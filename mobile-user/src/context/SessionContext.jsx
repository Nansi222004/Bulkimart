// Port of frontend/src/components/CustomerSessionGate.jsx.
// A stored token is only display data until `GET /api/auth/me` confirms it is a customer (`buyer`) session.
// While that check runs the storefront stays usable as a guest; account-only screens wait for it.
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { boundedFetch } from '../api/client';
import { local, readJSON } from '../lib/storage';
import { clearUserSession } from '../lib/session';
import { on, EVENTS } from '../lib/events';

const SessionContext = createContext({ verified: false, loading: false, profile: null, token: '', error: '' });
export const useSession = () => useContext(SessionContext);

export function SessionProvider({ children }) {
  const [state, setState] = useState(() => ({ loading: Boolean(local.getItem('userToken')), token: '', profile: null, error: '' }));
  const [retry, setRetry] = useState(0);
  const generation = useRef(0);

  const restore = useCallback(async ({ trustSaved = false } = {}) => {
    const request = ++generation.current;
    const token = local.getItem('userToken');
    if (!token) { local.removeItem('userProfile'); setState({ loading: false, token: '', profile: null, error: '' }); return; }
    // A login that just completed was already validated by the server (sessionRole buyer); show it at once and
    // re-confirm in the background like every launch does.
    const saved = readJSON(local, 'userProfile');
    if (trustSaved && saved?._id) setState({ loading: false, token, profile: saved, error: '' });
    else setState(previous => ({ ...previous, loading: true, error: '' }));
    try {
      const res = await boundedFetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } });
      const body = await res.json().catch(() => ({}));
      if (request !== generation.current || token !== local.getItem('userToken')) return;
      if ([401, 403].includes(res.status)) { clearUserSession(false); setState({ loading: false, token: '', profile: null, error: '' }); return; }
      if (!res.ok) throw new Error('Unable to verify your session. Please retry.');
      if (!body.success || body.userType !== 'user' || !['buyer', 'delivery', 'seller'].includes(body.sessionRole) || !body.profile?._id) {
        clearUserSession(false); setState({ loading: false, token: '', profile: null, error: 'This session cannot access the customer portal. Please sign in again.' }); return;
      }
      if (body.sessionRole === 'delivery') { clearUserSession(false); setState({ loading: false, token: '', profile: null, error: '' }); return; }
      if (body.sessionRole !== 'buyer') { clearUserSession(false); setState({ loading: false, token: '', profile: null, error: 'This is a seller session. Sign in to your customer account to continue.' }); return; }
      if (!body.profile.roles?.includes('buyer')) { setState({ loading: false, token: '', profile: null, error: 'A customer account is required to open this portal.' }); return; }
      local.setItem('userProfile', JSON.stringify(body.profile));
      setState({ loading: false, token, profile: body.profile, error: '' });
    } catch {
      if (request !== generation.current) return;
      // Offline or timed out: keep the token, stay a guest until Retry succeeds (web behaviour).
      setState(previous => previous.token === token && previous.profile ? previous : { loading: false, token: '', profile: null, error: 'Unable to verify your session. Please retry.' });
    }
  }, []);

  useEffect(() => { restore(); }, [restore, retry]);
  useEffect(() => on(EVENTS.SESSION_CHANGED, () => restore({ trustSaved: true })), [restore]);
  // Any 401 on a request that carried the current token ends the session once, here.
  useEffect(() => on(EVENTS.SESSION_EXPIRED, () => { if (local.getItem('userToken')) clearUserSession(); }), []);

  const verified = Boolean(!state.loading && state.token && state.token === local.getItem('userToken') && state.profile);
  const value = { ...state, verified, profile: verified ? state.profile : null, retry: () => setRetry(n => n + 1) };
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
