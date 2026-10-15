import React, { useEffect, useState } from 'react';
import { socket } from '../utils/socket';

export default function RealtimeNotice() {
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    const offline = () => setUnavailable(true);
    const online = () => setUnavailable(false);
    socket.on('connect_error', offline); socket.on('disconnect', offline); socket.on('connect', online);
    return () => { socket.off('connect_error', offline); socket.off('disconnect', offline); socket.off('connect', online); };
  }, []);
  return unavailable ? <div role="status" style={{ padding: '10px 16px', background: '#fff7ed', color: '#7c2d12', fontSize: 14 }}>
    Live updates are unavailable. You can still place orders. Refresh your orders to check the latest status.
  </div> : null;
}
