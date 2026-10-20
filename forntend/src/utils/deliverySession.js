import { clearPortalRequests } from './portalRequests';
import { clearDeliveryRegistrationDrafts } from './deliveryRegistrationDraft';
import { bindSessionBackend, clearSessionBackend } from './sessionBackend';
export const DELIVERY_SESSION_CHANGED = 'bulkimart:delivery-session-changed';
let revision = 0;
export const captureDeliverySession = () => ({ token: localStorage.getItem('deliveryToken'), revision });
export const isCurrentDeliverySession = snapshot => snapshot.token === localStorage.getItem('deliveryToken') && snapshot.revision === revision;
export function clearDeliverySession(notify = true) {
  revision++;
  clearPortalRequests('delivery');
  clearDeliveryRegistrationDrafts();
  clearSessionBackend('delivery');
  for (const key of ['deliveryToken', 'deliveryUserProfile', 'delivery_onboarded', 'deliveryDebitWallet', 'deliveryEarningsDaily']) localStorage.removeItem(key);
  if (notify) window.dispatchEvent(new Event(DELIVERY_SESSION_CHANGED));
}
export function saveDeliverySession(body) {
  if (!body.success || typeof body.token !== 'string' || !body.token || !body.user?._id || body.sessionRole !== 'delivery' || !body.user.roles?.includes('delivery')) throw new Error('Invalid Delivery login session. Please sign in again.');
  clearDeliverySession(false);
  localStorage.setItem('deliveryToken', body.token);
  localStorage.setItem('deliveryUserProfile', JSON.stringify(body.user));
  bindSessionBackend('delivery');
  window.dispatchEvent(new Event(DELIVERY_SESSION_CHANGED));
}
