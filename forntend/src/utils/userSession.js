import { clearPortalRequests } from './portalRequests';
import { resetCustomerSessions } from './customerSession';
import { apiUrl } from './api';
import { saveDeliverySession, captureDeliverySession, isCurrentDeliverySession } from './deliverySession';

export const SESSION_CHANGED = 'bulkimart:session-changed';
let sessionRevision = 0;
export const captureUserSession = () => ({ token: localStorage.getItem('userToken'), revision: sessionRevision });
export const isCurrentUserSession = snapshot => snapshot.token === localStorage.getItem('userToken') && snapshot.revision === sessionRevision;

export function clearUserSession(notify = true) {
  sessionRevision++; resetCustomerSessions(); clearPortalRequests('customer');
  for (const key of ['userToken', 'userProfile', 'userLocation', 'guestLocationCoords']) localStorage.removeItem(key);
  try {
    for (const key of Object.keys(sessionStorage)) if (key.startsWith('bulkimart:checkout:')) sessionStorage.removeItem(key);
  } catch { /* Storage may be disabled; the server remains authoritative. */ }
  if (notify) window.dispatchEvent(new Event(SESSION_CHANGED));
}

export function saveUserSession(body) {
  if (body.sessionRole === 'delivery') return saveDeliverySession(body);
  if (!body.success || typeof body.token !== 'string' || !body.token || !body.user?._id || body.sessionRole !== 'buyer') {
    throw new Error('The server returned an invalid login session. Please sign in again.');
  }
  clearUserSession(false);
  localStorage.setItem('userToken', body.token);
  localStorage.setItem('userProfile', JSON.stringify(body.user));
  window.dispatchEvent(new Event(SESSION_CHANGED));
}

export function openSessionDashboard(role) {
  if (role === 'delivery') window.history.replaceState(null, '', '/delivery/dashboard');
  else if (role !== 'buyer') throw new Error('Unsupported login role. Please sign in again.');
}
export async function enterCustomerSession() {
  // Keep the customer's existing account when opening the shop.
  if (localStorage.getItem('userToken')) { window.history.pushState(null, '', '/'); return; }
  const snapshot = captureDeliverySession();
  const token = snapshot.token;
  const response = await fetch(apiUrl('/api/auth/customer-session'), {
    method: 'POST', headers: { Authorization: `Bearer ${token}` },
  });
  const body = await response.json();
  if (!isCurrentDeliverySession(snapshot) || localStorage.getItem('userToken')) throw new Error('Your session changed. Please sign in again.');
  if (!response.ok || body.sessionRole !== 'buyer') throw new Error(body.message || 'Customer membership could not be verified.');
  saveUserSession(body);
  window.history.pushState(null, '', '/');
}
