/**
 * Live chat support — client state for a requester (customer, seller or
 * delivery partner). Transport-agnostic: each app passes an adapter, so this
 * file is IDENTICAL in frontend/, mobile-user/, mobile-seller/ and
 * mobile-delivery/. Keep them in sync.
 *
 * adapter = {
 *   request(method, path, body?) → Promise<envelope>  // throws Error{ message, code, status }
 *   socket                      // connected socket.io client for this session, or null
 *   isForeground() → boolean
 *   onForeground(cb) → unsubscribe
 *   appendFile?(form, field, file) → Promise  // optional: platform file handling (Expo)
 * }
 *
 * Server contract: backend/routes/supportChat.routes.js and
 * backend/socket/supportChat.socket.js. The server derives the role from the
 * session, so nothing role-related is sent from here.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const BASE = '/api/support-chat';
const OPEN = ['WAITING', 'ACTIVE'];

export const newClientMessageId = () => `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

const byTime = (a, b) => new Date(a.createdAt) - new Date(b.createdAt);

/** Merge server messages into the list: replaces optimistic copies (same clientMessageId) and drops duplicates. */
export const mergeMessages = (current, incoming) => {
  const list = [...current];
  for (const message of incoming) {
    const idx = list.findIndex((m) => m._id === message._id || (message.clientMessageId && m.clientMessageId === message.clientMessageId));
    if (idx >= 0) list[idx] = { ...list[idx], ...message, pending: false, failed: false };
    else list.push(message);
  }
  return list.sort(byTime);
};

const isRequesterSide = (message) => !['AGENT', 'SYSTEM'].includes(message.senderRole);

