import mongoose from "mongoose";
import User from "../models/User.js";
import WalletLedger, {
  WALLET_TRANSACTION_TYPE,
  WALLET_REFERENCE_TYPE,
} from "../models/WalletLedger.js";

import { httpError } from "../utils/response.js";
import { notifyUser, NOTIFICATION_EVENT } from "./notification.service.js";

const generateTransactionId = () => {
  const prefix = "WAL";
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `${prefix}-${timestamp}-${random}`;
};

/**
 * Get or initialize customer wallet
 */
export const getWallet = async (userId) => {
  let user = await User.findById(userId).select("wallet name email phone");
  if (!user) {
    throw httpError(404, "User not found");
  }

  if (!user.wallet) {
    user.wallet = { balance: 0, transactions: [] };
    await user.save();
  }

  return {
    userId: user._id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    balance: user.wallet.balance || 0,
    recentTransactions: (user.wallet.transactions || []).slice(-10).reverse(),
  };
};

/**
 * Get customer wallet balance only
 */
export const getWalletBalance = async (userId) => {
  const user = await User.findById(userId).select("wallet.balance");
  return user?.wallet?.balance || 0;
};

/**
 * Get paginated wallet transactions for a user
 */
export const getWalletTransactions = async (userId, { page = 1, limit = 20, type, direction } = {}) => {
  const query = { userId };
  if (type) query.type = type;
  if (direction) query.direction = direction;

  const skip = (Math.max(1, page) - 1) * limit;

  const [transactions, total] = await Promise.all([
    WalletLedger.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    WalletLedger.countDocuments(query),
  ]);

  return {
    transactions,
    total,
    page: Number(page),
    pages: Math.ceil(total / limit) || 1,
  };
};

/**
 * Atomically debit customer wallet
 */
export const debitWallet = async ({
  userId,
  amount,
  type = WALLET_TRANSACTION_TYPE.ORDER_PAYMENT,
  referenceType = WALLET_REFERENCE_TYPE.ORDER,
  referenceId = null,
  description,
  idempotencyKey = null,
  session = null,
  createdBy = null,
  createdByModel = null,
  metadata = {},
}) => {
  const debitAmount = Number(amount);
  if (!Number.isFinite(debitAmount) || debitAmount <= 0) {
    throw httpError(400, "Debit amount must be a positive number greater than 0");
  }

  // Idempotency check: if key already used, return existing transaction
  if (idempotencyKey) {
    const existing = session 
      ? await WalletLedger.findOne({ idempotencyKey }).session(session)
      : await WalletLedger.findOne({ idempotencyKey });
    if (existing) {
      return {
        success: true,
        alreadyProcessed: true,
        transaction: existing,
        balance: existing.balanceAfter,
      };
    }
  }

  // Safely initialize user wallet if missing or null in MongoDB
  await User.updateOne(
    { _id: userId, $or: [{ wallet: { $exists: false } }, { wallet: null }, { "wallet.balance": { $exists: false } }, { "wallet.balance": null }] },
    { $set: { wallet: { balance: 0, transactions: [] } } },
    session ? { session } : {}
  );

  // Atomic deduction with balance guard: balance >= debitAmount
  const updateOptions = { new: true, runValidators: true };
  if (session) updateOptions.session = session;

  const updatedUser = await User.findOneAndUpdate(
    { _id: userId, "wallet.balance": { $gte: debitAmount } },
    { $inc: { "wallet.balance": -debitAmount } },
    updateOptions
  );

  if (!updatedUser) {
    // Check if user exists to give exact error
    const checkUser = session
      ? await User.findById(userId).select("wallet.balance").session(session)
      : await User.findById(userId).select("wallet.balance");
    if (!checkUser) {
      throw httpError(404, "User not found for wallet debit");
    }
    throw httpError(400, `Insufficient wallet balance. Available: ₹${checkUser.wallet?.balance || 0}, Required: ₹${debitAmount}`);
  }

  const balanceAfter = updatedUser.wallet.balance;
  const balanceBefore = balanceAfter + debitAmount;
  const txnId = generateTransactionId();

  const ledgerData = {
    transactionId: txnId,
    userId,
    type,
    direction: "debit",
    amount: debitAmount,
    balanceBefore,
    balanceAfter,
    status: "completed",
    referenceType,
    referenceId: referenceId ? String(referenceId) : null,
    description: description || `Wallet debit of ₹${debitAmount}`,
    createdBy: createdBy || userId,
    createdByModel: createdByModel || "User",
    idempotencyKey,
    metadata,
  };

  let ledgerEntry;
  if (session) {
    const [entry] = await WalletLedger.create([ledgerData], { session });
    ledgerEntry = entry;
  } else {
    ledgerEntry = await WalletLedger.create(ledgerData);
  }

  // Sync to User.wallet.transactions array for fast profile reads
  const embeddedTxn = {
    type: "debit",
    amount: debitAmount,
    description: description || `Wallet debit of ₹${debitAmount}`,
    refId: txnId,
    createdAt: new Date(),
  };

  await User.updateOne(
    { _id: userId },
    { $push: { "wallet.transactions": { $each: [embeddedTxn], $slice: -50 } } },
    session ? { session } : {}
  );

  // Send real-time notification
  notifyUser(userId, {
    event: NOTIFICATION_EVENT.PAYMENT_SUCCESS || "WALLET_DEBIT",
    title: "Wallet Payment",
    message: `₹${debitAmount} deducted from your Bulkimart Wallet. Balance: ₹${balanceAfter}`,
    metadata: { transactionId: txnId, amount: debitAmount, balance: balanceAfter },
    route: "/profile",
  }).catch(() => {});

  return {
    success: true,
    transaction: ledgerEntry,
    balance: balanceAfter,
  };
};

