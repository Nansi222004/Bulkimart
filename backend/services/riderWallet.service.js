import mongoose from 'mongoose';
import DeliveryPartner from '../models/DeliveryPartner.js';
import SellerLedgerEntry from '../models/SellerLedgerEntry.js';
import RiderCashPayment from '../models/RiderCashPayment.js';
import User from '../models/User.js';
import { postLedgerEntry } from './sellerLedger.service.js';
import { financialTransaction } from './financeSafety.service.js';
import { getFinancePolicy } from './financePolicy.service.js';
import { riderLedgerBalances } from './deliveryPayout.service.js';
import { httpError } from '../utils/response.js';

/**
 * Rider wallet for COD parcels.
 *
 * A rider who collects a parcel's cash keeps their own earning from it and owes
 * Bulkimart the rest. Both go into the rider's existing earnings ledger
 * (rider_payable, "available" bucket), so the wallet is one running balance:
 *
 *   COD parcel: cash ₹50, earning ₹30  →  −₹50 + ₹30  =  −₹20 (owes ₹20)
 *   any later earning (+₹40)           →  +₹20 (debt cleared, nothing extra to do)
 *   or a UPI / cash payment approved by an admin (+₹20) → ₹0
 *
 * Wallet shown = on hold + available. Payouts stay limited to the positive
 * available part (deliveryPayout.service), so money covering a debt is never paid out.
 * Shop COD orders keep their own order-by-order cash handover.
 */

const paiseOf = (rupees) => Math.round(Number(rupees) * 100);

/** Posts one wallet entry and keeps the older earnings counters in step. Idempotent per key. */
export async function postRiderWallet({ partnerId, key, type, direction, paise, description, reference, metadata = {}, session }) {
  if (!Number.isSafeInteger(paise) || paise <= 0) return { alreadyProcessed: true };
  const { alreadyProcessed } = await postLedgerEntry({
    idempotencyKey: `RIDER_WALLET:${key}`, partnerId, account: 'rider_payable', type, direction, bucket: 'eligible',
    amount: paise / 100, description, reference, metadata: { source: 'rider-wallet', ...metadata },
  }, { session });
  if (!alreadyProcessed) {
    const rupees = (direction === 'credit' ? 1 : -1) * paise / 100;
    await DeliveryPartner.updateOne({ _id: partnerId }, { $inc: { 'earnings.pending': rupees, ...(type === 'parcel_earning' ? { 'earnings.total': rupees } : {}) } }, { session });
  }
  return { alreadyProcessed };
}

/** Wallet balance in paise: on hold + available (debts are negative). */
export async function riderWalletPaise(partnerId, { session = null } = {}) {
  const b = await riderLedgerBalances(partnerId, { session });
  return b.held + b.eligible;
}

const parcelRef = (b) => `#${String(b.reference || b._id).slice(-6).toUpperCase()}`;

// ---------------------------------------------------------------- parcel events (called inside the parcel's transaction)
/** Cash collected for a parcel: the rider now owes the whole amount until their earning is added. */
export async function parcelCashToWallet(b, session) {
  await postRiderWallet({
    partnerId: b.partnerId, key: `PARCEL:${b._id}:CASH`, type: 'parcel_cash_due', direction: 'debit', paise: b.cash.amountPaise,
    description: `COD cash collected for parcel ${parcelRef(b)}`, reference: b.reference,
    metadata: { parcelDeliveryId: String(b._id) }, session,
  });
}

/** Parcel delivered: the rider's earning goes into the wallet (immediately available; parcels have no return window). */
export async function parcelEarningToWallet(b, session) {
  await postRiderWallet({
    partnerId: b.partnerId, key: `PARCEL:${b._id}:EARNING`, type: 'parcel_earning', direction: 'credit', paise: b.pricing.driverPaise,
    description: `Earning for parcel ${parcelRef(b)}`, reference: b.reference,
    metadata: { parcelDeliveryId: String(b._id), paymentMethod: b.paymentMethod }, session,
  });
}

/** An admin confirmed the rider handed the cash back to the customer: the rider no longer owes it. */
export async function parcelCashReturnedToWallet(b, session) {
  await postRiderWallet({
    partnerId: b.cash.collectorId || b.partnerId, key: `PARCEL:${b._id}:CASH_RETURNED`, type: 'parcel_cash_due', direction: 'credit', paise: b.cash.amountPaise,
    description: `Cash returned to the customer for parcel ${parcelRef(b)}`, reference: b.reference,
    metadata: { parcelDeliveryId: String(b._id) }, session,
  });
}

