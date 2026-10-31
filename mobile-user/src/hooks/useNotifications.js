// Port of frontend/src/utils/useNotifications.js: the backend list is the source of truth, reconciled with the
// live `notification_new` socket event; the unread badge is kept live.
import { useCallback, useEffect, useRef, useState } from 'react';
import { boundedFetch, getToken } from '../api/client';
import { socket } from '../lib/socket';
import { on, emit, EVENTS } from '../lib/events';

const READ = 'notification_read', ALL_READ = 'notification_all_read';

export function useNotifications({ autoFetch = true } = {}) {
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [actionPending, setActionPending] = useState(false);
  const alive = useRef(true), generation = useRef(0), locks = useRef(new Set());
  useEffect(() => { alive.current = true; return () => { alive.current = false; generation.current++; }; }, []);
  const current = token => alive.current && token === getToken();

  const fetchNotifications = useCallback(async (page = 1) => {
    const token = getToken();
    if (!token) return;
    const epoch = ++generation.current;
    setLoading(true); setError('');
    try {
      const res = await boundedFetch(`/api/notifications?page=${page}&limit=30`, { headers: { Authorization: `Bearer ${token}` } });
      const body = await res.json().catch(() => ({}));
      if (!current(token) || epoch !== generation.current) return;
      if (!res.ok) throw new Error(body.message || 'Could not load notifications');
      setNotifications(body.data || []);
    } catch (err) {
      if (current(token) && epoch === generation.current) setError(err.message || 'Could not load notifications');
    } finally {
      if (current(token) && epoch === generation.current) setLoading(false);
    }
  }, []);

  const fetchUnreadCount = useCallback(async () => {
    const token = getToken();
    if (!token) { setUnreadCount(0); return; }
    try {
      const res = await boundedFetch('/api/notifications/unread-count', { headers: { Authorization: `Bearer ${token}` } });
      const body = await res.json().catch(() => ({}));
      if (current(token) && res.ok) setUnreadCount(body.data?.count || 0);
    } catch { /* badge is non-critical */ }
  }, []);

  const mutate = async (key, path, method, success) => {
    const token = getToken();
    if (!token || locks.current.has(key)) return { ok: false };
    locks.current.add(key); setActionPending(true); setError('');
    try {
      const res = await boundedFetch(path, { method, headers: { Authorization: `Bearer ${token}` } });
      const body = await res.json().catch(() => ({}));
      if (!current(token)) return { ok: false };
      if (!res.ok) throw new Error(body.message || 'Notification update failed');
      success(); return { ok: true };
    } catch (err) { if (current(token)) setError(err.message || 'Notification update failed'); return { ok: false }; }
    finally { locks.current.delete(key); if (alive.current) setActionPending(locks.current.size > 0); }
  };
  const markRead = useCallback(id => mutate(`read:${id}`, `/api/notifications/${id}/read`, 'PATCH', () => {
    setNotifications(prev => prev.map(n => (n._id === id ? { ...n, isRead: true } : n)));
    emit(READ, { id });
  }), []); // eslint-disable-line react-hooks/exhaustive-deps
  const markAllRead = useCallback(() => mutate('read-all', '/api/notifications/read-all', 'PATCH', () => {
    setNotifications(prev => prev.map(n => ({ ...n, isRead: true }))); setUnreadCount(0);
    emit(ALL_READ);
  }), []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchUnreadCount();
    const onNew = () => { fetchUnreadCount(); if (autoFetch) fetchNotifications(); };
    socket.on('notification_new', onNew);
    const stops = [
      on(EVENTS.SESSION_CHANGED, () => { generation.current++; setNotifications([]); setUnreadCount(0); setError(''); setLoading(false); fetchUnreadCount(); if (autoFetch) fetchNotifications(); }),
      on(READ, payload => { fetchUnreadCount(); if (payload?.id) setNotifications(prev => prev.map(n => (n._id === payload.id ? { ...n, isRead: true } : n))); }),
      on(ALL_READ, () => { setUnreadCount(0); setNotifications(prev => prev.map(n => ({ ...n, isRead: true }))); }),
    ];
    return () => { socket.off('notification_new', onNew); stops.forEach(stop => stop()); };
  }, [fetchUnreadCount, fetchNotifications, autoFetch]);

  useEffect(() => { if (autoFetch) { fetchNotifications(); fetchUnreadCount(); } }, [autoFetch, fetchNotifications, fetchUnreadCount]);

  return { notifications, unreadCount, loading, error, actionPending, fetchNotifications, fetchUnreadCount, markRead, markAllRead };
}
export default useNotifications;
