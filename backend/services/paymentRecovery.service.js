import crypto from 'node:crypto';
import mongoose from 'mongoose';
import Payment from '../models/Payment.js';
import Order from '../models/Order.js';
import Return from '../models/Return.js';
import { httpError } from '../utils/response.js';
import { getRazorpayClient } from './razorpay.service.js';

const conflict = message => httpError(409, message, { code: 'PAYMENT_RECONCILIATION_REQUIRED' });
const recoveryClient = () => {
  if (process.env.NODE_ENV !== 'production' && process.env.RAZORPAY_MODE !== 'test') throw httpError(503, 'Local payment recovery requires Razorpay test mode');
  return getRazorpayClient();
};
const receiptFor = (paymentId, key) => `RF-${crypto.createHash('sha256').update(`${paymentId}:${key}`).digest('hex').slice(0, 32)}`;
const record = (row, status, actor, result, providerId) => {
  row.status = status; row.lastResult = result;
  row.history ||= []; row.history.push({ status, actor, result, providerId, at: new Date() });
};
const isId = value => typeof value === 'string' && mongoose.isValidObjectId(value);
export const validateRecoveryInput = (paymentId, key) => {
  if (!isId(paymentId) || typeof key !== 'string' || !key || key.length > 160) throw httpError(400, 'Invalid payment recovery reference');
};

// Page through a bounded provider collection. A truncated/incomplete response
// must never establish absence or authorize a new financial request.
const providerRows = async fetchPage => {
  const rows = [];
  for (let skip = 0; skip < 1000; skip += 100) {
    const page = await fetchPage({ count: 100, skip });
    if (!Array.isArray(page?.items) || page.items.length > 100) throw conflict('Provider history is incomplete');
    rows.push(...page.items);
    if (page.items.length < 100) return rows;
  }
  throw conflict('Provider history requires manual reconciliation');
};
const captureFor = (payment, debt) => payment.captures?.find(row => row.gatewayPaymentId === debt.gatewayPaymentId);
const verifyCapture = async (payment, debt, client) => {
  if (!Number.isSafeInteger(debt.amountPaise) || debt.amountPaise <= 0 || debt.currency !== 'INR' || !debt.gatewayPaymentId || !debt.gatewayOrderId) throw conflict('Refund debt needs a verified capture reference');
  const capture = await client.payments.fetch(debt.gatewayPaymentId);
  const recorded = captureFor(payment, debt);
  const expected = recorded?.amountPaise ?? Math.round(payment.amount * 100);
  if (capture?.id !== debt.gatewayPaymentId || capture.order_id !== debt.gatewayOrderId || capture.status !== 'captured' || capture.currency !== 'INR' || capture.amount !== expected || !Number.isSafeInteger(capture.amount) || !Number.isSafeInteger(capture.amount_refunded ?? 0) || (capture.amount_refunded || 0) < 0 || (capture.amount_refunded || 0) > capture.amount || debt.amountPaise > capture.amount) throw conflict('Provider capture does not match the stored obligation');
  return capture;
};
const verifyRefund = (refund, debt, capture, { allowLegacy = false } = {}) => {
  if (!refund?.id || refund.payment_id !== capture.id || refund.amount !== debt.amountPaise || (refund.currency !== undefined && refund.currency !== 'INR') || !['processed', 'pending', 'failed'].includes(refund.status)) throw httpError(400, 'Provider refund does not match the obligation');
  if (!allowLegacy && refund.receipt !== debt.receipt && refund.notes?.obligationReceipt !== debt.receipt) throw httpError(400, 'Provider refund reference does not match the obligation');
};

