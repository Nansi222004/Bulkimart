import React, { useState, useEffect } from 'react';
import { useAdmin } from '../context/AdminContext';

/**
 * Review moderation.
 *
 * A shopper's review is invisible on the storefront and worth nothing to the
 * product's star rating until it is approved here. Approving or rejecting
 * one makes the server recompute that product's score from its approved
 * reviews — nothing about the rating is decided in this file.
 */

const STATUS_TABS = [
  { value: 'pending', label: 'Pending Approval' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'all', label: 'All' },
];

const STATUS_PILL = {
  pending: 'pending',
  approved: 'approved',
  rejected: 'rejected',
};

const STATUS_LABEL = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
};

export const UserReviewsTab = () => {
  const {
    reviewsList, reviewsLoading, reviewsError,
    reviewStatusFilter, setReviewStatusFilter,
    fetchCustomerReviews, updateCustomerReviewStatus, deleteCustomerReview,
  } = useAdmin();

  const [searchQuery, setSearchQuery] = useState('');
  const [filterRating, setFilterRating] = useState('All');
  const [busyId, setBusyId] = useState(null);

  useEffect(() => {
    const t = setTimeout(() => { fetchCustomerReviews(searchQuery, reviewStatusFilter); }, searchQuery ? 300 : 0);
    return () => clearTimeout(t);
  }, [searchQuery, reviewStatusFilter, fetchCustomerReviews]);

  // Status and search are the server's; the star filter is a local narrowing
  // of what came back.
  const filteredReviews = reviewsList.filter(
    (r) => filterRating === 'All' || String(r.rating) === filterRating
  );

  const act = async (id, fn) => {
    setBusyId(id);
    await fn();
    setBusyId(null);
  };

  const handleReject = (id) => {
    const reason = window.prompt('Reason for rejecting this review (optional — the shopper is not shown it):') ?? '';
    act(id, () => updateCustomerReviewStatus(id, 'rejected', reason));
  };

  const handleDelete = (id) => {
    if (!window.confirm('Delete this review permanently? Rejecting hides it and keeps the record.')) return;
    act(id, () => deleteCustomerReview(id));
  };

  return (
    <>
      {/* Moderation queues */}
      <div className="admin-action-row" style={{ gap: 8, flexWrap: 'wrap' }}>
        {STATUS_TABS.map((t) => (
          <button
            key={t.value}
            className={`admin-btn-sm ${reviewStatusFilter === t.value ? 'approve' : 'details'}`}
            onClick={() => setReviewStatusFilter(t.value)}
          >
            {t.label}
            {reviewStatusFilter === t.value ? ` (${reviewsList.length})` : ''}
          </button>
        ))}
      </div>

      <div className="admin-action-row">
        <div className="admin-search-wrapper" style={{ flex: '0 1 400px' }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--sa-text-muted)" strokeWidth="2.5">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            type="text"
            className="admin-search-input"
            placeholder="Search reviews by user, item or comment..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <select
          className="admin-filter-select"
          style={{ flex: '0 1 200px', minWidth: '150px' }}
          value={filterRating}
          onChange={(e) => setFilterRating(e.target.value)}
        >
          <option value="All">All Ratings</option>
          <option value="5">5 Stars</option>
          <option value="4">4 Stars</option>
          <option value="3">3 Stars</option>
          <option value="2">2 Stars</option>
          <option value="1">1 Star</option>
        </select>
      </div>

      {/* Reviews List */}
      <div className="admin-list-container">
        {reviewsLoading ? (
          <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--admin-text-muted)', width: '100%' }}>
            Loading reviews...
          </div>
        ) : reviewsError ? (
          <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--admin-error)', width: '100%' }}>
            Error: {reviewsError}
          </div>
        ) : filteredReviews.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--admin-text-muted)' }}>
            {reviewStatusFilter === 'pending'
              ? 'Nothing waiting for moderation.'
              : 'No reviews match selected filters.'}
          </div>
        ) : (
          filteredReviews.map(r => (
            <div key={r.id} className="admin-item-card">
              <div className="admin-item-header">
                <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--admin-text-muted)' }}>ID: #{r.id}</span>
                <span className={`admin-status-pill ${STATUS_PILL[r.status] || 'pending'}`}>
                  {STATUS_LABEL[r.status] || r.status}
                </span>
              </div>

              <div className="admin-item-body">
                <h4 className="admin-item-title" style={{ color: 'var(--admin-text-primary)' }}>{r.userName}</h4>
                <div style={{ display: 'flex', gap: 2, margin: '4px 0 8px 0' }}>
                  {Array.from({ length: 5 }).map((_, idx) => (
                    <span key={idx} style={{ color: idx < r.rating ? '#eab308' : '#cbd5e1', fontSize: 14 }}>★</span>
                  ))}
                </div>

                <div className="admin-item-row">
                  <span className="admin-item-label">Item Rated</span>
                  <span className="admin-item-value" style={{ color: 'var(--sa-primary)' }}>{r.itemRated}</span>
                </div>

                <div className="admin-item-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 4, margin: '8px 0' }}>
                  <span className="admin-item-label">Review Comment</span>
                  <span className="admin-item-value" style={{ textAlign: 'left', fontWeight: 600, fontSize: 12, color: 'var(--admin-text-secondary)', lineHeight: 1.4 }}>
                    {r.comment ? `"${r.comment}"` : <em style={{ opacity: 0.6 }}>Rating only — no comment left.</em>}
                  </span>
                </div>

                {r.status === 'rejected' && r.rejectionReason && (
                  <div className="admin-item-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 4, margin: '8px 0' }}>
                    <span className="admin-item-label">Rejection Reason</span>
                    <span className="admin-item-value" style={{ textAlign: 'left', fontSize: 12, color: '#b91c1c' }}>
                      {r.rejectionReason}
                    </span>
                  </div>
                )}

                <div className="admin-item-row">
                  <span className="admin-item-label">Submitted On</span>
                  <span className="admin-item-value">{r.date}</span>
                </div>
              </div>

              <div className="admin-item-actions" style={{ display: 'flex', gap: 8 }}>
                {r.status !== 'approved' && (
                  <button
                    className="admin-btn-sm approve"
                    style={{ padding: '8px' }}
                    disabled={busyId === r.id}
                    onClick={() => act(r.id, () => updateCustomerReviewStatus(r.id, 'approved'))}
                  >
                    {busyId === r.id ? '…' : 'Approve'}
                  </button>
                )}
                {r.status !== 'rejected' && (
                  <button
                    className="admin-btn-sm reject"
                    style={{ padding: '8px' }}
                    disabled={busyId === r.id}
                    onClick={() => handleReject(r.id)}
                  >
                    {busyId === r.id ? '…' : 'Reject'}
                  </button>
                )}
                <button
                  className="admin-btn-sm reject"
                  style={{ padding: '8px', border: '1px solid #ef4444', color: '#ef4444', background: 'none' }}
                  disabled={busyId === r.id}
                  onClick={() => handleDelete(r.id)}
                >
                  Delete
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </>
  );
};

export default UserReviewsTab;
