import { fail, text } from './serviceForms.service.js';
import { moneyPaise } from './vendorCommission.service.js';
import { MAX_CHECKOUT_PAISE } from '../utils/money.js';
export const TRANSITIONS = Object.freeze({
  submitted: ['under_review', 'rejected'],
  under_review: ['information_required', 'awaiting_payment', 'in_progress', 'rejected'],
  information_required: ['under_review', 'rejected'],
  in_progress: ['awaiting_payment', 'completed', 'rejected'], completed: [], rejected: [],
  awaiting_payment: ['awaiting_payment', 'rejected'], payment_verified: ['in_progress'],
});
export function transition(application, target, actor, message = '') {
  if (!TRANSITIONS[application.status]?.includes(target)) fail('This status transition is not allowed', 409);
  if (actor.type === 'vendor' && !(application.status === 'information_required' && target === 'under_review')) fail('Admin authorization required', 403);
  const note = text(message, 'Message', 2000, ['information_required', 'rejected'].includes(target) || actor.type === 'vendor');
  if (target === 'awaiting_payment') {
    const price = application.snapshot?.pricing;
    if (price?.mode !== 'fixed' || price.currency !== 'INR') fail('Only fixed INR service fees can be requested', 409);
    const amountPaise = moneyPaise(price.amount, 'Service fee');
    if (amountPaise <= 0 || amountPaise > MAX_CHECKOUT_PAISE) fail('Service fee is outside the supported payment limit', 409);
    if (application.billing?.paymentId) fail('Payment has been initiated; its fee and terms cannot change', 409);
    const terms = text(message, 'Payment terms', 2000, true);
    application.billing = { version: (application.billing?.version || 0) + 1, amountPaise, currency: 'INR', terms, status: 'unpaid', requestedBy: String(actor.id), requestedAt: new Date() };
  }
  if (['in_progress', 'completed'].includes(target) && application.snapshot?.pricing?.mode === 'fixed'
    && (application.billing?.status !== 'paid' || application.billing.reviewRequired)) fail('Request and verify the service payment before starting or completing paid work', 409);
  if (target === 'rejected' && application.billing?.paymentId) fail('An initiated or received payment requires financial review before closing the application', 409);
  application.status = target;
  if (target === 'information_required') application.informationRequest = note;
  if (target === 'rejected') application.rejectionReason = note;
  if (target === 'in_progress') application.processingAt = new Date();
  if (target === 'completed') application.completedAt = new Date();
  if (actor.type === 'admin') application.processedBy = actor.id;
  application.events.push({ action: actor.type === 'vendor' ? 'vendor_response' : target, status: target, actor: actor.id, actorType: actor.type, message: note });
}