const claimRefund = async (paymentId, key, actor, reconcile) => {
  validateRecoveryInput(paymentId, key);
  const token = crypto.randomUUID();
  const filter = { _id: paymentId, refundObligations: { $elemMatch: { key, ...(reconcile ? {} : { status: { $in: ['pending', 'failed'] } }) } },
    ...(reconcile ? { $or: [{ 'refundOperation.token': { $exists: false } }, { 'refundOperation.startedAt': { $lt: new Date(Date.now() - 300000) } }] } : { 'refundOperation.token': { $exists: false } }) };
  if (!reconcile) filter.$and = [{ refundObligations: { $not: { $elemMatch: { key: { $ne: key }, status: { $in: ['processing','reconciliation_required'] }, requestDispatchedAt: { $exists:true } } } } }];
  const payment = await Payment.findOneAndUpdate(filter, { $set: { refundOperation: { token, key, startedAt: new Date() } } }, { returnDocument: 'after' });
  if (!payment) {
    const existing = await Payment.findById(paymentId);
    const debt = existing?.refundObligations?.find(row => row.key === key);
    if (!debt) throw httpError(404, 'Refund obligation not found');
    if (debt.status === 'processed') return { payment: existing, debt, done: true };
    throw conflict('Refund is claimed, pending at the provider, or requires reconciliation');
  }
  const debt = payment.refundObligations.find(row => row.key === key);
  return { payment, debt, token, actor };
};
const releaseRefund = async (paymentId, token) => Payment.updateOne({ _id: paymentId, 'refundOperation.token': token }, { $unset: { refundOperation: 1 } });

// Apply provider evidence in a transaction. Exact provider IDs and terminal
// success are immutable. A delayed response cannot downgrade a webhook success.
const applyRefund = async ({ paymentId, key, refund, capture, actor, allowLegacy = false }) => {
  const session = await mongoose.startSession(); let outcome;
  try {
    await session.withTransaction(async () => {
      const payment = await Payment.findById(paymentId).session(session);
      const debt = payment?.refundObligations?.find(row => row.key === key);
      if (!debt) throw httpError(404, 'Refund obligation not found');
      verifyRefund(refund, debt, capture, { allowLegacy: allowLegacy || (debt.legacyRefund && debt.providerRefundId === refund.id) });
      if (debt.providerRefundId && debt.providerRefundId !== refund.id && debt.status !== 'failed') throw conflict('A different refund already owns this obligation');
      if (debt.status === 'processed') { if (debt.providerRefundId !== refund.id) throw conflict('Refund already completed'); outcome = debt.toObject(); return; }
      debt.providerRefundId = refund.id; debt.verifiedAt = new Date();
      if (allowLegacy) debt.legacyRefund = true;
      record(debt, refund.status === 'processed' ? 'processed' : refund.status === 'failed' ? 'failed' : 'processing', actor, `Provider verified ${refund.status}`, refund.id);
      if (refund.status === 'processed') {
        debt.processedAt = new Date();
        const settled = captureFor(payment, debt)?.disposition === 'settled' || (!payment.captures?.length && payment.gateway?.paymentId === capture.id);
        if (settled) {
          payment.refund ||= {};
          const verifiedDebts = payment.refundObligations.filter(row => row.status === 'processed' && row.gatewayPaymentId === capture.id);
          const verifiedSum = [...new Map(verifiedDebts.map(row => [row.providerRefundId, row.amountPaise])).values()].reduce((sum, amount) => sum + amount, 0);
          // Provider capture totals cover other verified partial refunds too.
          payment.refund.totalRefundedAmount = Math.max(payment.refund.totalRefundedAmount || 0, (capture.amount_refunded || 0) / 100, verifiedSum / 100);
          payment.refund.amount = debt.amountPaise / 100; payment.refund.status = 'processed';
          payment.refund.razorpayRefId = refund.id; payment.refund.processedAt = new Date();
          payment.status = Math.round(payment.refund.totalRefundedAmount * 100) >= Math.round(payment.amount * 100) ? 'refunded' : 'partial_refund';
        }
        if (debt.key.startsWith('CANCEL:') && debt.orderId) await Order.updateOne({ _id: debt.orderId, paymentId: payment._id }, { $set: { 'refundPending.status': 'processed', 'refundPending.providerRefundId': refund.id } }, { session });
      }
      if (debt.returnId) await Return.updateOne({ _id: debt.returnId, orderId: debt.orderId }, { $set: { refundReference: refund.id } }, { session });
      await payment.save({ session }); outcome = debt.toObject();
    });
  } finally { await session.endSession(); }
  return outcome;
};

const markRefund = async (paymentId, key, token, actor, status, result) => {
  // Use the lease in the filter so a stale response cannot alter a new owner.
  await Payment.updateOne({ _id: paymentId, 'refundOperation.token': token, refundObligations: { $elemMatch: { key, status: { $ne: 'processed' } } } }, {
    $set: { 'refundObligations.$.status': status, 'refundObligations.$.lastResult': result },
    $push: { 'refundObligations.$.history': { status, at: new Date(), actor, result } },
  });
};

