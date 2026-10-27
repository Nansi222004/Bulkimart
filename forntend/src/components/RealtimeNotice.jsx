import React, { useEffect, useState } from 'react';
import { socket } from '../utils/socket';

/**
 * Shown only for a real outage. A server restart, a network switch or a phone
 * waking up drops the socket for a moment and it reconnects on its own, so the
 * notice waits out a grace period instead of flashing on every blip. Closing
 * the socket on purpose (logout, account switch) is not an outage at all.
 */
// The server's answers when the sign-in token is missing or has expired. No
// retry can fix those, so they are reported as a sign-in problem at once.
const SIGN_IN_ERRORS = ['Authentication required', 'Invalid or expired token'];

export default function RealtimeNotice({ graceMs = 8000 }) {
  const [state, setState] = useState(null); // null | 'offline' | 'signin'
  useEffect(() => {
    let timer = null;
    const offline = reason => {
      if (SIGN_IN_ERRORS.includes(reason?.message)) { clearTimeout(timer); timer = null; setState('signin'); return; }
      if (reason === 'io client disconnect' || timer || socket.connected) return;
      timer = setTimeout(() => { timer = null; if (!socket.connected) setState('offline'); }, graceMs);
    };
    const online = () => { clearTimeout(timer); timer = null; setState(null); };
    socket.on('connect_error', offline); socket.on('disconnect', offline); socket.on('connect', online);
    return () => { clearTimeout(timer); socket.off('connect_error', offline); socket.off('disconnect', offline); socket.off('connect', online); };
  }, [graceMs]);
  if (!state) return null;
  return <div role="status" style={{ padding: '10px 16px', background: '#fff7ed', color: '#7c2d12', fontSize: 14 }}>
    {state === 'signin'
      ? 'Your session has expired. Please log out and sign in again to get live order updates.'
      : 'Live updates are unavailable. You can still place orders. Refresh your orders to check the latest status.'}
  </div>;
}
