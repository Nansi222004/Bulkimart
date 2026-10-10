import React, { useState } from 'react';
import { useSeller } from '../context/SellerContext';
import { useNotifications } from '../../../utils/useNotifications';

const TYPE_ICON = { order: '📦', delivery: '⚠', subscription: '🔁', promotion: '🎉', membership: '💰', system: '✓' };

export const NotificationDrawer = ({ isOpen, onClose }) => {
  const { triggerToast } = useSeller();

  // Backed by the real GET /api/notifications API — the DB is the source of
  // truth, not local state (a page refresh must still show the same list).
  const {
    notifications: rawNotifications, unreadCount, markRead, markAllRead, removeNotification,
  } = useNotifications({ autoFetch: isOpen });

  const notifications = rawNotifications.map((n) => ({
    id: n._id, type: n.type, title: n.title, desc: n.message, unread: !n.isRead,
    // Only ever set on an Admin broadcast — absent on every event-driven
    // notification, exactly as before this field existed.
    media: n.media,
    time: new Date(n.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }),
  }));

  const handleMarkAllRead = () => {
    markAllRead();
    triggerToast('All notifications marked as read.');
  };

  const handleClearAll = () => {
    rawNotifications.forEach((n) => removeNotification(n._id));
    triggerToast('Notifications cleared.');
  };

  const handleToggleRead = (id) => {
    const n = rawNotifications.find((x) => x._id === id);
    if (n && !n.isRead) markRead(id);
  };

  const [lightbox, setLightbox] = useState(null);

  if (!isOpen) return null;

  return (
    <div className="seller-modal-overlay" style={{ zIndex: 100 }}>
      <div className="seller-modal-sheet" style={{ maxHeight: '90%', animation: 'slideUp 0.3s ease-out' }}>
        
        {/* Header */}
        <div className="modal-sheet-header">
          <h3 className="modal-sheet-title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            🔔 Notifications
            {notifications.filter(n => n.unread).length > 0 && (
              <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 10, backgroundColor: 'var(--error)', color: '#ffffff' }}>
                {notifications.filter(n => n.unread).length} New
              </span>
            )}
          </h3>
          <button className="modal-close-btn" onClick={onClose}>✕</button>
        </div>

        {/* Action Controls */}
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 16px', borderBottom: '1px solid #f1f5f9', background: '#f8fafc' }}>
          <button 
            style={{ background: 'none', border: 'none', color: 'var(--primary)', fontSize: 11, fontWeight: 800, cursor: 'pointer' }}
            onClick={handleMarkAllRead}
            disabled={notifications.length === 0}
          >
            Mark all read
          </button>
          <button 
            style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
            onClick={handleClearAll}
            disabled={notifications.length === 0}
          >
            Clear all
          </button>
        </div>

        {/* Notification List Scroll box */}
        <div style={{ overflowY: 'auto', flex: 1, padding: 12 }}>
          {notifications.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)' }}>
              <span style={{ fontSize: 24, display: 'block', marginBottom: 8 }}>📭</span>
              <p style={{ margin: 0, fontSize: 12 }}>No notifications found</p>
            </div>
          ) : (
            notifications.map(n => (
              <div
                key={n.id}
                className="review-summary-card"
                style={{
                  margin: '0 0 10px 0',
                  padding: 12,
                  backgroundColor: n.unread ? 'var(--primary-light)' : '#ffffff',
                  borderColor: n.unread ? 'var(--primary)' : 'var(--border-color)',
                  cursor: 'pointer',
                  // WhatsApp-style read/unread contrast — same info, lower visual weight once read.
                  opacity: n.unread ? 1 : 0.72,
                }}
                onClick={() => handleToggleRead(n.id)}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                    <span style={{ fontSize: 16 }}>
                      {n.type === 'broadcast' ? '📢' : n.type === 'order' ? '📦' : n.type === 'stock' ? '⚠' : n.type === 'payout' ? '💰' : '✓'}
                    </span>
                    <div>
                      <h4 style={{ margin: 0, fontSize: 12, fontWeight: n.unread ? 800 : 700, color: 'var(--text-primary)' }}>{n.title}</h4>
                      <p style={{ margin: '4px 0 0 0', fontSize: 10.5, color: 'var(--text-secondary)' }}>{n.desc}</p>
                      {/* Only ever set on an Admin broadcast — absent on every
                          event-driven notification, exactly as before this
                          field existed. */}
                      {n.media?.url && (
                        <img
                          src={n.media.url} alt=""
                          style={{ display: 'block', width: '100%', maxWidth: 200, maxHeight: 110, objectFit: 'cover', borderRadius: 8, marginTop: 8, cursor: 'zoom-in' }}
                          onClick={(e) => { e.stopPropagation(); setLightbox(n.media.url); }}
                        />
                      )}
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
                    <span style={{ fontSize: 9, color: 'var(--text-muted)', fontWeight: 700 }}>{n.time}</span>
                    {n.unread && <div style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: 'var(--error)' }} />}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

      </div>

      {lightbox && (
        <div
          onClick={() => setLightbox(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 5000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
        >
          <img src={lightbox} alt="" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '100%', maxHeight: '100%', borderRadius: 8 }} />
          <button
            type="button" onClick={() => setLightbox(null)} aria-label="Close"
            style={{ position: 'absolute', top: 18, right: 18, border: 'none', background: 'rgba(255,255,255,0.15)', color: '#fff', width: 36, height: 36, borderRadius: '50%', fontSize: 16, cursor: 'pointer' }}
          >✕</button>
        </div>
      )}
    </div>
  );
};

export default NotificationDrawer;
