import crypto from 'node:crypto';
import Application from '../models/ServiceApplication.js';
import Payment from '../models/Payment.js';
import { fail } from './serviceForms.service.js';
import { requireServiceGateway } from './servicePaymentPolicy.service.js';
import { financialTransaction } from './financeSafety.service.js';
import { createRazorpayOrder, getRazorpayPaymentStatus, verifyRazorpayPaymentSignature } from './razorpay.service.js';
import { reconcileCreationAttempt } from './paymentRecovery.service.js';
import { addRefundObligation } from './paymentObligations.service.js';
import { postLedgerEntry } from './sellerLedger.service.js';
import { moneyPaise } from './vendorCommission.service.js';
import { MAX_CHECKOUT_PAISE } from '../utils/money.js';
import { notifyAllAdmins } from './notification.service.js';

// 'vendor_service' marks every simple service-fee payment (sellers and customers); legal quotation payments never use it.
const purpose = { servicePaymentKind: 'vendor_service' };
// The fee a fixed-price service charges when the application is submitted, or null for a free service.
export function serviceFeeBilling(service) {
  const price = service.pricing;
  if (price?.mode !== 'fixed' || !(Number(price.amount) > 0)) return null;
  if (price.currency !== 'INR') fail('Only INR service fees can be paid online', 409);
  const amountPaise = moneyPaise(price.amount, 'Service fee');
  if (amountPaise <= 0 || amountPaise > MAX_CHECKOUT_PAISE) fail('Service fee is outside the supported payment limit', 409);
  return { version: 1, amountPaise, currency: 'INR', status: 'unpaid', requestedAt: new Date(),
    terms: `Service fee for ${service.name}, paid to Bulkimart when you submit. If your application is rejected, the fee is refunded to your Bulkimart wallet.` };
}
// A seller's application (vendor set) or the signed-in customer's own request.
async function owned(id, user, vendor, session = null) {
  const a = await Application.findOne({ _id: id, user, ...(vendor ? { vendor, applicantType: { $ne: 'customer' } } : { applicantType: 'customer' }) }).session(session);
  if (!a) fail('Service application not found', 404);
  return a;
}
export async function initiateServicePayment(id, user, vendor, input, key) {
  requireServiceGateway();
  if (!/^[a-zA-Z0-9-]{16,100}$/.test(key || '')) fail('A valid payment request key is required');
  const prepared = await financialTransaction(async session => {
    const a = await owned(id, user, vendor, session), bill = a.billing;
    if (a.status !== 'awaiting_payment' || !bill || bill.reviewRequired || ['paid', 'refunded', 'partial_refund'].includes(bill.status)) fail('This application has no service fee waiting to be paid', 409);
    if (input.acceptTerms !== true || input.feeVersion !== bill.version || input.amountPaise !== bill.amountPaise) fail('Refresh and accept the current service fee and payment terms', 409);
    if (bill.mode && bill.mode !== process.env.RAZORPAY_MODE) fail('Payment environment changed. Contact support.', 409);
    let p = bill.paymentId ? await Payment.findOne({ _id: bill.paymentId, ...purpose, serviceApplicationId: a._id, userId: user }).session(session) : null;
    if (bill.paymentId && !p) fail('Service payment association requires review', 409);
    if (!p) {
      [p] = await Payment.create([{ userId: user, serviceApplicationId: a._id, ...purpose, serviceGatewayMode: process.env.RAZORPAY_MODE, quotationVersion: bill.version, amount: bill.amountPaise / 100, method: 'online', gateway: { provider: 'razorpay' } }], { session });
      bill.paymentId = String(p._id);
    }
    const attempt = p.gatewayAttempts.find(t => ['issued', 'initializing', 'creation_unknown'].includes(t.status)) || p.gatewayAttempts.find(t => t.attemptId === key);
    if (attempt) {
      if (attempt.status !== 'issued') fail('Check payment status before retrying an uncertain checkout or using a new attempt key', 409);
      return { p, attempt: attempt.toObject(), fresh: false };
    }
    if (p.gatewayAttempts.length >= 10) fail('Payment attempt limit reached. Contact support.', 409);
    p.gatewayAttempts.push({ attemptId: key, provider: 'razorpay', merchantOrderId: `SVC-${crypto.randomUUID()}`, amountPaise: bill.amountPaise, currency: 'INR', status: 'initializing', createdAt: new Date() });
    p.status = 'pending'; bill.status = 'pending'; bill.mode = process.env.RAZORPAY_MODE; bill.acceptedAt = new Date();
    a.events.push({ action: 'payment_terms_accepted', actor: user, actorType: a.applicantType === 'customer' ? 'customer' : 'vendor', status: a.status });
    a.markModified('billing'); await a.save({ session }); await p.save({ session });
    return { p, attempt: p.gatewayAttempts.at(-1).toObject(), fresh: true };
  });
  let attempt = prepared.attempt;
  if (prepared.fresh) {
    try {
      const gateway = await createRazorpayOrder({ merchantOrderId: attempt.merchantOrderId, amountPaise: attempt.amountPaise,
        notes: { serviceApplicationId: String(id), quotationVersion: String(prepared.p.quotationVersion) } });
      await reconcileCreationAttempt({ paymentId: String(prepared.p._id), key: attempt.attemptId, actor: user, gatewayOrderId: gateway.orderId });
      attempt = { ...attempt, gatewayOrderId: gateway.orderId };
    } catch {
      await Payment.updateOne({ _id: prepared.p._id, gatewayAttempts: { $elemMatch: { attemptId: attempt.attemptId, status: 'initializing' } } }, { $set: { 'gatewayAttempts.$.status': 'creation_unknown' } });
      fail('Checkout creation is uncertain. Check payment status before retrying.', 503);
    }
  }
  return { orderId: String(id), razorpayOrderId: attempt.gatewayOrderId, keyId: process.env.RAZORPAY_KEY_ID, amountPaise: attempt.amountPaise,
    currency: 'INR', name: 'Bulkimart', description: 'Service fee', verificationPath: vendor ? '/api/services/payments/verify' : '/api/customer-services/payments/verify' };
}

