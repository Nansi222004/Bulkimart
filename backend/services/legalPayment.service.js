import crypto from 'node:crypto';
import Application from '../models/ServiceApplication.js';
import Payment from '../models/Payment.js';
import { fail, text } from './serviceForms.service.js';
import { financialTransaction } from './financeSafety.service.js';
import { moneyPaise } from './vendorCommission.service.js';
import { requireLegalGateway, currentQuote, quotePayable, ratio, requireLegalFlag } from './legalPolicy.service.js';
import { approvedProvider, event, posting, captureLegalPayment, notifyLegal } from './legalWorkflow.service.js';
import { createRazorpayOrder, getRazorpayPaymentStatus, verifyRazorpayPaymentSignature } from './razorpay.service.js';
import { processRefundObligation, reconcileRefundEvent, reconcileCreationAttempt } from './paymentRecovery.service.js';

export async function initiateLegalPayment(id, user, input, key) {
  requireLegalGateway();
  if (!/^[a-zA-Z0-9-]{16,100}$/.test(key || '')) fail('Valid payment idempotency key required');
  const prepared = await financialTransaction(async session => {
    const a = await Application.findOne({ _id: id, user, applicantType: 'customer' }).session(session);
    if (!a) fail('Request not found', 404);
    if (!quotePayable(a)) fail('A current quotation without financial holds is required', 409);
    const q = currentQuote(a);
    if (input.quotationVersion !== q.version || input.acceptTerms !== true) fail('Review and accept the current quotation and terms', 409);
    await approvedProvider(a.provider, a.service, session);
    let p = a.legal.paymentId ? await Payment.findById(a.legal.paymentId).session(session) : null;
    if (!p) {
      [p] = await Payment.create([{ userId: user, serviceApplicationId: a._id, serviceGatewayMode: process.env.RAZORPAY_MODE, quotationVersion: q.version, amount: q.totalPaise / 100, method: 'online', status: 'pending', gateway: { provider: 'razorpay' } }], { session });
      a.legal.paymentId = String(p._id); a.legal.paymentStatus = 'pending';
    }
    if ((p.serviceGatewayMode || 'test') !== process.env.RAZORPAY_MODE) fail('Payment environment changed. Contact support.', 409);
    const prior = p.gatewayAttempts.find(t => t.attemptId === key);
    const active = p.gatewayAttempts.find(t => ['issued', 'initializing', 'creation_unknown'].includes(t.status));
    if (active || prior) {
      const attempt = active || prior;
      if (attempt.status !== 'issued') fail('Payment creation is uncertain or failed; reconcile or use a new key after confirmed failure', 409);
      return { a, p, attempt, fresh: false };
    }
    if (p.gatewayAttempts.length >= 20) fail('Payment attempt limit reached', 409);
    const merchantOrderId = `LS-${crypto.randomUUID()}`;
    p.status = 'pending'; a.legal.paymentStatus = 'pending';
    p.gatewayAttempts.push({ attemptId: key, provider: 'razorpay', merchantOrderId, amountPaise: q.totalPaise, currency: 'INR', status: 'initializing', createdAt: new Date() });
    event(a, { id: user, type: 'customer' }, 'quotation_terms_accepted');
    a.markModified('legal'); await a.save({ session }); await p.save({ session });
    return { a, p, attempt: p.gatewayAttempts.at(-1).toObject(), fresh: true };
  });
  let attempt = prepared.attempt;
  if (prepared.fresh) {
    try {
      const gw = await createRazorpayOrder({ merchantOrderId: attempt.merchantOrderId, amountPaise: attempt.amountPaise, notes: { legalRequestId: String(id), quotationVersion: String(prepared.p.quotationVersion) } });
      if (gw.amountPaise !== attempt.amountPaise || gw.currency !== 'INR') fail('Gateway order mismatch', 502);
      // Reuse the existing recovery binder even on the ordinary success path:
      // independently verify receipt, request, quote version, amount and currency.
      await reconcileCreationAttempt({ paymentId: String(prepared.p._id), key, actor: user, gatewayOrderId: gw.orderId });
      attempt = { ...attempt, gatewayOrderId: gw.orderId };
    } catch {
      await Payment.updateOne({ _id: prepared.p._id, gatewayAttempts: { $elemMatch: { attemptId: key, status: 'initializing' } } }, { $set: { 'gatewayAttempts.$.status': 'creation_unknown' } });
      fail('Gateway order creation outcome is uncertain. Admin reconciliation is required before retry.', 503);
    }
  }
  return { orderId: String(id), razorpayOrderId: attempt.gatewayOrderId, keyId: process.env.RAZORPAY_KEY_ID, amountPaise: attempt.amountPaise, currency: 'INR', name: 'Bulkimart', description: 'Confirmed legal service quotation', verificationPath: '/api/customer-services/payments/verify' };
}
export async function verifyLegalPayment(id, user, input, poll = false) {
  requireLegalGateway();
  const a = await Application.findOne({ _id: id, user, applicantType: 'customer' });
  if (!a) fail('Request not found', 404);
  const p = await Payment.findById(a.legal?.paymentId);
  if (!p) fail('Payment not initiated', 409);
  if ((p.serviceGatewayMode || 'test') !== process.env.RAZORPAY_MODE) fail('Payment environment changed. Contact support.', 409);
  const orderId = poll ? p.gatewayAttempts.at(-1)?.gatewayOrderId : input.razorpay_order_id;
  if (!orderId || !p.gatewayAttempts.some(t => t.gatewayOrderId === orderId)) fail('Payment order mismatch', 409);
  if (!poll && !verifyRazorpayPaymentSignature({ orderId, paymentId: input.razorpay_payment_id, signature: input.razorpay_signature })) fail('Payment verification failed', 401);
  const live = await getRazorpayPaymentStatus({ orderId, ...(poll ? {} : { paymentId: input.razorpay_payment_id }) });
  if (live.orderId !== orderId || (!poll && live.paymentId !== input.razorpay_payment_id)) fail('Gateway payment association mismatch', 409);
  if (live.paymentId) await captureLegalPayment(p._id, live);
  const fresh = await Application.findById(id);
  return { status: fresh.legal.paymentStatus || 'pending', requestStatus: fresh.status };
}
export async function approveLegalRefund(a, input, actor, session) {
  const q = currentQuote(a), l = a.legal;
  if (l.payout || !l.captureId || l.extraCaptures?.length) fail('Payout or unallocated capture requires separate reconciliation', 409);
  const amountPaise = moneyPaise(input.amount, 'Refund amount');
  if (amountPaise <= 0) fail('Positive refund amount required');
  const p = await Payment.findById(l.paymentId).session(session);
  const allocated = p.refundObligations.reduce((n, r) => n + r.amountPaise, 0);
  if (allocated + amountPaise > q.totalPaise) fail('Refund exceeds unallocated captured amount', 409);
  const reason = text(input.message, 'Refund reason', 2000, true);
  const key = `LEGAL:${crypto.randomUUID()}`;
  const capture = p.captures.find(c => c.gatewayPaymentId === l.captureId);
  p.refundObligations.push({ key, gatewayOrderId: capture.gatewayOrderId, gatewayPaymentId: l.captureId, amountPaise, currency: 'INR', reason, status: 'pending', createdAt: new Date() });
  l.refunds ||= []; l.refunds.push({ key, amountPaise, status: 'pending', approvedBy: String(actor.id), reason });
  l.refundPriorState ||= a.status;
  event(a, actor, 'refund_approved', reason, 'refund_processing');
  await p.save({ session });
}
export async function syncLegalRefunds(paymentId) {
  const a = await financialTransaction(async session => {
    const p = await Payment.findById(paymentId).session(session);
    const a = await Application.findById(p.serviceApplicationId).session(session), l = a.legal, q = currentQuote(a);
    for (const r of l.refunds || []) {
      const debt = p.refundObligations.find(d => d.key === r.key);
      r.status = debt.status; r.providerRefundId = debt.providerRefundId;
    }
    l.paymentStatus = p.status;
    const refunded = p.refundObligations.filter(r => r.status === 'processed').reduce((n, r) => n + r.amountPaise, 0);
    const previous = l.refundedPaise || 0;
    if (refunded > previous) {
      if (refunded > q.totalPaise || l.payout) fail('Refund allocation requires manual reconciliation', 409);
      // Cumulative targets avoid rounding drift between multiple partial refunds.
      const tax = ratio(q.serviceTaxPaise + q.commissionTaxPaise, refunded, q.totalPaise);
      const commission = ratio(q.commissionPaise, refunded - tax, q.providerPaise + q.commissionPaise || 1);
      const provider = refunded - tax - commission;
      for (const [suffix, account, bucket, amount] of [
        ['provider', 'legal_provider_payable', l.payableBucket || 'held', provider - (l.reversedProviderPaise || 0)],
        ['commission', 'commission_revenue', 'pending', commission - (l.reversedCommissionPaise || 0)],
        ['tax', 'tax_liability', 'pending', tax - (l.reversedTaxPaise || 0)],
        ['collection', 'legal_collections', 'pending', refunded - previous],
      ]) await posting(a, `refund-${refunded}-${suffix}`, account, 'debit', bucket, amount, session, 'reversal');
      l.refundedPaise = refunded; l.reversedProviderPaise = provider; l.reversedCommissionPaise = commission; l.reversedTaxPaise = tax;
      l.cancellation = null;
      event(a, { id: a.user, type: 'system' }, 'refund_confirmed', '', refunded === q.totalPaise ? 'refunded' : l.refundPriorState);
    }
    a.markModified('legal'); await a.save({ session }); return a;
  });
  await notifyLegal(a, 'refund_updated'); return a;
}
export async function executeLegalRefund(a, key, actor, reconcile = false, providerRefundId) {
  requireLegalGateway('refunds');
  if (!a.legal?.refunds?.some(r => r.key === key)) fail('Refund not found', 404);
  await processRefundObligation({ paymentId: String(a.legal.paymentId), key, actor, reconcile, providerRefundId });
  return syncLegalRefunds(a.legal.paymentId);
}
// Called only after the existing shared webhook signature verification.
export async function handleLegalWebhook(body, evt) {
  if (typeof body.event === 'string' && body.event.startsWith('payment.dispute.')) {
    const d = body.payload?.dispute?.entity;
    const p = d?.payment_id && await Payment.findOne({ serviceApplicationId: { $exists: true }, servicePaymentKind: { $ne: 'vendor_service' }, 'captures.gatewayPaymentId': d.payment_id });
    if (p?.serviceApplicationId) {
      requireLegalGateway();
      await financialTransaction(async session => {
        const a = await Application.findById(p.serviceApplicationId).session(session);
        const l = a.legal; l.disputes ||= [];
        const key = `${body.event}:${d.id}`;
        if (!l.disputes.includes(key)) {
          l.disputes.push(key); l.hold = { reason: 'Gateway dispute requires reconciliation', priorState: l.hold?.priorState || a.status };
          event(a, { id: a.user, type: 'system' }, 'gateway_dispute_hold', '', 'disputed'); a.markModified('legal'); await a.save({ session });
        }
      });
      return true;
    }
  }
  const p = evt.gatewayOrderId ? await Payment.findOne({ serviceApplicationId: { $exists: true }, servicePaymentKind: { $ne: 'vendor_service' }, 'gatewayAttempts.gatewayOrderId': evt.gatewayOrderId }) : null;
  const ref = evt.refundReceipt || evt.refundNotes?.obligationReceipt;
  const rp = evt.refundId ? await Payment.findOne({ serviceApplicationId: { $exists: true }, servicePaymentKind: { $ne: 'vendor_service' }, $or: [{ 'refundObligations.providerRefundId': evt.refundId }, ...(ref ? [{ 'refundObligations.receipt': ref }] : [])] }) : null;
  if (rp?.serviceApplicationId) {
    requireLegalGateway('refunds'); await reconcileRefundEvent(evt); await syncLegalRefunds(rp._id); return true;
  }
  if (!p?.serviceApplicationId) return false;
  requireLegalGateway();
  if (['payment_completed', 'payment_failed'].includes(evt.kind)) {
    // Fetch independently; the signed event alone does not bypass amount/state checks.
    const live = await getRazorpayPaymentStatus({ orderId: evt.gatewayOrderId, paymentId: evt.paymentId });
    if (live.orderId !== evt.gatewayOrderId || live.paymentId !== evt.paymentId || live.amountPaise !== evt.amountPaise || live.currency !== evt.currency) fail('Gateway event evidence mismatch', 409);
    await captureLegalPayment(p._id, live);
  }
  return true;
}
