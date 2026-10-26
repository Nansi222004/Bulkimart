import crypto from 'node:crypto';
import Request from '../models/GstAssistanceRequest.js';
import Payment from '../models/Payment.js';
import { currentGstFee } from './gstFee.service.js';
import { financialTransaction } from './financeSafety.service.js';
import { createRazorpayOrder, getRazorpayPaymentStatus, verifyRazorpayPaymentSignature, validateRazorpayConfig } from './razorpay.service.js';
import { reconcileCreationAttempt } from './paymentRecovery.service.js';
import { addRefundObligation } from './paymentObligations.service.js';
import { postLedgerEntry } from './sellerLedger.service.js';
import { httpError } from '../utils/response.js';

const fail = (message, status = 409) => { throw httpError(status, message); };
const active = row => !['cancelled','rejected','completed'].includes(row.status);
export function requireGstGateway() {
  const production = ['NODE_ENV','DEPLOYMENT_ENV','APP_ENV','VERCEL_ENV','RENDER_ENV'].some(key => ['production','prod','deployment-production'].includes(String(process.env[key] || '').trim().toLowerCase()));
  if (process.env.PAYMENT_GATEWAY !== 'razorpay' || process.env.RAZORPAY_MODE !== (production ? 'live' : 'test')) fail('Configure the matching Razorpay mode for GST service payments', 503);
  try { validateRazorpayConfig(); } catch { fail('GST service payment gateway is not configured', 503); }
}
async function owned(id, userId, session = null) {
  const row = await Request.findOne({ _id: id, userId }).session(session);
  if (!row) fail('GST assistance request not found', 404);
  return row;
}
export async function initiateGstPayment(id, userId, input, key) {
  requireGstGateway();
  if (!/^[a-zA-Z0-9-]{16,100}$/.test(key || '')) fail('A payment request key is required', 400);
  const prepared = await financialTransaction(async session => {
    const row = await owned(id, userId, session);
    if (!active(row) || row.billing?.reviewRequired) fail('This assistance request requires admin review before payment');
    if (!row.billing) {
      const fee = await currentGstFee(session);
      if (!fee) fail('The GST service fee has not been configured');
      row.billing = { ...fee, status: 'unpaid' };
    }
    const bill = row.billing;
    if (input.acceptTerms !== true || input.amountPaise !== bill.amountPaise || input.feeVersion !== bill.version) fail('The fee changed. Refresh and accept the displayed service fee and terms');
    if (bill.status === 'paid' || ['refunded','partial_refund'].includes(bill.status)) fail('Payment is already received or requires reconciliation');
    if (bill.mode && bill.mode !== process.env.RAZORPAY_MODE) fail('Payment environment changed; contact support');
    let p = bill.paymentId ? await Payment.findById(bill.paymentId).session(session) : null;
    if (!p) {
      [p] = await Payment.create([{ userId, gstAssistanceRequestId: row._id, quotationVersion: bill.version, amount: bill.amountPaise / 100, method: 'online', gateway: { provider: 'razorpay' } }], { session });
      bill.paymentId = p._id;
    }
    const attempt = p.gatewayAttempts.find(a => ['issued','initializing','creation_unknown'].includes(a.status));
    if (attempt && attempt.status !== 'issued') fail('Checkout creation is uncertain. Use Check payment status to recover it before retrying');
    if (attempt) return { p, attempt: attempt.toObject(), fresh: false };
    if (p.gatewayAttempts.length >= 10) fail('Payment attempt limit reached; contact support');
    p.gatewayAttempts.push({ attemptId: key, provider: 'razorpay', merchantOrderId: `GST-${crypto.randomUUID()}`, amountPaise: bill.amountPaise, currency: 'INR', status: 'initializing', createdAt: new Date() });
    bill.mode = process.env.RAZORPAY_MODE; bill.status = 'pending'; bill.acceptedAt = new Date();
    await row.save({ session }); await p.save({ session });
    return { p, attempt: p.gatewayAttempts.at(-1).toObject(), fresh: true };
  });
  let attempt = prepared.attempt;
  if (prepared.fresh) {
    try {
      const gateway = await createRazorpayOrder({ merchantOrderId: attempt.merchantOrderId, amountPaise: attempt.amountPaise, notes: { gstAssistanceRequestId: String(id), quotationVersion: String(prepared.p.quotationVersion) } });
      await reconcileCreationAttempt({ paymentId: String(prepared.p._id), key: attempt.attemptId, actor: userId, gatewayOrderId: gateway.orderId });
      attempt = { ...attempt, gatewayOrderId: gateway.orderId };
    } catch {
      await Payment.updateOne({ _id: prepared.p._id, gatewayAttempts: { $elemMatch: { attemptId: attempt.attemptId, status: 'initializing' } } }, { $set: { 'gatewayAttempts.$.status': 'creation_unknown' } });
      fail('Checkout creation is uncertain. Check payment status before retrying.', 503);
    }
  }
  return { orderId: String(id), razorpayOrderId: attempt.gatewayOrderId, keyId: process.env.RAZORPAY_KEY_ID, amountPaise: attempt.amountPaise, currency: 'INR', name: 'Bulkimart', description: 'GST registration assistance service fee', verificationPath: '/api/sellers/gst-assistance/payments/verify' };
}

