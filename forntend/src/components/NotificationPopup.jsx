import React, { useEffect, useState, useRef, useCallback } from 'react';
import { socket } from '../utils/socket';
import { apiUrl } from '../utils/api';
import { playNotificationDing } from '../utils/notificationSoundManager';

/**
 * WhatsApp-style floating notification — a shared component for Customer
 * and Seller (SHG/Delivery have no notification center yet; see the final
 * report's "remaining limitations").
 *
 * Reuses the EXISTING pipeline end to end: the socket `notification_new`
 * event already fired by notification.service.js's notifyCore for every
 * business event and every Admin broadcast — this component adds no new
 * socket event, no new backend call beyond the pre-existing
 * `PATCH /api/notifications/:id/read`, and creates no notification record
 * of its own. FCM stays background-only (see firebase-messaging-sw.js) —
 * this file never calls onForegroundMessage, which is what keeps socket
 * (foreground) and FCM (background) from ever both firing for the same
 * message while the tab is open (Section 15's duplicate-prevention
 * requirement is satisfied by NOT wiring FCM's foreground listener at all,
 * not by de-duplicating two live sources after the fact).
 *
 * @param {(route: string) => void} onNavigate — resolves a deep-link path
 *   to whatever this app's own tab-switching mechanism needs (each app's
 *   routes are shaped differently, so this stays the caller's job).
 */

const MAX_VISIBLE = 3;
const AUTO_DISMISS_MS = 6000;

const timeLabel = (iso) => {
  const d = new Date(iso);
  return d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
};

const authHeaders = () => ({ Authorization: 'Bearer ' + localStorage.getItem('userToken') });