export const processRefundObligation = async ({ paymentId, key, actor, reconcile = false, providerRefundId }) => {
  const purpose = await Payment.findById(paymentId).select('serviceApplicationId servicePaymentKind serviceGatewayMode parcelDeliveryId gstAssistanceRequestId advertising');
  if (purpose?.serviceApplicationId && (purpose.serviceGatewayMode || 'test') !== process.env.RAZORPAY_MODE) throw conflict('Service payment environment changed; reconciliation requires the original gateway mode');
  if (purpose?.gstAssistanceRequestId) { const { requireGstGateway } = await import('./gstPayment.service.js'); requireGstGateway(); }
  if (purpose?.advertising) throw httpError(409, 'Use advertising refund reconciliation for this payment');
  if (purpose?.parcelDeliveryId) { const { requireParcelGateway } = await import('./parcelPolicy.service.js'); requireParcelGateway('refunds'); }
  if (purpose?.servicePaymentKind === 'vendor_service') { const { requireServiceGateway } = await import('./servicePaymentPolicy.service.js'); requireServiceGateway(); }
  else if (purpose?.serviceApplicationId) { const { requireLegalGateway } = await import('./legalPolicy.service.js'); requireLegalGateway('refunds'); }
  const claim = await claimRefund(paymentId, key, actor, reconcile);
  if (claim.done) return claim.debt;
  const { payment, debt, token } = claim;
  try {
    if (debt.status === 'processed') return debt;
    const client = recoveryClient();
    if (payment.merchandiseSettlementHold && !reconcile) throw conflict('Payment dispute requires reconciliation before another refund');
    if (!reconcile) await markRefund(paymentId, key, token, actor, 'processing', 'Exclusive processing claim acquired');
    const capture = await verifyCapture(payment, debt, client);
    debt.receipt ||= receiptFor(paymentId, key);
    await Payment.updateOne({ _id: paymentId, 'refundOperation.token': token, 'refundObligations.key': key }, { $set: { 'refundObligations.$.receipt': debt.receipt } });
    const history = await providerRows(page => client.refunds.all({ ...page, payment_id: capture.id }));
    if (history.some(row => !row.id || row.payment_id !== capture.id || !Number.isSafeInteger(row.amount) || row.amount <= 0 || row.amount > capture.amount || !['processed','pending','failed'].includes(row.status))) throw conflict('Provider refund history contains invalid or unrelated entries');
    const matching = history.filter(row => row.receipt === debt.receipt || row.notes?.obligationReceipt === debt.receipt);
    if (matching.filter(row => row.status !== 'failed').length > 1) throw conflict('Multiple provider refunds need manual reconciliation');
    let found = matching.find(row => row.status !== 'failed') || matching.at(-1);
    const legacyProjection = !payment.groupRef && String(payment.orderId) === String(debt.orderId) && key.startsWith('CANCEL:') && payment.refund?.razorpayRefId && Math.round(payment.refund.amount * 100) === debt.amountPaise;
    if (!found && legacyProjection && !debt.providerRefundId) {
      const prior = await client.refunds.fetch(payment.refund.razorpayRefId);
      verifyRefund(prior, debt, capture, { allowLegacy: true });
      return await applyRefund({ paymentId, key, refund: prior, capture, actor, allowLegacy: true });
    }
    const returns = debt.orderId ? await Return.find({ orderId: debt.orderId }).select('refundReference refundStatus refundAmount').lean() : [];
    const competing = returns.filter(ret => String(ret._id) !== String(debt.returnId) && (ret.refundReference || ['completed', 'processing', 'manual_pending'].includes(ret.refundStatus)));
    const priorReturn = returns.find(ret => String(ret._id) === String(debt.returnId) && ret.refundReference && Math.round(ret.refundAmount * 100) === debt.amountPaise);
    if (!found && priorReturn && !debt.providerRefundId) {
      const prior = await client.refunds.fetch(priorReturn.refundReference);
      verifyRefund(prior, debt, capture, { allowLegacy: true });
      return await applyRefund({ paymentId, key, refund: prior, capture, actor, allowLegacy: true });
    }
    if (!found && competing.length && key.startsWith('CANCEL:') && !debt.returnId) {
      const exact = competing.filter(ret => ret.refundReference && Math.round(ret.refundAmount * 100) === debt.amountPaise);
      if (exact.length !== 1) throw conflict('Existing Return refund overlaps this obligation');
      found = await client.refunds.fetch(exact[0].refundReference);
      verifyRefund(found, debt, capture, { allowLegacy: true });
      if (found.status === 'failed') throw conflict('Legacy Return debt must be reconciled before another refund');
      return await applyRefund({ paymentId, key, refund: found, capture, actor, allowLegacy: true });
    }
    if (providerRefundId) {
      const evidence = await client.refunds.fetch(providerRefundId);
      verifyRefund(evidence, debt, capture);
      if (found && found.id !== evidence.id && found.status !== 'failed') throw conflict('Conflicting provider evidence');
      found = evidence;
    }
    if (found && (reconcile || found.status !== 'failed')) return await applyRefund({ paymentId, key, refund: await client.refunds.fetch(found.id), capture, actor });
    if (reconcile) {
      const status = debt.requestDispatchedAt ? 'reconciliation_required' : 'pending';
      await markRefund(paymentId, key, token, actor, status, debt.requestDispatchedAt ? 'No conclusive provider refund found; retry remains blocked' : 'No request was dispatched; provider history checked');
      return { key, status };
    }
    if (debt.requestDispatchedAt && !found && debt.lastResult !== 'Provider confirmed request rejection') throw conflict('Previous dispatched request has no conclusive result');
    // Unknown refunds on this capture are not evidence of an unrelated debt.
    const knownIds = new Set(payment.refundObligations.filter(row => row.key !== key).map(row => row.providerRefundId).filter(Boolean));
    if (history.some(row => row.status !== 'failed' && row.id !== found?.id && !knownIds.has(row.id))) throw conflict('Existing provider refund requires allocation/reconciliation');
    const outstanding = capture.amount - Math.max(capture.amount_refunded || 0, history.filter(row => row.status === 'processed').reduce((sum, row) => sum + row.amount, 0)) - history.filter(row => row.status === 'pending').reduce((sum, row) => sum + row.amount, 0);
    if (outstanding < debt.amountPaise) throw conflict('Refund exceeds the verified outstanding capture');
    // Each confirmed-failed retry gets a distinct receipt. Otherwise an old
    // failed refund could incorrectly resolve a newer, still-uncertain request.
    const requestReceipt = debt.requestDispatchedAt ? receiptFor(paymentId, `${key}:${(debt.attemptCount || 0) + 1}`) : debt.receipt;
    const dispatched = await Payment.updateOne({ _id: paymentId, 'refundOperation.token': token, refundObligations: { $elemMatch: { key, status:'processing', providerRefundId: debt.providerRefundId || { $exists:false } } } }, { $set: { 'refundObligations.$.receipt': requestReceipt, 'refundObligations.$.status': 'reconciliation_required', 'refundObligations.$.requestDispatchedAt': new Date() }, $unset: { 'refundObligations.$.providerRefundId': 1 }, $inc: { 'refundObligations.$.attemptCount': 1 }, $push: { 'refundObligations.$.history': { status: 'reconciliation_required', actor, at: new Date(), receipt: requestReceipt, result: 'Provider request dispatch recorded before external call' } } });
    if (!dispatched.matchedCount) throw conflict('Refund claim changed; request was not sent');
    debt.receipt = requestReceipt;
    let created;
    try {
      created = await client.payments.refund(capture.id, { amount: debt.amountPaise, receipt: requestReceipt, notes: { obligationReceipt: requestReceipt, paymentRecordId: String(paymentId) } });
    } catch (error) {
      const rejected = error.statusCode === 400 && error.error?.code === 'BAD_REQUEST_ERROR';
      await markRefund(paymentId, key, token, actor, rejected ? 'failed' : 'reconciliation_required', rejected ? 'Provider confirmed request rejection' : 'Provider outcome uncertain; reconcile before retry');
      return { key, status: rejected ? 'failed' : 'reconciliation_required' };
    }
    if (!created?.id) throw conflict('Provider refund identifier missing');
    verifyRefund(created, debt, capture);
    // Preserve the returned ID even if the independent verification GET times
    // out. Status remains uncertain until trusted terminal evidence arrives.
    await Payment.updateOne({ _id: paymentId, 'refundOperation.token': token, refundObligations: { $elemMatch: { key, status: { $ne:'processed' } } } }, { $set: { 'refundObligations.$.providerRefundId': created.id } });
    return await applyRefund({ paymentId, key, refund: await client.refunds.fetch(created.id), capture: await verifyCapture(payment, debt, client), actor });
  } catch (error) {
    await markRefund(paymentId, key, token, actor, 'reconciliation_required', 'Provider evidence incomplete or conflicting; no automatic retry');
    if (error.status) throw error;
    throw httpError(503, 'Provider recovery is unavailable; reconciliation remains required');
  } finally { await releaseRefund(paymentId, token); }
};

