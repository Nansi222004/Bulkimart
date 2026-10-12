import React, { useEffect, useState } from 'react';
import { useAdmin } from '../context/AdminContext';

const CATEGORY_OPTIONS = [
  'Order', 'Payment', 'Payment / Payout', 'Delivery', 'Product', 'Refund / Cancellation',
  'Account', 'Account / KYC', 'Subscription', 'Campaign', 'Advertisement / Promotion',
  'Order / Delivery', 'Pickup Issue', 'Customer Issue', 'Payment / Earnings',
  'Withdrawal / Payout', 'KYC / Verification', 'App / Technical Issue', 'Technical Issue', 'Other',
];

const STATUS_OPTIONS = ['OPEN', 'IN_PROGRESS', 'WAITING_FOR_USER', 'RESOLVED', 'CLOSED', 'REOPENED'];

const STATUS_ADMIN_NEXT = {
  OPEN: ['IN_PROGRESS'],
  IN_PROGRESS: ['WAITING_FOR_USER', 'RESOLVED'],
  WAITING_FOR_USER: ['IN_PROGRESS'],
  RESOLVED: ['CLOSED'],
  REOPENED: ['IN_PROGRESS'],
  CLOSED: [],
};

export const TicketsTab = () => {
  const {
    tickets, ticketsLoading, ticketsError, fetchTickets,
    ticketCategoryFilter, setTicketCategoryFilter,
    ticketRoleFilter, setTicketRoleFilter,
    selectedTicket, setSelectedTicket,
    ticketDetail, ticketMessages, ticketDetailLoading,
    openTicketDetail, replyToTicket, addInternalNote, assignTicketToSelf, changeTicketStatus, resolveTicket,
    ticketReply, setTicketReply,
    searchQuery, setSearchQuery,
    filterStatus, setFilterStatus,
  } = useAdmin();

  const [noteText, setNoteText] = useState('');
  const [showNoteBox, setShowNoteBox] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => {
      fetchTickets(
        filterStatus === 'All' ? 'all' : filterStatus,
        searchQuery,
        ticketCategoryFilter === 'All' ? 'all' : ticketCategoryFilter,
        ticketRoleFilter === 'All' ? 'all' : ticketRoleFilter,
      );
    }, searchQuery ? 300 : 0);
    return () => clearTimeout(t);
  }, [searchQuery, filterStatus, ticketCategoryFilter, ticketRoleFilter, fetchTickets]);

  const handleSubmitReply = (e) => {
    e.preventDefault();
    if (!ticketReply.trim()) return;
    replyToTicket(selectedTicket.id, ticketReply.trim());
  };

  const handleAddNote = (e) => {
    e.preventDefault();
    if (!noteText.trim()) return;
    addInternalNote(selectedTicket.id, noteText.trim());
    setNoteText('');
    setShowNoteBox(false);
  };

  const closeModal = () => {
    setSelectedTicket(null);
    setTicketReply('');
    setNoteText('');
    setShowNoteBox(false);
  };

  return (
    <>
      {/* Action Row */}
      <div className="admin-action-row">
        <div className="admin-search-wrapper">
          <input
            type="text"
            className="admin-search-input"
            placeholder="Search by ticket #, name, email, subject..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <select className="admin-filter-select" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
          <option value="All">All Statuses</option>
          {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
        </select>
        <select className="admin-filter-select" value={ticketRoleFilter} onChange={(e) => setTicketRoleFilter(e.target.value)}>
          <option value="All">All Roles</option>
          <option value="customer">Customer</option>
          <option value="seller">Seller</option>
          <option value="delivery">Delivery Partner</option>
        </select>
        <select className="admin-filter-select" value={ticketCategoryFilter} onChange={(e) => setTicketCategoryFilter(e.target.value)}>
          <option value="All">All Categories</option>
          {CATEGORY_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {/* Tickets List */}
      <div className="admin-list-container">
        {ticketsLoading ? (
          <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--admin-text-muted)', width: '100%' }}>Loading tickets...</div>
        ) : ticketsError ? (
          <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--admin-error)', width: '100%' }}>Error: {ticketsError}</div>
        ) : tickets.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--admin-text-muted)' }}>No support tickets match selected filters.</div>
        ) : (
          tickets.map(t => (
            <div key={t.id} className="admin-item-card">
              <div className="admin-item-header">
                <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--admin-text-muted)' }}>#{t.ticketNumber}</span>
                <span className={`admin-status-pill ${t.status.toLowerCase()}`}>{t.status.replace(/_/g, ' ')}</span>
              </div>

              <div className="admin-item-body">
                <h4 style={{ margin: '0 0 6px 0', fontSize: 13, fontWeight: 800, color: 'var(--admin-text-primary)' }}>{t.subject}</h4>
                <div className="admin-item-row" style={{ alignItems: 'flex-start' }}>
                  <span className="admin-item-label">Requester</span>
                  <span className="admin-item-value" style={{ textAlign: 'right', wordBreak: 'break-word' }}>
                    <div style={{ fontWeight: 700, color: 'var(--admin-text-primary)' }}>{t.userName || 'Anonymous'}</div>
                    {t.userEmail && (
                      <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--admin-text-muted)', marginTop: 2 }}>
                        ({t.userEmail})
                      </div>
                    )}
                  </span>
                </div>
                <div className="admin-item-row">
                  <span className="admin-item-label">Role</span>
                  <span className="admin-item-value" style={{ textTransform: 'capitalize' }}>{t.requesterRole}</span>
                </div>
                <div className="admin-item-row">
                  <span className="admin-item-label">Category</span>
                  <span className="admin-item-value">{t.category}</span>
                </div>
                <div className="admin-item-row">
                  <span className="admin-item-label">Opened</span>
                  <span className="admin-item-value">{t.date}</span>
                </div>
                {t.assignedAdmin?.name && (
                  <div className="admin-item-row">
                    <span className="admin-item-label">Assigned To</span>
                    <span className="admin-item-value">{t.assignedAdmin.name}</span>
                  </div>
                )}
              </div>

              <div className="admin-item-actions">
                <button className="admin-btn-sm details" style={{ flex: 'none', width: '100%' }} onClick={() => openTicketDetail(t)}>
                  Open Ticket
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* TICKET DETAIL MODAL */}
      {selectedTicket && (
        <div className="admin-modal-overlay">
          <div className="admin-modal-sheet">
            <div className="admin-modal-header">
              <h3 className="admin-modal-title">Support Ticket #{selectedTicket.ticketNumber}</h3>
              <button className="admin-modal-close" onClick={closeModal}>✕</button>
            </div>

            {ticketDetailLoading ? (
              <div style={{ textAlign: 'center', padding: 30, color: 'var(--admin-text-muted)' }}>Loading…</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

                <div className="admin-item-row" style={{ alignItems: 'flex-start' }}>
                  <span className="admin-item-label">Requester</span>
                  <span className="admin-item-value" style={{ textAlign: 'right', wordBreak: 'break-word' }}>
                    <div style={{ fontWeight: 700, color: 'var(--admin-text-primary)' }}>
                      {selectedTicket.userName || 'Anonymous'}
                      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--admin-text-muted)', marginLeft: 6, textTransform: 'capitalize' }}>
                        ({selectedTicket.requesterRole})
                      </span>
                    </div>
                    {selectedTicket.userEmail && (
                      <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--admin-text-muted)', marginTop: 2 }}>
                        {selectedTicket.userEmail}
                      </div>
                    )}
                  </span>
                </div>
                <div className="admin-item-row">
                  <span className="admin-item-label">Category</span>
                  <span className="admin-item-value">{selectedTicket.category}</span>
                </div>
                {ticketDetail?.relatedOrder && (
                  <div className="admin-item-row">
                    <span className="admin-item-label">Related Order</span>
                    <span className="admin-item-value">{ticketDetail.relatedOrder.orderNo || String(ticketDetail.relatedOrder._id || ticketDetail.relatedOrder)}</span>
                  </div>
                )}
                {ticketDetail?.relatedProduct && (
                  <div className="admin-item-row">
                    <span className="admin-item-label">Related Product</span>
                    <span className="admin-item-value">{ticketDetail.relatedProduct.name || String(ticketDetail.relatedProduct._id || ticketDetail.relatedProduct)}</span>
                  </div>
                )}
                {ticketDetail?.relatedDelivery && (
                  <div className="admin-item-row">
                    <span className="admin-item-label">Related Delivery</span>
                    <span className="admin-item-value">{ticketDetail.relatedDelivery.status || String(ticketDetail.relatedDelivery._id || ticketDetail.relatedDelivery)}</span>
                  </div>
                )}

                <div className="admin-item-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
                  <span className="admin-item-label">Subject</span>
                  <span className="admin-item-value" style={{ fontSize: 13, color: 'var(--admin-primary)', fontWeight: 800, textAlign: 'left' }}>{selectedTicket.subject}</span>
                </div>

                <hr style={{ borderColor: 'var(--admin-border-color)', margin: '4px 0' }} />

                {/* Admin actions: assign + status */}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button className="admin-btn-sm details" onClick={() => assignTicketToSelf(selectedTicket.id)}>
                    {ticketDetail?.assignedAdmin ? 'Reassign to Me' : 'Assign to Me'}
                  </button>
                  {(STATUS_ADMIN_NEXT[ticketDetail?.status] || []).map((next) => (
                    <button key={next} className="admin-btn-sm approve" onClick={() => changeTicketStatus(selectedTicket.id, next)}>
                      Move to {next.replace(/_/g, ' ')}
                    </button>
                  ))}
                  <button className="admin-btn-sm" onClick={() => setShowNoteBox((v) => !v)}>
                    {showNoteBox ? 'Cancel Note' : '+ Internal Note'}
                  </button>
                </div>

                {showNoteBox && (
                  <form onSubmit={handleAddNote} style={{ display: 'flex', flexDirection: 'column', gap: 8, background: '#fff7ed', border: '1px solid #fdba74', borderRadius: 10, padding: 10 }}>
                    <label className="admin-label" style={{ color: '#c2410c' }}>Internal note (never visible to requester)</label>
                    <textarea className="admin-textarea" value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder="Internal note..." required />
                    <button type="submit" className="admin-btn-sm" style={{ alignSelf: 'flex-start' }}>Add Note</button>
                  </form>
                )}

                <hr style={{ borderColor: 'var(--admin-border-color)', margin: '4px 0' }} />

                {/* Conversation */}
                <div style={{ maxHeight: 260, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {ticketMessages.map((m) => (
                    <div
                      key={m._id}
                      style={{
                        background: m.isInternal ? '#fff7ed' : m.senderRole === 'admin' ? '#eff6ff' : '#f8fafc',
                        border: `1px solid ${m.isInternal ? '#fdba74' : m.senderRole === 'admin' ? '#bfdbfe' : '#e2e8f0'}`,
                        borderRadius: 10, padding: '8px 10px', fontSize: 12,
                      }}
                    >
                      <div style={{ fontSize: 10, fontWeight: 800, color: m.isInternal ? '#c2410c' : m.senderRole === 'admin' ? '#2563eb' : '#475569', marginBottom: 3 }}>
                        {m.isInternal ? `🔒 INTERNAL NOTE — ${m.senderName}` : `${m.senderName} (${m.senderRole})`}
                      </div>
                      {m.message}
                      {(m.attachments || []).length > 0 && (
                        <div style={{ marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                          {m.attachments.map((a, i) => (
                            <a key={i} href={a.url} target="_blank" rel="noreferrer" style={{ fontSize: 10, color: '#2563eb' }}>📎 {a.fileName}</a>
                          ))}
                        </div>
                      )}
                      <div style={{ fontSize: 9, color: '#94a3b8', marginTop: 3 }}>{new Date(m.createdAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</div>
                    </div>
                  ))}
                </div>

                {['CLOSED'].includes(ticketDetail?.status) ? (
                  <div style={{ backgroundColor: 'var(--admin-primary-glow)', padding: 14, borderRadius: 12, border: '1px solid var(--admin-primary)', textAlign: 'center' }}>
                    <div style={{ color: 'var(--admin-primary)', fontWeight: 800, fontSize: 12 }}>Ticket closed.</div>
                  </div>
                ) : (
                  <form onSubmit={handleSubmitReply} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <div className="admin-form-group" style={{ margin: 0 }}>
                      <label className="admin-label">Reply to requester</label>
                      <textarea
                        className="admin-textarea"
                        placeholder="Type your reply..."
                        value={ticketReply}
                        onChange={(e) => setTicketReply(e.target.value)}
                        required
                      />
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button type="submit" className="admin-btn-sm approve" style={{ padding: 12, flex: 1 }}>
                        ✓ Send Reply
                      </button>
                      {ticketDetail?.status === 'IN_PROGRESS' && (
                        <button
                          type="button"
                          className="admin-btn-sm details"
                          style={{ padding: 12, flex: 1 }}
                          onClick={() => resolveTicket(selectedTicket.id, ticketReply)}
                        >
                          ✓ Reply &amp; Resolve
                        </button>
                      )}
                    </div>
                  </form>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
};

export default TicketsTab;
