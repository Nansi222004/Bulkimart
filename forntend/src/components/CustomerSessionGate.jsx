import React, { useEffect, useState } from 'react';
import { apiUrl } from '../utils/api';
import { clearUserSession, SESSION_CHANGED } from '../utils/userSession';

// A cached profile is display data, never proof of an authenticated role.
export default function CustomerSessionGate({ children }) {
  const [session, setSession] = useState({ loading: true });
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let generation = 0, controller;
    const restore = async () => {
      const request = ++generation;
      controller?.abort(); controller = new AbortController();
      const token = localStorage.getItem('userToken');
      if (!token) { localStorage.removeItem('userProfile'); setSession({ token: '', loading: false }); return; }
      setSession({ loading: true });
      try {
        const res = await fetch(apiUrl('/api/auth/me'), { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal });
        const body = await res.json().catch(() => ({}));
        if (request !== generation || token !== localStorage.getItem('userToken')) return;
        if ([401, 403].includes(res.status)) { clearUserSession(false); setSession({ token: '', loading: false }); return; }
        if (!res.ok) throw new Error('Unable to verify your session. Please retry.');
        if (!body.success || body.userType !== 'user' || !['buyer', 'delivery', 'seller'].includes(body.sessionRole) || !body.profile?._id) {
          clearUserSession(false); setSession({ error: 'This session cannot access the customer portal. Please sign in again.' }); return;
        }
        localStorage.setItem('userProfile', JSON.stringify(body.profile));
        if (body.sessionRole === 'delivery') {
          window.history.replaceState(null, '', '/delivery/dashboard');
          setSession({ loading: true }); return;
        }
        if (!body.profile.roles?.includes('buyer')) { setSession({ error: 'A customer account is required to open this portal.' }); return; }
        setSession({ token, loading: false });
      } catch (error) {
        if (request === generation && error.name !== 'AbortError') setSession({ error: 'Unable to verify your session. Please retry.' });
      }
    };
    const storage = event => { if (!event.key || event.key === 'userToken') restore(); };
    restore();
    window.addEventListener(SESSION_CHANGED, restore);
    window.addEventListener('storage', storage);
    return () => { generation++; controller?.abort(); window.removeEventListener(SESSION_CHANGED, restore); window.removeEventListener('storage', storage); };
  }, [retry]);
  if (session.error) return <div role="alert">{session.error} <button onClick={() => setRetry(value => value + 1)}>Retry</button></div>;
  if (session.loading) return <div role="status">Verifying your session…</div>;
  return <React.Fragment key={session.token || 'guest'}>{children}</React.Fragment>;
}
