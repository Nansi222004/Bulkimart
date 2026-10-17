import { boundedFetch } from './portalRequests';
import { getPortalToken, SELLER_SESSION_CHANGED } from './portalSession';
import { SESSION_CHANGED } from './userSession';
import { useState, useEffect, useCallback, useRef } from 'react';
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
  const [error,setError]=useState(''),[actionPending,setActionPending]=useState(false);
  const alive=useRef(true),generation=useRef(0),locks=useRef(new Set());
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;generation.current++;};},[]);
  const current=token=>alive.current&&token===getPortalToken();

  const authHeaders = useCallback(() => {
    const token = getPortalToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, []);

  const fetchNotifications = useCallback(async (page = 1) => {
    const token = getPortalToken();
    if (!token) return;
    const epoch=++generation.current;
    setLoading(true);setError('');
    try {
      const res = await boundedFetch(apiUrl('/api/notifications?page='+page+'&limit=30'), { headers: authHeaders() });
      const body = await res.json().catch(() => ({}));
      if(!current(token)||epoch!==generation.current)return;
      if(!res.ok)throw new Error(body.message || 'Could not load notifications');
      setNotifications(body.data || []);
    } catch (err) {
      if(current(token)&&epoch===generation.current)setError(err.message || 'Could not load notifications');
    } finally {
      if(current(token)&&epoch===generation.current)setLoading(false);
    }
  }, [authHeaders]);

  const fetchUnreadCount = useCallback(async () => {
    const token = getPortalToken();
    if (!token) return;
    try {
      const res = await boundedFetch(apiUrl('/api/notifications/unread-count'), { headers: authHeaders() });
      const body = await res.json().catch(() => ({}));
      if (current(token) && res.ok) setUnreadCount(body.data?.count || 0);
    } catch (err) {
      console.error('[NOTIFICATIONS] unread-count fetch failed:', err.message);
    }
  }, [authHeaders]);

  const mutate = async (key,path,method,success) => {
    const token=getPortalToken();if(!token||locks.current.has(key))return {ok:false};
    locks.current.add(key);setActionPending(true);setError('');
    try {
      const res=await boundedFetch(apiUrl(path),{method,headers:{Authorization:'Bearer '+token}});
      const body=await res.json().catch(()=>({}));
      if(!current(token))return {ok:false};
      if(!res.ok)throw new Error(body.message || 'Notification update failed');
      success();return {ok:true};
    }catch(err){if(current(token))setError(err.message || 'Notification update failed');return {ok:false};}
    finally{locks.current.delete(key);if(alive.current)setActionPending(locks.current.size>0);}
  };
  const markRead = useCallback(id => mutate('read:'+id,'/api/notifications/'+id+'/read','PATCH',()=>{
    setNotifications(prev=>prev.map(n=>n._id===id?{...n,isRead:true}:n));
    window.dispatchEvent(new CustomEvent('notification_read',{detail:{id}}));
  }),[authHeaders]);
  const markAllRead = useCallback(()=>mutate('read-all','/api/notifications/read-all','PATCH',()=>{
    setNotifications(prev=>prev.map(n=>({...n,isRead:true})));setUnreadCount(0);
    window.dispatchEvent(new CustomEvent('notification_all_read'));
  }),[authHeaders]);
  const removeNotification = useCallback(id=>mutate('delete:'+id,'/api/notifications/'+id,'DELETE',()=>{
    setNotifications(prev=>prev.filter(n=>n._id!==id));
    window.dispatchEvent(new CustomEvent('notifications_updated'));
  }),[authHeaders]);

  // Always keep the unread badge live, independent of whether the drawer is open.
  useEffect(() => {
    fetchUnreadCount();
    let sessionToken=getPortalToken();
    const onSession=()=>{
      if(sessionToken===getPortalToken())return;
      sessionToken=getPortalToken();generation.current++;
      setNotifications([]);setUnreadCount(0);setError('');setLoading(false);
      fetchUnreadCount();if(autoFetch)fetchNotifications();
    };

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
      for(const event of ['storage',SESSION_CHANGED,SELLER_SESSION_CHANGED])window.addEventListener(event,onSession);
      window.addEventListener('notification_read', onRead);
      window.addEventListener('notification_all_read', onAllRead);
      window.addEventListener('notifications_updated', onUpdate);
    }

    return () => {
      socket.off('notification_new', onNew);
      if (typeof window !== 'undefined') {
        for(const event of ['storage',SESSION_CHANGED,SELLER_SESSION_CHANGED])window.removeEventListener(event,onSession);
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
    notifications, unreadCount, loading, error, actionPending,
    fetchNotifications, fetchUnreadCount, markRead, markAllRead, removeNotification,
  };
};

export default useNotifications;