/**
 * Atomically credit customer wallet
 */
export const creditWallet = async ({
  userId,
  amount,
  type = WALLET_TRANSACTION_TYPE.REFUND,
  referenceType = WALLET_REFERENCE_TYPE.RETURN,
  referenceId = null,
  description,
  idempotencyKey = null,
  session = null,
  createdBy = null,
  createdByModel = null,
  metadata = {},
}) => {
  const creditAmount = Number(amount);
  if (!Number.isFinite(creditAmount) || creditAmount <= 0) {
    throw httpError(400, "Credit amount must be a positive number greater than 0");
  }

  // Idempotency check: if key already used, return existing transaction
  if (idempotencyKey) {
    const existing = session
      ? await WalletLedger.findOne({ idempotencyKey }).session(session)
      : await WalletLedger.findOne({ idempotencyKey });
    if (existing) {
      return {
        success: true,
        alreadyProcessed: true,
        transaction: existing,
        balance: existing.balanceAfter,
      };
    }
  }

  // Safely initialize user wallet if missing or null in MongoDB
  await User.updateOne(
    { _id: userId, $or: [{ wallet: { $exists: false } }, { wallet: null }, { "wallet.balance": { $exists: false } }, { "wallet.balance": null }] },
    { $set: { wallet: { balance: 0, transactions: [] } } },
    session ? { session } : {}
  );

  const updateOptions = { new: true, runValidators: true };
  if (session) updateOptions.session = session;

  const updatedUser = await User.findOneAndUpdate(
    { _id: userId },
    { $inc: { "wallet.balance": creditAmount } },
    updateOptions
  );

  if (!updatedUser) {
    throw httpError(404, "User not found for wallet credit");
  }

  const balanceAfter = updatedUser.wallet.balance;
  const balanceBefore = balanceAfter - creditAmount;
  const txnId = generateTransactionId();

  const ledgerData = {
    transactionId: txnId,
    userId,
    type,
    direction: "credit",
    amount: creditAmount,
    balanceBefore,
    balanceAfter,
    status: "completed",
    referenceType,
    referenceId: referenceId ? String(referenceId) : null,
    description: description || `Wallet credit of ₹${creditAmount}`,
    createdBy: createdBy || userId,
    createdByModel: createdByModel || "User",
    idempotencyKey,
    metadata,
  };

  let ledgerEntry;
  if (session) {
    const [entry] = await WalletLedger.create([ledgerData], { session });
    ledgerEntry = entry;
  } else {
    ledgerEntry = await WalletLedger.create(ledgerData);
  }

  // Sync to User.wallet.transactions array
  const embeddedTxn = {
    type: "credit",
    amount: creditAmount,
    description: description || `Wallet credit of ₹${creditAmount}`,
    refId: txnId,
    createdAt: new Date(),
  };

  await User.updateOne(
    { _id: userId },
    { $push: { "wallet.transactions": { $each: [embeddedTxn], $slice: -50 } } },
    session ? { session } : {}
  );

  // Send real-time notification
  notifyUser(userId, {
    event: NOTIFICATION_EVENT.REFUND_COMPLETED || "WALLET_CREDIT",
    title: "Wallet Credited",
    message: `₹${creditAmount} credited to your Bulkimart Wallet. Available Balance: ₹${balanceAfter}`,
    metadata: { transactionId: txnId, amount: creditAmount, balance: balanceAfter },
    route: "/profile",
  }).catch(() => {});

  return {
    success: true,
    transaction: ledgerEntry,
    balance: balanceAfter,
  };
};

