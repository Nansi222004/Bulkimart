import React, { useEffect, useRef, useState } from 'react';
import { useSeller } from '../context/SellerContext';
import { socket } from '../../../utils/socket';
import { apiUrl } from '../../../utils/api';
import { onForegroundMessage } from '../../../utils/firebaseMessaging';
import ModalPortal from '../../../components/ModalPortal';
import { sellerOrderTotal } from '../utils/sellerOrderAmounts';

export const orderReference = notification => {
  const id = notification?.metadata?.orderId || notification?.orderId;
  return /^[a-f\d]{24}$/i.test(String(id || '')) ? String(id) : null;
};

// Mounted once above every seller tab. Socket payloads are hints only: never
// render customer data until the seller-authorized detail endpoint answers.
export default function SellerOrderAlerts() {
  const { sellerProfile, fetchSellerOrder, openSellerOrder, selectedOrder, setSelectedOrder } = useSeller();
  const [queue, setQueue] = useState([]);
  const current = useRef(selectedOrder); current.current = selectedOrder;
  const active = queue[0];
  useEffect(() => {
    setQueue([]);
    if (sellerProfile?.status !== 'approved') return;
    const token = localStorage.getItem('sellerToken');
    if (!token) return;
    // Earlier builds could remember an unpaid order as already presented.
    // Those entries must not suppress its first eligible paid notification.
    const key = `bulkimart:seller-order-alerts:v2:${sellerProfile._id}`;
    let seen;
    try { seen = new Set(JSON.parse(sessionStorage.getItem(key) || '[]')); } catch { seen = new Set(); }
    const pending = new Set(), notificationIds = new Map(); let alive = true, reconciling = false;
    const validSession = () => alive && token === localStorage.getItem('sellerToken');
    const remember = id => {
      seen.add(id);
      try { sessionStorage.setItem(key, JSON.stringify([...seen].slice(-500))); } catch { /* In-memory dedup remains active. */ }
    };
    const receive = async (hint, notificationId) => {
      const id = orderReference(hint);
      if (!id || !validSession() || pending.has(id)) return;
      if (seen.has(id) && String(current.current?._id) !== id) return;
      pending.add(id);
      try {
        const result = await fetchSellerOrder(id);
        if (!validSession() || !result.ok) return;
        if (String(current.current?._id) === id) { setSelectedOrder(result.data); remember(id); return; }
        if (result.data.status !== 'placed' || (result.data.paymentMethod !== 'cod' && result.data.paymentStatus !== 'paid') || seen.has(id)) return;
        setQueue(previous => previous.some(order => order._id === id) ? previous : [...previous, { ...result.data, notificationId: notificationIds.get(id) || notificationId }]);
      } finally { pending.delete(id); }
    };
    const onNotification = notification => {
      if (notification?.event === 'ORDER_CREATED') {
        const id = orderReference(notification);
        if (id && notification._id) notificationIds.set(id, notification._id);
        setQueue(previous => previous.map(order => order._id === id ? { ...order, notificationId: notification._id } : order));
        receive(notification, notification._id);
      }
    };
    const onNewOrder = hint => receive(hint);
    const reconcile = async () => {
      if (!validSession() || reconciling) return;
      reconciling = true;
      try {
        let page = 1, pages = 1;
        do {
          const response = await fetch(apiUrl(`/api/notifications?event=ORDER_CREATED&isRead=false&limit=50&page=${page}`), { headers: { Authorization: `Bearer ${token}` } });
          if (!response.ok || !validSession()) return;
          const body = await response.json(); pages = body.meta?.pages || 1;
          for (const notification of [...(body.data || [])].reverse()) await receive(notification, notification._id);
          page++;
        } while (validSession() && page <= pages);
        // A process may stop after committing an order but before persisting
        // its best-effort notification. Reconcile actual pending orders too.
        page = 1; pages = 1;
        do {
          const response = await fetch(apiUrl(`/api/sellers/orders?status=placed&limit=100&page=${page}`), { headers: { Authorization: `Bearer ${token}` } });
          if (!response.ok || !validSession()) return;
          const body = await response.json(); pages = body.meta?.pages || 1;
          for (const order of body.data || []) await receive({ orderId: order._id });
          page++;
        } while (validSession() && page <= pages);
      } catch { /* Durable unread notifications are reconciled on the next tick. */ }
      finally { reconciling = false; }
    };
    const onPresented = event => { if (event.detail?.sellerId === String(sellerProfile._id)) remember(event.detail.orderId); };
    socket.on('new_order', onNewOrder); socket.on('notification_new', onNotification); socket.on('connect', reconcile);
    window.addEventListener('focus', reconcile); window.addEventListener('seller_order_presented', onPresented);
    const timer = setInterval(reconcile, 30000); reconcile();
    let stopPush;
    onForegroundMessage(payload => {
      if (payload.data?.audience === 'seller' && payload.data.event === 'ORDER_CREATED') onNotification({ event: 'ORDER_CREATED', orderId: payload.data.orderId, _id: payload.data.notificationId });
    }).then(stop => { if (alive) stopPush = stop; else stop?.(); }).catch(() => {});
    return () => {
      alive = false; clearInterval(timer); stopPush?.();
      socket.off('new_order', onNewOrder); socket.off('notification_new', onNotification); socket.off('connect', reconcile);
      window.removeEventListener('focus', reconcile); window.removeEventListener('seller_order_presented', onPresented);
    };
  }, [sellerProfile?._id, sellerProfile?.status, fetchSellerOrder, setSelectedOrder]);
  useEffect(() => {
    if (active) window.dispatchEvent(new CustomEvent('seller_order_presented', { detail: { sellerId: String(sellerProfile?._id), orderId: active._id } }));
  }, [active?._id, sellerProfile?._id]);
  useEffect(() => {
    if (selectedOrder?._id) setQueue(previous => previous.filter(order => order._id !== selectedOrder._id));
  }, [selectedOrder?._id]);
  if (!active) return null;
  const dismiss = () => setQueue(previous => previous.slice(1));
  return <ModalPortal className="seller-order-alert-backdrop" aria-label="New order received"
    onClick={event => { if (event.target === event.currentTarget) dismiss(); }}
    onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); dismiss(); } }}>
  <aside className="seller-order-alert" role="dialog" aria-modal="true" aria-label="New order received" aria-live="polite">
    <button type="button" className="modal-close-btn" aria-label="Dismiss new order" onClick={dismiss}>✕</button>
    <h3>New order received</h3><strong>{active.orderNo}</strong>
    <p>{active.customer?.name || 'Customer'} · {active.itemCount} items · {sellerOrderTotal(active).label}: ₹{sellerOrderTotal(active).value}</p>
    {active.sellerAmounts?.couponDiscount > 0 && <p>Coupon discount: ₹{active.sellerAmounts.couponDiscount}</p>}
    <p>{active.paymentMethod === 'cod' ? 'Cash on Delivery · Pay on delivery' : `${active.paymentMethod} · ${active.paymentStatus}`}</p>
    <button type="button" onClick={async () => { if (await openSellerOrder(active._id, active.notificationId)) dismiss(); }}>View order</button>
    {queue.length > 1 && <small>{queue.length - 1} more new orders</small>}
  </aside></ModalPortal>;
}