export async function settleServicePayment(paymentId, live) {
  requireServiceGateway();
  let submitted = null;
  const status = await financialTransaction(async session => {
    const p = await Payment.findOne({ _id: paymentId, ...purpose }).session(session);
    const a = p && await Application.findOne({ _id: p.serviceApplicationId }).session(session), bill = a?.billing;
    const attempt = p?.gatewayAttempts.find(t => t.gatewayOrderId === live.orderId);
    if (!bill || String(bill.paymentId) !== String(p._id) || bill.mode !== process.env.RAZORPAY_MODE || bill.version !== p.quotationVersion
      || !attempt || !live.paymentId || live.currency !== 'INR' || live.amountPaise !== attempt.amountPaise || live.amountPaise !== bill.amountPaise) fail('Service payment amount or association mismatch', 409);
    let capture = p.captures.find(c => c.gatewayPaymentId === live.paymentId);
    if (capture && (capture.gatewayOrderId !== live.orderId || capture.amountPaise !== live.amountPaise)) fail('Capture replay mismatch', 409);
    if (live.state === 'COMPLETED') {
      const refunded = live.refundedPaise ?? 0;
      if (!Number.isSafeInteger(refunded) || refunded < 0 || refunded > live.amountPaise) fail('Invalid provider refund evidence', 409);
      if (!capture) {
        const extra = p.captures.some(c => c.disposition === 'settled') || a.status !== 'awaiting_payment' || bill.reviewRequired;
        p.captures.push({ gatewayOrderId: live.orderId, gatewayPaymentId: live.paymentId, amountPaise: live.amountPaise, currency: 'INR', disposition: extra ? 'refund_required' : 'settled', receivedAt: new Date(), refundedPaise: 0 });
        capture = p.captures.at(-1);
        if (extra) {
          addRefundObligation(p, { key: `SERVICE_EXTRA:${live.paymentId}`, gatewayOrderId: live.orderId, gatewayPaymentId: live.paymentId, amountPaise: live.amountPaise, reason: 'Extra or late service capture requires refund review' });
          bill.reviewRequired = true;
        } else {
          p.status = 'paid'; p.paidAt = new Date(); bill.status = 'paid'; bill.captureId = live.paymentId;
          // A fee paid at submission makes the application real for the admin; an older admin-requested fee resumes review.
          a.status = bill.requestedBy ? 'payment_verified' : 'submitted'; if (!bill.requestedBy) submitted = a;
        }
        await postLedgerEntry({ idempotencyKey: `SERVICE_RECEIPT:${live.paymentId}`, serviceApplicationId: a._id, paymentId: p._id,
          account: 'service_collections', type: 'adjustment', direction: 'credit', bucket: 'held', amount: live.amountPaise / 100,
          reference: live.paymentId, description: 'Provider-verified service fee held pending service and financial review' }, { session });
        a.events.push({ action: extra ? 'payment_review_required' : 'payment_verified', actor: a.user, actorType: 'system', status: a.status });
      }
      const previous = capture.refundedPaise || 0;
      if (refunded > previous) {
        await postLedgerEntry({ idempotencyKey: `SERVICE_REFUND:${live.paymentId}:${refunded}`, serviceApplicationId: a._id, paymentId: p._id,
          account: 'service_collections', type: 'reversal', direction: 'debit', bucket: 'held', amount: (refunded - previous) / 100,
          reference: live.paymentId, description: 'Provider-verified service refund requiring financial review' }, { session });
        capture.refundedPaise = refunded; bill.reviewRequired = true;
        if (capture.disposition === 'settled') { bill.refundedPaise = refunded; bill.status = refunded === live.amountPaise ? 'refunded' : 'partial_refund'; p.status = bill.status; }
      }
    } else if (live.state === 'FAILED' && !p.captures.some(c => c.disposition === 'settled')) {
      p.status = 'failed'; bill.status = 'failed'; attempt.status = 'failed';
    }
    a.markModified('billing'); await a.save({ session }); await p.save({ session });
    return bill.status;
  });
  if (submitted) await notifyAllAdmins({ event: 'SYSTEM', title: 'New paid service application', message: `${submitted.snapshot.name}: service fee paid and application submitted`,
    metadata: { applicationId: String(submitted._id) }, route: `/admin/services?${submitted.applicantType === 'customer' ? 'legalRequest' : 'application'}=${submitted._id}` }).catch(() => {});
  return status;
}