// ---------------------------------------------------------------- debt limit
/**
 * Why a rider may not take this cash parcel, or null. Taking it would leave them owing
 * more than the admin's limit (cash minus their earning is what it adds to the debt).
 */
export async function parcelDebtLimitReason(partnerId, b, session) {
  if (b.paymentMethod !== 'pay_driver') return null;
  const { riderParcelDebtLimit } = await getFinancePolicy({ session });
  const limitPaise = paiseOf(riderParcelDebtLimit ?? 500);
  const adds = Math.max(0, (b.pricing?.totalPaise || 0) - (b.pricing?.driverPaise || 0));
  const after = (await riderWalletPaise(partnerId, { session })) - adds;
  return after < -limitPaise ? 'cash_debt_limit' : null;
}

// ---------------------------------------------------------------- views
const STATEMENT_TYPES = ['parcel_earning', 'parcel_cash_due', 'rider_cash_payment', 'delivery_earning', 'payout_reservation', 'payout_settlement'];
/** The entries a rider understands (release/bookkeeping moves between buckets are left out). */
async function statement(partnerId, limit = 100) {
  const rows = await SellerLedgerEntry.find({
    partnerId, account: 'rider_payable', type: { $in: STATEMENT_TYPES },
    $or: [
      { type: { $in: ['parcel_earning', 'parcel_cash_due', 'rider_cash_payment'] } },
      { type: 'delivery_earning', direction: 'credit' },
      { type: 'payout_reservation', bucket: 'eligible', direction: 'debit' },
      { type: 'payout_settlement', bucket: 'eligible', direction: 'credit' }, // a cancelled payout returning
    ],
  }).sort({ createdAt: -1 }).limit(limit).select('type direction bucket amount description reference metadata createdAt').lean();
  return rows.map((r) => ({
    _id: r._id, type: r.type, at: r.createdAt, description: r.description, reference: r.reference,
    amountPaise: (r.direction === 'credit' ? 1 : -1) * Math.round(r.amount * 100),
    onHold: r.bucket === 'held', parcelDeliveryId: r.metadata?.parcelDeliveryId,
  }));
}

export async function riderWalletView(partnerId) {
  const [balances, policy, pending, recent, rows] = await Promise.all([
    riderLedgerBalances(partnerId), getFinancePolicy(),
    RiderCashPayment.findOne({ partnerId, status: 'pending' }).lean(),
    RiderCashPayment.find({ partnerId }).sort({ createdAt: -1 }).limit(10).lean(),
    statement(partnerId),
  ]);
  const balancePaise = balances.held + balances.eligible;
  const limitPaise = paiseOf(policy.riderParcelDebtLimit ?? 500);
  return {
    balancePaise, owedPaise: Math.max(0, -balancePaise),
    availablePaise: Math.max(0, balances.eligible), onHoldPaise: balances.held,
    debtLimitPaise: limitPaise, cashParcelsBlocked: balancePaise <= -limitPaise,
    pendingPayment: pending ? paymentView(pending) : null,
    payments: recent.map(paymentView),
    statement: rows,
  };
}

const paymentView = (p) => ({
  _id: p._id, amountPaise: p.amountPaise, method: p.method, reference: p.reference, note: p.note, status: p.status,
  approvedPaise: p.approvedPaise, rejectReason: p.rejectReason, createdAt: p.createdAt, reviewedAt: p.reviewedAt,
});

// ---------------------------------------------------------------- manual payments
export async function submitRiderCashPayment(partner, userId, input = {}) {
  const amountPaise = paiseOf(input.amount);
  const method = input.method;
  const reference = String(input.reference || '').trim();
  const note = String(input.note || '').trim().slice(0, 300);
  if (!['upi', 'cash'].includes(method)) throw httpError(400, 'Choose UPI or cash');
  if (!Number.isSafeInteger(amountPaise) || amountPaise < 100) throw httpError(400, 'Enter an amount of at least ₹1');
  if (reference.length < 4 || reference.length > 100) throw httpError(400, method === 'upi' ? 'Enter the UPI transaction ID / UTR (at least 4 characters)' : 'Enter the cash receipt number or who received it (at least 4 characters)');
  const owed = Math.max(0, -(await riderWalletPaise(partner._id)));
  if (!owed) throw httpError(409, 'You do not owe Bulkimart anything right now.');
  if (amountPaise > owed) throw httpError(400, `You owe ₹${(owed / 100).toFixed(2)}. Enter that amount or less.`);
  try {
    const payment = await RiderCashPayment.create({ partnerId: partner._id, userId, amountPaise, method, reference, note });
    notifyAdminsOfPayment(payment, partner).catch(() => {});
    return paymentView(payment);
  } catch (err) {
    if (err?.code === 11000) throw httpError(409, 'You already have a payment waiting for approval.');
    throw err;
  }
}

