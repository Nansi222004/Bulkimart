import React, { useEffect, useState } from 'react';
import { useDelivery } from '../context/DeliveryContext';
import { useTickets } from '../../../utils/useTickets';
import TicketDetailModal from '../../../components/support/TicketDetailModal';
import { AttachmentPreview, AttachmentUploader } from '../../../components/common/AttachmentPreview';

const getUserId = () => {
  try { return JSON.parse(localStorage.getItem('userProfile') || 'null')?._id; } catch { return undefined; }
};

export const DeliverySupportPage = () => {
  const { triggerToast } = useDelivery();
  const { tickets, categories, loading, fetchCategories, fetchMyTickets, createTicket, fetchTicketDetail, sendMessage, reopenTicket } = useTickets('delivery');
  const currentUserId = getUserId();

  const [category, setCategory] = useState('');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [files, setFiles] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [openTicket, setOpenTicket] = useState(null);
  const [openMessages, setOpenMessages] = useState([]);

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

  return (
    <div className="delivery-page-container" style={{ padding: 16 }}>
      <h3 style={{ margin: '0 0 16px', fontSize: 16, fontWeight: 800 }}>Support</h3>

      <div style={{ background: '#fff', borderRadius: 14, border: '1.5px solid #e2e8f0', padding: 16, marginBottom: 20 }}>
        <h4 style={{ margin: '0 0 12px', fontSize: 12, fontWeight: 800 }}>RAISE A TICKET</h4>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <select value={category} onChange={(e) => setCategory(e.target.value)} style={{ padding: 10, borderRadius: 8, border: '1.5px solid #e2e8f0' }}>
            <option value="">Select a category</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <input type="text" placeholder="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} style={{ padding: 10, borderRadius: 8, border: '1.5px solid #e2e8f0' }} />
          <textarea placeholder="Describe the issue..." value={description} onChange={(e) => setDescription(e.target.value)} style={{ padding: 10, borderRadius: 8, border: '1.5px solid #e2e8f0', minHeight: 80 }} />
          <AttachmentUploader
            files={files}
            onAddFiles={(selected) => setFiles((prev) => [...prev, ...selected].slice(0, 5))}
            onRemoveFile={(idxToRemove) => setFiles((prev) => prev.filter((_, idx) => idx !== idxToRemove))}
            maxFiles={5}
          />
          <button type="submit" disabled={submitting} style={{ padding: 12, borderRadius: 10, border: 'none', background: '#1b7a37', color: '#fff', fontWeight: 800, cursor: 'pointer' }}>
            {submitting ? 'Submitting…' : 'Submit Ticket'}
          </button>
        </form>
      </div>

      <h4 style={{ margin: '0 0 12px', fontSize: 12, fontWeight: 800 }}>MY TICKETS</h4>
      {loading ? (
        <div style={{ textAlign: 'center', padding: 20, color: '#94a3b8', fontSize: 12 }}>Loading…</div>
      ) : tickets.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 20, color: '#94a3b8', fontSize: 12 }}>No tickets yet</div>
      ) : tickets.map((t) => (
        <div key={t._id} onClick={() => openDetail(t)} style={{ background: '#fff', borderRadius: 12, border: '1.5px solid #e2e8f0', padding: 12, marginBottom: 8, cursor: 'pointer' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 11, fontWeight: 800, color: '#64748b' }}>#{t.ticketNumber}</span>
            <span style={{ fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 20, background: '#eff6ff', color: '#2563eb' }}>{(t.status || '').replace(/_/g, ' ')}</span>
          </div>
          <div style={{ fontSize: 13, fontWeight: 700, marginTop: 4 }}>{t.subject}</div>
        </div>
      ))}

      {openTicket && (
        <TicketDetailModal
          ticket={openTicket}
          messages={openMessages}
          currentUserId={currentUserId}
          onClose={() => setOpenTicket(null)}
          onReply={async (msg) => { await sendMessage(openTicket._id, msg); await refreshDetail(); }}
          onReopen={async () => { await reopenTicket(openTicket._id); await refreshDetail(); }}
        />
      )}
    </div>
  );
};

export default DeliverySupportPage;
