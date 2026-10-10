import React, { useState } from 'react';
import { useAdmin } from '../context/AdminContext';
import { SHGDetailModal } from './SHGDetailModal';

export const SHGVerificationsTab = () => {
  const { shgVendors, approveShgVendor, triggerToast } = useAdmin();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedShg, setSelectedShg] = useState(null);

  const handleVerify = async (id, name) => {
    await approveShgVendor(id);
    setSelectedShg(null);
  };

  const filteredShg = (shgVendors || []).filter(shg =>
    (shg.groupName.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (shg.nrlmId && shg.nrlmId.toLowerCase().includes(searchQuery.toLowerCase()))) &&
    shg.status.toLowerCase() === 'pending'
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
            placeholder="Search pending by SHG name or NRLM Code..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      <div className="admin-list-container">
        {filteredShg.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--admin-text-muted)', width: '100%' }}>
            No pending SHG vendor applications found.
          </div>
        ) : (
          filteredShg.map(shg => (
            <div key={shg.id} className="admin-item-card">
              <div className="admin-item-header">
                <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--admin-text-muted)' }}>ID: #{shg.id.slice(-6)}</span>
                <span className={`admin-status-pill pending`}>
                  Pending Audit
                </span>
              </div>

              <div className="admin-item-body">
                <h4 className="admin-item-title">{shg.groupName}</h4>
                <p style={{ margin: '2px 0 10px 0', fontSize: 11, color: 'var(--admin-text-muted)' }}>Location: {shg.district || '—'} Hub</p>
                
                <div className="admin-item-row" style={{ borderTop: '1px solid #f1f5f9', paddingTop: 8 }}>
                  <span className="admin-item-label">DAY-NRLM Database ID</span>
                  <span className="admin-item-value" style={{ fontFamily: 'monospace' }}>{shg.nrlmId || '—'}</span>
                </div>
                <div className="admin-item-row">
                  <span className="admin-item-label">Active Members Directory</span>
                  <span className="admin-item-value">{shg.membersCount} Members</span>
                </div>
                <div className="admin-item-row">
                  <span className="admin-item-label">Joint Bank Account</span>
                  <span className="admin-item-value">{shg.bankName || '—'}</span>
                </div>
              </div>

              <div className="admin-item-actions">
                <button className="admin-btn-sm details" onClick={() => setSelectedShg(shg)}>
                  Verify NRLM Dossier
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* SHG DETAIL MODAL INSPECTOR */}
      {selectedShg && (
        <SHGDetailModal
          shg={selectedShg}
          onClose={() => setSelectedShg(null)}
          onRefresh={() => {
            setSelectedShg(null);
          }}
        />
      )}
    </>
  );
};

export default SHGVerificationsTab;