async function notifyAdminsOfPayment(payment, partner) {
  const { notifyAllAdmins } = await import('./notification.service.js');
  const user = await User.findById(partner.userId).select('name').lean();
  await notifyAllAdmins({
    event: 'SYSTEM', title: 'Rider cash payment to approve',
    message: `${user?.name || 'A rider'} reported paying ₹${(payment.amountPaise / 100).toFixed(2)} by ${payment.method === 'upi' ? 'UPI' : 'cash'} (ref ${payment.reference}).`,
    metadata: { riderCashPaymentId: String(payment._id) }, route: '/admin/rider-wallets',
  });
}

/** Admin approves with the amount actually received; it is added to the rider's wallet. */
export async function approveRiderCashPayment(paymentId, adminId, input = {}) {
  if (!mongoose.isValidObjectId(paymentId)) throw httpError(400, 'Invalid payment');
  const payment = await financialTransaction(async (session) => {
    const p = await RiderCashPayment.findOne({ _id: paymentId, status: 'pending' }).session(session);
    if (!p) throw httpError(409, 'This payment is no longer waiting for approval.');
    const received = input.amount === undefined || input.amount === null || input.amount === '' ? p.amountPaise : paiseOf(input.amount);
    if (!Number.isSafeInteger(received) || received < 100 || received > p.amountPaise) throw httpError(400, `Approve an amount between ₹1 and ₹${(p.amountPaise / 100).toFixed(2)} (what the rider reported).`);
    p.status = 'approved'; p.approvedPaise = received; p.reviewedBy = adminId; p.reviewedAt = new Date();
    await p.save({ session });
    await postRiderWallet({
      partnerId: p.partnerId, key: `PAYMENT:${p._id}`, type: 'rider_cash_payment', direction: 'credit', paise: received,
      description: `Paid to Bulkimart by ${p.method === 'upi' ? 'UPI' : 'cash'} (ref ${p.reference})`, reference: p.reference,
      metadata: { riderCashPaymentId: String(p._id), method: p.method }, session,
    });
    return p;
  });
  notifyRiderOfPayment(payment).catch(() => {});
  return paymentView(payment);
}

export async function rejectRiderCashPayment(paymentId, adminId, input = {}) {
  if (!mongoose.isValidObjectId(paymentId)) throw httpError(400, 'Invalid payment');
  const reason = String(input.reason || '').trim();
  if (reason.length < 3 || reason.length > 300) throw httpError(400, 'Give the rider a reason (3–300 characters)');
  const p = await RiderCashPayment.findOneAndUpdate({ _id: paymentId, status: 'pending' },
    { $set: { status: 'rejected', rejectReason: reason, reviewedBy: adminId, reviewedAt: new Date() } }, { returnDocument: 'after' });
  if (!p) throw httpError(409, 'This payment is no longer waiting for approval.');
  notifyRiderOfPayment(p).catch(() => {});
  return paymentView(p);
}

async function notifyRiderOfPayment(p) {
  const { notifyRider } = await import('./notification.service.js');
  const ok = p.status === 'approved';
  await notifyRider(String(p.partnerId), {
    event: ok ? 'PAYOUT_COMPLETED' : 'PAYOUT_REJECTED',
    title: ok ? 'Cash payment approved' : 'Cash payment not approved',
    message: ok ? `₹${(p.approvedPaise / 100).toFixed(2)} you paid to Bulkimart was added to your wallet.` : `Your payment of ₹${(p.amountPaise / 100).toFixed(2)} was not approved: ${p.rejectReason}`,
    metadata: { riderCashPaymentId: String(p._id) }, route: '/delivery/earnings',
  });
}

