import ModalPortal from '../ModalPortal';
import React, { useState, useEffect, useRef } from 'react';

const STATUS_COLORS = {
  OPEN: '#3b82f6', IN_PROGRESS: '#f59e0b', WAITING_FOR_USER: '#a855f7',
  RESOLVED: '#16a34a', CLOSED: '#64748b', REOPENED: '#dc2626',
};

const fmt = (iso) => new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

/**
 * Self-contained ticket conversation view — shared by Seller and
 * Delivery Partner (all similar utilitarian in-app dashboards). Customer's
 * dark-themed ProfilePage renders its own detail view instead, since the
 * plain light styling here wouldn't fit that context; the data underneath
 * (useTickets hook, /api/tickets endpoints) is identical either way.
 */
export const TicketDetailModal = ({ ticket, messages, onClose, onReply, onReopen, currentUserId }) => {
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  if (!ticket) return null;

  const handleSend = async () => {
    if (!reply.trim()) return;
    setSending(true);
    try {
      await onReply(reply.trim());
      setReply('');
    } finally {
      setSending(false);
    }
  };

  return (
    <ModalPortal style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.65)', zIndex: 1200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px 12px', boxSizing: 'border-box' }} onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Support conversation" style={{ width: '100%', minWidth: 0, maxWidth: 480, maxHeight: '85dvh', overflowWrap: 'anywhere', background: '#fff', borderRadius: 16, display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1), 0 8px 10px -6px rgba(0,0,0,0.1)', boxSizing: 'border-box' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ padding: 16, borderBottom: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 800, color: '#64748b' }}>#{ticket.ticketNumber || ticket._id}</div>
            <div style={{ fontSize: 14, fontWeight: 800, color: '#0f172a', marginTop: 2 }}>{ticket.subject}</div>
            <div style={{ marginTop: 6, display: 'flex', gap: 6, alignItems: 'center' }}>
              <span style={{ fontSize: 10, fontWeight: 800, padding: '3px 9px', borderRadius: 20, color: '#fff', background: STATUS_COLORS[ticket.status] || '#64748b' }}>
                {(ticket.status || '').replace(/_/g, ' ')}
              </span>
              {ticket.category && <span style={{ fontSize: 10, color: '#64748b', fontWeight: 700 }}>{ticket.category}</span>}
            </div>
          </div>
          <button aria-label="Close support conversation" onClick={onClose} style={{ minWidth: 44, minHeight: 44, flexShrink: 0, border: 'none', background: 'none', fontSize: 16, cursor: 'pointer', color: '#64748b' }}>✕</button>
        </div>

        <div style={{ overflowY: 'auto', minHeight: 0, flex: 1, padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {(messages || []).map((m) => {
            const mine = String(m.senderId) === String(currentUserId) && m.senderRole !== 'admin';
            const isAdmin = m.senderRole === 'admin';
            return (
              <div key={m._id} style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '82%' }}>
                <div style={{
                  background: isAdmin ? '#eff6ff' : mine ? '#ecfdf5' : '#f8fafc',
                  border: `1px solid ${isAdmin ? '#bfdbfe' : mine ? '#a7f3d0' : '#e2e8f0'}`,
                  borderRadius: 12, padding: '8px 12px', fontSize: 12.5, color: '#1e293b', lineHeight: 1.5,
                }}>
                  <div style={{ fontSize: 10, fontWeight: 800, color: isAdmin ? '#2563eb' : '#475569', marginBottom: 3 }}>
                    {isAdmin ? `Support Team${m.senderName ? ` (${m.senderName})` : ''}` : m.senderName}
                  </div>
                  {m.message}
                  {(m.attachments || []).length > 0 && (
                    <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {m.attachments.map((a, i) => (
                        <a key={i} href={a.url} target="_blank" rel="noreferrer" style={{ fontSize: 10, color: '#2563eb', textDecoration: 'underline' }}>
                          📎 {a.fileName || 'attachment'}
                        </a>
                      ))}
                    </div>
                  )}
                </div>
                <div style={{ fontSize: 9, color: '#94a3b8', marginTop: 3, textAlign: mine ? 'right' : 'left' }}>{fmt(m.createdAt)}</div>
              </div>
            );
          })}
          <div ref={messagesEndRef} />
        </div>

        <div style={{ padding: 12, borderTop: '1px solid #f1f5f9' }}>
          {ticket.status === 'RESOLVED' ? (
            <button onClick={onReopen} style={{ width: '100%', padding: 12, borderRadius: 10, border: 'none', background: '#dc2626', color: '#fff', fontWeight: 800, fontSize: 12, cursor: 'pointer' }}>
              Reopen Ticket
            </button>
          ) : ticket.status === 'CLOSED' ? (
            <div style={{ textAlign: 'center', fontSize: 11, color: '#94a3b8', padding: 8 }}>This ticket is closed.</div>
          ) : (
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                placeholder="Type a reply…"
                style={{ flex: 1, padding: '10px 12px', borderRadius: 10, border: '1.5px solid #e2e8f0', fontSize: 12.5 }}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSend(); }}
              />
              <button onClick={handleSend} disabled={sending || !reply.trim()} style={{ padding: '10px 16px', borderRadius: 10, border: 'none', background: '#1b7a37', color: '#fff', fontWeight: 800, fontSize: 12, cursor: 'pointer', opacity: sending ? 0.6 : 1 }}>
                {sending ? '…' : 'Send'}
              </button>
            </div>
          )}
        </div>
      </div>
    </ModalPortal>
  );
};

export default TicketDetailModal;