export async function settleGstPayment(paymentId, live) {
  return financialTransaction(async session => {
    const p = await Payment.findById(paymentId).session(session);
    const row = p?.gstAssistanceRequestId && await Request.findById(p.gstAssistanceRequestId).session(session);
    if (!row || !row.billing || row.billing.mode !== process.env.RAZORPAY_MODE) fail('GST payment environment or request mismatch');
    const attempt = p.gatewayAttempts.find(a => a.gatewayOrderId === live.orderId);
    if (!attempt || !live.paymentId || live.currency !== 'INR' || live.amountPaise !== attempt.amountPaise || live.amountPaise !== row.billing.amountPaise) fail('GST payment amount or association mismatch');
    const recorded = p.captures.find(c => c.gatewayPaymentId === live.paymentId);
    if (recorded) {
      if (recorded.gatewayOrderId !== live.orderId || recorded.amountPaise !== live.amountPaise) fail('Capture replay does not match the recorded payment');
      if (recorded.disposition === 'settled' && Number.isSafeInteger(live.refundedPaise) && live.refundedPaise > (row.billing.refundedPaise || 0)) {
        if (live.refundedPaise > live.amountPaise) fail('Provider refund amount exceeds capture');
        const delta = live.refundedPaise - (row.billing.refundedPaise || 0);
        await postLedgerEntry({ idempotencyKey: `GST_REFUND:${live.paymentId}:${live.refundedPaise}`, gstAssistanceRequestId: row._id, paymentId: p._id, account: 'gst_assistance_collections', type: 'reversal', direction: 'debit', bucket: 'held', amount: delta / 100, reference: live.paymentId, description: 'Provider-verified GST service refund; requires financial review' }, { session });
        row.billing.refundedPaise = live.refundedPaise; row.billing.reviewRequired = true;
        row.billing.status = live.refundedPaise === live.amountPaise ? 'refunded' : 'partial_refund'; p.status = row.billing.status;
        await row.save({ session }); await p.save({ session });
      }
      return row.billing.status;
    }
    if (live.state === 'COMPLETED') {
      const extra = p.captures.some(c => c.disposition === 'settled') || !active(row) || row.billing.reviewRequired;
      p.captures.push({ gatewayOrderId: live.orderId, gatewayPaymentId: live.paymentId, amountPaise: live.amountPaise, currency: 'INR', disposition: extra ? 'refund_required' : 'settled', receivedAt: new Date() });
      if (extra) {
        addRefundObligation(p, { key: `GST_EXTRA:${live.paymentId}`, gatewayOrderId: live.orderId, gatewayPaymentId: live.paymentId, amountPaise: live.amountPaise, reason: 'GST service extra or late capture requires refund review' });
        row.billing.reviewRequired = true;
      } else {
        p.status = 'paid'; p.paidAt = new Date(); row.billing.status = 'paid';
      }
      await postLedgerEntry({ idempotencyKey: `GST_RECEIPT:${live.paymentId}`, gstAssistanceRequestId: row._id, paymentId: p._id,
        account: 'gst_assistance_collections', type: 'adjustment', direction: 'credit', bucket: 'held', amount: live.amountPaise / 100,
        reference: live.paymentId, description: 'Verified GST assistance fee collected by Bulkimart; held pending service and financial reconciliation' }, { session });
      row.events.push({ action: extra ? 'payment_review_required' : 'payment_verified', from: row.status, to: row.status, actorType: 'system', at: new Date() });
      if (live.refundedPaise > 0) {
        row.billing.reviewRequired = true;
        if (!extra) {
          if (!Number.isSafeInteger(live.refundedPaise) || live.refundedPaise > live.amountPaise) fail('Invalid provider refund amount');
          await postLedgerEntry({ idempotencyKey: `GST_REFUND:${live.paymentId}:${live.refundedPaise}`, gstAssistanceRequestId: row._id, paymentId: p._id, account: 'gst_assistance_collections', type: 'reversal', direction: 'debit', bucket: 'held', amount: live.refundedPaise / 100, reference: live.paymentId, description: 'Provider-verified GST service refund; requires financial review' }, { session });
          row.billing.refundedPaise = live.refundedPaise;
          row.billing.status = live.refundedPaise === live.amountPaise ? 'refunded' : 'partial_refund'; p.status = row.billing.status;
        }
      }
    } else if (live.state === 'FAILED' && !p.captures.some(c => c.disposition === 'settled')) { p.status = 'failed'; row.billing.status = 'failed'; }
    await p.save({ session }); await row.save({ session }); return row.billing.status;
  });
}
export async function verifyGstPayment(id, userId, input = {}, poll = false) {
  requireGstGateway();
  const row = await owned(id, userId);
  const p = row.billing?.paymentId && await Payment.findById(row.billing.paymentId);
  if (!p) fail('Payment has not been started');
  let attempt = poll ? p.gatewayAttempts.at(-1) : p.gatewayAttempts.find(a => a.gatewayOrderId === input.razorpay_order_id);
  if (!attempt) fail('Payment order does not belong to this GST request');
  if (poll && ['initializing','creation_unknown'].includes(attempt.status)) {
    await reconcileCreationAttempt({ paymentId: String(p._id), key: attempt.attemptId, actor: userId });
    const fresh = await Payment.findById(p._id); attempt = fresh.gatewayAttempts.find(a => a.attemptId === attempt.attemptId);
  }
  if (!attempt.gatewayOrderId) fail('Checkout is awaiting provider reconciliation');
  if (!poll && !verifyRazorpayPaymentSignature({ orderId: attempt.gatewayOrderId, paymentId: input.razorpay_payment_id, signature: input.razorpay_signature })) fail('Payment signature verification failed', 401);
  const live = await getRazorpayPaymentStatus({ orderId: attempt.gatewayOrderId, ...(poll ? {} : { paymentId: input.razorpay_payment_id }) });
  if (live.orderId !== attempt.gatewayOrderId || (!poll && live.paymentId !== input.razorpay_payment_id)) fail('Provider payment association mismatch');
  return { status: live.paymentId ? await settleGstPayment(p._id, live) : row.billing.status };
}
export async function handleGstWebhook(body, evt) {
  const dispute = body.event?.startsWith('payment.dispute.') && body.payload?.dispute?.entity;
  const affectedId = dispute?.payment_id || evt.refundPaymentId;
  if (affectedId) {
    const affected = await Payment.findOne({ gstAssistanceRequestId: { $exists: true }, 'captures.gatewayPaymentId': affectedId });
    if (affected) {
      requireGstGateway();
      if (dispute) {
        await Request.updateOne({ _id: affected.gstAssistanceRequestId }, { $set: { 'billing.reviewRequired': true }, $inc: { __v: 1 } });
      } else {
        const captured = affected.captures.find(c => c.gatewayPaymentId === affectedId);
        const live = await getRazorpayPaymentStatus({ orderId: captured.gatewayOrderId, paymentId: affectedId });
        await settleGstPayment(affected._id, live);
      }
      return true;
    }
  }
  if (!evt.gatewayOrderId) return false;
  const p = await Payment.findOne({ gstAssistanceRequestId: { $exists: true }, 'gatewayAttempts.gatewayOrderId': evt.gatewayOrderId });
  if (!p) return false;
  requireGstGateway();
  if (['payment_completed','payment_failed'].includes(evt.kind)) {
    const live = await getRazorpayPaymentStatus({ orderId: evt.gatewayOrderId, paymentId: evt.paymentId });
    if (live.orderId !== evt.gatewayOrderId || live.paymentId !== evt.paymentId || live.amountPaise !== evt.amountPaise || live.currency !== evt.currency) fail('GST webhook evidence mismatch');
    await settleGstPayment(p._id, live);
  }
  return true;
}
