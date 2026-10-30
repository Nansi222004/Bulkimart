import ModalPortal from '../../../components/ModalPortal';
import React, { useEffect, useState } from 'react';
import { useAdmin } from '../context/AdminContext';
import {
  MessageSquare, User, Tag, Clock, Package, Paperclip,
  ExternalLink, Send, CheckCircle2, Lock, X, ArrowRight,
  ShieldCheck
} from 'lucide-react';
import './TicketsTab.css';

const CATEGORY_OPTIONS = [
  'Order', 'Payment', 'Payment / Payout', 'Delivery', 'Product', 'Refund / Cancellation',
  'Account', 'Account / KYC', 'Subscription', 'Campaign',
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

const getRoleLabel = (role) => {
  if (!role) return 'Customer';
  const r = String(role).toLowerCase();
  if (r === 'delivery' || r === 'rider') return 'Delivery Partner';
  if (r === 'seller' || r === 'vendor') return 'Seller';
  if (r === 'shg') return 'SHG Partner';
  if (r === 'admin') return 'Admin Support';
  return role.charAt(0).toUpperCase() + role.slice(1);
};

const getInitials = (name) => {
  if (!name) return 'U';
  const parts = String(name).trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
};

const isImageAttachment = (att) => {
  if (!att) return false;
  if (att.mimeType && att.mimeType.startsWith('image/')) return true;
  if (att.resourceType === 'image') return true;
  const url = String(att.url || att.fileName || '').toLowerCase();
  return /\.(jpg|jpeg|png|webp|gif|svg|avif)($|\?)/i.test(url);
};

export const TicketsTab = () => {
  const {
    tickets, ticketsLoading, ticketsError, fetchTickets,
    ticketCategoryFilter, setTicketCategoryFilter,
    ticketRoleFilter, setTicketRoleFilter,
    selectedTicket, setSelectedTicket,
    ticketDetail, ticketMessages, ticketDetailLoading,
    openTicketDetail, replyToTicket, addInternalNote, changeTicketStatus, resolveTicket,
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

  const activeTicket = selectedTicket ? {
    ...selectedTicket,
    ...(ticketDetail || {}),
    id: ticketDetail?._id || selectedTicket.id,
    ticketNumber: ticketDetail?.ticketNumber || selectedTicket.ticketNumber || selectedTicket.id,
    userName: ticketDetail?.userName || ticketDetail?.userId?.name || selectedTicket.userName || 'Anonymous',
    userEmail: ticketDetail?.userEmail || ticketDetail?.userId?.email || selectedTicket.userEmail || '',
    requesterRole: ticketDetail?.requesterRole || ticketDetail?.userId?.role || selectedTicket.requesterRole || 'customer',
    category: ticketDetail?.category || selectedTicket.category || 'General',
    subject: ticketDetail?.subject || selectedTicket.subject || 'Support Request',
    status: ticketDetail?.status || selectedTicket.status || 'OPEN',
    date: selectedTicket.date || (ticketDetail?.createdAt ? new Date(ticketDetail.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'),
  } : null;

  const handleSubmitReply = (e) => {
    e.preventDefault();
    if (!ticketReply.trim() || !activeTicket) return;
    replyToTicket(activeTicket.id, ticketReply.trim());
  };

  const handleAddNote = (e) => {
    e.preventDefault();
    if (!noteText.trim() || !activeTicket) return;
    addInternalNote(activeTicket.id, noteText.trim());
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
                <h4 style={{ margin: '0 0 6px 0', fontSize: 13, fontWeight: 800, color: 'var(--admin-text-primary)' }}>{t.subject || 'Support Request'}</h4>
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
                  <span className="admin-item-value" style={{ textTransform: 'capitalize' }}>{t.requesterRole || 'Customer'}</span>
                </div>
                <div className="admin-item-row">
                  <span className="admin-item-label">Category</span>
                  <span className="admin-item-value">{t.category || 'General'}</span>
                </div>
                <div className="admin-item-row">
                  <span className="admin-item-label">Opened</span>
                  <span className="admin-item-value">{t.date}</span>
                </div>
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

      {/* MODERN TICKET DETAIL MODAL */}
      {activeTicket && (
        <ModalPortal className="ticket-modal-overlay admin-modal-overlay">
          <div className="ticket-modal-sheet admin-modal-sheet">
            {/* Header */}
            <div className="ticket-modal-header admin-modal-header">
              <div className="ticket-modal-header-left">
                <div className="ticket-id-badge admin-modal-title">
                  <MessageSquare size={18} color="#08b9e8" />
                  <span>Support Ticket #{activeTicket.ticketNumber}</span>
                </div>
                <span className={`ticket-status-pill ${activeTicket.status.toLowerCase()}`}>
                  {activeTicket.status.replace(/_/g, ' ')}
                </span>
              </div>
              <button
                type="button"
                className="ticket-modal-close-btn admin-modal-close"
                onClick={closeModal}
                title="Close"
              >
                ✕
              </button>
            </div>

            {ticketDetailLoading ? (
              <div style={{ textAlign: 'center', padding: 50, color: '#64748b' }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>Loading ticket details &amp; conversation…</div>
              </div>
            ) : (
              <div className="ticket-modal-body">
                {/* Executive Summary Card */}
                <div className="ticket-summary-card">
                  {/* Subject & Context Chips */}
                  <div className="ticket-subject-row">
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6, width: '100%' }}>
                      <span className="ticket-meta-label">Subject &amp; Issue</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        {ticketDetail?.relatedOrder && (
                          <span className="ticket-context-pill" title="Linked Order">
                            <Package size={11} color="#0284c7" />
                            <span>Order #{ticketDetail.relatedOrder.orderNo || String(ticketDetail.relatedOrder._id || ticketDetail.relatedOrder)}</span>
                          </span>
                        )}
                        {ticketDetail?.relatedProduct && (
                          <span className="ticket-context-pill" title="Linked Product">
                            <Tag size={11} color="#10b981" />
                            <span>{ticketDetail.relatedProduct.name || String(ticketDetail.relatedProduct._id || ticketDetail.relatedProduct)}</span>
                          </span>
                        )}
                        {ticketDetail?.relatedDelivery && (
                          <span className="ticket-context-pill" title="Delivery Status">
                            <Clock size={11} color="#f59e0b" />
                            <span>Delivery: {ticketDetail.relatedDelivery.status || String(ticketDetail.relatedDelivery._id || ticketDetail.relatedDelivery)}</span>
                          </span>
                        )}
                      </div>
                    </div>
                    <h4 className="ticket-subject-text admin-item-value" style={{ textAlign: 'left', margin: '4px 0 0 0' }}>
                      {activeTicket.subject || 'Support Request'}
                    </h4>
                  </div>

                  {/* 3-Column Metadata Row */}
                  <div className="ticket-meta-grid">
                    {/* Requester Column */}
                    <div className="ticket-meta-item">
                      <span className="ticket-meta-label">Requester</span>
                      <div className="ticket-user-cell">
                        <div className="ticket-avatar">
                          {getInitials(activeTicket.userName)}
                        </div>
                        <div className="ticket-user-info" style={{ textAlign: 'left' }}>
                          <span className="ticket-user-name admin-item-value" style={{ textAlign: 'left' }}>
                            {activeTicket.userName || 'Anonymous'}
                          </span>
                          <span className="ticket-user-role-tag" style={{ textAlign: 'left' }}>
                            {getRoleLabel(activeTicket.requesterRole)}
                          </span>
                          {activeTicket.userEmail && (
                            <span style={{ fontSize: 11, color: '#64748b', marginTop: 1, textAlign: 'left' }}>{activeTicket.userEmail}</span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Category Column */}
                    <div className="ticket-meta-item">
                      <span className="ticket-meta-label">Category</span>
                      <div>
                        <span className="ticket-category-tag admin-item-value">
                          <Tag size={11} />
                          <span>{activeTicket.category || 'General'}</span>
                        </span>
                      </div>
                    </div>

                    {/* Date Column */}
                    <div className="ticket-meta-item">
                      <span className="ticket-meta-label">Opened On</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: '#334155', fontWeight: 600 }}>
                        <Clock size={12} color="#64748b" />
                        <span>{activeTicket.date || 'Recently'}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Status Transitions & Internal Note Actions */}
                <div className="ticket-action-bar">
                  {(STATUS_ADMIN_NEXT[activeTicket.status] || []).map((next) => (
                    <button
                      key={next}
                      type="button"
                      className="ticket-btn-primary"
                      onClick={() => changeTicketStatus(activeTicket.id, next)}
                    >
                      <span>Move to {next.replace(/_/g, ' ')}</span>
                      <ArrowRight size={13} />
                    </button>
                  ))}
                  <button
                    type="button"
                    className="ticket-btn-secondary"
                    onClick={() => setShowNoteBox((v) => !v)}
                  >
                    <Lock size={12} color="#b45309" />
                    <span>{showNoteBox ? 'Close Note Box' : '+ Internal Staff Note'}</span>
                  </button>
                </div>

                {/* Internal Staff Note Editor */}
                {showNoteBox && (
                  <form onSubmit={handleAddNote} className="ticket-note-box">
                    <div className="ticket-note-header">
                      <div className="ticket-note-title">
                        <Lock size={13} />
                        <span>Internal Note (Only visible to Bulkimart admin staff)</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setShowNoteBox(false)}
                        style={{ border: 'none', background: 'none', color: '#b45309', cursor: 'pointer', fontSize: 12 }}
                      >
                        ✕
                      </button>
                    </div>
                    <textarea
                      className="ticket-note-textarea"
                      value={noteText}
                      onChange={(e) => setNoteText(e.target.value)}
                      placeholder="Add private note regarding this issue or actions taken..."
                      required
                    />
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                      <button
                        type="button"
                        className="ticket-btn-secondary"
                        style={{ padding: '6px 12px', fontSize: 12 }}
                        onClick={() => setShowNoteBox(false)}
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        className="ticket-btn-primary"
                        style={{ padding: '6px 14px', fontSize: 12, background: 'linear-gradient(135deg, #d97706, #b45309)' }}
                      >
                        Save Note
                      </button>
                    </div>
                  </form>
                )}

                {/* Conversation Activity Stream */}
                <div className="ticket-conversation-card">
                  <div className="ticket-conversation-header">
                    <div className="ticket-conversation-title">
                      <MessageSquare size={13} color="#0284c7" />
                      <span>Ticket Activity &amp; Conversation ({ticketMessages.length})</span>
                    </div>
                  </div>

                  <div className="ticket-messages-list">
                    {ticketMessages.length === 0 ? (
                      <div style={{ textAlign: 'center', padding: '24px 0', color: '#94a3b8', fontSize: 12.5 }}>
                        No messages in conversation yet.
                      </div>
                    ) : (
                      ticketMessages.map((m) => {
                        const isInternal = Boolean(m.isInternal);
                        const isAdmin = !isInternal && m.senderRole === 'admin';
                        const bubbleClass = isInternal ? 'internal' : isAdmin ? 'admin' : 'requester';

                        return (
                          <div key={m._id} className={`ticket-message-bubble ${bubbleClass}`}>
                            <div className="ticket-message-top">
                              <div className="ticket-message-author">
                                {isInternal ? (
                                  <>
                                    <Lock size={12} color="#b45309" />
                                    <span>🔒 Internal Note — {m.senderName || 'Staff'}</span>
                                  </>
                                ) : isAdmin ? (
                                  <>
                                    <ShieldCheck size={13} color="#15803d" />
                                    <span>Bulkimart Support ({m.senderName || 'Admin'})</span>
                                  </>
                                ) : (
                                  <>
                                    <div style={{ width: 18, height: 18, borderRadius: '50%', background: '#e0e7ff', color: '#4338ca', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 800 }}>
                                      {getInitials(m.senderName)}
                                    </div>
                                    <span>{m.senderName || 'User'}</span>
                                    <span style={{ fontSize: 10, color: '#4338ca', fontWeight: 600, background: '#e0e7ff', padding: '1px 6px', border: '1px solid #c7d2fe', borderRadius: 10 }}>
                                      {getRoleLabel(m.senderRole)}
                                    </span>
                                  </>
                                )}
                              </div>
                              <span className="ticket-message-time">
                                {m.createdAt ? new Date(m.createdAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''}
                              </span>
                            </div>

                            <div className="ticket-message-body">
                              {m.message}
                            </div>

                            {(m.attachments || []).length > 0 && (
                              <div className="ticket-attachments-grid">
                                {m.attachments.map((a, i) => {
                                  if (isImageAttachment(a)) {
                                    return (
                                      <a
                                        key={i}
                                        href={a.url}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="ticket-image-thumb-link"
                                        title={`Click to view full image (${a.fileName || 'Attachment'})`}
                                      >
                                        <img src={a.url} alt={a.fileName || 'Attachment'} className="ticket-image-thumb" loading="lazy" />
                                        <div className="ticket-image-overlay">
                                          <span>🔍 View</span>
                                        </div>
                                      </a>
                                    );
                                  }
                                  return (
                                    <a
                                      key={i}
                                      href={a.url}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="ticket-file-pill"
                                      title={a.fileName || 'Attachment'}
                                    >
                                      <Paperclip size={12} />
                                      <span>{a.fileName || 'Document'}</span>
                                      <ExternalLink size={10} style={{ opacity: 0.6 }} />
                                    </a>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>

                {/* Reply Section */}
                {['CLOSED'].includes(activeTicket.status) ? (
                  <div className="ticket-closed-banner">
                    <CheckCircle2 size={16} color="#059669" />
                    <span>This support ticket has been closed. No further replies can be submitted.</span>
                  </div>
                ) : (
                  <form onSubmit={handleSubmitReply} className="ticket-reply-box">
                    <div className="ticket-reply-header">
                      <span>Reply to {activeTicket.userName || 'Requester'}</span>
                      <span style={{ fontSize: 11, color: '#64748b', fontWeight: 500 }}>
                        Requester will receive an in-app notification &amp; update
                      </span>
                    </div>
                    <textarea
                      className="ticket-reply-textarea"
                      placeholder="Type your response to the customer or delivery partner..."
                      value={ticketReply}
                      onChange={(e) => setTicketReply(e.target.value)}
                      required
                    />
                    <div className="ticket-reply-actions">
                      {activeTicket.status === 'IN_PROGRESS' && (
                        <button
                          type="button"
                          className="ticket-btn-resolve"
                          onClick={() => resolveTicket(activeTicket.id, ticketReply)}
                        >
                          <CheckCircle2 size={14} />
                          <span>Reply &amp; Resolve</span>
                        </button>
                      )}
                      <button type="submit" className="ticket-btn-primary">
                        <Send size={13} />
                        <span>Send Reply</span>
                      </button>
                    </div>
                  </form>
                )}
              </div>
            )}
          </div>
        </ModalPortal>
      )}
    </>
  );
};

export default TicketsTab;
