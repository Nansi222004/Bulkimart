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
