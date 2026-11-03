import React, { useEffect, useRef, useState } from 'react';
import useWebSupportChat from '../../utils/useWebSupportChat';
import { deliveryState, STATUS_LABEL } from '../../utils/supportChatCore';
import './LiveChatPanel.css';

/**
 * Live chat with Bulkimart Support for the customer, seller and delivery web
 * portals. Sits beside the existing ticket UI (it does not replace it).
 *
 * Props:
 *  - relatedOrders: [{ id, label }] the user may attach (optional)
 *  - initialRelatedOrderId: preselect one (e.g. opened from an order page)
 *  - onCreateTicket(): open the portal's existing ticket form
 *  - autoOpen: open the current chat straight away if there is one
 */
const ACCEPT = 'image/jpeg,image/png,image/webp,application/pdf';
const MAX_FILES = 3;
const MAX_BYTES = 5 * 1024 * 1024;

const time = (d) => new Date(d).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
const day = (d) => new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

const checkFiles = (list) => {
  const files = Array.from(list || []);
  if (files.length > MAX_FILES) return { error: `Attach at most ${MAX_FILES} files.` };
  const bad = files.find((f) => !ACCEPT.split(',').includes(f.type) || f.size > MAX_BYTES);
  if (bad) return { error: `${bad.name}: only JPEG, PNG, WEBP or PDF up to 5 MB.` };
  return { files };
};

function Ticks({ message }) {
  const state = deliveryState(message);
  const label = { sending: 'Sending', sent: 'Sent', delivered: 'Delivered', read: 'Read', failed: 'Not sent' }[state];
  const mark = { sending: '…', sent: '✓', delivered: '✓✓', read: '✓✓', failed: '!' }[state];
  return <span className={`lc-ticks lc-ticks--${state}`} title={label} aria-label={label}>{mark}</span>;
}

function Attachments({ items }) {
  if (!items?.length) return null;
  return (
    <div className="lc-attachments">
      {items.map((a, i) => {
        const url = typeof a.url === 'string' && /^https?:\/\//.test(a.url) ? a.url : null;
        const isImage = (a.mimeType || '').startsWith('image/');
        if (!url) return <span key={i} className="lc-file">{a.local ? 'Uploading ' : ''}{a.fileName || 'Attachment'}</span>;
        return isImage
          ? <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="lc-image"><img src={url} alt={a.fileName || 'Attachment'} loading="lazy" /></a>
          : <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="lc-file" download={a.fileName}>📄 {a.fileName || 'Document'}</a>;
      })}
    </div>
  );
}

function AvailabilityBadge({ availability }) {
  if (!availability) return null;
  const tone = availability.status === 'AVAILABLE' ? 'online' : availability.status === 'BUSY' ? 'busy' : 'offline';
  const text = availability.status === 'AVAILABLE' ? `${availability.availableAgents} agent${availability.availableAgents === 1 ? '' : 's'} available`
    : availability.status === 'BUSY' ? 'Agents busy' : 'Agents offline';
  return <span className={`lc-badge lc-badge--${tone}`}><span className="lc-dot" />{text}</span>;
}

