import mongoose from 'mongoose';
import FbbChargeConfig from '../models/FbbChargeConfig.js';
import FbbCharge from '../models/FbbCharge.js';
import Seller from '../models/Seller.js';
import Payment from '../models/Payment.js';
import SellerLedgerEntry from '../models/SellerLedgerEntry.js';
import { postLedgerEntry, sellerBalances } from './sellerLedger.service.js';
import { financialTransaction } from './financeSafety.service.js';
import { razorpayAttempt, addRefundObligation } from './paymentObligations.service.js';
import { createRazorpayOrder } from './razorpay.service.js';
import { getPaymentGateway } from '../config/runtime.js';
import { httpError } from '../utils/response.js';
import { currentChargeConfig } from './warehouse.service.js';

/**
 * FBB service charges (approved 2026-11-25): storage once per accepted unit at verified receipt, packaging
 * when packing is done, fulfilment at hand-off. Rates are versioned; packaging and fulfilment rates are
 * frozen on the order at placement (Order.fbb.chargeTerms), storage uses the version in force at receipt.
 *
 * Money flow (all on the seller's FBB obligation account, never on the customer's bill):
 *   charge      debit  seller_fbb_obligation   (FbbCharge _id = idempotency key; booked once)
 *   reversal    credit seller_fbb_obligation   (approved correction; the charge is marked reversed, never deleted)
 *   settlement  debit  seller_payable/eligible + credit seller_fbb_obligation (netted from earnings before payouts)
 *   payment     credit seller_fbb_obligation   (seller pays in advance, verified Razorpay capture)
 * Commission is computed on the goods exactly as before; these charges never touch it. Tax treatment is
 * pending accountant review, so no tax is added here.
 */

const LEDGER_TYPE = { storage: 'fbb_storage_fee', packaging: 'fbb_packaging_fee', fulfillment: 'fbb_fulfillment_fee' };
const ACCOUNT = 'seller_fbb_obligation';
const paise = (value) => Math.round(Number(value) * 100);
const rupees = (p) => p / 100;

/* ------------------------------------------------------------------ configuration -------------------------------- */

const parseRate = (raw, label, bases) => {
  const amountPaise = paise(raw?.amount);
  if (!Number.isSafeInteger(amountPaise) || amountPaise < 0 || amountPaise > 10_000_000) throw httpError(400, `${label}: enter an amount of ₹0 or more`);
  const basis = raw?.basis || 'per_unit';
  if (!bases.includes(basis)) throw httpError(400, `${label}: choose ${bases.join(' or ')}`);
  return { amountPaise, basis };
};

/** A new rate version (finance permission). Earlier versions are never changed. */
export const saveChargeConfig = async ({ input = {}, adminId }) => {
  const reason = String(input.reason || '').trim();
  if (reason.length < 5) throw httpError(400, 'Explain the change (at least 5 characters)');
  const effectiveFrom = input.effectiveFrom ? new Date(input.effectiveFrom) : new Date();
  if (Number.isNaN(effectiveFrom.getTime()) || effectiveFrom < new Date(Date.now() - 60 * 1000)) throw httpError(400, 'The effective date cannot be in the past');
  const storage = parseRate(input.storage, 'Storage', ['per_unit']);
  const packaging = parseRate(input.packaging, 'Packaging', ['per_unit', 'per_order']);
  const fulfillment = parseRate(input.fulfillment, 'Fulfilment', ['per_unit', 'per_order']);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const latest = await FbbChargeConfig.findOne().sort({ version: -1 }).select('version').lean();
    try {
      return (await FbbChargeConfig.create({ version: (latest?.version || 0) + 1, effectiveFrom, storage, packaging, fulfillment, reason, createdBy: adminId })).toObject();
    } catch (error) { if (error?.code !== 11000) throw error; }
  }
  throw httpError(409, 'Another rate change was saved at the same time; refresh and try again');
};

const describe = (config) => config && ({
  version: config.version, effectiveFrom: config.effectiveFrom, taxTreatment: config.taxTreatment,
  storage: { amount: rupees(config.storage.amountPaise), basis: config.storage.basis },
  packaging: { amount: rupees(config.packaging.amountPaise), basis: config.packaging.basis },
  fulfillment: { amount: rupees(config.fulfillment.amountPaise), basis: config.fulfillment.basis },
});

