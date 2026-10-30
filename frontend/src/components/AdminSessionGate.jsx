import React, { useEffect, useState } from 'react';
import { portalRequest, clearPortalRequests } from '../utils/portalRequests';

export default function AdminSessionGate({ token, onInvalid, children }) {
  const [state, setState] = useState({ loading: true });
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setState({ loading: true });
    portalRequest('admin', token, '/api/auth/me', { cacheMs: 60000, fresh: retry > 0 })
      .then(async response => {
        const body = await response.json();
        if (!active || token !== localStorage.getItem('adminToken')) return;
        if ([401,403].includes(response.status) || response.ok && (body.userType !== 'admin' || !body.profile?._id)) { clearPortalRequests('admin'); onInvalid(); return; }
        if (!response.ok || !body.success) throw new Error();
        setState({ token, verified: true });
      }).catch(() => { if (active) setState({ error: 'Unable to verify the admin session. Check your connection and retry.' }); });
    return () => { active = false; };
  }, [token, retry]);
  if (state.error) return <div role="alert">{state.error}<button type="button" onClick={() => setRetry(value => value + 1)}>Retry verification</button></div>;
  if (!state.verified || state.token !== token) return <p role="status">Verifying admin session…</p>;
  return children;
}
