import mongoose from "mongoose";
import Payment from "../models/Payment.js";
import { asyncHandler } from "../middlewares/error.middleware.js";
import { ok, created, httpError, paginated } from "../utils/response.js";
import {
  getWallet,
  getWalletTransactions,
  creditWallet,
  adminCreditWallet,
  adminDebitWallet,
  getAdminWalletOverview,
  getAdminUserWallets,
  getAdminWalletTransactions,
} from "../services/wallet.service.js";
import {
  createPayment,
  getOrderStatus,
  rupeesToPaise,
  isConfigured,
} from "../services/phonepe.service.js";
import { PAYMENT_STATUS } from "../constants/enums.js";

// ============================================================================
// CUSTOMER WALLET ENDPOINTS & TOP-UP
// ============================================================================

// @desc    Direct quick credit for testing/dev mode
// @route   POST /api/wallet/dev-topup
// @access  Private (Customer)
export const devQuickTopup = asyncHandler(async (req, res) => {
  const { amount } = req.body;
  const numAmount = Number(amount);
  if (!Number.isFinite(numAmount) || numAmount < 1) {
    throw httpError(400, "Amount must be a positive number");
  }

  const result = await creditWallet({
    userId: req.user._id,
    amount: numAmount,
    type: "WALLET_TOPUP",
    referenceType: "TOPUP",
    referenceId: `DEV-${Date.now()}`,
    description: `Dev Mode Instant Wallet Top-up (₹${numAmount})`,
    idempotencyKey: `DEV_TOPUP:${req.user._id}:${Date.now()}`,
  });

  return ok(res, result, `₹${numAmount} credited to your wallet instantly`);
});

// Settle Topup payment (called from webhook, return redirect or status polling)
export const settleWalletTopupPayment = async ({
  payment,
  state,
  gatewayOrderId,
  paymentDetails,
  errorCode,
}) => {
  if (payment.status !== PAYMENT_STATUS.PENDING) {
    return { changed: false, status: payment.status };
  }

  const applySettlement = async (session = null) => {
    const query = Payment.findById(payment._id);
    if (session) query.session(session);
    const fresh = await query;

    if (!fresh || fresh.status !== PAYMENT_STATUS.PENDING) {
      return { changed: false, status: fresh?.status || payment.status };
    }

    if (state === "COMPLETED") {
      fresh.status = PAYMENT_STATUS.PAID;
      fresh.paidAt = new Date();
      fresh.gateway = {
        ...(fresh.gateway || {}),
        orderId: gatewayOrderId,
        paymentDetails,
      };
      if (session) {
        await fresh.save({ session });
      } else {
        await fresh.save();
      }

      await creditWallet({
        userId: fresh.userId,
        amount: fresh.amount,
        type: "WALLET_TOPUP",
        referenceType: "TOPUP",
        referenceId: String(fresh._id),
        description: `Wallet top-up of ₹${fresh.amount} via PhonePe`,
        idempotencyKey: `TOPUP:${fresh._id}`,
        session,
      });

      return { changed: true, status: "paid" };
    } else if (state === "FAILED") {
      fresh.status = PAYMENT_STATUS.FAILED;
      fresh.gateway = {
        ...(fresh.gateway || {}),
        orderId: gatewayOrderId,
        errorCode,
      };
      if (session) {
        await fresh.save({ session });
      } else {
        await fresh.save();
      }
      return { changed: true, status: "failed" };
    }

    return { changed: false, status: fresh.status };
  };

  try {
    const session = await mongoose.startSession();
    let result = { changed: false, status: payment.status };
    try {
      await session.withTransaction(async () => {
        result = await applySettlement(session);
      });
      return result;
    } catch (txnError) {
      console.warn("MongoDB transaction unsupported/failed in top-up settlement, executing fallback:", txnError.message);
      return await applySettlement(null);
    } finally {
      await session.endSession();
    }
  } catch (err) {
    return await applySettlement(null);
  }
};