/** What a seller sees before choosing FBB: rates in force now, and any already-scheduled change. */
export const chargePreview = async () => {
  const [current, upcoming] = await Promise.all([
    currentChargeConfig(),
    FbbChargeConfig.findOne({ effectiveFrom: { $gt: new Date() } }).sort({ effectiveFrom: 1 }).lean(),
  ]);
  return { current: describe(current), upcoming: describe(upcoming), shippingNote: 'Shipping stays the customer\'s ordinary delivery charge; it is not an FBB charge.', taxNote: 'Tax on these charges, if any, is not yet decided.' };
};

export const listChargeConfigs = async () => (await FbbChargeConfig.find().sort({ version: -1 }).lean()).map(describe);

/** Rates frozen onto an FBB order at placement (null when charging is off or no rates exist). */
export const chargeTermsForNewOrder = async (session) => {
  const config = await currentChargeConfig(new Date(), session);
  return config ? { configVersion: config.version, packaging: { ...config.packaging }, fulfillment: { ...config.fulfillment } } : null;
};

/* ------------------------------------------------------------------ booking charges ------------------------------ */

const bookCharge = async ({ key, type, sellerId, orderId, receiptId, productId, qty, basis, ratePaise, configVersion, description, session }) => {
  const amountPaise = basis === 'per_order' ? ratePaise : ratePaise * qty;
  if (await FbbCharge.exists({ _id: key }).session(session)) return false;
  await FbbCharge.create([{ _id: key, type, sellerId, orderId, receiptId, productId, qty, basis, ratePaise, amountPaise, configVersion }], { session });
  if (amountPaise > 0) {
    await postLedgerEntry({ idempotencyKey: `FBB:${key}`, sellerId, orderId, account: ACCOUNT, type: LEDGER_TYPE[type], direction: 'debit', bucket: 'held',
      amount: rupees(amountPaise), description, metadata: { source: 'fbb-charges-v1', chargeId: key, configVersion, basis, qty, ratePaise, taxTreatment: 'pending_accountant_review' } }, { session });
  }
  return true;
};

/** Storage: once per accepted unit on a posted receipt (damaged, rejected, missing units are not charged). */
export const chargeStorageForReceipt = async (receipt, session) => {
  const config = await currentChargeConfig(receipt.postedAt || new Date(), session);
  if (!config) return false;
  let booked = false;
  for (const line of receipt.lines) {
    if (!(line.acceptedQty > 0)) continue;
    booked = await bookCharge({ key: `STORAGE:${receipt._id}:${line._id}`, type: 'storage', sellerId: receipt.sellerId, receiptId: receipt._id, productId: line.productId,
      qty: line.acceptedQty, basis: 'per_unit', ratePaise: config.storage.amountPaise, configVersion: config.version,
      description: `FBB storage ${receipt.receiptNo}: ${line.productName} × ${line.acceptedQty}`, session }) || booked;
  }
  return booked;
};

const unitsOf = (order) => order.items.reduce((n, item) => n + (Number(item.qty) || 0), 0);
const sellerOf = (order) => {
  const ids = [...new Set(order.items.map((item) => String(item.sellerId)))];
  if (ids.length !== 1) throw httpError(409, 'An FBB order must belong to exactly one seller');
  return ids[0];
};

/**
 * Packaging (at packing) or fulfilment (at hand-off), at the rate frozen on the order. No terms = no charge:
 * orders placed while FBB charging was off, and exchange replacements (which carry no terms).
 */
export const chargeOrderService = async (order, type, session) => {
  const terms = order.fbb?.chargeTerms;
  if (!terms || !terms[type]) return false;
  return bookCharge({ key: `${type.toUpperCase()}:${order._id}`, type, sellerId: sellerOf(order), orderId: order._id, qty: unitsOf(order),
    basis: terms[type].basis, ratePaise: terms[type].amountPaise, configVersion: terms.configVersion,
    description: `FBB ${type} ${order.orderNo}`, session });
};