export async function verifyServicePayment(id, user, vendor, input = {}, poll = false) {
  requireServiceGateway();
  const a = await owned(id, user, vendor), p = a.billing?.paymentId && await Payment.findOne({ _id: a.billing.paymentId, ...purpose, serviceApplicationId: a._id, userId: user });
  if (!p) fail('Payment has not been started', 409);
  let attempt = poll ? p.gatewayAttempts.at(-1) : p.gatewayAttempts.find(t => t.gatewayOrderId === input.razorpay_order_id);
  if (!attempt) fail('Payment order does not belong to this application', 409);
  if (poll && ['initializing', 'creation_unknown'].includes(attempt.status)) {
    await reconcileCreationAttempt({ paymentId: String(p._id), key: attempt.attemptId, actor: user });
    attempt = (await Payment.findById(p._id)).gatewayAttempts.find(t => t.attemptId === attempt.attemptId);
  }
  if (!attempt.gatewayOrderId) fail('Checkout is awaiting provider reconciliation', 409);
  if (!poll && !verifyRazorpayPaymentSignature({ orderId: attempt.gatewayOrderId, paymentId: input.razorpay_payment_id, signature: input.razorpay_signature })) fail('Payment signature verification failed', 401);
  const live = await getRazorpayPaymentStatus({ orderId: attempt.gatewayOrderId, ...(poll ? {} : { paymentId: input.razorpay_payment_id }) });
  if (live.orderId !== attempt.gatewayOrderId || (!poll && live.paymentId !== input.razorpay_payment_id)) fail('Provider payment association mismatch', 409);
  return { status: live.paymentId ? await settleServicePayment(p._id, live) : a.billing.status };
}

// Called only after the shared webhook has verified the provider signature.
export async function handleServiceWebhook(body, evt) {
  const dispute = body.event?.startsWith('payment.dispute.') && body.payload?.dispute?.entity;
  const affected = dispute?.payment_id || evt.refundPaymentId;
  const p = affected ? await Payment.findOne({ ...purpose, 'captures.gatewayPaymentId': affected })
    : evt.gatewayOrderId ? await Payment.findOne({ ...purpose, 'gatewayAttempts.gatewayOrderId': evt.gatewayOrderId }) : null;
  if (!p) return false;
  requireServiceGateway();
  if (dispute) {
    await Application.updateOne({ _id: p.serviceApplicationId }, { $set: { 'billing.reviewRequired': true }, $inc: { __v: 1 } });
  } else if (affected || ['payment_completed', 'payment_failed'].includes(evt.kind)) {
    const capture = affected && p.captures.find(c => c.gatewayPaymentId === affected);
    const live = await getRazorpayPaymentStatus({ orderId: capture?.gatewayOrderId || evt.gatewayOrderId, paymentId: affected || evt.paymentId });
    if (!affected && (live.orderId !== evt.gatewayOrderId || live.paymentId !== evt.paymentId || live.amountPaise !== evt.amountPaise || live.currency !== evt.currency)) fail('Service webhook evidence mismatch', 409);
    await settleServicePayment(p._id, live);
  }
  return true;
}
