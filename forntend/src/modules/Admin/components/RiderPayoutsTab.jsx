import React, { useState, useEffect } from 'react';
import { useAdmin } from '../context/AdminContext';

export const RiderPayoutsTab = () => {
  const { riderPayouts, riderPayoutsLoading, riderPayoutsError, fetchRiderPayouts, settleRiderPayout } = useAdmin();
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    const t = setTimeout(() => { fetchRiderPayouts(searchQuery); }, searchQuery ? 300 : 0);
    return () => clearTimeout(t);
  }, [searchQuery, fetchRiderPayouts]);

  const handlePayRider = (id, name, amount) => {
    if (amount <= 0) return;
    settleRiderPayout(id, name, amount);
  };

  const filteredPayouts = riderPayouts;

  return (
    <>
      <div className="admin-action-row">
        <div className="admin-search-wrapper" style={{ flex: '0 1 400px' }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--sa-text-muted)" strokeWidth="2.5">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            type="text"
            className="admin-search-input"
            placeholder="Search riders by name..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      <div className="admin-list-container">
        {riderPayoutsLoading ? (
          <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--admin-text-muted)', width: '100%' }}>
            Loading rider payouts...
          </div>
        ) : riderPayoutsError ? (
          <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--admin-error)', width: '100%' }}>
            Error: {riderPayoutsError}
          </div>
        ) : filteredPayouts.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--admin-text-muted)', width: '100%' }}>
            No rider payout data available.
          </div>
        ) : filteredPayouts.map(r => (
          <div key={r.id} className="admin-item-card">
            <div className="admin-item-header">
              <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--admin-text-muted)' }}>ID: #{r.id}</span>
              <span className={`admin-status-pill ${r.pendingPayout > 0 ? 'pending' : 'approved'}`}>
                {r.pendingPayout > 0 ? 'Pending Settlement' : 'Settled'}
              </span>
            </div>

            <div className="admin-item-body">
              <h4 className="admin-item-title">{r.name}</h4>
              <p style={{ margin: '2px 0 10px 0', fontSize: 11, color: 'var(--admin-text-muted)' }}>Vehicle Type: {r.vehicle}</p>

              <div className="admin-item-row" style={{ borderTop: '1px solid #f1f5f9', paddingTop: 8 }}>
                <span className="admin-item-label">Pending Payout Amount</span>
                <span className="admin-item-value" style={{ color: r.pendingPayout > 0 ? '#b91c1c' : '#059669', fontWeight: 800 }}>
                  ₹{r.pendingPayout.toFixed(2)}
                </span>
              </div>
              <div className="admin-item-row">
                <span className="admin-item-label">Trips Logged This Week</span>
                <span className="admin-item-value">{r.tripsThisWeek} deliveries</span>
              </div>
              <div className="admin-item-row">
                <span className="admin-item-label">Total Paid Out (Lifetime)</span>
                <span className="admin-item-value" style={{ color: '#d97706', fontWeight: 700 }}>₹{r.paidTotal.toFixed(2)}</span>
              </div>
              {!r.hasPayoutMethod && (
                <div className="admin-item-row">
                  <span className="admin-item-value" style={{ color: '#b91c1c', fontWeight: 700, fontSize: 11 }}>No UPI ID or bank account on file</span>
                </div>
              )}
            </div>

            <div className="admin-item-actions">
              {r.pendingPayout > 0 ? (
                <button className="admin-btn-sm approve" style={{ padding: '8px 12px' }} disabled={!r.hasPayoutMethod} onClick={() => handlePayRider(r.id, r.name, r.pendingPayout)}>
                  Mark as Paid (UPI/Bank)
                </button>
              ) : (
                <button className="admin-btn-sm details" style={{ padding: '8px 12px' }} disabled>
                  Fully Settled
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </>
  );
};

export default RiderPayoutsTab;