export default function LiveChatPanel({ relatedOrders = [], initialRelatedOrderId = '', onCreateTicket, autoOpen = true }) {
  const chat = useWebSupportChat();
  const [topic, setTopic] = useState('');
  const [orderId, setOrderId] = useState(initialRelatedOrderId);
  const [firstMessage, setFirstMessage] = useState('');
  const [startFiles, setStartFiles] = useState([]);
  const [draft, setDraft] = useState('');
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const listRef = useRef(null);
  const fileRef = useRef(null);
  const startFileRef = useRef(null);
  const { active, messages, availability } = chat;

  useEffect(() => {
    chat.refresh().then((list) => {
      const open = list.find((c) => ['WAITING', 'ACTIVE'].includes(c.status));
      if (open && autoOpen) chat.openConversation(open._id);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { setOrderId(initialRelatedOrderId); }, [initialRelatedOrderId]);

  // Stick to the bottom when new messages arrive.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, chat.agentTyping]);

  const start = async (e) => {
    e.preventDefault();
    if (!topic || !firstMessage.trim()) { setNotice('Choose a topic and describe your issue.'); return; }
    setBusy(true); setNotice('');
    try {
      await chat.startChat({ supportCategory: topic, message: firstMessage.trim(), relatedOrderId: orderId || undefined, files: startFiles });
      setFirstMessage(''); setStartFiles([]); setTopic('');
    } catch (err) { setNotice(err.message); } finally { setBusy(false); }
  };

  const send = async (e) => {
    e?.preventDefault();
    if (!draft.trim() && !files.length) return;
    const text = draft; const attach = files;
    setDraft(''); setFiles([]); setNotice('');
    try { await chat.send(text, attach); } catch (err) { setNotice(err.message); }
  };

  const pick = (setter) => (e) => {
    const { files: picked, error } = checkFiles(e.target.files);
    e.target.value = '';
    if (error) { setNotice(error); return; }
    setter(picked);
  };

  const busyMessage = availability && availability.status !== 'AVAILABLE' ? availability.message : '';

  // ------------------------------------------------------------- chat view
  if (active) {
    const open = ['WAITING', 'ACTIVE'].includes(active.status);
    return (
      <section className="lc-panel" aria-label="Live chat with support">
        <header className="lc-head">
          <button type="button" className="lc-icon-btn" onClick={() => { chat.closeView(); chat.refresh(); }} aria-label="Back to support options">←</button>
          <div className="lc-head-main">
            <strong>{active.agentName || 'Bulkimart Support'}</strong>
            <span className="lc-sub">
              {active.status === 'ACTIVE' && active.agentName ? (active.agentOnline ? 'Online' : 'Offline') : STATUS_LABEL[active.status]}
              {' · '}{active.conversationNumber}{active.relatedTicketNumber ? ` · Ticket #${active.relatedTicketNumber}` : ''}
            </span>
          </div>
          <span className={`lc-status lc-status--${active.status.toLowerCase()}`}>{STATUS_LABEL[active.status]}</span>
          {open ? <button type="button" className="lc-link-btn" onClick={() => window.confirm('End this chat?') && chat.closeChat().catch((err) => setNotice(err.message))}>End chat</button> : null}
        </header>

        {active.status === 'WAITING' ? (
          <div className="lc-banner">
            {availability?.queuePosition ? `You are number ${availability.queuePosition} in the queue. ` : ''}
            {busyMessage || 'An agent will join shortly.'}
            {busyMessage && onCreateTicket ? <button type="button" className="lc-link-btn" onClick={onCreateTicket}>Create a support ticket</button> : null}
          </div>
        ) : null}

        <div className="lc-messages" ref={listRef} role="log" aria-live="polite">
          {chat.hasMore ? <button type="button" className="lc-older" onClick={() => chat.loadOlder()}>Load earlier messages</button> : null}
          {messages.map((m, i) => {
            const showDay = i === 0 || day(m.createdAt) !== day(messages[i - 1].createdAt);
            const mine = !['AGENT', 'SYSTEM'].includes(m.senderRole);
            return (
              <React.Fragment key={m._id}>
                {showDay ? <div className="lc-day">{day(m.createdAt)}</div> : null}
                {m.senderRole === 'SYSTEM' ? <div className="lc-system">{m.messageText}</div> : (
                  <div className={`lc-row ${mine ? 'lc-row--mine' : ''}`}>
                    <div className={`lc-bubble ${mine ? 'lc-bubble--mine' : ''} ${m.failed ? 'lc-bubble--failed' : ''}`}>
                      {!mine ? <span className="lc-sender">{m.senderName || 'Support'}</span> : null}
                      {m.messageText ? <p className="lc-text">{m.messageText}</p> : null}
                      <Attachments items={m.attachments} />
                      <span className="lc-meta">{time(m.createdAt)}{mine ? <Ticks message={m} /> : null}</span>
                      {m.failed ? <button type="button" className="lc-retry" onClick={() => chat.retry(m).catch(() => {})}>Retry</button> : null}
                    </div>
                  </div>
                )}
              </React.Fragment>
            );
          })}
          {chat.agentTyping ? <div className="lc-typing" aria-label="Agent is typing"><span /><span /><span /></div> : null}
        </div>

        {notice ? <div className="lc-notice" role="alert">{notice}</div> : null}

        {open ? (
          <form className="lc-composer" onSubmit={send}>
            <input ref={fileRef} type="file" accept={ACCEPT} multiple hidden onChange={pick(setFiles)} />
            <button type="button" className="lc-icon-btn" onClick={() => fileRef.current?.click()} aria-label="Attach files">📎</button>
            <div className="lc-input-wrap">
              {files.length ? <div className="lc-chips">{files.map((f) => <span key={f.name} className="lc-chip">{f.name}</span>)}<button type="button" className="lc-link-btn" onClick={() => setFiles([])}>Remove</button></div> : null}
              <textarea value={draft} rows={1} maxLength={2000} placeholder="Type a message…" aria-label="Message"
                onChange={(e) => { setDraft(e.target.value); chat.notifyTyping(); }}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} />
            </div>
            <button type="submit" className="lc-send" disabled={!draft.trim() && !files.length}>Send</button>
          </form>
        ) : (
          <div className="lc-ended">
            <span>This chat is {active.status.toLowerCase()}.</span>
            {active.canReopen ? <button type="button" className="lc-btn" onClick={() => chat.reopenChat().catch((err) => setNotice(err.message))}>Reopen chat</button> : null}
            <button type="button" className="lc-btn lc-btn--ghost" onClick={() => { chat.closeView(); chat.refresh(); }}>New chat</button>
          </div>
        )}
      </section>
    );
  }

  // ------------------------------------------------------------- start / history view
  const history = chat.conversations;
  return (
    <section className="lc-panel lc-panel--home" aria-label="Chat with support">
      <header className="lc-home-head">
        <div>
          <h3>Chat with Support</h3>
          <p>Talk to a Bulkimart support agent in real time.</p>
        </div>
        <AvailabilityBadge availability={availability} />
      </header>

      {chat.error ? <div className="lc-notice" role="alert">{chat.error}</div> : null}
      {busyMessage ? (
        <div className="lc-banner">
          {busyMessage}
          {onCreateTicket ? <button type="button" className="lc-link-btn" onClick={onCreateTicket}>Create a support ticket</button> : null}
        </div>
      ) : null}

      {chat.openChat ? (
        <button type="button" className="lc-resume" onClick={() => chat.openConversation(chat.openChat._id)}>
          <span><strong>Continue your chat</strong> {chat.openChat.conversationNumber} · {STATUS_LABEL[chat.openChat.status]}</span>
          {chat.openChat.unreadCount ? <span className="lc-unread">{chat.openChat.unreadCount}</span> : <span>→</span>}
        </button>
      ) : (
        <form className="lc-start" onSubmit={start}>
          <label>Topic
            <select value={topic} onChange={(e) => setTopic(e.target.value)} required>
              <option value="">Select a topic</option>
              {chat.categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          {relatedOrders.length ? (
            <label>Related order (optional)
              <select value={orderId} onChange={(e) => setOrderId(e.target.value)}>
                <option value="">None</option>
                {relatedOrders.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
              </select>
            </label>
          ) : null}
          <label>How can we help?
            <textarea value={firstMessage} onChange={(e) => setFirstMessage(e.target.value)} maxLength={2000} rows={3} placeholder="Describe your issue" required />
          </label>
          <input ref={startFileRef} type="file" accept={ACCEPT} multiple hidden onChange={pick(setStartFiles)} />
          <div className="lc-start-actions">
            <button type="button" className="lc-btn lc-btn--ghost" onClick={() => startFileRef.current?.click()}>📎 {startFiles.length ? `${startFiles.length} file(s)` : 'Attach'}</button>
            <button type="submit" className="lc-btn" disabled={busy}>{busy ? 'Starting…' : 'Start chat'}</button>
          </div>
          {notice ? <div className="lc-notice" role="alert">{notice}</div> : null}
        </form>
      )}

      <h4 className="lc-history-title">Chat history</h4>
      {chat.loading ? <p className="lc-empty">Loading…</p> : !history.length ? <p className="lc-empty">No chats yet.</p> : (
        <ul className="lc-history">
          {history.map((c) => (
            <li key={c._id}>
              <button type="button" onClick={() => chat.openConversation(c._id)}>
                <span className="lc-history-main"><strong>{c.supportCategory}</strong><span>{c.lastMessagePreview || '—'}</span></span>
                <span className="lc-history-side">
                  <span className={`lc-status lc-status--${c.status.toLowerCase()}`}>{STATUS_LABEL[c.status]}</span>
                  <span>{day(c.lastMessageAt)}</span>
                  {c.unreadCount ? <span className="lc-unread">{c.unreadCount}</span> : null}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
