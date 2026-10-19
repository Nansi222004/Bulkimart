import { clearPortalRequests } from './portalRequests';
import { resetCustomerSessions } from './customerSession';
import { apiUrl } from './api';
import { clearDeliveryRegistrationDrafts } from './deliveryRegistrationDraft';

export const SESSION_CHANGED = 'bulkimart:session-changed';
let sessionRevision = 0;
export const captureUserSession = () => ({ token: localStorage.getItem('userToken'), revision: sessionRevision });
export const isCurrentUserSession = snapshot => snapshot.token === localStorage.getItem('userToken') && snapshot.revision === sessionRevision;

export function clearUserSession(notify = true) {
  clearDeliveryRegistrationDrafts();
  sessionRevision++; resetCustomerSessions(); clearPortalRequests('customer'); clearPortalRequests('delivery');
  for (const key of ['userToken', 'userProfile', 'delivery_onboarded', 'deliveryDebitWallet', 'deliveryEarningsDaily', 'userLocation', 'guestLocationCoords']) localStorage.removeItem(key);
  try {
    for (const key of Object.keys(sessionStorage)) if (key.startsWith('bulkimart:checkout:')) sessionStorage.removeItem(key);
  } catch { /* Storage may be disabled; the server remains authoritative. */ }
  if (notify) window.dispatchEvent(new Event(SESSION_CHANGED));
}

export function saveUserSession(body) {
  if (!body.success || typeof body.token !== 'string' || !body.token || !body.user?._id || !['buyer', 'delivery'].includes(body.sessionRole)) {
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
  const snapshot = captureUserSession();
  const token = snapshot.token;
  const response = await fetch(apiUrl('/api/auth/customer-session'), {
    method: 'POST', headers: { Authorization: `Bearer ${token}` },
  });
  const body = await response.json();
  if (!isCurrentUserSession(snapshot)) throw new Error('Your session changed. Please sign in again.');
  if (!response.ok || body.sessionRole !== 'buyer') throw new Error(body.message || 'Customer membership could not be verified.');
  saveUserSession(body);
  window.history.pushState(null, '', '/');
}