// @desc    Initiate PhonePe payment for top-up
// @route   POST /api/wallet/topup/initiate
// @access  Private (Customer)
export const initiateWalletTopup = asyncHandler(async (req, res) => {
  if (!isConfigured()) {
    throw httpError(503, "Online payment gateway is not configured");
  }

  const { amount } = req.body;
  const numAmount = Number(amount);

  if (!Number.isFinite(numAmount) || numAmount < 1) {
    throw httpError(400, "Top-up amount must be at least ₹1");
  }
  if (numAmount > 100000) {
    throw httpError(400, "Maximum single top-up amount is ₹1,00,000");
  }

  const payment = await Payment.create({
    userId: req.user._id,
    amount: numAmount,
    method: "online",
    status: PAYMENT_STATUS.PENDING,
    isWalletTopup: true,
  });

  const merchantOrderId = `TOPUP-${payment._id}-A1`;
  const base =
    process.env.API_BASE_URL || `http://localhost:${process.env.PORT || 5050}`;
  const redirectUrl = `${base}/api/wallet/topup/return/${merchantOrderId}`;

  const gw = await createPayment({
    merchantOrderId,
    amountPaise: rupeesToPaise(numAmount),
    redirectUrl,
    message: `Bulkimart Wallet Top-up — ₹${numAmount}`,
  });

  payment.gateway = {
    provider: "phonepe",
    merchantOrderId,
    orderId: gw.orderId,
    initiatedAt: new Date(),
  };
  await payment.save();

  return created(
    res,
    {
      redirectUrl: gw.redirectUrl,
      merchantOrderId,
      amount: numAmount,
    },
    "PhonePe top-up payment initiated"
  );
});

// @desc    PhonePe return handler for wallet top-up
// @route   GET /api/wallet/topup/return/:merchantOrderId
// @access  Public
export const walletTopupReturn = asyncHandler(async (req, res) => {
  const { merchantOrderId } = req.params;
  const payment = await Payment.findOne({
    "gateway.merchantOrderId": merchantOrderId,
  });

  let status = "unknown";
  if (payment) {
    try {
      const live = await getOrderStatus(merchantOrderId);
      const settled = await settleWalletTopupPayment({
        payment,
        state: live.state,
        gatewayOrderId: live.orderId,
        paymentDetails: live.paymentDetails,
      });
      status = settled.status;
    } catch {
      status = payment.status;
    }
  }

  const app = process.env.APP_BASE_URL || process.env.FRONTEND_URL || "http://localhost:4173";
  return res.redirect(
    `${app}/profile?topupStatus=${encodeURIComponent(status)}`
  );
});

// @desc    Get top-up payment status & update wallet if completed
// @route   GET /api/wallet/topup/status/:merchantOrderId
// @access  Private (Customer)
export const getWalletTopupStatus = asyncHandler(async (req, res) => {
  const { merchantOrderId } = req.params;
  const payment = await Payment.findOne({
    "gateway.merchantOrderId": merchantOrderId,
  });
  if (!payment) throw httpError(404, "Top-up payment record not found");
  if (String(payment.userId) !== String(req.user._id)) {
    throw httpError(403, "Not your top-up payment");
  }

  if (
    payment.status === PAYMENT_STATUS.PENDING &&
    payment.gateway?.merchantOrderId
  ) {
    try {
      const live = await getOrderStatus(payment.gateway.merchantOrderId);
      await settleWalletTopupPayment({
        payment,
        state: live.state,
        gatewayOrderId: live.orderId,
        paymentDetails: live.paymentDetails,
      });
    } catch {}
  }

  const fresh = await Payment.findById(payment._id);
  const userWallet = await getWallet(req.user._id);

  return ok(
    res,
    {
      status: fresh.status,
      amount: fresh.amount,
      paidAt: fresh.paidAt,
      balance: userWallet.balance,
    },
    "Wallet top-up status"
  );
});

// @desc    Get logged in user's wallet details & balance
// @route   GET /api/wallet
// @access  Private (Customer)
export const getMyWallet = asyncHandler(async (req, res) => {
  const data = await getWallet(req.user._id);
  return ok(res, data, "Wallet details retrieved successfully");
});

