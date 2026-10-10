import React, { useState } from 'react';
import { useAdmin } from '../context/AdminContext';

export const SHGPayoutsTab = () => {
  const { triggerToast } = useAdmin();
  const [searchQuery, setSearchQuery] = useState('');

  // Mock SHG Group Joint Payouts
  const [payouts, setPayouts] = useState([]);

  const handleDisburse = (id, name, amount) => {
    if (amount <= 0) return;
    setPayouts(prev => prev.map(p => p.id === id ? { ...p, pendingAmount: 0.00, totalDisbursed: p.totalDisbursed + amount, lastPayoutDate: 'Today' } : p));
    triggerToast(`Bulk disbursement of ₹${amount} initiated to ${name}'s joint bank account.`);
  };

  const filteredPayouts = payouts.filter(p =>
    p.groupName.toLowerCase().includes(searchQuery.toLowerCase())
  );

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
            placeholder="Search by SHG group name..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      <div className="admin-list-container">
        {filteredPayouts.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--admin-text-muted)', width: '100%' }}>
            No SHG payouts pending or settled.
          </div>
        ) : (
          filteredPayouts.map(p => (
            <div key={p.id} className="admin-item-card">
              <div className="admin-item-header">
                <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--admin-text-muted)' }}>ID: #{p.id}</span>
                <span className={`admin-status-pill ${p.pendingAmount > 0 ? 'pending' : 'approved'}`}>
                  {p.pendingAmount > 0 ? 'Pending Payout' : 'Settled'}
                </span>
              </div>

              <div className="admin-item-body">
                <h4 className="admin-item-title">{p.groupName}</h4>
                <p style={{ margin: '2px 0 10px 0', fontSize: 11, color: 'var(--admin-text-muted)' }}>Joint Account: {p.bankAccount}</p>
                
                <div className="admin-item-row" style={{ borderTop: '1px solid #f1f5f9', paddingTop: 8 }}>
                  <span className="admin-item-label">Pending Settlements</span>
                  <span className="admin-item-value" style={{ color: p.pendingAmount > 0 ? '#b91c1c' : '#059669', fontWeight: 800 }}>
                    ₹{p.pendingAmount.toFixed(2)}
                  </span>
                </div>
                <div className="admin-item-row">
                  <span className="admin-item-label">Total Volume Settled</span>
                  <span className="admin-item-value">₹{p.totalDisbursed.toFixed(2)}</span>
                </div>
                <div className="admin-item-row">
                  <span className="admin-item-label">Last Payout Date</span>
                  <span className="admin-item-value">{p.lastPayoutDate}</span>
                </div>
              </div>

              <div className="admin-item-actions">
                {p.pendingAmount > 0 ? (
                  <button className="admin-btn-sm approve" style={{ padding: '8px 12px' }} onClick={() => handleDisburse(p.id, p.groupName, p.pendingAmount)}>
                    Disburse Settlement
                  </button>
                ) : (
                  <button className="admin-btn-sm details" style={{ padding: '8px 12px' }} disabled>
                    Settled
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </>
  );
};

export default SHGPayoutsTab;
