import { fail, text } from './serviceForms.service.js';
export const TRANSITIONS = Object.freeze({
  submitted: ['under_review', 'rejected'],
  under_review: ['information_required', 'in_progress', 'rejected'],
  information_required: ['under_review', 'rejected'],
  in_progress: ['completed', 'rejected'], completed: [], rejected: [],
});
export function transition(application, target, actor, message = '') {
  if (!TRANSITIONS[application.status]?.includes(target)) fail('This status transition is not allowed', 409);
  if (actor.type === 'vendor' && !(application.status === 'information_required' && target === 'under_review')) fail('Admin authorization required', 403);
  const note = text(message, 'Message', 2000, ['information_required', 'rejected'].includes(target) || actor.type === 'vendor');
  application.status = target;
  if (target === 'information_required') application.informationRequest = note;
  if (target === 'rejected') application.rejectionReason = note;
  if (target === 'in_progress') application.processingAt = new Date();
  if (target === 'completed') application.completedAt = new Date();
  if (actor.type === 'admin') application.processedBy = actor.id;
  application.events.push({ action: actor.type === 'vendor' ? 'vendor_response' : target, status: target, actor: actor.id, actorType: actor.type, message: note });
}
