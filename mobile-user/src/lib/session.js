// Customer session storage — port of frontend/src/utils/userSession.js.
// The JWT goes to SecureStore (via `local` → SECURE_KEYS); the profile is display data only.
import { local, session } from './storage';
import { emit, EVENTS } from './events';
import { clearPortalRequests } from '../api/client';

let sessionRevision = 0;
export const captureUserSession = () => ({ token: local.getItem('userToken'), revision: sessionRevision });
export const isCurrentUserSession = snapshot => snapshot.token === local.getItem('userToken') && snapshot.revision === sessionRevision;

const cleanups = new Set();
/** Work that must run whenever the session ends (push token removal, socket disconnect). */
export const onSessionCleared = fn => { cleanups.add(fn); return () => cleanups.delete(fn); };

export function clearUserSession(notify = true) {
  for (const fn of cleanups) { try { fn(); } catch { /* cleanup is best effort */ } }
  sessionRevision++;
  clearPortalRequests();
  // Everything personal kept on the phone: the next person to sign in must not see it. 'userAvatar' is
  // the picture older app versions kept here; 'nhcone_recent_searches' is the search history.
  for (const key of ['userToken', 'userProfile', 'userLocation', 'guestLocationCoords', 'userAvatar', 'nhcone_recent_searches']) local.removeItem(key);
  for (const key of session.keys()) if (key.startsWith('bulkimart:checkout:')) session.removeItem(key);
  if (notify) emit(EVENTS.SESSION_CHANGED);
}

export function saveUserSession(body) {
  if (!body.success || typeof body.token !== 'string' || !body.token || !body.user?._id || body.sessionRole !== 'buyer') {
    throw new Error('The server returned an invalid login session. Please sign in again.');
  }
  clearUserSession(false);
  local.setItem('userToken', body.token);
  local.setItem('userProfile', JSON.stringify(body.user));
  emit(EVENTS.SESSION_CHANGED);
}
