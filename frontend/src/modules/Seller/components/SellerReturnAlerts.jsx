import React, { useEffect, useRef, useState } from 'react';
import { useSeller } from '../context/SellerContext';
import { socket } from '../../../utils/socket';
import { apiUrl } from '../../../utils/api';
import { boundedFetch } from '../../../utils/portalRequests';
import { onForegroundMessage } from '../../../utils/firebaseMessaging';
import ModalPortal from '../../../components/ModalPortal';
import { playNotificationDing } from '../../../utils/notificationSoundManager';
import { isSellerReturnNotification, openSellerReturn, sellerReturnIdOf } from '../utils/returnNotification';

// Durable requests are reconciled on startup, focus, reconnect and a timer.
// Transport payloads are hints; authorize each return before showing its data.
export default function SellerReturnAlerts({ subscribePush = onForegroundMessage }) {
  const { sellerProfile, setActiveTab } = useSeller();
  const [queue, setQueue] = useState([]);
  const rememberRef = useRef(() => {});
  useEffect(() => {
    setQueue([]);
    if (sellerProfile?.status !== 'approved') return;
    const token = localStorage.getItem('sellerToken');
    if (!token) return;
    const key = `bulkimart:seller-return-alerts:v1:${sellerProfile._id}`;
    let seen;
    try { seen = new Set(JSON.parse(sessionStorage.getItem(key) || '[]')); } catch { seen = new Set(); }
    let alive = true, reconciling = false, stopPush;
    const pending = new Set();
    const valid = () => alive && token === localStorage.getItem('sellerToken');
    const headers = { Authorization: `Bearer ${token}` };
    const remember = id => {
      seen.add(id);
      try { sessionStorage.setItem(key, JSON.stringify([...seen].slice(-500))); } catch { /* in-memory dedup */ }
    };
    rememberRef.current = remember;
    const receive = async hint => {
      const id = sellerReturnIdOf(hint);
      if (!valid() || !id || seen.has(id) || pending.has(id)) return;
      pending.add(id);
      try {
        const response = await boundedFetch(apiUrl(`/api/sellers/returns/${id}`), { headers });
        if (!response.ok || !valid()) return;
        const body = await response.json(), ret = body.data;
        if (!valid() || !ret) return;
        if (!['RETURN_REQUESTED', 'UNDER_REVIEW'].includes(ret.status)) {
          setQueue(previous => previous.filter(item => item._id !== id));
          return;
        }
        if (window.location.pathname === '/seller/item-returns' && new URLSearchParams(window.location.search).get('return') === id) { remember(id); return; }
        setQueue(previous => previous.some(item => item._id === id) ? previous : [...previous, { ...ret, _id: id, notificationId: hint._id }]);
      } catch { /* retry on reconciliation */ }
      finally { pending.delete(id); }
    };
    const reconcile = async () => {
      if (!valid() || reconciling) return;
      reconciling = true;
      try {
        for (const path of ['/api/notifications?event=RETURN_REQUESTED&isRead=false&limit=50', '/api/sellers/returns?status=RETURN_REQUESTED,UNDER_REVIEW&limit=100']) {
          try {
          let page = 1, pages = 1;
          do {
            const response = await boundedFetch(apiUrl(`${path}&page=${page}`), { headers });
            if (!response.ok || !valid()) break;
            const body = await response.json(); pages = body.meta?.pages || 1;
            for (const row of [...(body.data || [])].reverse()) await receive(path.startsWith('/api/notifications') ? row : { metadata: { returnId: row._id } });
            page++;
          } while (valid() && page <= pages);
          } catch { /* The returns fallback still runs if notification reads fail. */ }
        }
      } finally { reconciling = false; }
    };
    const refresh = () => { void reconcile().catch(() => {}); };
    const notification = hint => { if (isSellerReturnNotification(hint)) void receive(hint); };
    socket.on('notification_new', notification); socket.on('connect', refresh);
    window.addEventListener('focus', refresh);
    const timer = setInterval(refresh, 30000); refresh();
    subscribePush(payload => {
      const data = payload?.data;
      if (data?.audience === 'seller' && data.event === 'RETURN_REQUESTED') notification({ event: data.event, _id: data.notificationId, metadata: { returnId: data.returnId }, route: data.route });
    }).then(stop => { if (alive) stopPush = stop; else stop?.(); }).catch(() => {});
    return () => {
      alive = false; clearInterval(timer); stopPush?.();
      socket.off('notification_new', notification); socket.off('connect', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [sellerProfile?._id, sellerProfile?.status, subscribePush]);
  const active = queue[0];
  useEffect(() => { if (active) playNotificationDing(); }, [active?._id]);
  if (!active) return null;
  const dismiss = () => { rememberRef.current(active._id); setQueue(previous => previous.slice(1)); };
  const open = () => {
    openSellerReturn(setActiveTab, { metadata: { returnId: active._id } });
    if (active.notificationId) void boundedFetch(apiUrl(`/api/notifications/${active.notificationId}/read`), { method: 'PATCH', headers: { Authorization: `Bearer ${localStorage.getItem('sellerToken')}` } }).catch(() => {});
    dismiss();
  };
  return <ModalPortal className="seller-order-alert-backdrop" onClick={event => { if (event.target === event.currentTarget) dismiss(); }}
    onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); dismiss(); } }}>
    <aside className="seller-order-alert" role="dialog" aria-modal="true" aria-label="New return request" aria-live="polite">
      <button type="button" className="modal-close-btn" aria-label="Dismiss return alert" onClick={dismiss}>✕</button>
      <h3>New return request</h3><strong>{active.returnNumber}</strong>
      <p>{active.productName} × {active.quantity}</p><p>{active.reason?.replace(/_/g, ' ')}</p>
      <p>Review the request, then choose how to collect the item.</p>
      <button type="button" onClick={open}>View return</button>
      {queue.length > 1 && <small>{queue.length - 1} more return requests</small>}
    </aside>
  </ModalPortal>;
}
