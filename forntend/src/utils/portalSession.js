import { clearPortalRequests } from './portalRequests';
import { bindSessionBackend, sessionMatchesBackend } from './sessionBackend';
import { disablePushSession } from './pushSessionState';
// Portals have independent credentials. Never fall back to another portal.
export const SELLER_SESSION_CHANGED = 'bulkimart:seller-session-changed';
export const portalScope = () => {
  const path = typeof window !== 'undefined' ? window.location?.pathname || '' : '';
  if (/^\/seller(?:\/|$)/.test(path)) return 'seller';
  if (/^\/delivery(?:\/|$)/.test(path)) return 'delivery';
  if (/^\/admin(?:\/|$)/.test(path)) return 'admin';
  return 'customer';
};
export const portalTokenKey = (scope = portalScope()) => scope === 'admin' ? 'adminToken' : scope === 'seller' ? 'sellerToken' : scope === 'delivery' ? 'deliveryToken' : 'userToken';
export const getPortalToken = (scope = portalScope()) => sessionMatchesBackend(scope) ? localStorage.getItem(portalTokenKey(scope)) : null;
export const pushTokenKey = (scope = portalScope()) => scope === 'admin' ? 'bulkimart_admin_fcm_token' : scope === 'seller' ? 'bulkimart_seller_fcm_token' : scope === 'delivery' ? 'bulkimart_delivery_fcm_token' : 'nhcone_fcm_token';

export function saveSellerSession(body) {
  if (!body.success || typeof body.token !== 'string' || !body.token || !body.user?._id || body.sessionRole !== 'seller' || !body.user.roles?.includes('seller')) {
    throw new Error('Invalid seller session. Please sign in again.');
  }
  clearPortalRequests('seller');
  void disablePushSession('seller');
  localStorage.setItem('sellerToken', body.token);
  localStorage.setItem('sellerUserProfile', JSON.stringify(body.user));
  bindSessionBackend('seller');
  window.dispatchEvent(new Event(SELLER_SESSION_CHANGED));
}
