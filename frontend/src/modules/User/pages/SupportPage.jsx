import React, { useEffect, useState } from 'react';
import { useUser } from '../context/UserContext';
import { useFeedback } from '../../../components/feedback/FeedbackProvider';
import { useTickets } from '../../../utils/useTickets';
import TicketDetailModal from '../../../components/support/TicketDetailModal';
import LiveChatPanel from '../../../components/support/LiveChatPanel';
import { AttachmentUploader } from '../../../components/common/AttachmentPreview';
import AccountPageHeader from '../components/AccountPageHeader';

const readChatParams = () => {
  const params = new URLSearchParams(window.location.search);
  return { chat: Boolean(params.get('chat')), order: params.get('order') || '' };
};

/**
 * /support — Help & Support as its own page (it used to be a popup inside Account).
 * /support?chat=1[&order=<id>] opens live chat, with that order preselected.
 */
const SupportPage = () => {
  const ui = useFeedback();
  const { currentUser, orders: userOrders } = useUser();
  const {
    tickets, categories, loading,
    fetchCategories, fetchMyTickets, createTicket, fetchTicketDetail, sendMessage, reopenTicket,
  } = useTickets('customer');

  const [view, setView] = useState(() => (readChatParams().chat ? 'chat' : 'tickets'));
  const [chatOrderId, setChatOrderId] = useState(() => readChatParams().order);
  // Opened again while already on this page (notification or "Chat with support about this order").
  useEffect(() => {
    const open = (e) => { setView('chat'); setChatOrderId(e.detail?.orderId || ''); };
    window.addEventListener('bulkimart:open-support-chat', open);
    return () => window.removeEventListener('bulkimart:open-support-chat', open);
  }, []);
  // Keep Tickets vs Chat in the URL, so a refresh reopens the same tab.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (view === 'chat') params.set('chat', '1'); else { params.delete('chat'); params.delete('order'); }
    const query = params.toString();
    const next = `/support${query ? `?${query}` : ''}`;
    if (window.location.pathname === '/support' && window.location.pathname + window.location.search !== next) {
      window.history.replaceState(window.history.state, '', next);
    }
  }, [view]);

  const [category, setCategory] = useState('');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [files, setFiles] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [justCreated, setJustCreated] = useState(null);
  const [openTicket, setOpenTicket] = useState(null);
  const [openMessages, setOpenMessages] = useState([]);

  useEffect(() => {
    if (!currentUser) return;
    fetchCategories();
    fetchMyTickets();
  }, [currentUser?._id]); // eslint-disable-line react-hooks/exhaustive-deps

  const chatOrders = (userOrders || []).slice(0, 30).map((o) => ({ id: o._id, label: `${o.orderNo || o._id} · ${new Date(o.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}` }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!category || !subject.trim() || !description.trim()) return;
    setSubmitting(true);
    try {
      const t = await createTicket({ category, subject, description }, files);
      setJustCreated(t);
      setCategory(''); setSubject(''); setDescription(''); setFiles([]);
    } catch (err) {
      ui.notify(err.message, { type: 'error' });
    } finally {
      setSubmitting(false);
    }
  };

  const openDetail = async (t) => {
    try {
      const body = await fetchTicketDetail(t._id);
      setOpenTicket(body.data.ticket);
      setOpenMessages(body.data.messages);
    } catch (err) {
      ui.notify(err.message, { type: 'error' });
    }
  };

  const refreshDetail = async () => {
    const body = await fetchTicketDetail(openTicket._id);
    setOpenTicket(body.data.ticket);
    setOpenMessages(body.data.messages);
    fetchMyTickets();
  };

  return (
    <div className="account-subpage">
      <AccountPageHeader title="Help & Support" />
      <div className="account-subpage-body">
        <div role="tablist" aria-label="Help and support" style={{ display: 'flex', gap: 6, background: '#eaf9fe', borderRadius: 12, padding: 4 }}>
          {[['tickets', 'Support Tickets'], ['chat', 'Chat with Support']].map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={view === id} onClick={() => setView(id)}
              style={{ flex: 1, border: 0, borderRadius: 9, padding: '10px 8px', fontWeight: 800, fontSize: 13, cursor: 'pointer', background: view === id ? '#ffffff' : 'transparent', color: view === id ? 'var(--primary-hover, #078ccb)' : '#475569', boxShadow: view === id ? '0 1px 3px rgba(0,0,0,0.08)' : 'none' }}>
              {label}
            </button>
          ))}
        </div>
        {view === 'chat' ? (
          <LiveChatPanel relatedOrders={chatOrders} initialRelatedOrderId={chatOrderId} onCreateTicket={() => setView('tickets')} />
        ) : justCreated ? (
          <div style={{ textAlign: 'center', padding: '24px 10px', color: '#0f172a', display: 'flex', flexDirection: 'column', gap: '12px', background: '#ffffff', borderRadius: '16px', border: '1px solid #e2e8f0' }}>
            <span style={{ fontSize: '48px' }}>✉️</span>
            <h4 style={{ margin: 0, fontSize: '18px', fontWeight: '800', color: '#0f172a' }}>Ticket Submitted Successfully!</h4>
            <p style={{ fontSize: '13px', color: '#64748b', lineHeight: '1.5' }}>
              Your support ticket ID is <strong>#{justCreated.ticketNumber}</strong>. Our team is reviewing the issue and will alert you shortly.
            </p>
            <button type="button" onClick={() => setJustCreated(null)} className="auth-submit-btn" style={{ marginTop: '12px' }}>
              Back to Help
            </button>
          </div>
        ) : (
          <>
            <h4 style={{ margin: 0, fontSize: '16px', color: '#0f172a', fontWeight: '800' }}>Contact Customer Support</h4>
            <p style={{ fontSize: '13px', color: '#64748b', lineHeight: '1.5', margin: 0 }}>
              Need help with an order, payment, or delivery timing? Open a support ticket and our team will get back within 24 hours.
            </p>

            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div className="auth-input-group">
                <label htmlFor="support-category" style={{ color: '#475569', fontWeight: '600' }}>Category</label>
                <select id="support-category" value={category} onChange={(e) => setCategory(e.target.value)} required
                  style={{ width: '100%', padding: '12px 14px', borderRadius: '10px', border: '1.5px solid #cbd5e1', backgroundColor: '#ffffff', color: '#0f172a', fontSize: '14px' }}>
                  <option value="">Select a category</option>
                  {categories.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>

              <div className="auth-input-group">
                <label htmlFor="support-subject" style={{ color: '#475569', fontWeight: '600' }}>Query Subject</label>
                <input id="support-subject" type="text" placeholder="e.g. Wallet balance query" value={subject} onChange={(e) => setSubject(e.target.value)} required />
              </div>

              <div className="auth-input-group">
                <label htmlFor="support-description" style={{ color: '#475569', fontWeight: '600' }}>How can we assist you?</label>
                <textarea id="support-description" placeholder="Explain your problem or questions in details..." value={description} onChange={(e) => setDescription(e.target.value)} required
                  style={{ width: '100%', height: '100px', padding: '12px 14px', borderRadius: '10px', border: '1.5px solid #cbd5e1', backgroundColor: '#ffffff', color: '#0f172a', fontSize: '14px', outline: 'none', boxSizing: 'border-box', resize: 'none' }} />
              </div>

              <div className="auth-input-group">
                <label style={{ color: '#475569', fontWeight: '600' }}>Attachments (optional, up to 5)</label>
                <AttachmentUploader
                  files={files}
                  onAddFiles={(selected) => setFiles((prev) => [...prev, ...selected].slice(0, 5))}
                  onRemoveFile={(idxToRemove) => setFiles((prev) => prev.filter((_, idx) => idx !== idxToRemove))}
                  maxFiles={5}
                />
              </div>

              <button type="submit" className="auth-submit-btn" disabled={submitting}>
                {submitting ? 'Submitting…' : 'Submit Support Ticket'}
              </button>
            </form>

            <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: 16 }}>
              <h4 style={{ margin: '0 0 12px', fontSize: '14px', color: '#0f172a', fontWeight: '800' }}>MY TICKETS</h4>
              {loading ? (
                <p style={{ fontSize: 12, color: '#64748b' }}>Loading…</p>
              ) : tickets.length === 0 ? (
                <div style={{ padding: '16px', background: '#ffffff', borderRadius: '12px', border: '1px solid #e2e8f0', textAlign: 'center' }}>
                  <p style={{ fontSize: 12, color: '#64748b', margin: 0 }}>No tickets yet</p>
                </div>
              ) : tickets.map((t) => (
                <button type="button" key={t._id} onClick={() => openDetail(t)}
                  style={{ display: 'block', width: '100%', textAlign: 'left', font: 'inherit', background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 14, marginBottom: 10, cursor: 'pointer', boxShadow: '0 2px 6px rgba(0,0,0,0.02)' }}>
                  <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 11, fontWeight: 800, color: '#64748b' }}>#{t.ticketNumber}</span>
                    <span style={{ fontSize: 11, fontWeight: 800, padding: '3px 10px', borderRadius: 20, background: 'var(--sf-highlight)', color: 'var(--sf-highlight-text)' }}>
                      {(t.status || '').replace(/_/g, ' ')}
                    </span>
                  </span>
                  <span style={{ display: 'block', fontSize: 14, fontWeight: 700, marginTop: 6, color: '#0f172a' }}>{t.subject}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {openTicket && (
        <TicketDetailModal
          ticket={openTicket}
          messages={openMessages}
          currentUserId={currentUser?._id}
          onClose={() => setOpenTicket(null)}
          onReply={async (msg) => { await sendMessage(openTicket._id, msg); await refreshDetail(); }}
          onReopen={async () => { await reopenTicket(openTicket._id); await refreshDetail(); }}
        />
      )}
    </div>
  );
};

export default SupportPage;