export function useSupportChat(adapter, { enabled = true } = {}) {
  const [availability, setAvailability] = useState(null);
  const [categories, setCategories] = useState([]);
  const [conversations, setConversations] = useState([]);
  const [active, setActive] = useState(null);
  const [messages, setMessages] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [agentTyping, setAgentTyping] = useState(false);

  const activeRef = useRef(null);
  activeRef.current = active;
  const adapterRef = useRef(adapter);
  adapterRef.current = adapter;
  const typingTimer = useRef(null);
  const myTypingTimer = useRef(null);
  const amTyping = useRef(false);

  const call = useCallback((method, path, body) => adapterRef.current.request(method, `${BASE}${path}`, body), []);

  const upsertConversation = useCallback((conversation) => {
    if (!conversation?._id) return;
    setConversations((prev) => {
      const rest = prev.filter((c) => c._id !== conversation._id);
      return [conversation, ...rest].sort((a, b) => (OPEN.includes(b.status) - OPEN.includes(a.status)) || (new Date(b.lastMessageAt) - new Date(a.lastMessageAt)));
    });
    if (activeRef.current?._id === conversation._id) setActive((prev) => ({ ...prev, ...conversation }));
  }, []);

  const refreshAvailability = useCallback(async () => {
    try { setAvailability((await call('GET', '/availability')).data); } catch { /* keep last known */ }
  }, [call]);

  const markRead = useCallback(async (conversationId) => {
    const socket = adapterRef.current.socket;
    if (socket?.connected) socket.emit('support:message:read', { conversationId });
    else await call('POST', `/conversations/${conversationId}/read`).catch(() => {});
    setConversations((prev) => prev.map((c) => (c._id === conversationId ? { ...c, unreadCount: 0 } : c)));
    setActive((prev) => (prev?._id === conversationId ? { ...prev, unreadCount: 0 } : prev));
  }, [call]);

  const loadMessages = useCallback(async (conversationId) => {
    const { data } = await call('GET', `/conversations/${conversationId}/messages?limit=30`);
    setMessages((prev) => (activeRef.current?._id === conversationId ? mergeMessages(prev, data.messages) : data.messages));
    setHasMore(data.hasMore);
  }, [call]);

  /** Load availability, topics and history; opens the current open chat if there is one. */
  const refresh = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [avail, cats, list] = await Promise.all([call('GET', '/availability'), call('GET', '/categories'), call('GET', '/conversations?limit=30')]);
      setAvailability(avail.data);
      setCategories(cats.data?.categories || []);
      setConversations(list.data || []);
      return list.data || [];
    } catch (err) {
      setError(err.message || 'Could not load live chat.');
      return [];
    } finally { setLoading(false); }
  }, [call]);

  const openConversation = useCallback(async (conversationId) => {
    setError('');
    try {
      const { data } = await call('GET', `/conversations/${conversationId}`);
      setActive(data.conversation);
      activeRef.current = data.conversation;
      if (data.availability) setAvailability(data.availability);
      setMessages([]);
      await loadMessages(conversationId);
      if (adapterRef.current.isForeground()) markRead(conversationId);
      return data.conversation;
    } catch (err) {
      setError(err.message || 'Could not open this chat.');
      return null;
    }
  }, [call, loadMessages, markRead]);

  const closeView = useCallback(() => { setActive(null); activeRef.current = null; setMessages([]); setHasMore(false); setAgentTyping(false); }, []);

  const loadOlder = useCallback(async () => {
    const conversation = activeRef.current;
    const oldest = messages.find((m) => !m.pending);
    if (!conversation || !oldest) return;
    const { data } = await call('GET', `/conversations/${conversation._id}/messages?limit=30&before=${oldest._id}`);
    setMessages((prev) => mergeMessages(prev, data.messages));
    setHasMore(data.hasMore);
  }, [call, messages]);

  const toForm = async (fields, files) => {
    const form = new FormData();
    Object.entries(fields).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') form.append(k, String(v)); });
    const append = adapterRef.current.appendFile;
    for (const f of files) {
      if (append) await append(form, 'attachments', f); else form.append('attachments', f);
    }
    return form;
  };

  /** Start a chat (or continue the open one). */
  const startChat = useCallback(async ({ supportCategory, message, relatedOrderId, files = [] }) => {
    setError('');
    const clientMessageId = newClientMessageId();
    const fields = { supportCategory, message, relatedOrderId, clientMessageId };
    const { data } = await call('POST', '/conversations', files.length ? await toForm(fields, files) : fields);
    upsertConversation(data.conversation);
    if (data.availability) setAvailability(data.availability);
    setActive(data.conversation);
    activeRef.current = data.conversation;
    await loadMessages(data.conversation._id);
    return data;
  }, [call, loadMessages, upsertConversation]);

  /** Send in the active chat, optimistically. Failed sends stay in the list with `failed: true` for retry. */
  const send = useCallback(async (text, files = [], retryOf = null) => {
    const conversation = activeRef.current;
    const body = String(text || '').trim();
    if (!conversation || (!body && !files.length)) return;
    const clientMessageId = retryOf?.clientMessageId || newClientMessageId();
    const optimistic = {
      _id: `tmp-${clientMessageId}`, clientMessageId, conversationId: conversation._id, senderRole: conversation.userRole,
      messageType: 'TEXT', messageText: body, attachments: files.map((f) => ({ fileName: f.name || f.fileName, mimeType: f.type || f.mimeType, local: true })),
      createdAt: retryOf?.createdAt || new Date().toISOString(), pending: true, failed: false, _files: files,
    };
    setMessages((prev) => mergeMessages(prev.filter((m) => m.clientMessageId !== clientMessageId), [optimistic]));
    try {
      const fields = { message: body, clientMessageId };
      const { data } = await call('POST', `/conversations/${conversation._id}/messages`, files.length ? await toForm(fields, files) : fields);
      setMessages((prev) => mergeMessages(prev, [data]));
    } catch (err) {
      setMessages((prev) => prev.map((m) => (m.clientMessageId === clientMessageId ? { ...m, pending: false, failed: true, error: err.message } : m)));
      if (err.code === 'CHAT_CLOSED') openConversation(conversation._id);
      throw err;
    }
  }, [call, openConversation]);

  const retry = useCallback((message) => send(message.messageText, message._files || [], message), [send]);

  const closeChat = useCallback(async () => {
    const conversation = activeRef.current;
    if (!conversation) return;
    const { data } = await call('POST', `/conversations/${conversation._id}/close`);
    upsertConversation(data);
    await loadMessages(conversation._id);
  }, [call, loadMessages, upsertConversation]);

  const reopenChat = useCallback(async () => {
    const conversation = activeRef.current;
    if (!conversation) return;
    const { data } = await call('POST', `/conversations/${conversation._id}/reopen`);
    upsertConversation(data);
    await loadMessages(conversation._id);
    refreshAvailability();
  }, [call, loadMessages, refreshAvailability, upsertConversation]);

  /** Call on every keystroke; sends start once and stop after 2.5 s idle. */
  const notifyTyping = useCallback(() => {
    const socket = adapterRef.current.socket;
    const conversation = activeRef.current;
    if (!socket?.connected || !conversation || !OPEN.includes(conversation.status)) return;
    if (!amTyping.current) { amTyping.current = true; socket.emit('support:typing:start', { conversationId: conversation._id }); }
    clearTimeout(myTypingTimer.current);
    myTypingTimer.current = setTimeout(() => {
      amTyping.current = false;
      socket.emit('support:typing:stop', { conversationId: conversation._id });
    }, 2500);
  }, []);

  // ---- real-time
  useEffect(() => {
    const socket = adapter?.socket;
    if (!enabled || !socket) return undefined;
    const join = () => {
      socket.emit('support:join', {});
      // Catch up on anything missed while disconnected.
      const conversation = activeRef.current;
      if (conversation) loadMessages(conversation._id).catch(() => {});
    };
    const onMessage = ({ conversationId, message, conversation }) => {
      if (conversation) upsertConversation(conversation);
      if (activeRef.current?._id !== conversationId || !message) return;
      setMessages((prev) => mergeMessages(prev, [message]));
      if (!isRequesterSide(message)) {
        if (message.senderRole === 'AGENT') setAgentTyping(false);
        socket.emit('support:message:delivered', { conversationId, messageIds: [message._id] });
        if (adapterRef.current.isForeground()) markRead(conversationId);
      }
    };
    const onUpdated = ({ conversation }) => { upsertConversation(conversation); if (activeRef.current?._id === conversation?._id) refreshAvailability(); };
    const onTyping = ({ conversationId, side, typing }) => {
      if (side !== 'AGENT' || activeRef.current?._id !== conversationId) return;
      setAgentTyping(!!typing);
      clearTimeout(typingTimer.current);
      if (typing) typingTimer.current = setTimeout(() => setAgentTyping(false), 6000);
    };
    const onRead = ({ conversationId, readAt, reader }) => {
      if (reader !== 'AGENT' || activeRef.current?._id !== conversationId) return;
      setMessages((prev) => prev.map((m) => (isRequesterSide(m) && !m.readAt && !m.pending ? { ...m, readAt, deliveredAt: m.deliveredAt || readAt } : m)));
    };
    const onDelivered = ({ conversationId, messageIds, deliveredAt }) => {
      if (activeRef.current?._id !== conversationId) return;
      setMessages((prev) => prev.map((m) => (messageIds.includes(m._id) && !m.deliveredAt ? { ...m, deliveredAt } : m)));
    };
    if (socket.connected) join();
    socket.on('connect', join);
    socket.on('support:message:new', onMessage);
    socket.on('support:conversation:updated', onUpdated);
    socket.on('support:typing', onTyping);
    socket.on('support:message:read', onRead);
    socket.on('support:message:delivered', onDelivered);
    return () => {
      socket.off('connect', join);
      socket.off('support:message:new', onMessage);
      socket.off('support:conversation:updated', onUpdated);
      socket.off('support:typing', onTyping);
      socket.off('support:message:read', onRead);
      socket.off('support:message:delivered', onDelivered);
      clearTimeout(typingTimer.current);
      clearTimeout(myTypingTimer.current);
    };
  }, [adapter?.socket, enabled, loadMessages, markRead, refreshAvailability, upsertConversation]);

  // Back in the foreground: catch up and mark read. Availability is polled (not pushed to requesters).
  useEffect(() => {
    if (!enabled) return undefined;
    const unsubscribe = adapterRef.current.onForeground?.(() => {
      const conversation = activeRef.current;
      refreshAvailability();
      if (conversation) loadMessages(conversation._id).then(() => markRead(conversation._id)).catch(() => {});
    });
    const timer = setInterval(() => { if (adapterRef.current.isForeground()) refreshAvailability(); }, 30000);
    return () => { unsubscribe?.(); clearInterval(timer); };
  }, [enabled, loadMessages, markRead, refreshAvailability]);

  const openChat = useMemo(() => conversations.find((c) => OPEN.includes(c.status)) || null, [conversations]);
  const unreadTotal = useMemo(() => conversations.reduce((sum, c) => sum + (c.unreadCount || 0), 0), [conversations]);

  return {
    availability, categories, conversations, active, messages, hasMore, loading, error, agentTyping, openChat, unreadTotal,
    refresh, refreshAvailability, openConversation, closeView, loadOlder, startChat, send, retry, closeChat, reopenChat, notifyTyping, setError,
  };
}

/** Delivery state shown under a requester's own message. */
export const deliveryState = (m) => (m.failed ? 'failed' : m.pending ? 'sending' : m.readAt ? 'read' : m.deliveredAt ? 'delivered' : 'sent');

export const STATUS_LABEL = { WAITING: 'Waiting for an agent', ACTIVE: 'Connected', RESOLVED: 'Resolved', CLOSED: 'Closed' };
