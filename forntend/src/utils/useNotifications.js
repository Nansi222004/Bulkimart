import { getPortalToken } from './portalSession';
import { useState, useEffect, useCallback } from 'react';
import { apiUrl } from './api';
import { socket } from './socket';

/**
 * Shared data hook for any notification drawer (Seller's existing one,
 * Customer's new one, and any future one) — the backend DB is the source
 * of truth; this hook fetches from it and reconciles with the live
 * `notification_new` socket event, rather than treating socket state as
 * authoritative on its own (a page refresh must still show the right list).
 */
export const useNotifications = ({ autoFetch = true } = {}) => {
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);

  const authHeaders = useCallback(() => {
    const token = getPortalToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, []);

  const fetchNotifications = useCallback(async (page = 1) => {
    const token = getPortalToken();
    if (!token) return;
    setLoading(true);
    try {
      const res = await fetch(apiUrl(`/api/notifications?page=${page}&limit=30`), { headers: authHeaders() });
      const body = await res.json().catch(() => ({}));
      if (res.ok) setNotifications(body.data || []);
    } catch (err) {
      console.error('[NOTIFICATIONS] fetch failed:', err.message);
    } finally {
      setLoading(false);
    }
  }, [authHeaders]);

  const fetchUnreadCount = useCallback(async () => {
    const token = getPortalToken();
    if (!token) return;
    try {
      const res = await fetch(apiUrl('/api/notifications/unread-count'), { headers: authHeaders() });
      const body = await res.json().catch(() => ({}));
      if (res.ok) setUnreadCount(body.data?.count || 0);
    } catch (err) {
      console.error('[NOTIFICATIONS] unread-count fetch failed:', err.message);
    }
  }, [authHeaders]);

  const markRead = useCallback(async (id) => {
    try {
      const response = await fetch(apiUrl(`/api/notifications/${id}/read`), { method: 'PATCH', headers: authHeaders() });
      if (!response.ok) return;
      setNotifications((prev) => prev.map((n) => (n._id === id ? { ...n, isRead: true } : n)));
      if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('notification_read', { detail: { id } }));
    } catch (err) {
      console.error('[NOTIFICATIONS] mark-read failed:', err.message);
    }
  }, [authHeaders]);

  const markAllRead = useCallback(async () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
    setUnreadCount(0);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('notification_all_read'));
    }
    try {
      await fetch(apiUrl('/api/notifications/read-all'), { method: 'PATCH', headers: authHeaders() });
    } catch (err) {
      console.error('[NOTIFICATIONS] mark-all-read failed:', err.message);
    }
  }, [authHeaders]);

  const removeNotification = useCallback(async (id) => {
    setNotifications((prev) => prev.filter((n) => n._id !== id));
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('notifications_updated'));
    }
    try {
      await fetch(apiUrl(`/api/notifications/${id}`), { method: 'DELETE', headers: authHeaders() });
    } catch (err) {
      console.error('[NOTIFICATIONS] delete failed:', err.message);
    }
  }, [authHeaders]);

  // Always keep the unread badge live, independent of whether the drawer is open.
  useEffect(() => {
    fetchUnreadCount();

    const onNew = () => { fetchUnreadCount(); if (autoFetch) fetchNotifications(); };

    const onRead = (e) => {
      const id = e.detail?.id;
      fetchUnreadCount();
      if (id) {
        setNotifications((prev) => prev.map((n) => (n._id === id ? { ...n, isRead: true } : n)));
      }
    };

    const onAllRead = () => {
      setUnreadCount(0);
      setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
    };

    const onUpdate = () => {
      fetchUnreadCount();
    };

    socket.on('notification_new', onNew);
    if (typeof window !== 'undefined') {
      window.addEventListener('notification_read', onRead);
      window.addEventListener('notification_all_read', onAllRead);
      window.addEventListener('notifications_updated', onUpdate);
    }

    return () => {
      socket.off('notification_new', onNew);
      if (typeof window !== 'undefined') {
        window.removeEventListener('notification_read', onRead);
        window.removeEventListener('notification_all_read', onAllRead);
        window.removeEventListener('notifications_updated', onUpdate);
      }
    };
  }, [fetchUnreadCount, fetchNotifications, autoFetch]);

  useEffect(() => {
    if (autoFetch) {
      fetchNotifications();
      fetchUnreadCount();
    }
  }, [autoFetch, fetchNotifications, fetchUnreadCount]);

  return {
    notifications, unreadCount, loading,
    fetchNotifications, fetchUnreadCount, markRead, markAllRead, removeNotification,
  };
};

export default useNotifications;
