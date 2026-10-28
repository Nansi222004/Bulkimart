import { useCallback, useEffect, useRef, useState } from 'react';
import { adminGet, adminPatch } from '../../../utils/adminApi';
import { socket, connectSocket, disconnectSocket } from '../../../utils/socket';
import { useFeedback } from '../../../components/feedback/FeedbackProvider';

export default function useAdminNotifications() {
  const [adminNotifications, setNotifications] = useState([]);
  const [adminUnreadCount, setCount] = useState(0);
  const [adminNotifLoading, setLoading] = useState(false);
  const [adminNotifError, setError] = useState('');
  const alive = useRef(true), listGeneration = useRef(0), countGeneration = useRef(0);
  const feedback = useFeedback(), feedbackRef = useRef(feedback);
  feedbackRef.current = feedback;
  const token = () => localStorage.getItem('adminToken');
  const current = session => alive.current && session && session === token();
  const fetchAdminNotifications = useCallback(async ({ quiet = false } = {}) => {
    const session = token(); if (!session) return;
    const generation = ++listGeneration.current;
    if (!quiet) setLoading(true);
    try {
      const { data } = await adminGet('/notifications?limit=30');
      if (!current(session) || generation !== listGeneration.current) return;
      if (!Array.isArray(data)) throw Error('Unable to load admin notifications. Please retry.');
      setNotifications(data); setError('');
    } catch (error) {
      if (current(session) && generation === listGeneration.current) setError(error.message || 'Unable to load notifications.');
    } finally { if (current(session) && generation === listGeneration.current) setLoading(false); }
  }, []);
  const fetchAdminUnreadCount = useCallback(async () => {
    const session = token(); if (!session) return;
    const generation = ++countGeneration.current;
    try {
      const { data } = await adminGet('/notifications/unread-count');
      if (current(session) && generation === countGeneration.current && Number.isSafeInteger(data?.count) && data.count >= 0) setCount(data.count);
    } catch { /* Keep the last confirmed count; the next reconciliation retries. */ }
  }, []);
  const markAdminNotificationRead = useCallback(async id => {
    const session = token(); if (!session) return;
    await adminPatch(`/notifications/${id}/read`, {});
    if (!current(session)) return;
    setNotifications(rows => rows.map(row => row._id === id ? { ...row, isRead: true } : row));
    await fetchAdminUnreadCount();
  }, [fetchAdminUnreadCount]);

  useEffect(() => {
    alive.current = true;
    let session = token(); const seen = new Set();
    const reconcile = () => {
      if (!token()) return;
      void fetchAdminUnreadCount(); void fetchAdminNotifications({ quiet: true });
    };
    const onNew = payload => {
      if (!session || session !== token()) return;
      reconcile();
      // Existing feedback gives a visible foreground alert as well as the bell.
      if (payload?.metadata?.applicationId || /^\/admin\/services(?:[?/#]|$)/.test(payload?.route || '')) {
        const key = payload._id || `${payload.metadata?.applicationId}:${payload.title}:${payload.message}:${payload.createdAt}`;
        if (!seen.has(key)) {
          seen.add(key); if (seen.size > 200) seen.delete(seen.values().next().value);
          feedbackRef.current.notify([payload.title || 'Service request update', payload.message].filter(Boolean).join(': '), { type: 'info' });
        }
      }
    };
    const onSession = () => {
      if (session === token()) return;
      session = token(); listGeneration.current++; countGeneration.current++;
      setNotifications([]); setCount(0); setLoading(false); setError(''); seen.clear();
      if (session) { connectSocket(session, 'admin'); reconcile(); }
      else disconnectSocket();
    };
    const onVisible = () => { if (typeof document === 'undefined' || document.visibilityState !== 'hidden') reconcile(); };
    socket.on('notification_new', onNew); socket.on('connect', reconcile);
    window.addEventListener('focus', reconcile); window.addEventListener('online', reconcile);
    window.addEventListener('storage', onSession); window.addEventListener('bulkimart:admin-session-changed', onSession);
    document.addEventListener?.('visibilitychange', onVisible);
    if (session) { connectSocket(session, 'admin'); reconcile(); }
    const timer = setInterval(onVisible, 30000);
    return () => {
      alive.current = false; listGeneration.current++; countGeneration.current++;
      clearInterval(timer);
      socket.off('notification_new', onNew); socket.off('connect', reconcile);
      window.removeEventListener('focus', reconcile); window.removeEventListener('online', reconcile);
      window.removeEventListener('storage', onSession); window.removeEventListener('bulkimart:admin-session-changed', onSession);
      document.removeEventListener?.('visibilitychange', onVisible);
      disconnectSocket();
    };
  }, [fetchAdminNotifications, fetchAdminUnreadCount]);
  return { adminNotifications, adminUnreadCount, adminNotifLoading, adminNotifError, fetchAdminNotifications, fetchAdminUnreadCount, markAdminNotificationRead };
}
