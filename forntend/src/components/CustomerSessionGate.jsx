import { saveDeliverySession } from '../utils/deliverySession';
import React, { useEffect, useState } from 'react';
import { clearUserSession, SESSION_CHANGED } from '../utils/userSession';
import { acquireCustomerSession, CustomerSessionContext, isPublicCustomerPath } from '../utils/customerSession';

// A cached profile is display data, never proof of an authenticated role.
export default function CustomerSessionGate({ children }) {
  const [session, setSession] = useState(() => ({ loading: Boolean(localStorage.getItem('userToken')) }));
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let generation = 0, active;
    const restore = async () => {
      const request = ++generation;
      active?.release(); active = null;
      const token = localStorage.getItem('userToken');
      if (!token) { localStorage.removeItem('userProfile'); setSession({ token: '', loading: false }); return; }
      setSession({ loading: true });
      try {
        active = acquireCustomerSession(token);
        const { res, body } = await active.promise;
        if (request !== generation || token !== localStorage.getItem('userToken')) return;
        if ([401, 403].includes(res.status)) { clearUserSession(false); setSession({ token: '', loading: false }); return; }
        if (!res.ok) throw new Error('Unable to verify your session. Please retry.');
        if (!body.success || body.userType !== 'user' || !['buyer', 'delivery', 'seller'].includes(body.sessionRole) || !body.profile?._id) {
          clearUserSession(false); setSession({ error: 'This session cannot access the customer portal. Please sign in again.' }); return;
        }
        localStorage.setItem('userProfile', JSON.stringify(body.profile));
        if (body.sessionRole === 'delivery') {
          // Migrate old shared credentials only after server verification.
          if (!localStorage.getItem('deliveryToken')) saveDeliverySession({ success: true, token, user: body.profile, sessionRole: 'delivery' });
          clearUserSession(false);
          setSession({ token: '', loading: false }); return;
        }
        if (body.sessionRole !== 'buyer') {
          clearUserSession(false);
          setSession({ error: 'This is a seller session. Sign in to your customer account to continue.' }); return;
        }
        if (!body.profile.roles?.includes('buyer')) { setSession({ error: 'A customer account is required to open this portal.' }); return; }
        setSession({ token, profile: body.profile, loading: false });
      } catch (error) {
        if (request === generation && error.name !== 'AbortError') setSession({ error: 'Unable to verify your session. Please retry.' });
      }
    };
    const storage = event => { if (!event.key || event.key === 'userToken') restore(); };
    restore();
    window.addEventListener(SESSION_CHANGED, restore);
    window.addEventListener('storage', storage);
    return () => { generation++; active?.release(); window.removeEventListener(SESSION_CHANGED, restore); window.removeEventListener('storage', storage); };
  }, [retry]);
  const publicPage = isPublicCustomerPath(window.location.pathname);
  const error = session.error && <div role="alert">{session.error} <button onClick={() => setRetry(value => value + 1)}>Retry</button></div>;
  if (!publicPage && session.error) return error;
  if (!publicPage && session.loading) return <div role="status">Verifying your session…</div>;
  const verified = Boolean(!session.loading && !session.error && session.token && session.token === localStorage.getItem('userToken'));
  return <CustomerSessionContext.Provider value={{ verified, profile: verified ? session.profile : null }}>
    {error}
    <React.Fragment key={verified ? session.token : 'guest'}>{children}</React.Fragment>
  </CustomerSessionContext.Provider>;
}
