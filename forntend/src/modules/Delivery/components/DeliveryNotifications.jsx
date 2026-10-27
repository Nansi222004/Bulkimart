import React, { useState, useEffect } from 'react';
import { Bell } from 'lucide-react';
import ModalPortal from '../../../components/ModalPortal';
import NotificationPopup from '../../../components/NotificationPopup';
import { useNotifications } from '../../../utils/useNotifications';
import { socket } from '../../../utils/socket';

export default function DeliveryNotifications({ onNavigate }) {
  const [open, setOpen] = useState(false);
  const { notifications, unreadCount, loading, error, actionPending, fetchNotifications, fetchUnreadCount, markRead } = useNotifications({ autoFetch: open });
  useEffect(() => {
    window.addEventListener('focus', fetchUnreadCount); socket.on('connect', fetchUnreadCount);
    return () => { window.removeEventListener('focus', fetchUnreadCount); socket.off('connect', fetchUnreadCount); };
  }, [fetchUnreadCount]);
  const visible = notifications.filter(notification => /^\/delivery(?:\/|$)/.test(notification.route || ''));
  const navigate = route => {
    if (route === '/delivery') route = '/delivery/dashboard';
    if (!/^\/delivery\/(dashboard|earnings|history|returns|profile|support|parcels)(?:[?#]|$)/.test(route || '')) return;
    setOpen(false); onNavigate(route);
  };
  return <>
    <div className="delivery-notification-toolbar"><button type="button" aria-label="Delivery notifications" aria-expanded={open} onClick={() => setOpen(true)}>
      <Bell size={18} aria-hidden="true" /> Notifications{unreadCount > 0 && <span>{unreadCount}</span>}
    </button></div>
    <NotificationPopup audience="rider" onNavigate={navigate} />
    {open && <ModalPortal className="delivery-notifications-overlay" role="dialog" aria-modal="true" aria-label="Delivery notifications">
      <section className="delivery-notifications-sheet">
        <header><h2>Notifications</h2><button type="button" aria-label="Close notifications" onClick={() => setOpen(false)}>✕</button></header>
        {loading && <p role="status">Loading notifications…</p>}
        {error && <p role="alert">{error} <button type="button" onClick={() => fetchNotifications()}>Retry</button></p>}
        {!loading && !error && visible.length === 0 && <p>No delivery notifications yet.</p>}
        {visible.map(notification => <button type="button" className="delivery-notification-item" key={notification._id} disabled={actionPending}
          onClick={async () => { if (!notification.isRead) { const result = await markRead(notification._id); if (!result?.ok) return; } navigate(notification.route); }}>
          <strong>{!notification.isRead && <span aria-label="Unread">● </span>}{notification.title}</strong>
          <span>{notification.message}</span><time>{new Date(notification.createdAt).toLocaleString('en-IN')}</time>
        </button>)}
      </section>
    </ModalPortal>}
  </>;
}
