import { fail, text } from './serviceForms.service.js';
// Fixed-price services are paid when the applicant submits (awaiting_payment until then),
// so the admin flow is only review → information → work → completion, or rejection.
// payment_verified is kept for applications whose fee an admin requested before this flow.
export const TRANSITIONS = Object.freeze({
  awaiting_payment: ['rejected'],
  submitted: ['under_review', 'rejected'],
  payment_verified: ['under_review', 'in_progress', 'rejected'],
  under_review: ['information_required', 'in_progress', 'rejected'],
  information_required: ['under_review', 'rejected'],
  in_progress: ['completed', 'rejected'], completed: [], rejected: [],
});
const APPLICANT_ACTORS = ['vendor', 'customer'];
// True when rejecting this application must give the paid fee back (to the applicant's wallet).
export const refundDueOnRejection = application => application.billing?.status === 'paid' && !application.billing.reviewRequired;

/**
 * Whether the applicant may cancel a fixed-price request themselves, and whether the
 * paid fee goes back to their wallet. Uses only what was frozen on the request at
 * checkout (the service's cancellation window), never the service's current settings:
 *  - not paid yet → can always cancel, nothing to refund;
 *  - paid → within `cancellationWindowHours` of payment and before work starts,
 *    cancel with a wallet refund; after that, no cancellation (per the accepted terms).
 * Returns { allowed, refund, reason, deadline }.
 */
export function applicantCancellation(application, now = new Date()) {
  const bill = application.billing;
  if (!bill) return { allowed: false, refund: false, reason: 'This request has no service fee.' };
  if (application.status === 'cancelled' && bill.cancelRefundDue && bill.status === 'paid') return { allowed: true, refund: true, resume: true };
  if (['cancelled', 'rejected', 'completed', 'refunded'].includes(application.status)) return { allowed: false, refund: false, reason: 'This request is already closed.' };
  if (application.processingAt || ['in_progress', 'completed_pending_admin_verification'].includes(application.status)) return { allowed: false, refund: false, reason: 'Work on this request has already started, so it can no longer be cancelled.' };
  if (bill.reviewRequired) return { allowed: false, refund: false, reason: 'This payment is being reviewed by our finance team. Please contact Bulkimart.' };
  if (bill.status === 'paid') {
    const hours = Number.isInteger(bill.cancellationWindowHours) ? bill.cancellationWindowHours : 0;
    const paidAt = bill.paidAt ? new Date(bill.paidAt) : null;
    const deadline = paidAt && hours > 0 ? new Date(paidAt.getTime() + hours * 3600000) : null;
    if (!deadline) return { allowed: false, refund: false, reason: 'This service cannot be cancelled after payment.' };
    if (now > deadline) return { allowed: false, refund: false, deadline, reason: `Cancellation was available for ${hours} hour${hours === 1 ? '' : 's'} after payment.` };
    return { allowed: true, refund: true, deadline };
  }
  if (application.status === 'awaiting_payment' && ['unpaid', 'failed'].includes(bill.status)) return { allowed: true, refund: false };
  return { allowed: false, refund: false, reason: 'A payment for this request is still being processed. Check the payment status first.' };
}
export function transition(application, target, actor, message = '') {
  if (!TRANSITIONS[application.status]?.includes(target)) fail('This status transition is not allowed', 409);
  if (APPLICANT_ACTORS.includes(actor.type) && !(application.status === 'information_required' && target === 'under_review')) fail('Admin authorization required', 403);
  const note = text(message, 'Message', 2000, ['information_required', 'rejected'].includes(target) || APPLICANT_ACTORS.includes(actor.type));
  if (['in_progress', 'completed'].includes(target) && application.billing && (application.billing.status !== 'paid' || application.billing.reviewRequired)) fail('The service fee must be paid before work starts', 409);
  if (target === 'rejected' && application.billing?.reviewRequired) fail('This payment needs a finance review before the application can be closed', 409);
  application.status = target;
  if (target === 'information_required') application.informationRequest = note;
  if (target === 'rejected') application.rejectionReason = note;
  if (target === 'in_progress') application.processingAt = new Date();
  if (target === 'completed') application.completedAt = new Date();
  if (actor.type === 'admin') application.processedBy = actor.id;
  application.events.push({ action: APPLICANT_ACTORS.includes(actor.type) ? `${actor.type}_response` : target, status: target, actor: actor.id, actorType: actor.type, message: note });
}