export const reconcileRefundEvent = async ({ refundId, refundPaymentId, amountPaise, currency, refundReceipt, refundNotes }) => {
  if (!refundId) throw httpError(400, 'Refund identifier required');
  const reference = refundReceipt || refundNotes?.obligationReceipt;
  const payment = await Payment.findOne({ $or: [{ 'refundObligations.providerRefundId': refundId }, ...(reference ? [{ 'refundObligations.receipt': reference }] : [])] });
  if (!payment) return { handled: false };
  const debt = payment.refundObligations.find(row => row.providerRefundId === refundId || (reference && row.receipt === reference));
  if (!debt || refundPaymentId !== debt.gatewayPaymentId || amountPaise !== debt.amountPaise || (currency !== undefined && currency !== 'INR')) throw httpError(400, 'Refund event association mismatch');
  const client = recoveryClient(), capture = await verifyCapture(payment, debt, client);
  const refund = await client.refunds.fetch(refundId);
  if (refund.id !== refundId) throw httpError(400, 'Refund evidence identifier mismatch');
  const outcome = await applyRefund({ paymentId: String(payment._id), key: debt.key, refund, capture });
  return { handled: true, outcome };
};

// Historical Return refunds predate the obligation journal. Keep their reader,
// but bind signed events to a fetched refund and its original captured payment.
export const verifyLegacyRefundEvent = async ({ refundId, refundPaymentId, amountPaise, currency }) => {
  const ret = await Return.findOne({ refundReference: refundId });
  if (!ret) return null;
  const order = await Order.findById(ret.orderId), payment = order && await Payment.findById(order.paymentId);
  if (!payment || payment.gateway?.provider !== 'razorpay' || payment.refund?.razorpayRefId !== refundId) throw httpError(400, 'Legacy refund payment association mismatch');
  const debt = { gatewayPaymentId: payment.gateway.paymentId, gatewayOrderId: payment.gateway.orderId, amountPaise: Math.round(ret.refundAmount * 100), currency: 'INR' };
  if (refundPaymentId !== debt.gatewayPaymentId || amountPaise !== debt.amountPaise || (currency !== undefined && currency !== 'INR')) throw httpError(400, 'Legacy refund event mismatch');
  const client = recoveryClient(), capture = await verifyCapture(payment, debt, client), refund = await client.refunds.fetch(refundId);
  if (refund?.id !== refundId) throw httpError(400, 'Legacy refund identifier mismatch');
  verifyRefund(refund, debt, capture, { allowLegacy: true });
  return refund.status;
};