/**
 * Process wallet refund for cancelled or returned orders
 */
export const refundToWallet = async ({
  userId,
  amount,
  reason = "Order refund",
  referenceType = WALLET_REFERENCE_TYPE.RETURN,
  referenceId,
  idempotencyKey,
  session = null,
}) => {
  return await creditWallet({
    userId,
    amount,
    type: WALLET_TRANSACTION_TYPE.REFUND,
    referenceType,
    referenceId,
    description: reason,
    idempotencyKey: idempotencyKey || `REFUND:${referenceType}:${referenceId}`,
    session,
  });
};

/**
 * Admin controlled wallet credit
 */
export const adminCreditWallet = async ({ userId, amount, reason, adminId }) => {
  const cleanReason = String(reason || '').trim();
  if (!cleanReason || cleanReason.length < 5) {
    throw httpError(400, "A valid reason (minimum 5 characters) is mandatory for admin wallet credit adjustment");
  }

  // Auto-generate a unique idempotencyKey so the sparse unique index never
  // receives null and causes E11000 on repeated admin adjustments.
  const idempotencyKey = `ADMIN_CREDIT:${String(userId)}:${String(adminId)}:${Date.now()}`;

  const res = await creditWallet({
    userId,
    amount,
    type: WALLET_TRANSACTION_TYPE.ADMIN_CREDIT,
    referenceType: WALLET_REFERENCE_TYPE.ADMIN,
    referenceId: String(adminId),
    description: `Admin Credit: ${cleanReason}`,
    idempotencyKey,
    createdBy: adminId,
    createdByModel: "Admin",
    metadata: { reason: cleanReason, adminId },
  });

  return {
    ...res,
    walletBalance: res.balance,
  };
};

/**
 * Admin controlled wallet debit
 */
export const adminDebitWallet = async ({ userId, amount, reason, adminId }) => {
  const cleanReason = String(reason || '').trim();
  if (!cleanReason || cleanReason.length < 5) {
    throw httpError(400, "A valid reason (minimum 5 characters) is mandatory for admin wallet debit adjustment");
  }

  // Auto-generate a unique idempotencyKey so the sparse unique index never
  // receives null and causes E11000 on repeated admin adjustments.
  const idempotencyKey = `ADMIN_DEBIT:${String(userId)}:${String(adminId)}:${Date.now()}`;

  const res = await debitWallet({
    userId,
    amount,
    type: WALLET_TRANSACTION_TYPE.ADMIN_DEBIT,
    referenceType: WALLET_REFERENCE_TYPE.ADMIN,
    referenceId: String(adminId),
    description: `Admin Debit: ${reason.trim()}`,
    idempotencyKey,
    createdBy: adminId,
    createdByModel: "Admin",
    metadata: { reason: reason.trim(), adminId },
  });

  return {
    ...res,
    walletBalance: res.balance,
  };
};

/**
 * Admin: Get aggregated wallet statistics
 */
