import ModalPortal from '../../../components/ModalPortal';
import React, { useState } from 'react';
import { useNotifications } from '../../../utils/useNotifications';
import { useUser } from '../context/UserContext';

const EVENT_ICON = {
  order: '📦', delivery: '🚴', promotion: '🎉', system: 'ℹ️', broadcast: '📢',
};

const timeAgo = (iso) => {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
};

/** Only known, existing routes — an unrecognised one falls back to Home rather than a dead link. */
const resolveNav = (route) => {
  if (!route) return null;
  if (route.startsWith('/orders')) return 'orders';
  return null;
};

export const NotificationDrawer = ({ isOpen, onClose }) => {
  const { setActiveNav } = useUser();
  const { notifications, loading, markRead, markAllRead } = useNotifications({ autoFetch: isOpen });
  const [lightbox, setLightbox] = useState(null);

  if (!isOpen) return null;

  const visibleNotifications = notifications.filter((item) => !['subscription', 'membership'].includes(item.type));
  const visibleUnreadCount = visibleNotifications.filter((item) => !item.isRead).length;

  const handleClick = (n) => {
    if (!n.isRead) markRead(n._id);
    if (/^\/legal-services\/requests\/[a-f\d]{24}$/i.test(n.route || '')) { window.history.pushState(null, '', n.route); onClose(); return; }
    const nav = resolveNav(n.route);
    if (nav) {
      setActiveNav(nav);
      onClose();
    }
  };

  return (
    <ModalPortal className="notif-drawer-overlay" onClick={onClose}>
      <div className="notif-drawer-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="notif-drawer-header">
          <h3 className="notif-drawer-title">
            🔔 Notifications
            {visibleUnreadCount > 0 && <span className="notif-drawer-badge">{visibleUnreadCount} New</span>}
          </h3>
          <button className="notif-drawer-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="notif-drawer-actions">
          <button onClick={markAllRead} disabled={visibleUnreadCount === 0}>Mark all read</button>
        </div>

        <div className="notif-drawer-list">
          {loading && visibleNotifications.length === 0 ? (
            <div className="notif-drawer-empty">Loading…</div>
          ) : visibleNotifications.length === 0 ? (
            <div className="notif-drawer-empty">
              <span style={{ fontSize: 24, display: 'block', marginBottom: 8 }}>📭</span>
              No notifications yet
            </div>
          ) : (
            visibleNotifications.map((n) => (
              <div
                key={n._id}
                className={`notif-drawer-item ${n.isRead ? '' : 'unread'}`}
                onClick={() => handleClick(n)}
              >
                <span className="notif-drawer-icon">{EVENT_ICON[n.type] || 'ℹ️'}</span>
                <div className="notif-drawer-body">
                  <div className="notif-drawer-item-title">{n.title}</div>
                  <div className="notif-drawer-item-msg">{n.message}</div>
                  {/* `n.media` is only ever set on an Admin broadcast — every
                      event-driven notification has no such field, so this
                      block simply never renders for them, exactly as before
                      this feature existed. Click opens a lightweight
                      preview, never navigates on its own — the row's own
                      click (deep-link) still fires first via stopPropagation
                      only inside the image itself. */}
                  {n.media?.url && (
                    <img
                      src={n.media.url} alt="" className="notif-drawer-media-thumb"
                      onClick={(e) => { e.stopPropagation(); setLightbox(n.media.url); }}
                    />
                  )}
                  <div className="notif-drawer-item-time">{timeAgo(n.createdAt)}</div>
                </div>
                {!n.isRead && <span className="notif-drawer-dot" />}
              </div>
            ))
          )}
        </div>
      </div>

      {lightbox && (
        <ModalPortal className="notif-lightbox-overlay" onClick={() => setLightbox(null)}>
          <img src={lightbox} alt="" onClick={(e) => e.stopPropagation()} />
          <button type="button" onClick={() => setLightbox(null)} aria-label="Close">✕</button>
        </ModalPortal>
      )}
    </ModalPortal>
  );
};

export default NotificationDrawer;
