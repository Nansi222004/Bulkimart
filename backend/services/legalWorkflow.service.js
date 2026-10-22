import mongoose from 'mongoose';
import crypto from 'node:crypto';
import Application from '../models/ServiceApplication.js';
import Provider from '../models/LegalProvider.js';
import User from '../models/User.js';
import Payment from '../models/Payment.js';
import Ledger from '../models/SellerLedgerEntry.js';
import { fail, text } from './serviceForms.service.js';
import { financialTransaction } from './financeSafety.service.js';
import { postLedgerEntry } from './sellerLedger.service.js';
import { currentQuote, quotationSnapshot, latestLegalRule, requireLegalFlag, settlementBlockers } from './legalPolicy.service.js';
import { notifyUser, notifyAllAdmins } from './notification.service.js';

export const oid = value => { if (!mongoose.isObjectIdOrHexString(value)) fail('Invalid identifier'); return value; };
export function event(a, actor, action, message = '', target = a.status) {
  a.events.push({ action, actor: actor.id, actorType: actor.type, priorState: a.status, status: target, message: text(message, 'Message', 2000), at: new Date() });
  a.status = target;
}
export async function notifyLegal(a, action) {
  const base = { event: 'SYSTEM', title: 'Legal service request update', message: `Request ${a._id}: ${action.replaceAll('_', ' ')}`, metadata: { applicationId: String(a._id) } };
  // Transport failures must never invalidate committed business state.
  await Promise.allSettled([notifyUser(a.user, { ...base, route: `/legal-services/requests/${a._id}` }), notifyAllAdmins({ ...base, route: `/admin/services?legalRequest=${a._id}` })]);
  if (a.provider) {
    const p = await Provider.findById(a.provider).select('user').catch(() => null);
    if (p) await Promise.allSettled([notifyUser(p.user, { ...base, route: '/legal-provider' })]);
  }
}
export async function approvedProvider(id, service, session) {
  const p = await Provider.findOne({ _id: oid(id), status: 'approved', services: service }).session(session || null);
  if (!p || !p.reviewReference || !await User.exists({ _id: p.user, isActive: true }).session(session || null)) fail('Provider is not approved and eligible for this service', 409);
  // Serialize assignment/payment/start against provider suspension or edits.
  if (session) {
    const changed = await Provider.updateOne({ _id: p._id, __v: p.__v }, { $inc: { __v: 1 } }, { session });
    if (!changed.modifiedCount) fail('Provider changed; review eligibility again', 409);
  }
  return p;
}
export async function mutateLegal(id, version, actor, action) {
  const a = await financialTransaction(async session => {
    const a = await Application.findOne({ _id: oid(id), applicantType: 'customer' }).session(session);
    if (!a) fail('Request not found', 404);
    if (Number(version) !== a.__v) fail('Request changed. Reload before continuing.', 409);
    a.legal ||= {};
    await action(a, session);
    a.markModified('legal'); await a.save({ session });
    return a;
  });
  await notifyLegal(a, a.events.at(-1)?.action || 'updated');
  return a;
}
const requireState = (a, states) => { if (!states.includes(a.status)) fail('Action is not permitted in this request state', 409); };
export async function adminAction(a, input, actor, session) {
  const l = a.legal, q = currentQuote(a), reason = text(input.message ?? '', 'Reason', 2000, true);
  a.responsibleAdmin = actor.id;
  switch (input.action) {
    case 'review': requireState(a, ['submitted']); event(a, actor, 'review', reason, 'under_review'); break;
    case 'information':
      requireState(a, ['under_review', 'in_progress', 'completed_pending_admin_verification']);
      l.resumeAfterInformation = a.status; a.informationRequest = reason;
      event(a, actor, 'information_required', reason, 'information_required'); break;
    case 'reject':
      requireState(a, ['submitted', 'under_review', 'information_required']); a.rejectionReason = reason;
      event(a, actor, 'rejected', reason, 'rejected'); break;
    case 'assign': {
      requireLegalFlag('fulfilment'); requireState(a, ['under_review', 'information_required']);
      if (l.paymentId) fail('Provider assignment is frozen after payment initiation', 409);
      const p = await approvedProvider(input.providerId, a.service, session); a.provider = p._id;
      event(a, actor, 'provider_assigned', reason); break;
    }
    case 'share_documents': {
      const ids = input.fileIds;
      if (!Array.isArray(ids) || ids.some(id => !a.files.some(f => f.fileId === id))) fail('Invalid document selection');
      for (const f of a.files) f.providerVisible = ids.includes(f.fileId);
      if (!Array.isArray(input.fieldIds) || input.fieldIds.some(id => !a.snapshot.fields.some(f => f.id === id))) fail('Invalid answer selection');
      l.sharedAnswerIds = input.fieldIds;
      event(a, actor, 'provider_document_access_updated', reason); break;
    }
    case 'provider_message':
      if (!a.provider) fail('Assign a provider first', 409);
      event(a, actor, 'admin_provider_message', reason); break;
    case 'quote': {
      requireState(a, ['under_review', 'awaiting_payment']);
      if (l.paymentId) fail('Payment was initiated; quotation cannot be repriced', 409);
      if (!a.provider) fail('Assign an approved provider before quoting', 409);
      await approvedProvider(a.provider, a.service, session);
      const rule = await latestLegalRule(session);
      const quote = quotationSnapshot(input, rule?.toObject(), a, actor.id);
      l.quotes ||= []; l.quotes.push(quote);
      event(a, actor, 'quotation_confirmed', reason, 'awaiting_payment'); break;
    }
    case 'start':
      requireLegalFlag('fulfilment'); requireState(a, ['payment_verified']);
      if (!['paid', 'partial_refund'].includes(l.paymentStatus) || l.capturedPaise !== q?.totalPaise || l.hold || l.cancellation) fail('Full verified payment without holds is required', 409);
      await approvedProvider(a.provider, a.service, session);
      a.processingAt = new Date(); event(a, actor, 'work_authorized', reason, 'in_progress'); break;
    case 'verify_completion':
      requireState(a, ['completed_pending_admin_verification']);
      if (l.hold || l.cancellation || !['paid', 'partial_refund'].includes(l.paymentStatus)) fail('Financial hold blocks completion verification', 409);
      l.completionVerifiedAt = new Date(); l.completionVerifiedBy = String(actor.id); a.completedAt = new Date();
      event(a, actor, 'completion_verified', reason, 'completed'); break;
    case 'cancel':
      if (l.paymentId) fail('Paid or initiated requests require explicit refund review; cancellation alone cannot erase obligations', 409);
      requireState(a, ['submitted', 'under_review', 'information_required', 'awaiting_payment']);
      l.cancellation = null; event(a, actor, 'cancelled', reason, 'cancelled'); break;
    case 'deny_cancellation':
      if (!l.cancellation) fail('No cancellation request', 409);
      l.cancellation = null; event(a, actor, 'cancellation_declined', reason); break;
    case 'hold':
      if (l.payout?.status === 'completed') fail('Paid-out requests need external recovery review; automatic reversal is prohibited', 409);
      l.hold = { reason, at: new Date(), by: String(actor.id), priorState: a.status };
      event(a, actor, 'dispute_hold', reason, 'disputed'); break;
    case 'resolve_hold': {
      if (!l.hold || l.extraCaptures?.length || l.refunds?.some(r => r.status !== 'processed')) fail('Unreconciled financial exceptions remain', 409);
      const prior = l.hold.priorState; l.hold = null;
      event(a, actor, 'hold_resolved', reason, prior); break;
    }
    case 'bank_reconciled':
      if (l.paymentStatus !== 'paid' || !input.bankReference || !input.settlementReference) fail('Verified payment and bank/gateway settlement evidence are required', 409);
      l.bankReconciliation = { status: 'verified', bankReference: text(input.bankReference, 'Bank evidence', 200, true), settlementReference: text(input.settlementReference, 'Gateway settlement evidence', 200, true), at: new Date(), by: String(actor.id) };
      event(a, actor, 'bank_settlement_reconciled', reason); break;
    case 'release': {
      const blockers = settlementBlockers(a);
      if (blockers.length || l.payableBucket === 'eligible') fail(`Settlement not eligible: ${blockers.join(', ') || 'already released'}`, 409);
      await approvedProvider(a.provider, a.service, session);
      const reconciliation = await legalReconciliation(a, session);
      if (reconciliation.exceptions.length) fail('Financial reconciliation exceptions block settlement', 409);
      const net = q.providerPaise - (l.reversedProviderPaise || 0);
      await posting(a, 'release-held', 'legal_provider_payable', 'debit', 'held', net, session);
      await posting(a, 'release-eligible', 'legal_provider_payable', 'credit', 'eligible', net, session);
      l.payableBucket = 'eligible'; event(a, actor, 'provider_payable_eligible', reason); break;
    }
    default: fail('Unknown admin action');
  }
}
export async function posting(a, suffix, account, direction, bucket, paise, session, type = 'adjustment') {
  if (!paise) return;
  if (!Number.isSafeInteger(paise) || paise < 0) fail('Invalid financial posting', 409);
  return postLedgerEntry({ idempotencyKey: `LEGAL:${a._id}:${suffix}`, serviceApplicationId: a._id,
    providerId: a.provider, paymentId: a.legal.paymentId, account, type, direction, bucket, amount: paise / 100,
    currency: 'INR', description: `Legal service ${suffix}`, reference: String(a._id), metadata: { quotationVersion: currentQuote(a).version } }, { session });
}
export async function captureLegalPayment(paymentId, live) {
  const a = await financialTransaction(async session => {
    const p = await Payment.findById(paymentId).session(session);
    if (!p?.serviceApplicationId) fail('Payment not found', 404);
    const a = await Application.findById(p.serviceApplicationId).session(session), l = a.legal, q = currentQuote(a);
    const attempt = p.gatewayAttempts.find(t => t.gatewayOrderId === live.orderId);
    if (!attempt || p.quotationVersion !== q.version || live.amountPaise !== q.totalPaise || live.amountPaise !== attempt.amountPaise || live.currency !== 'INR' || !live.paymentId) fail('Payment does not match the stored quotation and attempt', 409);
    const actor = { id: a.user, type: 'system' };
    if (live.state !== 'COMPLETED') {
      if (live.state === 'FAILED' && attempt.status !== 'captured' && attempt.status !== 'failed') {
        attempt.status = 'failed';
        if (!p.captures.length) { p.status = 'failed'; l.paymentStatus = 'failed'; }
        event(a, actor, 'payment_attempt_failed');
      }
    } else if (!p.captures.some(c => c.gatewayPaymentId === live.paymentId)) {
      const blocked = l.paymentStatus === 'paid' || attempt.status === 'failed' || !['awaiting_payment'].includes(a.status) || l.hold || l.cancellation || (q.expiresAt && new Date(q.expiresAt) <= new Date());
      p.captures.push({ gatewayOrderId: live.orderId, gatewayPaymentId: live.paymentId, amountPaise: live.amountPaise, currency: 'INR', disposition: blocked ? 'refund_required' : 'settled', receivedAt: new Date() });
      attempt.status = 'captured';
      if (blocked) {
        l.extraCaptures ||= []; l.extraCaptures.push({ paymentId: live.paymentId, orderId: live.orderId, amountPaise: live.amountPaise });
        l.hold = { reason: 'Late or additional capture requires reconciliation', priorState: a.status };
        await posting(a, `extra-${live.paymentId}`, 'legal_collections', 'credit', 'held', live.amountPaise, session);
        event(a, actor, 'late_capture_hold', '', 'disputed');
      } else {
        p.status = 'paid'; p.paidAt = new Date(); p.gateway.paymentId = live.paymentId;
        l.paymentStatus = 'paid'; l.capturedPaise = live.amountPaise; l.captureId = live.paymentId;
        l.payableBucket = 'held';
        for (const [suffix, account, bucket, n] of [
          ['collection', 'legal_collections', 'pending', q.totalPaise],
          ['provider', 'legal_provider_payable', 'held', q.providerPaise],
          ['commission', 'commission_revenue', 'pending', q.commissionPaise],
          ['tax', 'tax_liability', 'pending', q.serviceTaxPaise + q.commissionTaxPaise],
        ]) await posting(a, suffix, account, 'credit', bucket, n, session, suffix === 'commission' ? 'platform_commission' : 'adjustment');
        event(a, actor, 'payment_verified', '', 'payment_verified');
      }
    }
    a.markModified('legal'); await a.save({ session }); await p.save({ session }); return a;
  });
  await notifyLegal(a, a.events.at(-1)?.action || 'payment_updated'); return a;
}
export async function legalReconciliation(a, session = null) {
  // A MongoDB transaction must not run parallel operations on one session.
  const p = a.legal?.paymentId ? await Payment.findById(a.legal.paymentId).session(session).lean() : null;
  const entries = await Ledger.find({ serviceApplicationId: a._id }).session(session).lean();
  const balances = {};
  for (const e of entries) { const k = `${e.account}:${e.bucket}`; balances[k] = (balances[k] || 0) + (e.direction === 'credit' ? 1 : -1) * Math.round(e.amount * 100); }
  const q = currentQuote(a), l = a.legal || {}, exceptions = [];
  if (['paid', 'partial_refund', 'refunded'].includes(l.paymentStatus)) {
    if (!p || !['paid', 'partial_refund', 'refunded'].includes(p.status) || l.capturedPaise !== q?.totalPaise) exceptions.push('payment_mismatch');
    if ((balances[`legal_provider_payable:${l.payableBucket || 'held'}`] || 0) !== q.providerPaise - (l.reversedProviderPaise || 0)) exceptions.push('provider_balance_mismatch');
    for (const [account, expected] of [['commission_revenue', q.commissionPaise - (l.reversedCommissionPaise || 0)], ['tax_liability', q.serviceTaxPaise + q.commissionTaxPaise - (l.reversedTaxPaise || 0)], ['legal_collections', q.totalPaise - (l.refundedPaise || 0)]]) {
      if ((balances[`${account}:pending`] || 0) !== expected) exceptions.push(`${account}_mismatch`);
    }
  }
  if (l.bankReconciliation?.status !== 'verified') exceptions.push('bank_settlement_unreconciled');
  if (l.extraCaptures?.length) exceptions.push('late_or_additional_capture');
  return { balancesPaise: balances, exceptions, settlementBlockers: settlementBlockers(a), entries, payment: p ? { status: p.status, attempts: p.gatewayAttempts, captures: p.captures } : null };
}
export const submissionHash = (service, answers, files) => crypto.createHash('sha256').update(JSON.stringify({ service: String(service), answers: Object.fromEntries(Object.entries(answers).sort(([a], [b]) => a.localeCompare(b))), files: files.map(f => ({ field: f.fieldname, hash: f.sha256 })).sort((a, b) => a.field.localeCompare(b.field)) })).digest('hex');
