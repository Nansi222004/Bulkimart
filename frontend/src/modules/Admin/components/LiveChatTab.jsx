import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { adminGet, adminPatch, adminPost, qs } from '../../../utils/adminApi';
import { socket } from '../../../utils/socket';
import { mergeMessages, newClientMessageId, deliveryState } from '../../../utils/supportChatCore';
import { useAdmin } from '../context/AdminContext';
import './LiveChatTab.css';

/**
 * Support agent dashboard for live chat (customers, sellers, delivery partners).
 * Data: /api/admin/support-chat/*  · Real time: support:* socket events (agents room).
 * Left: queue & conversations · Centre: conversation · Right: requester context.
 */
const TABS = [
  { id: 'WAITING', label: 'Waiting' },
  { id: 'mine', label: 'My chats' },
  { id: 'ACTIVE', label: 'Active' },
  { id: 'RESOLVED', label: 'Resolved' },
  { id: 'CLOSED', label: 'Closed' },
  { id: 'all', label: 'All' },
];
const ROLE_LABEL = { CUSTOMER: 'Customer', SELLER: 'Seller', DELIVERY: 'Delivery' };
const STATUS_LABEL = { WAITING: 'Waiting', ACTIVE: 'Active', RESOLVED: 'Resolved', CLOSED: 'Closed' };
const ACCEPT = 'image/jpeg,image/png,image/webp,application/pdf';

