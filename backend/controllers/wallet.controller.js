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
  getOrderStatus,
} from "../services/phonepe.service.js";
import { createRazorpayOrder, getRazorpayPaymentStatus, verifyRazorpayPaymentSignature } from '../services/razorpay.service.js';
import { getPaymentGateway } from '../config/runtime.js';
import { toPaise } from '../utils/money.js';
import { settleRazorpayWalletTopup } from '../services/walletTopup.service.js';
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

// @desc    Initiate a Razorpay wallet top-up
// @route   POST /api/wallet/topup/initiate
// @access  Private (Customer)
export const initiateWalletTopup = asyncHandler(async (req, res) => {
  if (getPaymentGateway() !== 'razorpay') throw httpError(503, 'Razorpay is not configured for wallet top-ups');
  const amountPaise = toPaise(req.body.amount);
  if (amountPaise < 100) throw httpError(400, 'Top-up amount must be at least ₹1');
  const paymentId = new mongoose.Types.ObjectId();
  const merchantOrderId = `TOPUP-${paymentId}`;
  const gw = await createRazorpayOrder({ merchantOrderId, amountPaise, notes: { paymentId: String(paymentId), purpose: 'wallet_topup' } });
  await Payment.create({
    _id: paymentId, userId: req.user._id, amount: amountPaise / 100, method: 'online',
    status: PAYMENT_STATUS.PENDING, isWalletTopup: true,
    gateway: { provider: 'razorpay', merchantOrderId, orderId: gw.orderId, initiatedAt: new Date() },
  });
  return created(res, {
    orderId: String(paymentId), razorpayOrderId: gw.orderId, keyId: gw.keyId,
    amountPaise, currency: 'INR', name: 'Bulkimart', description: 'Wallet top-up',
    verificationPath: '/api/wallet/topup/verify',
  }, 'Wallet top-up payment initiated');
});

export const verifyWalletTopup = asyncHandler(async (req, res) => {
  const { orderId, razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
  if (!mongoose.isValidObjectId(orderId)) throw httpError(400, 'Invalid top-up payment');
  const payment = await Payment.findOne({ _id: orderId, userId: req.user._id, isWalletTopup: true, 'gateway.provider': 'razorpay' });
  if (!payment) throw httpError(404, 'Top-up payment not found');
  if (payment.gateway.orderId !== razorpay_order_id) throw httpError(400, 'Top-up order mismatch');
  if (!verifyRazorpayPaymentSignature({ orderId: razorpay_order_id, paymentId: razorpay_payment_id, signature: razorpay_signature })) {
    throw httpError(401, 'Payment verification failed');
  }
  const live = await getRazorpayPaymentStatus({ orderId: razorpay_order_id, paymentId: razorpay_payment_id });
  const settled = await settleRazorpayWalletTopup({ payment, state: live.state, gatewayOrderId: live.orderId,
    gatewayPaymentId: live.paymentId, amountPaise: live.amountPaise, currency: live.currency, paymentDetails: live.paymentDetails });
  return ok(res, settled, settled.status === 'paid' ? 'Wallet top-up verified' : 'Payment has not been confirmed');
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