export const NotificationPopup = ({ onNavigate }) => {
  const [stack, setStack] = useState([]);
  const [lightbox, setLightbox] = useState(null);
  const timers = useRef({});

  const dismiss = useCallback((key) => {
    setStack((prev) => prev.filter((n) => n.key !== key));
    clearTimeout(timers.current[key]);
    delete timers.current[key];
  }, []);

  useEffect(() => {
    const onNew = (payload) => {
      const key = payload?._id || `${Date.now()}-${Math.random()}`;
      const entry = { ...payload, key, receivedAt: payload?.createdAt || new Date().toISOString() };

      setStack((prev) => {
        // A duplicate socket delivery of the SAME persisted notification
        // (a reconnect re-emitting, for instance) must not stack twice.
        if (payload?._id && prev.some((n) => n._id === payload._id)) return prev;
        return [entry, ...prev].slice(0, MAX_VISIBLE);
      });

      playNotificationDing();

      timers.current[key] = setTimeout(() => dismiss(key), AUTO_DISMISS_MS);
    };

    socket.on('notification_new', onNew);
    return () => {
      socket.off('notification_new', onNew);
      Object.values(timers.current).forEach(clearTimeout);
      timers.current = {};
    };
  }, [dismiss]);

  const openNotification = async (n) => {
    dismiss(n.key);
    if (n._id) {
      // Best-effort — the existing PATCH endpoint, never a second read-tracking path.
      fetch(apiUrl(`/api/notifications/${n._id}/read`), { method: 'PATCH', headers: authHeaders() }).catch(() => {});
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('notification_read', { detail: { id: n._id } }));
      }
    }
    if (n.route && onNavigate) onNavigate(n.route);
  };

  const openMedia = (e, n) => {
    e.stopPropagation();
    if (n.route) { openNotification(n); return; }
    setLightbox(n.media.url);
  };

  if (stack.length === 0 && !lightbox) return null;

  return (
    <>
      <div className="nh-popup-stack" aria-live="polite">
        {stack.map((n) => (
          <div key={n.key} className="nh-popup-card" onClick={() => openNotification(n)}>
            <div className="nh-popup-header">
              <span className="nh-popup-app-icon">🛍️</span>
              <span className="nh-popup-app-name">Bulkimart</span>
              <span className="nh-popup-time">{timeLabel(n.receivedAt)}</span>
              <button
                type="button" className="nh-popup-close" aria-label="Dismiss"
                onClick={(e) => { e.stopPropagation(); dismiss(n.key); }}
              >✕</button>
            </div>
            <div className="nh-popup-body">
              <div className="nh-popup-title">{n.title}</div>
              <div className="nh-popup-message">{n.message}</div>
            </div>
            {n.media?.url && (
              <img
                src={n.media.url} alt="" className="nh-popup-media"
                onClick={(e) => openMedia(e, n)}
              />
            )}
            <div className="nh-popup-footer">
              <span className="nh-popup-unread-dot" /> Unread
            </div>
          </div>
        ))}
      </div>

      {lightbox && (
        <div className="nh-lightbox-overlay" onClick={() => setLightbox(null)}>
          <img src={lightbox} alt="" className="nh-lightbox-img" onClick={(e) => e.stopPropagation()} />
          <button type="button" className="nh-lightbox-close" onClick={() => setLightbox(null)} aria-label="Close">✕</button>
        </div>
      )}

      <style>{`
        .nh-popup-stack {
          position: fixed;
          top: calc(env(safe-area-inset-top, 0px) + 12px);
          right: 16px;
          left: auto;
          width: min(360px, calc(100vw - 32px));
          display: flex;
          flex-direction: column;
          gap: 10px;
          z-index: 4000;
          pointer-events: none;
        }
        @media (max-width: 640px) {
          .nh-popup-stack { left: 16px; right: 16px; width: auto; }
        }
        .nh-popup-card {
          pointer-events: auto;
          background: #ffffff;
          border-radius: 14px;
          box-shadow: 0 10px 30px rgba(0,0,0,0.18);
          border: 1px solid #e2e8f0;
          overflow: hidden;
          cursor: pointer;
          animation: nh-popup-in 0.28s cubic-bezier(0.16, 1, 0.3, 1);
        }
        @keyframes nh-popup-in {
          from { opacity: 0; transform: translateY(-14px) scale(0.97); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        .nh-popup-header { display: flex; align-items: center; gap: 6px; padding: 8px 10px 4px; }
        .nh-popup-app-icon { font-size: 14px; }
        .nh-popup-app-name { font-size: 11px; font-weight: 800; color: #64748b; flex: 1; }
        .nh-popup-time { font-size: 10.5px; color: #94a3b8; }
        .nh-popup-close { border: none; background: none; color: #94a3b8; font-size: 12px; cursor: pointer; padding: 2px 4px; line-height: 1; }
        .nh-popup-body { padding: 2px 12px 10px; }
        .nh-popup-title { font-size: 13px; font-weight: 800; color: #0f172a; margin-bottom: 2px; }
        .nh-popup-message { font-size: 12px; color: #475569; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
        .nh-popup-media { width: 100%; max-height: 140px; object-fit: cover; display: block; cursor: zoom-in; }
        .nh-popup-footer { display: flex; align-items: center; gap: 6px; padding: 6px 12px 8px; font-size: 10.5px; color: #0ea5e9; font-weight: 800; }
        .nh-popup-unread-dot { width: 6px; height: 6px; border-radius: 50%; background: #0ea5e9; }

        .nh-lightbox-overlay {
          position: fixed; inset: 0; background: rgba(0,0,0,0.85); z-index: 5000;
          display: flex; align-items: center; justify-content: center; padding: 24px;
        }
        .nh-lightbox-img { max-width: 100%; max-height: 100%; border-radius: 8px; }
        .nh-lightbox-close { position: absolute; top: 18px; right: 18px; border: none; background: rgba(255,255,255,0.15); color: #fff; width: 36px; height: 36px; border-radius: 50%; font-size: 16px; cursor: pointer; }
      `}</style>
    </>
  );
};

export default NotificationPopup;
