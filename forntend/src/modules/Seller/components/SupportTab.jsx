import React, { useEffect, useState, useRef } from 'react';
import { useSeller } from '../context/SellerContext';
import { useTickets } from '../../../utils/useTickets';
import TicketDetailModal from '../../../components/support/TicketDetailModal';
import { AttachmentPreview, AttachmentUploader } from '../../../components/common/AttachmentPreview';

const faqs = [
  { q: 'How to add products?', a: 'Go to the Products tab, tap "Add Product", fill in name, price, stock, and tap Save.' },
  { q: 'How to track orders?', a: 'Go to the Track Order tab to see all active shipments with live timeline.' },
  { q: 'How to request payout?', a: 'Go to Money Request tab, enter amount, choose bank, and submit payout request.' },
  { q: 'How to manage returns?', a: 'Go to Return Requests tab to review and approve or reject customer return claims.' },
  { q: 'Payment not received?', a: 'Check Payment History tab. If marked Pending for over 5 days, create a Support Ticket.' },
  { q: 'How to update store?', a: 'Go to Profile tab and tap "Edit" to update store details, address, and bank info.' },
];

export const SupportTab = () => {
  const { triggerToast, userProfile } = useSeller();
  const { tickets, categories, loading, fetchCategories, fetchMyTickets, createTicket, fetchTicketDetail, sendMessage, reopenTicket } = useTickets('seller');

  const [category, setCategory] = useState('');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [files, setFiles] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [expandedFaq, setExpandedFaq] = useState(null);

  const [openTicket, setOpenTicket] = useState(null);
  const [openMessages, setOpenMessages] = useState([]);

  const formRef = useRef(null);
  const subjectInputRef = useRef(null);

  useEffect(() => { fetchCategories(); fetchMyTickets(); }, [fetchCategories, fetchMyTickets]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!category || !subject.trim() || !description.trim()) {
      triggerToast('Please fill category, subject and description');
      return;
    }
    setSubmitting(true);
    try {
      const t = await createTicket({ category, subject, description }, files);
      triggerToast(`Ticket ${t.ticketNumber} created`);
      setCategory(''); setSubject(''); setDescription(''); setFiles([]);
    } catch (err) {
      triggerToast(err.message);
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
      triggerToast(err.message);
    }
  };

  const refreshDetail = async () => {
    const body = await fetchTicketDetail(openTicket._id);
    setOpenTicket(body.data.ticket);
    setOpenMessages(body.data.messages);
    fetchMyTickets();
  };

  const handleChatClick = () => {
    formRef.current?.scrollIntoView({ behavior: 'smooth' });
    subjectInputRef.current?.focus();
    triggerToast('Support ticket form ready. Fill details to reach support team.');
  };

  const handleCallClick = () => {
    triggerToast('Dialing Bulkimart Helpline: 1800-111-2233');
    window.location.href = 'tel:18001112233';
  };

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, padding: '12px 16px 0' }}>
        {[
          { icon: '💬', label: 'Chat with Team', action: handleChatClick },
          { icon: '📞', label: 'Call Support', action: handleCallClick },
        ].map(opt => (
          <button key={opt.label} onClick={opt.action} style={{ padding: '14px 10px', backgroundColor: '#fff', borderRadius: 14, border: '1.5px solid #e2e8f0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <span style={{ fontSize: 22 }}>{opt.icon}</span>
            <span style={{ fontSize: 10, fontWeight: 800, color: 'var(--text-primary)' }}>{opt.label}</span>
          </button>
        ))}
      </div>

      <div style={{ padding: '16px 16px 0' }}>
        <h4 style={{ margin: '0 0 10px', fontSize: 12, fontWeight: 800 }}>HELP TOPICS</h4>
        {faqs.map((faq, idx) => {
          const isOpen = expandedFaq === idx;
          return (
            <div
              key={faq.q}
              className="faq-row"
              style={{ flexDirection: 'column', alignItems: 'stretch', gap: isOpen ? 8 : 0, transition: 'all 0.2s ease' }}
              onClick={() => setExpandedFaq(isOpen ? null : idx)}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="faq-question">{faq.q}</span>
                <span className="faq-chevron" style={{ transform: isOpen ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s ease', fontWeight: 800 }}>›</span>
              </div>
              {isOpen && (
                <div style={{ fontSize: 11.5, color: '#475569', backgroundColor: '#f8fafc', padding: '8px 10px', borderRadius: 6, borderLeft: '3px solid #3b82f6', lineHeight: 1.5, marginTop: 4 }}>
                  {faq.a}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div ref={formRef} style={{ padding: '16px' }}>
        <h4 style={{ margin: '0 0 12px', fontSize: 12, fontWeight: 800 }}>CREATE SUPPORT TICKET</h4>
        <form onSubmit={handleSubmit}>
          <div className="onboarding-form-group">
            <label className="onboarding-label">Category</label>
            <select className="onboarding-input" value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">Select a category</option>
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="onboarding-form-group">
            <label className="onboarding-label">Subject</label>
            <input ref={subjectInputRef} type="text" className="onboarding-input" placeholder="What is your issue about?" value={subject} onChange={(e) => setSubject(e.target.value)} />
          </div>
          <div className="onboarding-form-group">
            <label className="onboarding-label">Describe Problem</label>
            <textarea className="onboarding-textarea" placeholder="Provide as much detail as possible..." value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="onboarding-form-group">
            <label className="onboarding-label">Attachments (optional, up to 5)</label>
            <AttachmentUploader
              files={files}
              onAddFiles={(selected) => setFiles((prev) => [...prev, ...selected].slice(0, 5))}
              onRemoveFile={(idxToRemove) => setFiles((prev) => prev.filter((_, idx) => idx !== idxToRemove))}
              maxFiles={5}
            />
          </div>
          <button type="submit" className="primary-onboarding-btn" disabled={submitting}>{submitting ? 'Submitting…' : 'Submit Ticket'}</button>
        </form>
      </div>

      <div style={{ padding: '0 16px 24px' }}>
        <h4 style={{ margin: '0 0 12px', fontSize: 12, fontWeight: 800 }}>TICKET HISTORY</h4>
        {loading ? (
          <div style={{ textAlign: 'center', padding: '20px 0', color: 'var(--text-muted)' }}><p style={{ margin: 0, fontSize: 12 }}>Loading…</p></div>
        ) : tickets.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '20px 0', color: 'var(--text-muted)' }}><p style={{ margin: 0, fontSize: 12 }}>No tickets yet</p></div>
        ) : tickets.map(t => (
          <div key={t._id} className="review-summary-card" style={{ marginBottom: 10, cursor: 'pointer' }} onClick={() => openDetail(t)}>
            <div className="review-item-row">
              <span className="review-item-key">#{t.ticketNumber}</span>
              <span style={{ fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 20, backgroundColor: t.status === 'RESOLVED' || t.status === 'CLOSED' ? 'var(--primary-light)' : '#eff6ff', color: t.status === 'RESOLVED' || t.status === 'CLOSED' ? 'var(--primary)' : 'var(--info)' }}>
                {(t.status || '').replace(/_/g, ' ')}
              </span>
            </div>
            <div className="review-item-row" style={{ marginTop: 4 }}>
              <span className="review-item-key">{t.subject}</span>
              <span className="review-item-val">{new Date(t.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}</span>
            </div>
          </div>
        ))}
      </div>

      {openTicket && (
        <TicketDetailModal
          ticket={openTicket}
          messages={openMessages}
          currentUserId={userProfile?._id}
          onClose={() => setOpenTicket(null)}
          onReply={async (msg) => { await sendMessage(openTicket._id, msg); await refreshDetail(); }}
          onReopen={async () => { await reopenTicket(openTicket._id); await refreshDetail(); }}
        />
      )}
    </>
  );
};

export default SupportTab;