export const ensureReturnObligation = async (paymentId, ret, amountPaise) => {
  const session = await mongoose.startSession(); const key = `RETURN:${ret._id}`;
  try {
    await session.withTransaction(async () => {
      const payment = await Payment.findById(paymentId).session(session);
      if (!payment || payment.gateway?.provider !== 'razorpay' || payment.method !== 'online' || String(payment.userId) !== String(ret.customerId)) throw conflict('Original Razorpay payment is required');
      const order = await Order.findOne({ _id: ret.orderId, paymentId: payment._id, userId: ret.customerId }).session(session);
      if (!order) throw conflict('Return payment ownership mismatch');
      const captures = payment.captures.filter(row => row.disposition === 'settled' && row.currency === 'INR' && row.amountPaise === Math.round(payment.amount * 100));
      if (captures.length !== 1 || !captures[0].gatewayPaymentId || !captures[0].gatewayOrderId) throw conflict('A unique original captured payment is required');
      const capture = captures[0];
      const prior = payment.refundObligations.find(row => row.key === key);
      if (prior && (prior.amountPaise !== amountPaise || String(prior.returnId) !== String(ret._id) || prior.gatewayPaymentId !== capture.gatewayPaymentId)) throw conflict('Return obligation evidence mismatch');
      if (payment.refundObligations.some(row => String(row.orderId) === String(ret.orderId) && row.key.startsWith('CANCEL:'))) throw conflict('Cancellation obligation already owns this refund debt');
      if (!payment.refundObligations.some(row => row.key === key)) {
        const reserved = payment.refundObligations.filter(row => row.gatewayPaymentId === capture.gatewayPaymentId && row.status !== 'failed').reduce((sum, row) => sum + row.amountPaise, 0);
        if (!Number.isSafeInteger(amountPaise) || amountPaise <= 0 || reserved + amountPaise > capture.amountPaise) throw conflict('Return obligations exceed captured funds');
        payment.refundObligations.push({ key, orderId: ret.orderId, returnId: ret._id, gatewayOrderId: capture.gatewayOrderId, gatewayPaymentId: capture.gatewayPaymentId, amountPaise, currency: 'INR', reason: 'Item return', createdAt: new Date(), status: 'pending', receipt: receiptFor(paymentId, key) });
        await payment.save({ session });
      }
    });
  } finally { await session.endSession(); }
  return key;
};

