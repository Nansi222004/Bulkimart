// Portals have independent credentials. Never fall back to another portal.
export const SELLER_SESSION_CHANGED = 'bulkimart:seller-session-changed';
export const portalScope = () => typeof window !== 'undefined' && /^\/seller(?:\/|$)/.test(window.location?.pathname || '') ? 'seller' : 'customer';
export const portalTokenKey = (scope = portalScope()) => scope === 'seller' ? 'sellerToken' : 'userToken';
export const getPortalToken = (scope = portalScope()) => localStorage.getItem(portalTokenKey(scope));
export const pushTokenKey = (scope = portalScope()) => scope === 'seller' ? 'bulkimart_seller_fcm_token' : 'nhcone_fcm_token';

export function saveSellerSession(body) {
  if (!body.success || typeof body.token !== 'string' || !body.token || !body.user?._id || body.sessionRole !== 'seller' || !body.user.roles?.includes('seller')) {
    throw new Error('Invalid seller session. Please sign in again.');
  }
  localStorage.setItem('sellerToken', body.token);
  localStorage.setItem('sellerUserProfile', JSON.stringify(body.user));
  window.dispatchEvent(new Event(SELLER_SESSION_CHANGED));
}