// ---------------------------------------------------------------- admin lists
/** Riders whose wallet is negative (owe Bulkimart), most owed first. */
export async function ridersOwing({ q, page = 1, limit = 20 } = {}) {
  page = Math.max(1, Number(page) || 1); limit = Math.min(100, Math.max(1, Number(limit) || 20));
  const paise = { $toLong: { $round: [{ $multiply: ['$amount', 100] }, 0] } };
  const rows = await SellerLedgerEntry.aggregate([
    { $match: { account: 'rider_payable', bucket: { $in: ['held', 'eligible'] }, partnerId: { $exists: true } } },
    { $group: {
      _id: '$partnerId',
      balance: { $sum: { $cond: [{ $eq: ['$direction', 'credit'] }, paise, { $multiply: [paise, -1] }] } },
      lastCashAt: { $max: { $cond: [{ $eq: ['$type', 'parcel_cash_due'] }, '$createdAt', null] } },
    } },
    { $match: { balance: { $lt: 0 } } },
    { $lookup: { from: DeliveryPartner.collection.name, localField: '_id', foreignField: '_id', as: 'partner', pipeline: [{ $project: { userId: 1, vehicleType: 1, vehicleNo: 1 } }] } },
    { $unwind: '$partner' },
    { $lookup: { from: User.collection.name, localField: 'partner.userId', foreignField: '_id', as: 'user', pipeline: [{ $project: { name: 1, phone: 1 } }] } },
    { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
    ...(String(q || '').trim() ? [{ $match: { $or: ['user.name', 'user.phone'].map((f) => ({ [f]: new RegExp(String(q).trim().slice(0, 60).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') })) } }] : []),
    { $lookup: { from: RiderCashPayment.collection.name, localField: '_id', foreignField: 'partnerId', as: 'pending', pipeline: [{ $match: { status: 'pending' } }, { $project: { amountPaise: 1, method: 1, reference: 1, createdAt: 1 } }] } },
    { $sort: { balance: 1 } },
    { $facet: { rows: [{ $skip: (page - 1) * limit }, { $limit: limit }], totals: [{ $group: { _id: null, riders: { $sum: 1 }, owed: { $sum: { $multiply: ['$balance', -1] } } } }] } },
  ]);
  const totals = rows[0]?.totals?.[0] || { riders: 0, owed: 0 };
  const policy = await getFinancePolicy();
  return {
    debtLimitPaise: paiseOf(policy.riderParcelDebtLimit ?? 500),
    totals: { riders: totals.riders, owedPaise: Number(totals.owed) },
    rows: (rows[0]?.rows || []).map((r) => ({
      partnerId: r._id, name: r.user?.name || 'Rider', phone: r.user?.phone, vehicle: [r.partner.vehicleType, r.partner.vehicleNo].filter(Boolean).join(' · '),
      owedPaise: -Number(r.balance), lastCashAt: r.lastCashAt, pendingPayment: r.pending[0] || null,
    })),
    page, limit, totalPages: Math.max(1, Math.ceil(totals.riders / limit)),
  };
}

export async function listRiderCashPayments({ status = 'pending', page = 1, limit = 20 } = {}) {
  page = Math.max(1, Number(page) || 1); limit = Math.min(100, Math.max(1, Number(limit) || 20));
  const filter = ['pending', 'approved', 'rejected'].includes(status) ? { status } : {};
  const [rows, total] = await Promise.all([
    RiderCashPayment.find(filter).sort({ createdAt: status === 'pending' ? 1 : -1 }).skip((page - 1) * limit).limit(limit)
      .populate('userId', 'name phone').populate('reviewedBy', 'name').lean(),
    RiderCashPayment.countDocuments(filter),
  ]);
  const owed = new Map(await Promise.all(rows.map(async (p) => [String(p._id), Math.max(0, -(await riderWalletPaise(p.partnerId)))])));
  return {
    rows: rows.map((p) => ({ ...paymentView(p), partnerId: p.partnerId, riderName: p.userId?.name || 'Rider', riderPhone: p.userId?.phone, reviewedBy: p.reviewedBy?.name, currentlyOwedPaise: owed.get(String(p._id)) })),
    page, limit, totalPages: Math.max(1, Math.ceil(total / limit)), total,
  };
}

export async function riderWalletAdminDetail(partnerId) {
  if (!mongoose.isValidObjectId(partnerId)) throw httpError(400, 'Invalid rider');
  const partner = await DeliveryPartner.findById(partnerId).select('userId vehicleType vehicleNo').lean();
  if (!partner) throw httpError(404, 'Rider not found');
  const user = await User.findById(partner.userId).select('name phone').lean();
  return { rider: { partnerId, name: user?.name || 'Rider', phone: user?.phone, vehicle: [partner.vehicleType, partner.vehicleNo].filter(Boolean).join(' · ') }, ...(await riderWalletView(partnerId)) };
}
