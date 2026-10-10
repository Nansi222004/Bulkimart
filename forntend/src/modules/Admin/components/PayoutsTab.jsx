import React from 'react';
import { useAdmin } from '../context/AdminContext';

export const PayoutsTab = () => {
  const {
    payouts,
    processPayout,
    selectedPayout,
    setSelectedPayout,
    searchQuery,
    setSearchQuery,
    filterStatus,
    setFilterStatus
  } = useAdmin();

  // Filter payouts
  const filteredPayouts = payouts.filter(p => {
    const matchesSearch = p.sellerName.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = filterStatus === 'All' || p.status === filterStatus;
    return matchesSearch && matchesStatus;
  });

  return (
    <>
      {/* Action Row */}
      <div className="admin-action-row">
        <div className="admin-search-wrapper">
          <input
            type="text"
            className="admin-search-input"
            placeholder="Search payouts by seller..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <select
          className="admin-filter-select"
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
        >
          <option value="All">All Statuses</option>
          <option value="Pending">Pending Review</option>
          <option value="Approved">Approved / Paid</option>
        </select>
      </div>

      {/* Payouts List */}
      <div className="admin-list-container">
        {filteredPayouts.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--admin-text-muted)' }}>
            No payout requests match selected filters.
          </div>
        ) : (
          filteredPayouts.map(p => (
            <div key={p.id} className="admin-item-card">
              <div className="admin-item-header">
                <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--admin-text-muted)' }}>ID: #{p.id}</span>
                <span className={`admin-status-pill ${p.status.toLowerCase()}`}>
                  {p.status === 'Approved' ? 'Paid' : p.status}
                </span>
              </div>

              <div className="admin-item-body">
                <div className="admin-item-row">
                  <span className="admin-item-label">Requesting Vendor</span>
                  <span className="admin-item-value">{p.sellerName}</span>
                </div>
                <div className="admin-item-row">
                  <span className="admin-item-label">Transfer Amount</span>
                  <span className="admin-item-value" style={{ color: 'var(--admin-primary)', fontWeight: 800, fontSize: 14 }}>₹{p.amount.toLocaleString('en-IN')}</span>
                </div>
                <div className="admin-item-row">
                  <span className="admin-item-label">Request Date</span>
                  <span className="admin-item-value">{p.date}</span>
                </div>
              </div>

              <div className="admin-item-actions">
                {p.status === 'Pending' && (
                  <button className="admin-btn-sm approve" onClick={() => processPayout(p.id)}>Approve Transfer</button>
                )}
                <button className="admin-btn-sm details" onClick={() => setSelectedPayout(p)}>Bank Details</button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* DETAILED BANK INFO MODAL */}
      {selectedPayout && (
        <div className="admin-modal-overlay">
          <div className="admin-modal-sheet">
            <div className="admin-modal-header">
              <h3 className="admin-modal-title">Payout Bank Specifications</h3>
              <button className="admin-modal-close" onClick={() => setSelectedPayout(null)}>✕</button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              
              <div className="admin-item-row">
                <span className="admin-item-label">Payout ID</span>
                <span className="admin-item-value">#{selectedPayout.id}</span>
              </div>

              <div className="admin-item-row">
                <span className="admin-item-label">Beneficiary Seller</span>
                <span className="admin-item-value" style={{ fontSize: 13, color: 'var(--admin-primary)' }}>{selectedPayout.sellerName}</span>
              </div>

              <div className="admin-item-row">
                <span className="admin-item-label">Requested Payout</span>
                <span className="admin-item-value" style={{ fontWeight: 800 }}>₹{selectedPayout.amount.toLocaleString('en-IN')}</span>
              </div>

              <hr style={{ borderColor: 'var(--admin-border-color)', margin: '8px 0' }} />

              <div className="admin-item-row">
                <span className="admin-item-label">Bank Name</span>
                <span className="admin-item-value">{selectedPayout.bankName}</span>
              </div>

              <div className="admin-item-row">
                <span className="admin-item-label">Account No</span>
                <span className="admin-item-value">{selectedPayout.accountNumber}</span>
              </div>

              <div className="admin-item-row">
                <span className="admin-item-label">Bank IFSC Code</span>
                <span className="admin-item-value">{selectedPayout.id === 'pay3' ? 'PUNB0029000' : 'HDFC0001234'}</span>
              </div>

              <hr style={{ borderColor: 'var(--admin-border-color)', margin: '8px 0' }} />

              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, backgroundColor: 'var(--admin-bg-sidebar)', padding: 12, borderRadius: 10, border: '1px solid var(--admin-border-color)' }}>
                <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--admin-text-secondary)', marginBottom: 2 }}>SECURITY CONTROLS</div>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--admin-success)', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span>✓</span> Bank accounts verified during onboarding dossier audit
                </div>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--admin-success)', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span>✓</span> Vendor funds tally with completed order revenue history
                </div>
              </div>

              {selectedPayout.status === 'Pending' && (
                <div className="admin-item-actions" style={{ marginTop: 12 }}>
                  <button className="admin-btn-sm approve" onClick={() => processPayout(selectedPayout.id)}>✓ Approve IMPS Transfer</button>
                </div>
              )}

            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default PayoutsTab;
