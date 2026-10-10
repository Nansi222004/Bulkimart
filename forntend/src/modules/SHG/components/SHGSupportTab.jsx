import React, { useEffect, useState } from 'react';
import { useSHG } from '../context/SHGContext';
import { useTickets } from '../../../utils/useTickets';
import TicketDetailModal from '../../../components/support/TicketDetailModal';
import { AttachmentPreview, AttachmentUploader } from '../../../components/common/AttachmentPreview';

const getUserId = () => {
  try { return JSON.parse(localStorage.getItem('userProfile') || 'null')?._id; } catch { return undefined; }
};

const SHGSupportTab = () => {
  const { triggerToast } = useSHG();
  const currentUserId = getUserId();
  const { tickets, categories, loading, fetchCategories, fetchMyTickets, createTicket, fetchTicketDetail, sendMessage, reopenTicket } = useTickets('shg');

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
      triggerToast(`Ticket ${t.ticketNumber} raised successfully!`);
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
    <div className="shg-tab-content" style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
      <div className="shg-section">
        <div className="shg-card">
          <div className="shg-card-header">
            <h4 className="shg-card-title">Raise Compliance or Payout Ticket</h4>
          </div>
          <div style={{ padding: 16 }}>
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div className="shg-form-group">
                <label className="shg-label">Category</label>
                <select className="shg-input" value={category} onChange={(e) => setCategory(e.target.value)} required>
                  <option value="">Select a category</option>
                  {categories.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>

              <div className="shg-form-group">
                <label className="shg-label">Subject</label>
                <input
                  type="text"
                  className="shg-input"
                  placeholder="e.g. NRLM Verification Delay"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  required
                />
              </div>

              <div className="shg-form-group">
                <label className="shg-label">Issue Details</label>
                <textarea
                  className="shg-textarea"
                  placeholder="Provide details about your query or difficulty..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  required
                />
              </div>

              <div className="shg-form-group">
                <label className="shg-label">Attachments (optional, up to 5)</label>
                <AttachmentUploader
                  files={files}
                  onAddFiles={(selected) => setFiles((prev) => [...prev, ...selected].slice(0, 5))}
                  onRemoveFile={(idxToRemove) => setFiles((prev) => prev.filter((_, idx) => idx !== idxToRemove))}
                  maxFiles={5}
                />
              </div>

              <button type="submit" className="shg-primary-btn" style={{ margin: 0 }} disabled={submitting}>
                {submitting ? 'Submitting…' : 'Submit Support Ticket'}
              </button>
            </form>
          </div>
        </div>
      </div>

      <div className="shg-section" style={{ paddingBottom: 32 }}>
        <h4 className="shg-section-title">Support Ticket History</h4>
        <div className="shg-card">
          {loading ? (
            <div className="shg-empty-state"><p className="shg-empty-text">Loading…</p></div>
          ) : tickets.length === 0 ? (
            <div className="shg-empty-state">
              <div className="shg-empty-icon">💬</div>
              <p className="shg-empty-text">No support tickets created yet.</p>
            </div>
          ) : (
            tickets.map(ticket => (
              <div key={ticket._id} className="shg-payout-row" style={{ cursor: 'pointer' }} onClick={() => openDetail(ticket)}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--shg-text-primary)' }}>
                    {ticket.subject}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--shg-text-muted)', marginTop: 2 }}>
                    #{ticket.ticketNumber} • Created: {new Date(ticket.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                  </div>
                </div>

                <span className={`shg-status-badge ${['RESOLVED', 'CLOSED'].includes(ticket.status) ? 'active' : 'pending'}`}>
                  {(ticket.status || '').replace(/_/g, ' ')}
                </span>
              </div>
            ))
          )}
        </div>
      </div>

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

export default SHGSupportTab;