/** Approved correction (finance): the charge is marked reversed and credited back once; history stays. */
export const reverseCharge = async ({ chargeId, adminId, reason }) => {
  const text = String(reason || '').trim();
  if (text.length < 5) throw httpError(400, 'Explain the reversal (at least 5 characters)');
  return financialTransaction(async (session) => {
    const charge = await FbbCharge.findOneAndUpdate({ _id: chargeId, status: 'posted' }, { $set: { status: 'reversed', reversal: { reason: text, by: adminId, at: new Date() } } }, { session, returnDocument: 'after' });
    if (!charge) throw httpError(409, 'This charge is not posted (already reversed or not found)');
    await Seller.updateOne({ _id: charge.sellerId }, { $inc: { financialLedgerVersion: 1 } }, { session });
    if (charge.amountPaise > 0) {
      await postLedgerEntry({ idempotencyKey: `FBB_REVERSAL:${charge._id}`, sellerId: charge.sellerId, orderId: charge.orderId, account: ACCOUNT, type: 'fbb_fee_reversal',
        direction: 'credit', bucket: 'held', amount: rupees(charge.amountPaise), description: `Reversal of FBB charge ${charge._id}: ${text}`,
        postedBy: adminId, postedByRole: 'admin', metadata: { source: 'fbb-charges-v1', chargeId: charge._id } }, { session });
    }
    return charge.toObject();
  });
};

/* ------------------------------------------------------------------ balances & settlement -------------------------- */

/** Seller's FBB obligation: charged, reversed, paid, settled from earnings, and what is still owed. */
export const fbbObligationSummary = async (sellerId, session = null) => {
  const query = SellerLedgerEntry.aggregate([
    { $match: { sellerId: new mongoose.Types.ObjectId(String(sellerId)), account: ACCOUNT } },
    { $group: { _id: '$type', paise: { $sum: { $toLong: { $round: [{ $multiply: ['$amount', 100] }, 0] } } } } },
  ]);
  if (session) query.session(session);
  const byType = Object.fromEntries((await query).map((row) => [row._id, row.paise]));
  const chargedPaise = (byType.fbb_storage_fee || 0) + (byType.fbb_packaging_fee || 0) + (byType.fbb_fulfillment_fee || 0);
  const creditPaise = (byType.fbb_fee_reversal || 0) + (byType.fbb_fee_payment || 0) + (byType.fbb_fee_settlement || 0);
  return {
    charged: rupees(chargedPaise), reversed: rupees(byType.fbb_fee_reversal || 0), paidInAdvance: rupees(byType.fbb_fee_payment || 0),
    settledFromEarnings: rupees(byType.fbb_fee_settlement || 0),
    outstanding: rupees(Math.max(0, chargedPaise - creditPaise)), advanceCredit: rupees(Math.max(0, creditPaise - chargedPaise)),
    outstandingPaise: Math.max(0, chargedPaise - creditPaise),
  };
};

/**
 * Deduct what a seller owes for FBB from their settlement-eligible earnings: a balanced pair, eligible
 * seller_payable debit + obligation credit, never more than either side. Serialized with payouts on the
 * seller's ledger version, so a payout and a deduction cannot both spend the same rupee. Runs whether or not
 * new charges are switched on, so existing obligations are never abandoned.
 */
export const settleFbbObligationsInSession = async (sellerId, session, actorId = null) => {
  const seller = await Seller.findOneAndUpdate({ _id: sellerId }, { $inc: { financialLedgerVersion: 1 } }, { session, returnDocument: 'after' }).select('financialLedgerVersion');
  if (!seller) return { settled: 0 };
  const { outstandingPaise } = await fbbObligationSummary(sellerId, session);
  if (!outstandingPaise) return { settled: 0 };
  const balances = await sellerBalances(new mongoose.Types.ObjectId(String(sellerId)), { session });
  const amountPaise = Math.min(outstandingPaise, Math.max(0, Math.round(balances.eligible * 100)));
  if (!amountPaise) return { settled: 0, outstanding: rupees(outstandingPaise) };
  const key = `FBB_SETTLE:${sellerId}:${seller.financialLedgerVersion}`;
  const common = { sellerId, type: 'fbb_fee_settlement', amount: rupees(amountPaise), postedBy: actorId, postedByRole: actorId ? 'admin' : 'system',
    description: 'FBB service charges deducted from eligible earnings', metadata: { source: 'fbb-charges-v1', settlementKey: key } };
  await postLedgerEntry({ ...common, idempotencyKey: `${key}:PAYABLE`, account: 'seller_payable', direction: 'debit', bucket: 'eligible' }, { session });
  await postLedgerEntry({ ...common, idempotencyKey: `${key}:OBLIGATION`, account: ACCOUNT, direction: 'credit', bucket: 'held' }, { session });
  return { settled: rupees(amountPaise), outstanding: rupees(outstandingPaise - amountPaise) };
};

