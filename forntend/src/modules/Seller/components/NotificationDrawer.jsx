import ModalPortal from '../../../components/ModalPortal';
import React, { useState } from 'react';
import { useSeller } from '../context/SellerContext';
import { useNotifications } from '../../../utils/useNotifications';
import { isRetiredSellerNotification } from '../utils/retiredFeatures';
import { orderReference } from './SellerOrderAlerts';
import { isSellerReturnNotification, openSellerReturn } from '../utils/returnNotification';

export const NotificationDrawer = ({ isOpen, onClose }) => {
  const { triggerToast, openSellerOrder, setActiveTab } = useSeller();
  const { notifications, markRead, markAllRead, removeNotification, loading, error, actionPending, fetchNotifications } = useNotifications({ autoFetch: isOpen });
  const [lightbox, setLightbox] = useState(null);
  const [opening, setOpening] = useState(false);
  if (!isOpen) return null;
  const visible = notifications.filter(n => !['subscription', 'membership'].includes(n.type) && !isRetiredSellerNotification(n));
  const open = async notification => {
    if (opening) return;
    setOpening(true);
    try {
      onClose();
      if (isSellerReturnNotification(notification)) {
        if (!notification.isRead) await markRead(notification._id);
        openSellerReturn(setActiveTab, notification);
        return;
      }
      const id = orderReference(notification);
      if (id) await openSellerOrder(id, notification.isRead ? undefined : notification._id);
      else {
        if (!notification.isRead) await markRead(notification._id);
        const route = notification.route || '';
        const tab = route.startsWith('/seller/') ? route.split('/')[2].split('?')[0] : route === '/orders' ? 'orders' : null;
        if (['orders', 'services', 'products', 'stock', 'support', 'item-returns', 'dashboard', 'earnings', 'paymenthistory', 'moneyrequest'].includes(tab)) setActiveTab(tab);
        else if (notification.type === 'order') triggerToast('This order notification has no valid order reference. Open Orders to review.');
      }
    } finally { setOpening(false); }
  };
  return <ModalPortal className="seller-modal-overlay" style={{ zIndex: 100 }} role="dialog" aria-modal="true" aria-label="Notifications">
    <div className="seller-modal-sheet">
      <div className="modal-sheet-header"><h3>Notifications</h3><button type="button" aria-label="Close notifications" onClick={onClose}>✕</button></div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
        <button type="button" disabled={loading || actionPending || !visible.length} onClick={markAllRead}>Mark all read</button>
        <button type="button" disabled={loading || actionPending || !visible.length} onClick={() => visible.forEach(n => removeNotification(n._id))}>Clear all</button>
      </div>
      <div style={{ overflowY: 'auto' }}>
        {loading && <p role="status">Loading notifications…</p>}
        {error && <div role="alert">{error}<button type="button" onClick={() => fetchNotifications()}>Retry notifications</button></div>}
        {!loading && !error && !visible.length && <p>No notifications found</p>}
        {visible.map(n => <article key={n._id} className="seller-notification-row">
          <button type="button" className="seller-notification-open" disabled={opening} onClick={() => open(n)}>
            <strong>{!n.isRead && '● '}{n.title}</strong><span>{n.message}</span>
            <small>{new Date(n.createdAt).toLocaleDateString('en-IN')}</small>
          </button>
          {n.media?.url && <button type="button" className="seller-notification-media" onClick={() => setLightbox(n.media.url)} aria-label="Preview notification image"><img src={n.media.url} alt="" /></button>}
          <button type="button" disabled={actionPending} aria-label="Dismiss notification" onClick={event => { event.stopPropagation(); removeNotification(n._id); }}>✕</button>
        </article>)}
      </div>
    </div>
    {lightbox && <ModalPortal className="seller-modal-overlay" style={{ zIndex: 101 }}>
      <img src={lightbox} alt="Notification image" style={{ maxWidth: '90%', maxHeight: '80vh' }} />
      <button type="button" aria-label="Close image" onClick={() => setLightbox(null)}>✕</button>
    </ModalPortal>}
  </ModalPortal>;
};
export default NotificationDrawer;