// @desc    Get logged in user's wallet transaction history
// @route   GET /api/wallet/transactions
// @access  Private (Customer)
export const getMyWalletTransactions = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, type, direction } = req.query;
  const result = await getWalletTransactions(req.user._id, {
    page: Number(page),
    limit: Number(limit),
    type,
    direction,
  });

  return paginated(
    res,
    result.transactions,
    { page: result.page, limit: Number(limit), total: result.total }
  );
});

// ============================================================================
// ADMIN WALLET MANAGEMENT ENDPOINTS
// ============================================================================

// @desc    Get aggregated admin wallet overview stats
// @route   GET /api/admin/wallet/overview
// @access  Private (Admin)
export const adminGetOverview = asyncHandler(async (req, res) => {
  const stats = await getAdminWalletOverview();
  return ok(res, stats, "Admin wallet overview stats retrieved");
});

// @desc    Get list of user wallets for admin
// @route   GET /api/admin/wallet/users
// @access  Private (Admin)
export const adminGetUserWallets = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, search, minBalance } = req.query;
  const result = await getAdminUserWallets({
    page: Number(page),
    limit: Number(limit),
    search,
    minBalance,
  });

  return paginated(
    res,
    result.users,
    { page: result.page, limit: Number(limit), total: result.total }
  );
});

// @desc    Get single user's wallet detail & transactions for admin
// @route   GET /api/admin/wallet/users/:userId
// @access  Private (Admin)
export const adminGetUserWalletDetail = asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const wallet = await getWallet(userId);
  const { transactions } = await getWalletTransactions(userId, { page: 1, limit: 50 });

  return ok(
    res,
    {
      ...wallet,
      transactions,
    },
    "User wallet details retrieved for admin"
  );
});

// @desc    Get all wallet ledger transactions across platform for admin
// @route   GET /api/admin/wallet/transactions
// @access  Private (Admin)
export const adminGetAllTransactions = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, type, search, userId } = req.query;
  const result = await getAdminWalletTransactions({
    page: Number(page),
    limit: Number(limit),
    type,
    search,
    userId,
  });

  return paginated(
    res,
    result.transactions,
    { page: result.page, limit: Number(limit), total: result.total }
  );
});

// @desc    Perform controlled wallet credit adjustment by admin
// @route   POST /api/admin/wallet/users/:userId/credit
// @access  Private (Admin)
export const adminCreditUser = asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const { amount, reason } = req.body;

  const numAmount = Number(amount);
  if (!Number.isFinite(numAmount) || numAmount <= 0) {
    throw httpError(400, "Amount must be a positive number greater than 0");
  }

  const cleanReason = String(reason || '').trim();
  if (!cleanReason || cleanReason.length < 5) {
    throw httpError(400, "A detailed reason (at least 5 characters) is required for admin credit adjustment");
  }

  const result = await adminCreditWallet({
    userId,
    amount: numAmount,
    reason: cleanReason,
    adminId: req.user._id,
  });

  return ok(res, result, `₹${numAmount} successfully credited to user wallet`);
});

// @desc    Perform controlled wallet debit adjustment by admin
// @route   POST /api/admin/wallet/users/:userId/debit
// @access  Private (Admin)
export const adminDebitUser = asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const { amount, reason } = req.body;

  const numAmount = Number(amount);
  if (!Number.isFinite(numAmount) || numAmount <= 0) {
    throw httpError(400, "Amount must be a positive number greater than 0");
  }

  const cleanReason = String(reason || '').trim();
  if (!cleanReason || cleanReason.length < 5) {
    throw httpError(400, "A detailed reason (at least 5 characters) is required for admin debit adjustment");
  }

  const result = await adminDebitWallet({
    userId,
    amount: numAmount,
    reason: String(reason).trim(),
    adminId: req.user._id,
  });

  return ok(res, result, `₹${numAmount} successfully debited from user wallet`);
});