export const settleFbbObligations = ({ sellerId, actorId = null }) => financialTransaction((session) => settleFbbObligationsInSession(sellerId, session, actorId));

/** Sellers that currently owe FBB charges (for the weekly payout run and admin billing). */
export const sellersWithFbbObligations = async () => {
  const rows = await SellerLedgerEntry.aggregate([
    { $match: { account: ACCOUNT } },
    { $group: { _id: '$sellerId', paise: { $sum: { $cond: [{ $eq: ['$direction', 'debit'] }, { $toLong: { $round: [{ $multiply: ['$amount', 100] }, 0] } }, { $multiply: [{ $toLong: { $round: [{ $multiply: ['$amount', 100] }, 0] } }, -1] }] } } } },
    { $match: { paise: { $gt: 0 } } },
  ]);
  return rows.map((row) => ({ sellerId: row._id, outstanding: rupees(row.paise) }));
};

/* ------------------------------------------------------------------ advance payment -------------------------------- */

const checkout = (payment) => ({ keyId: process.env.RAZORPAY_KEY_ID, razorpayOrderId: payment.gateway.orderId, amountPaise: paise(payment.amount),
  currency: 'INR', orderId: String(payment._id), verificationPath: '/api/sellers/fbb/payments/verify', name: 'Bulkimart', description: 'FBB service charges' });

/** Seller pays (part of) what they owe in advance. One open payment at a time; amount ≤ outstanding. */
export const startFbbObligationPayment = async ({ seller, userId, amount }) => {
  if (getPaymentGateway() !== 'razorpay') throw httpError(409, 'Online payment is not available right now');
  const { outstandingPaise } = await fbbObligationSummary(seller._id);
  const amountPaise = paise(amount);
  if (!Number.isSafeInteger(amountPaise) || amountPaise < 100) throw httpError(400, 'Enter at least ₹1');
  if (amountPaise > outstandingPaise) throw httpError(409, 'You can pay at most what you currently owe for FBB');
  let payment = await Payment.findOne({ fbbObligationSellerId: seller._id, status: 'pending', checkoutAbandonedAt: { $exists: false } });
  if (payment && paise(payment.amount) !== amountPaise) throw httpError(409, 'Finish or cancel the payment already started before starting another');
  if (!payment) payment = await Payment.create({ userId, fbbObligationSellerId: seller._id, amount: rupees(amountPaise), method: 'online', status: 'pending' });
  if (payment.gateway?.orderId) return { status: payment.status, checkout: checkout(payment) };
  const receipt = `FBB-${payment._id}`;
  const reserved = await Payment.findOneAndUpdate({ _id: payment._id, gatewayAttempts: { $size: 0 } }, { $push: { gatewayAttempts: { attemptId: receipt, merchantOrderId: receipt, provider: 'razorpay', amountPaise, currency: 'INR', status: 'initializing', createdAt: new Date() } } }, { returnDocument: 'after' });
  if (!reserved) throw httpError(409, 'Payment creation is in progress. Check its status; do not start another.');
  try {
    const gw = await createRazorpayOrder({ merchantOrderId: receipt, amountPaise, notes: { fbbObligationSellerId: String(seller._id) } });
    if (gw.amountPaise !== amountPaise || gw.currency !== 'INR') throw new Error('Provider amount mismatch');
    payment = await Payment.findOneAndUpdate({ _id: payment._id, 'gatewayAttempts.attemptId': receipt }, { $set: { 'gatewayAttempts.$.gatewayOrderId': gw.orderId, 'gatewayAttempts.$.status': 'issued',
      gateway: { provider: 'razorpay', orderId: gw.orderId, merchantOrderId: receipt, initiatedAt: new Date() } } }, { returnDocument: 'after' });
  } catch {
    await Payment.updateOne({ _id: payment._id, 'gatewayAttempts.attemptId': receipt }, { $set: { 'gatewayAttempts.$.status': 'creation_unknown' } });
    throw httpError(503, 'Payment creation outcome needs reconciliation; no new charge will be created');
  }
  return { status: payment.status, checkout: checkout(payment) };
};