export const getAdminWalletOverview = async () => {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const [totalUsers, usersWithWalletRes, totalBalanceRes, ledgerAgg, typeAgg] = await Promise.all([
    User.countDocuments(),
    User.countDocuments({ "wallet.balance": { $gt: 0 } }),
    User.aggregate([{ $group: { _id: null, total: { $sum: "$wallet.balance" } } }]),
    WalletLedger.aggregate([
      {
        $group: {
          _id: "$direction",
          totalAmount: { $sum: "$amount" },
          count: { $sum: 1 },
        },
      },
    ]),
    WalletLedger.aggregate([
      {
        $group: {
          _id: "$type",
          totalAmount: { $sum: "$amount" },
          count: { $sum: 1 },
        },
      },
    ]),
  ]);

  const totalWalletBalance = totalBalanceRes[0]?.total || 0;
  let totalCredits = 0;
  let totalDebits = 0;

  ledgerAgg.forEach((item) => {
    if (item._id === "credit") totalCredits = item.totalAmount;
    if (item._id === "debit") totalDebits = item.totalAmount;
  });

  let userDebits = 0;
  let adminDebits = 0;
  let userTopups = 0;
  let adminCredits = 0;
  let refundCredits = 0;

  typeAgg.forEach((item) => {
    const t = String(item._id || "").toLowerCase();
    if (t === "order_payment") userDebits = item.totalAmount;
    if (t === "admin_debit") adminDebits = item.totalAmount;
    if (t === "topup" || t === "wallet_topup") userTopups = item.totalAmount;
    if (t === "admin_credit") adminCredits = item.totalAmount;
    if (t === "refund" || t.includes("refund")) refundCredits += item.totalAmount;
  });

  const totalDonationReceived = 0;
  const totalDonationCount = 0;
  const todayDonationReceived = 0;

  return {
    totalUsers,
    usersWithWallet: usersWithWalletRes,
    totalBalance: totalWalletBalance,
    totalWalletBalance,
    totalCredits,
    totalDebits,
    userDebits,
    adminDebits,
    userTopups,
    adminCredits,
    refundCredits,
    totalDonationReceived,
    totalDonationCount,
    todayDonationReceived,
  };
};

/**
 * Admin: List user wallets with search & pagination
 */
export const getAdminUserWallets = async ({ page = 1, limit = 20, search, minBalance }) => {
  const query = {};

  if (search && search.trim()) {
    const regex = new RegExp(search.trim(), "i");
    query.$or = [{ name: regex }, { email: regex }, { phone: regex }];
  }

  if (minBalance !== undefined && !isNaN(minBalance)) {
    query["wallet.balance"] = { $gte: Number(minBalance) };
  }

  const skip = (Math.max(1, page) - 1) * limit;

  const [users, total] = await Promise.all([
    User.find(query)
      .select("name email phone wallet isActive createdAt")
      .sort({ "wallet.balance": -1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    User.countDocuments(query),
  ]);

  return {
    users: users.map((u) => {
      const bal = u.wallet?.balance || 0;
      return {
        _id: u._id,
        name: u.name || "N/A",
        email: u.email || "N/A",
        phone: u.phone || "N/A",
        balance: bal,
        wallet: {
          balance: bal,
          transactions: u.wallet?.transactions || [],
        },
        isActive: u.isActive,
        lastTransactionAt: u.wallet?.transactions?.slice(-1)[0]?.createdAt || u.createdAt,
      };
    }),
    total,
    page: Number(page),
    pages: Math.ceil(total / limit) || 1,
  };
};

/**
 * Admin: List all wallet ledger transactions
 */
export const getAdminWalletTransactions = async ({ page = 1, limit = 20, type, search, userId }) => {
  const query = {};

  if (userId) {
    query.userId = userId;
  }

  if (type) {
    query.type = type;
  }

  if (search && search.trim()) {
    const regex = new RegExp(search.trim(), "i");
    query.$or = [
      { transactionId: regex },
      { description: regex },
      { referenceId: regex },
    ];
  }

  const skip = (Math.max(1, page) - 1) * limit;

  const [transactions, total] = await Promise.all([
    WalletLedger.find(query)
      .populate("userId", "name email phone")
      .populate("createdBy", "name email")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    WalletLedger.countDocuments(query),
  ]);

  return {
    transactions,
    total,
    page: Number(page),
    pages: Math.ceil(total / limit) || 1,
  };
};