export const reconcileCreationAttempt = async ({ paymentId, key, actor, gatewayOrderId }) => {
  validateRecoveryInput(paymentId, key);
  const purpose = await Payment.findById(paymentId).select('serviceApplicationId servicePaymentKind serviceGatewayMode parcelDeliveryId gstAssistanceRequestId advertising');
  if (purpose?.serviceApplicationId && (purpose.serviceGatewayMode || 'test') !== process.env.RAZORPAY_MODE) throw conflict('Service payment environment changed; reconciliation requires the original gateway mode');
  if (purpose?.gstAssistanceRequestId) { const { requireGstGateway } = await import('./gstPayment.service.js'); requireGstGateway(); }
  if (purpose?.advertising) throw httpError(409, 'Use advertising order reconciliation for this payment');
  if (purpose?.parcelDeliveryId) { const { requireParcelGateway } = await import('./parcelPolicy.service.js'); requireParcelGateway(); }
  if (purpose?.servicePaymentKind === 'vendor_service') { const { requireServiceGateway } = await import('./servicePaymentPolicy.service.js'); requireServiceGateway(); }
  else if (purpose?.serviceApplicationId) { const { requireLegalGateway } = await import('./legalPolicy.service.js'); requireLegalGateway(); }
  const token = crypto.randomUUID();
  const payment = await Payment.findOneAndUpdate({ _id: paymentId, gatewayAttempts: { $elemMatch: { attemptId: key, status: { $in: ['initializing', 'creation_unknown'] }, $or: [{ recoveryToken: { $exists: false } }, { recoveryLockedAt: { $lt: new Date(Date.now() - 300000) } }] } } }, { $set: { 'gatewayAttempts.$.recoveryToken': token, 'gatewayAttempts.$.recoveryLockedAt': new Date() } }, { returnDocument: 'after' });
  if (!payment) throw conflict('Attempt is resolved or already being reconciled');
  const attempt = payment.gatewayAttempts.find(row => row.attemptId === key);
  try {
    const client = recoveryClient();
    if (!attempt.merchantOrderId) throw conflict('Attempt has no persisted receipt; manual provider investigation required');
    const candidates = gatewayOrderId ? [await client.orders.fetch(gatewayOrderId)] : await providerRows(page => client.orders.all({ ...page, receipt: attempt.merchantOrderId.slice(0, 40) }));
    const associated = row => payment.gstAssistanceRequestId ? row.notes?.gstAssistanceRequestId === String(payment.gstAssistanceRequestId) && row.notes?.quotationVersion === String(payment.quotationVersion) : payment.parcelDeliveryId ? row.notes?.parcelDeliveryId === String(payment.parcelDeliveryId) && row.notes?.quotationVersion === String(payment.quotationVersion) : payment.serviceApplicationId ? row.notes?.[payment.servicePaymentKind === 'vendor_service' ? 'serviceApplicationId' : 'legalRequestId'] === String(payment.serviceApplicationId) && row.notes?.quotationVersion === String(payment.quotationVersion) : row.notes?.bulkimartOrderId === String(attempt.orderId);
    const matches = candidates.filter(row => row.receipt === attempt.merchantOrderId.slice(0, 40) && row.notes?.merchantOrderId === attempt.merchantOrderId && associated(row));
    if (matches.length !== 1) throw conflict('Provider absence or ambiguity is not conclusive; attempt remains blocked');
    const found = await client.orders.fetch(matches[0].id);
    if (!found?.id || found.id !== matches[0].id || found.receipt !== attempt.merchantOrderId.slice(0, 40) || found.notes?.merchantOrderId !== attempt.merchantOrderId || !associated(found) || found.amount !== attempt.amountPaise || found.currency !== attempt.currency) throw httpError(400, 'Provider order does not match the stored attempt');
    const changed = await Payment.updateOne({ _id: paymentId, gatewayAttempts: { $elemMatch: { attemptId: key, recoveryToken: token, status: { $in: ['initializing', 'creation_unknown'] } } } }, { $set: { 'gatewayAttempts.$.gatewayOrderId': found.id, 'gatewayAttempts.$.status': 'issued', 'gatewayAttempts.$.resolvedAt': new Date() }, $push: { 'gatewayAttempts.$.history': { status: 'issued', actor, at: new Date(), providerId: found.id, result: 'Provider order identity, receipt, association, amount and currency verified' } } });
    if (!changed.modifiedCount) throw conflict('Attempt changed during reconciliation');
    await Payment.updateOne({ _id: paymentId, status: { $in: ['pending', 'failed'] } }, { $set: { gateway: { provider: 'razorpay', orderId: found.id, merchantOrderId: attempt.merchantOrderId, initiatedAt: attempt.createdAt } } });
    return { gatewayOrderId: found.id, orderId: String(attempt.orderId) };
  } catch (error) {
    await Payment.updateOne({ _id: paymentId, 'gatewayAttempts.recoveryToken': token }, { $push: { 'gatewayAttempts.$.history': { status: 'creation_unknown', actor, at: new Date(), result: 'Provider evidence inconclusive; new initialization remains blocked' } } });
    if (error.status) throw error;
    throw httpError(503, 'Provider lookup unavailable; attempt remains blocked');
  } finally { await Payment.updateOne({ _id: paymentId, 'gatewayAttempts.recoveryToken': token }, { $unset: { 'gatewayAttempts.$.recoveryToken': 1, 'gatewayAttempts.$.recoveryLockedAt': 1 } }); }
};