/**
 * Settle a verified Razorpay signal for an FBB advance payment (verify endpoint and the shared webhook).
 * One capture credits the obligation once (idempotent per payment). An extra capture is journaled for refund.
 * Paying more than became outstanding meanwhile leaves an advance credit that offsets later charges.
 */
export const settleFbbObligationPayment = async ({ payment, state, gatewayOrderId, gatewayPaymentId, amountPaise, currency }) => {
  if (state === 'PENDING') return { changed: false, status: payment.status };
  return financialTransaction(async (session) => {
    const fresh = await Payment.findById(payment._id).session(session);
    const attempt = razorpayAttempt(fresh, gatewayOrderId);
    if (!gatewayPaymentId || amountPaise !== attempt.amountPaise || amountPaise !== paise(fresh.amount) || currency !== 'INR') throw httpError(400, 'FBB payment mismatch');
    if (fresh.captures?.some((row) => row.gatewayPaymentId === gatewayPaymentId && row.gatewayOrderId === gatewayOrderId)) return { changed: false, status: fresh.status };
    if (state !== 'COMPLETED') { if (fresh.status !== 'paid') fresh.status = 'failed'; await fresh.save({ session }); return { changed: true, status: fresh.status }; }
    const extra = ['paid', 'partial_refund', 'refunded'].includes(fresh.status);
    fresh.captures.push({ gatewayOrderId, gatewayPaymentId, amountPaise, currency, disposition: extra ? 'refund_required' : 'settled', receivedAt: new Date() });
    if (extra) addRefundObligation(fresh, { key: `FBB_CAPTURE:${gatewayPaymentId}`, gatewayOrderId, gatewayPaymentId, amountPaise, reason: 'Additional capture of an FBB charge payment' });
    else {
      fresh.status = 'paid'; fresh.paidAt = new Date();
      fresh.gateway = { ...fresh.gateway, provider: 'razorpay', orderId: gatewayOrderId, paymentId: gatewayPaymentId };
      await Seller.updateOne({ _id: fresh.fbbObligationSellerId }, { $inc: { financialLedgerVersion: 1 } }, { session });
      await postLedgerEntry({ idempotencyKey: `FBB_PAYMENT:${fresh._id}`, sellerId: fresh.fbbObligationSellerId, paymentId: fresh._id, account: ACCOUNT, type: 'fbb_fee_payment',
        direction: 'credit', bucket: 'held', amount: fresh.amount, reference: gatewayPaymentId, description: 'Seller payment of FBB service charges' }, { session });
    }
    await fresh.save({ session });
    return { changed: true, status: fresh.status };
  });
};

/* ------------------------------------------------------------------ statements ----------------------------------- */

export const listCharges = async ({ sellerId, status, type, page = 1, limit = 50 } = {}) => {
  const filter = { ...(sellerId ? { sellerId } : {}), ...(status ? { status } : {}), ...(type ? { type } : {}) };
  const [rows, total] = await Promise.all([
    FbbCharge.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).populate('orderId', 'orderNo').populate('receiptId', 'receiptNo').lean(),
    FbbCharge.countDocuments(filter),
  ]);
  return { rows: rows.map((row) => ({ ...row, amount: rupees(row.amountPaise), rate: rupees(row.ratePaise) })), total, page, limit };
};

/** Finance check: every posted charge has exactly its ledger debit, every reversal its credit. */
export const chargeReconciliation = async () => {
  const charges = await FbbCharge.find({ amountPaise: { $gt: 0 } }).lean();
  const keys = charges.flatMap((c) => [`FBB:${c._id}`, ...(c.status === 'reversed' ? [`FBB_REVERSAL:${c._id}`] : [])]);
  const entries = new Map((await SellerLedgerEntry.find({ idempotencyKey: { $in: keys } }).select('idempotencyKey amount').lean()).map((e) => [e.idempotencyKey, e]));
  const problems = [];
  for (const c of charges) {
    const debit = entries.get(`FBB:${c._id}`);
    if (!debit || paise(debit.amount) !== c.amountPaise) problems.push({ chargeId: c._id, problem: 'ledger debit missing or different' });
    if (c.status === 'reversed' && !entries.get(`FBB_REVERSAL:${c._id}`)) problems.push({ chargeId: c._id, problem: 'reversal credit missing' });
  }
  return { checked: charges.length, problems };
};