const ago = (d) => {
  const s = Math.max(0, Math.floor((Date.now() - new Date(d).getTime()) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
};
const time = (d) => new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
const pathConversationId = () => {
  const id = window.location.pathname.split('/')[3];
  return /^[a-f\d]{24}$/i.test(id || '') ? id : null;
};

function Attachments({ items }) {
  if (!items?.length) return null;
  return (
    <div className="alc-attachments">
      {items.map((a, i) => {
        const url = typeof a.url === 'string' && /^https?:\/\//.test(a.url) ? a.url : null;
        if (!url) return <span key={i} className="alc-file">{a.fileName || 'Attachment'}</span>;
        return (a.mimeType || '').startsWith('image/')
          ? <a key={i} href={url} target="_blank" rel="noopener noreferrer"><img src={url} alt={a.fileName || 'Attachment'} loading="lazy" /></a>
          : <a key={i} className="alc-file" href={url} target="_blank" rel="noopener noreferrer" download={a.fileName}>📄 {a.fileName || 'Document'}</a>;
      })}
    </div>
  );
}

export default function LiveChatTab() {
  const { triggerToast } = useAdmin();
  const toast = useCallback((m) => (triggerToast ? triggerToast(m) : window.alert(m)), [triggerToast]);
  const [tab, setTab] = useState('WAITING');
  const [role, setRole] = useState('');
  const [q, setQ] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [list, setList] = useState([]);
  const [counts, setCounts] = useState({});
  const [listLoading, setListLoading] = useState(false);
  const [selectedId, setSelectedId] = useState(pathConversationId);
  const [context, setContext] = useState(null);
  const [messages, setMessages] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [agents, setAgents] = useState([]);
  const [me, setMe] = useState('');
  const [draft, setDraft] = useState('');
  const [files, setFiles] = useState([]);
  const [typing, setTyping] = useState({});
  const [transferTo, setTransferTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [, forceTick] = useState(0);
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;
  const listRef = useRef(null);
  const fileRef = useRef(null);
  const typingTimer = useRef(null);
  const amTyping = useRef(false);

  const conversation = context?.conversation || null;
  const myAgent = agents.find((a) => String(a._id) === me);

  // -------------------------------------------------------------- data
  const loadList = useCallback(async () => {
    setListLoading(true);
    try {
      const params = { status: tab === 'mine' ? 'OPEN' : tab === 'all' ? '' : tab, mine: tab === 'mine' ? 'true' : '', role, q, from, to, unread: unreadOnly ? 'true' : '', limit: 100 };
      const { data, meta } = await adminGet(`/support-chat/conversations${qs(params)}`);
      setList(data || []);
      setCounts(meta?.counts || {});
    } catch (err) { toast(err.message); } finally { setListLoading(false); }
  }, [tab, role, q, from, to, unreadOnly, toast]);

  const loadAgents = useCallback(async () => {
    try { const { data } = await adminGet('/support-chat/agents'); setAgents(data.agents || []); setMe(String(data.me)); } catch { /* shown as unknown */ }
  }, []);

  const markRead = useCallback((id) => {
    if (socket.connected) socket.emit('support:message:read', { conversationId: id });
    else adminPost(`/support-chat/conversations/${id}/read`).catch(() => {});
    setList((prev) => prev.map((c) => (c._id === id ? { ...c, unreadCount: 0 } : c)));
  }, []);

  const openConversation = useCallback(async (id) => {
    setSelectedId(id);
    window.history.replaceState(null, '', `/admin/live-chat/${id}`);
    setMessages([]); setContext(null); setDraft(''); setFiles([]);
    try {
      const [{ data: ctx }, { data: page }] = await Promise.all([
        adminGet(`/support-chat/conversations/${id}`),
        adminGet(`/support-chat/conversations/${id}/messages?limit=40`),
      ]);
      if (selectedRef.current !== id) return;
      setContext(ctx);
      setMessages(page.messages);
      setHasMore(page.hasMore);
      if (document.visibilityState === 'visible') markRead(id);
    } catch (err) { toast(err.message); }
  }, [markRead, toast]);

  const refreshContext = useCallback(async () => {
    const id = selectedRef.current;
    if (!id) return;
    try { const { data } = await adminGet(`/support-chat/conversations/${id}`); if (selectedRef.current === id) setContext(data); } catch { /* keep */ }
  }, []);

  const loadOlder = async () => {
    const oldest = messages.find((m) => !m.pending);
    if (!oldest || !selectedId) return;
    const { data } = await adminGet(`/support-chat/conversations/${selectedId}/messages?limit=40&before=${oldest._id}`);
    setMessages((prev) => mergeMessages(prev, data.messages));
    setHasMore(data.hasMore);
  };

  useEffect(() => { const t = setTimeout(loadList, q ? 300 : 0); return () => clearTimeout(t); }, [loadList, q]);
  useEffect(() => { loadAgents(); if (selectedId) openConversation(selectedId); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  useEffect(() => { const t = setInterval(() => forceTick((n) => n + 1), 30000); return () => clearInterval(t); }, []); // waiting-time labels

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, typing[selectedId]]); // eslint-disable-line react-hooks/exhaustive-deps

  // -------------------------------------------------------------- real time
  useEffect(() => {
    const join = () => socket.emit('support:join', {}, (ack) => { if (ack && !ack.ok) toast(ack.message || 'Live chat connection refused'); });
    const upsert = (c) => {
      if (!c?._id) return;
      setList((prev) => (prev.some((x) => x._id === c._id) ? prev.map((x) => (x._id === c._id ? { ...x, ...c } : x)) : prev));
      if (selectedRef.current === c._id) setContext((prev) => (prev ? { ...prev, conversation: { ...prev.conversation, ...c } } : prev));
    };
    const onCreated = () => { loadList(); };
    const onUpdated = ({ conversation: c }) => { upsert(c); loadList(); if (selectedRef.current === c?._id) refreshContext(); };
    const onMessage = ({ conversationId, message, conversation: c }) => {
      upsert(c);
      if (selectedRef.current !== conversationId || !message) { loadList(); return; }
      setMessages((prev) => mergeMessages(prev, [message]));
      if (!['AGENT', 'SYSTEM'].includes(message.senderRole)) {
        setTyping((prev) => ({ ...prev, [conversationId]: null }));
        socket.emit('support:message:delivered', { conversationId, messageIds: [message._id] });
        if (document.visibilityState === 'visible') markRead(conversationId);
      }
    };
    const onTyping = ({ conversationId, side, typing: on, name }) => {
      setTyping((prev) => ({ ...prev, [conversationId]: on ? { side, name } : null }));
    };
    const onRead = ({ conversationId, readAt, reader }) => {
      if (reader !== 'USER' || selectedRef.current !== conversationId) return;
      setMessages((prev) => prev.map((m) => (m.senderRole === 'AGENT' && !m.readAt && !m.pending ? { ...m, readAt, deliveredAt: m.deliveredAt || readAt } : m)));
    };
    const onDelivered = ({ conversationId, messageIds, deliveredAt }) => {
      if (selectedRef.current !== conversationId) return;
      setMessages((prev) => prev.map((m) => (messageIds.includes(m._id) && !m.deliveredAt ? { ...m, deliveredAt } : m)));
    };
    const onAgents = ({ agents: next }) => setAgents(next || []);
    if (socket.connected) join();
    socket.on('connect', join);
    socket.on('support:conversation:created', onCreated);
    socket.on('support:conversation:updated', onUpdated);
    socket.on('support:message:new', onMessage);
    socket.on('support:typing', onTyping);
    socket.on('support:message:read', onRead);
    socket.on('support:message:delivered', onDelivered);
    socket.on('support:agent:status', onAgents);
    return () => {
      socket.emit('support:leave', {});
      socket.off('connect', join);
      socket.off('support:conversation:created', onCreated);
      socket.off('support:conversation:updated', onUpdated);
      socket.off('support:message:new', onMessage);
      socket.off('support:typing', onTyping);
      socket.off('support:message:read', onRead);
      socket.off('support:message:delivered', onDelivered);
      socket.off('support:agent:status', onAgents);
    };
  }, [loadList, markRead, refreshContext, toast]);

  // -------------------------------------------------------------- actions
  const act = async (path, body, okMessage) => {
    if (!selectedId) return;
    setBusy(true);
    try {
      const res = await adminPost(`/support-chat/conversations/${selectedId}/${path}`, body);
      if (okMessage) toast(res.message || okMessage);
      await Promise.all([refreshContext(), loadList()]);
      return res;
    } catch (err) { toast(err.message); return null; } finally { setBusy(false); }
  };

  const send = async (e) => {
    e?.preventDefault();
    const text = draft.trim();
    if (!selectedId || (!text && !files.length)) return;
    const clientMessageId = newClientMessageId();
    const attach = files;
    setDraft(''); setFiles([]);
    const optimistic = { _id: `tmp-${clientMessageId}`, clientMessageId, senderRole: 'AGENT', senderName: myAgent?.name || 'You', messageText: text, attachments: attach.map((f) => ({ fileName: f.name, mimeType: f.type })), createdAt: new Date().toISOString(), pending: true };
    setMessages((prev) => mergeMessages(prev, [optimistic]));
    try {
      let body = { message: text, clientMessageId };
      if (attach.length) { const form = new FormData(); form.append('message', text); form.append('clientMessageId', clientMessageId); attach.forEach((f) => form.append('attachments', f)); body = form; }
      const { data } = await adminPost(`/support-chat/conversations/${selectedId}/messages`, body);
      setMessages((prev) => mergeMessages(prev, [data]));
      if (conversation?.status === 'WAITING') refreshContext();
    } catch (err) {
      setMessages((prev) => prev.map((m) => (m.clientMessageId === clientMessageId ? { ...m, pending: false, failed: true } : m)));
      toast(err.message);
    }
  };

  const onDraft = (value) => {
    setDraft(value);
    if (!socket.connected || !selectedId) return;
    if (!amTyping.current) { amTyping.current = true; socket.emit('support:typing:start', { conversationId: selectedId }); }
    clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => { amTyping.current = false; socket.emit('support:typing:stop', { conversationId: selectedId }); }, 2500);
  };

  const pickFiles = (e) => {
    const picked = Array.from(e.target.files || []);
    e.target.value = '';
    if (picked.length > 3) return toast('Attach at most 3 files.');
    const bad = picked.find((f) => !ACCEPT.split(',').includes(f.type) || f.size > 5 * 1024 * 1024);
    if (bad) return toast(`${bad.name}: only JPEG, PNG, WEBP or PDF up to 5 MB.`);
    return setFiles(picked);
  };

  const setMyStatus = async (status) => {
    try { await adminPatch('/support-chat/agents/me', { status }); loadAgents(); } catch (err) { toast(err.message); }
  };

  const createTicket = async () => {
    const subject = window.prompt('Ticket subject (leave blank for a default):', '');
    if (subject === null) return;
    await act('ticket', { subject }, 'Ticket created');
  };

  // -------------------------------------------------------------- render helpers
  const isMine = conversation && String(conversation.assignedAdminId) === me;
  const isSuper = myAgent?.role === 'superAdmin';
  const canReply = conversation && (conversation.status === 'WAITING' || (conversation.status === 'ACTIVE' && (isMine || isSuper)));
  const otherAgents = useMemo(() => agents.filter((a) => String(a._id) !== String(conversation?.assignedAdminId || '')), [agents, conversation?.assignedAdminId]);
  const onlineCount = agents.filter((a) => a.status !== 'OFFLINE').length;
  const peerTyping = selectedId ? typing[selectedId] : null;

  return (
    <div className="alc">
      <div className="alc-topbar">
        <div>
          <h2>Live Chat Support</h2>
          <span className="alc-muted">{onlineCount} agent{onlineCount === 1 ? '' : 's'} online · {counts.WAITING || 0} waiting · {counts.ACTIVE || 0} active</span>
        </div>
        <label className="alc-mystatus">My status
          <select value={myAgent?.preference || 'AVAILABLE'} onChange={(e) => setMyStatus(e.target.value)}>
            <option value="AVAILABLE">Available</option>
            <option value="BUSY">Busy</option>
            <option value="OFFLINE">Offline</option>
          </select>
          <span className={`alc-dot alc-dot--${(myAgent?.status || 'OFFLINE').toLowerCase()}`} title={myAgent?.status || 'OFFLINE'} />
        </label>
      </div>

      <div className="alc-grid">
        {/* ---------------- left: queue */}
        <aside className="alc-left">
          <div className="alc-tabs" role="tablist">
            {TABS.map((t) => (
              <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'is-active' : ''} onClick={() => setTab(t.id)}>
                {t.label}{t.id === 'WAITING' && counts.WAITING ? <span className="alc-count">{counts.WAITING}</span> : null}
                {t.id === 'mine' && counts.unreadMine ? <span className="alc-count alc-count--accent">{counts.unreadMine}</span> : null}
              </button>
            ))}
          </div>
          <div className="alc-filters">
            <input type="search" placeholder="Search name, CHAT-number, topic…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search conversations" />
            <div className="alc-filter-row">
              <select value={role} onChange={(e) => setRole(e.target.value)} aria-label="Filter by role">
                <option value="">All roles</option><option value="CUSTOMER">Customers</option><option value="SELLER">Sellers</option><option value="DELIVERY">Delivery</option>
              </select>
              <label className="alc-check"><input type="checkbox" checked={unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked)} /> Unread</label>
            </div>
            <div className="alc-filter-row">
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From date" />
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To date" />
            </div>
          </div>
          <ul className="alc-list">
            {listLoading && !list.length ? <li className="alc-empty">Loading…</li> : null}
            {!listLoading && !list.length ? <li className="alc-empty">No conversations.</li> : null}
            {list.map((c) => (
              <li key={c._id}>
                <button type="button" className={`alc-item ${selectedId === c._id ? 'is-selected' : ''}`} onClick={() => openConversation(c._id)}>
                  <div className="alc-item-top">
                    <span className={`alc-role alc-role--${c.userRole.toLowerCase()}`}>{ROLE_LABEL[c.userRole]}</span>
                    <strong>{c.userName}</strong>
                    <span className="alc-time">{c.status === 'WAITING' ? `waiting ${ago(c.queuedAt)}` : ago(c.lastMessageAt)}</span>
                  </div>
                  <div className="alc-item-mid">
                    <span className="alc-preview">{typing[c._id]?.side === 'USER' ? 'typing…' : (c.lastMessagePreview || '—')}</span>
                    {c.unreadCount ? <span className="alc-count alc-count--accent">{c.unreadCount}</span> : null}
                  </div>
                  <div className="alc-item-bottom">
                    <span>{c.conversationNumber} · {c.supportCategory}</span>
                    <span className={`alc-status alc-status--${c.status.toLowerCase()}`}>{STATUS_LABEL[c.status]}{c.assignedAdminName && c.status === 'ACTIVE' ? ` · ${c.assignedAdminName}` : ''}</span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        {/* ---------------- centre: conversation */}
        <section className="alc-center">
          {!selectedId ? <div className="alc-placeholder">Select a conversation from the queue.</div> : !conversation ? <div className="alc-placeholder">Loading conversation…</div> : (
            <>
              <header className="alc-chat-head">
                <div className="alc-chat-title">
                  <strong>{conversation.userName}</strong>
                  <span className="alc-muted">{ROLE_LABEL[conversation.userRole]} · {conversation.conversationNumber} · {conversation.supportCategory}{conversation.relatedTicketNumber ? ` · Ticket #${conversation.relatedTicketNumber}` : ''}</span>
                </div>
                <span className={`alc-status alc-status--${conversation.status.toLowerCase()}`}>{STATUS_LABEL[conversation.status]}{conversation.assignedAdminName ? ` · ${conversation.assignedAdminName}` : ''}</span>
                <div className="alc-actions">
                  {conversation.status === 'WAITING' ? <button type="button" className="alc-btn" disabled={busy} onClick={() => act('accept', {}, 'Chat accepted')}>Accept</button> : null}
                  {['WAITING', 'ACTIVE'].includes(conversation.status) && (conversation.status === 'WAITING' || isMine || isSuper) ? (
                    <span className="alc-transfer">
                      <select value={transferTo} onChange={(e) => setTransferTo(e.target.value)} aria-label="Assign to agent">
                        <option value="">{conversation.status === 'WAITING' ? 'Assign to…' : 'Transfer to…'}</option>
                        {otherAgents.map((a) => <option key={a._id} value={a._id}>{a.name} ({a.status.toLowerCase()}, {a.activeChats} active)</option>)}
                      </select>
                      <button type="button" className="alc-btn alc-btn--ghost" disabled={!transferTo || busy} onClick={async () => { await act('assign', { adminId: transferTo }, 'Chat assigned'); setTransferTo(''); }}>Go</button>
                    </span>
                  ) : null}
                  {conversation.status === 'ACTIVE' && (isMine || isSuper) ? <button type="button" className="alc-btn alc-btn--ghost" disabled={busy} onClick={() => act('resolve', {}, 'Chat resolved')}>Resolve</button> : null}
                  {conversation.status !== 'CLOSED' ? <button type="button" className="alc-btn alc-btn--ghost" disabled={busy} onClick={() => window.confirm('Close this chat?') && act('close', {}, 'Chat closed')}>Close</button> : null}
                  {['RESOLVED', 'CLOSED'].includes(conversation.status) ? <button type="button" className="alc-btn alc-btn--ghost" disabled={busy} onClick={() => act('reopen', {}, 'Chat reopened')}>Reopen</button> : null}
                  {!conversation.relatedTicketId ? <button type="button" className="alc-btn alc-btn--ghost" disabled={busy} onClick={createTicket}>Create ticket</button> : null}
                </div>
              </header>

              <div className="alc-messages" ref={listRef} role="log" aria-live="polite">
                {hasMore ? <button type="button" className="alc-older" onClick={loadOlder}>Load earlier messages</button> : null}
                {messages.map((m) => (m.senderRole === 'SYSTEM'
                  ? <div key={m._id} className="alc-system">{m.messageText} · {time(m.createdAt)}</div>
                  : (
                    <div key={m._id} className={`alc-row ${m.senderRole === 'AGENT' ? 'alc-row--agent' : ''}`}>
                      <div className={`alc-bubble ${m.senderRole === 'AGENT' ? 'alc-bubble--agent' : ''} ${m.failed ? 'alc-bubble--failed' : ''}`}>
                        <span className="alc-sender">{m.senderName || ROLE_LABEL[m.senderRole]}</span>
                        {m.messageText ? <p>{m.messageText}</p> : null}
                        <Attachments items={m.attachments} />
                        <span className="alc-meta">{time(m.createdAt)}{m.senderRole === 'AGENT' ? ` · ${deliveryState(m)}` : ''}</span>
                      </div>
                    </div>
                  )))}
                {peerTyping ? <div className="alc-typing">{peerTyping.name || 'Someone'} is typing…</div> : null}
              </div>

              {canReply ? (
                <form className="alc-composer" onSubmit={send}>
                  <input ref={fileRef} type="file" hidden multiple accept={ACCEPT} onChange={pickFiles} />
                  <button type="button" className="alc-icon" onClick={() => fileRef.current?.click()} aria-label="Attach files">📎</button>
                  <div className="alc-input">
                    {files.length ? <div className="alc-chips">{files.map((f) => <span key={f.name}>{f.name}</span>)}<button type="button" onClick={() => setFiles([])}>Remove</button></div> : null}
                    <textarea rows={2} maxLength={2000} value={draft} placeholder={conversation.status === 'WAITING' ? 'Reply to accept this chat…' : 'Type a reply…'} aria-label="Reply"
                      onChange={(e) => onDraft(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} />
                  </div>
                  <button type="submit" className="alc-send" disabled={!draft.trim() && !files.length}>Send</button>
                </form>
              ) : (
                <div className="alc-readonly">
                  {conversation.status === 'ACTIVE' ? `Assigned to ${conversation.assignedAdminName}. Ask them to transfer it to you to reply.` : `This chat is ${conversation.status.toLowerCase()}. Reopen it to reply.`}
                </div>
              )}
            </>
          )}
        </section>

        {/* ---------------- right: context */}
        <aside className="alc-right">
          {!context ? <div className="alc-placeholder">Requester details appear here.</div> : (
            <>
              <section>
                <h4>User</h4>
                <dl>
                  <dt>Name</dt><dd>{context.user?.name || conversation.userName}</dd>
                  <dt>Role</dt><dd>{ROLE_LABEL[conversation.userRole]}</dd>
                  {context.user?.phone ? <><dt>Phone</dt><dd>{context.user.phone}</dd></> : null}
                  {context.user?.email ? <><dt>Email</dt><dd>{context.user.email}</dd></> : null}
                  {context.user?.memberSince ? <><dt>Member since</dt><dd>{new Date(context.user.memberSince).toLocaleDateString('en-IN')}</dd></> : null}
                  {context.seller ? <><dt>Store</dt><dd>{context.seller.businessName || '—'}</dd><dt>Seller status</dt><dd>{context.seller.status}</dd></> : null}
                  {context.deliveryPartner ? <><dt>Partner status</dt><dd>{context.deliveryPartner.status}</dd><dt>Vehicle</dt><dd>{context.deliveryPartner.vehicleType || '—'}</dd></> : null}
                </dl>
              </section>
              <section>
                <h4>Conversation</h4>
                <dl>
                  <dt>Topic</dt><dd>{conversation.supportCategory}</dd>
                  <dt>Started</dt><dd>{time(conversation.createdAt)}</dd>
                  {conversation.acceptedAt ? <><dt>Accepted</dt><dd>{time(conversation.acceptedAt)}</dd></> : null}
                  {conversation.resolvedAt ? <><dt>Resolved</dt><dd>{time(conversation.resolvedAt)}</dd></> : null}
                  {conversation.closedAt ? <><dt>Closed</dt><dd>{time(conversation.closedAt)} ({conversation.closedBy === 'USER' ? 'by user' : 'by agent'})</dd></> : null}
                  {conversation.reopenCount ? <><dt>Reopened</dt><dd>{conversation.reopenCount}×</dd></> : null}
                </dl>
              </section>
              {context.relatedOrder ? (
                <section>
                  <h4>Related order</h4>
                  <dl>
                    <dt>Order</dt><dd>{context.relatedOrder.orderNo}</dd>
                    <dt>Status</dt><dd>{context.relatedOrder.status}</dd>
                    {context.relatedOrder.totalAmount != null ? <><dt>Total</dt><dd>₹{context.relatedOrder.totalAmount}</dd></> : null}
                    {context.relatedOrder.paymentMethod ? <><dt>Payment</dt><dd>{context.relatedOrder.paymentMethod}</dd></> : null}
                    <dt>Placed</dt><dd>{time(context.relatedOrder.createdAt)}</dd>
                  </dl>
                </section>
              ) : null}
              <section>
                <h4>Support tickets</h4>
                {!context.tickets?.length ? <p className="alc-muted">None.</p> : (
                  <ul className="alc-mini">
                    {context.tickets.map((t) => (
                      <li key={t._id}>
                        <span>#{t.ticketNumber || '—'} · {t.subject}</span>
                        <span className="alc-mini-side">{t.status}
                          {String(conversation.relatedTicketId) === String(t._id) ? ' · linked'
                            : <button type="button" className="alc-link" disabled={busy} onClick={() => act('link-ticket', { ticketId: t._id }, 'Ticket linked')}>Link</button>}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
              <section>
                <h4>Previous chats</h4>
                {!context.previousConversations?.length ? <p className="alc-muted">None.</p> : (
                  <ul className="alc-mini">
                    {context.previousConversations.map((c) => (
                      <li key={c._id}><button type="button" className="alc-link" onClick={() => openConversation(c._id)}>{c.conversationNumber}</button><span className="alc-mini-side">{c.supportCategory} · {STATUS_LABEL[c.status]}</span></li>
                    ))}
                  </ul>
                )}
              </section>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