// A signed late capture may be the first message containing the provider order
// ID after an initialization timeout. Fetch and bind trusted provider evidence
// before the normal capture handler can use it. Never trust event notes alone.
export const recoverCreationFromWebhook = async ({ gatewayOrderId, amountPaise, currency }) => {
  let found;
  try { found = await recoveryClient().orders.fetch(gatewayOrderId); }
  catch (error) {
    if (error.statusCode === 404 || (error.statusCode === 400 && error.error?.code === 'BAD_REQUEST_ERROR')) return null;
    if (error.status) throw error;
    throw httpError(503, 'Provider order lookup unavailable; no capture was discarded');
  }
  if (!found?.notes?.merchantOrderId) return null;
  if (found.amount !== amountPaise || found.currency !== currency || currency !== 'INR') throw httpError(400, 'Capture event does not match provider order');
  const payment = await Payment.findOne({ gatewayAttempts: { $elemMatch: { merchantOrderId: found.notes.merchantOrderId, status: { $in: ['initializing', 'creation_unknown'] } } } });
  if (!payment) return null;
  const attempt = payment.gatewayAttempts.find(row => row.merchantOrderId === found.notes.merchantOrderId && ['initializing', 'creation_unknown'].includes(row.status));
  await reconcileCreationAttempt({ paymentId: String(payment._id), key: attempt.attemptId, gatewayOrderId });
  return Payment.findById(payment._id);
};
