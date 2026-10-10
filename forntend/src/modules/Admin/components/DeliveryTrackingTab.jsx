import React, { useState } from 'react';
import { useAdmin } from '../context/AdminContext';

export const DeliveryTrackingTab = () => {
  const { triggerToast } = useAdmin();
  const [searchQuery, setSearchQuery] = useState('');

  // No live SLA-tracking endpoint exists yet — empty until one is wired up.
  const [activeDeliveries, setActiveDeliveries] = useState([]);

  const handleReassign = (id, rider) => {
    triggerToast(`Alert sent to Dispatch Center. Reassigning delivery ${id} from ${rider}...`);
  };

  const filteredDeliveries = activeDeliveries.filter(d =>
    d.riderName.toLowerCase().includes(searchQuery.toLowerCase()) ||
    d.id.toLowerCase().includes(searchQuery.toLowerCase())
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
            placeholder="Search active deliveries by ID or rider..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 12 }}>
          <div style={{ display: 'flex', flexDirection: 'column', textAlign: 'right' }}>
            <span style={{ fontSize: 10, fontWeight: 800, color: '#64748b', textTransform: 'uppercase' }}>Active Fleet size</span>
            <span style={{ fontSize: 14, fontWeight: 900, color: '#0ea5e9' }}>No data source yet</span>
          </div>
        </div>
      </div>

      <div className="admin-list-container">
        {filteredDeliveries.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--admin-text-muted)', width: '100%' }}>
            No active deliveries to track.
          </div>
        ) : filteredDeliveries.map(d => {
          const isDelayed = d.elapsedMinutes > d.slaMinutes;
          return (
            <div key={d.id} className="admin-item-card" style={{ borderLeft: isDelayed ? '4px solid #ef4444' : '4px solid #10b981' }}>
              <div className="admin-item-header">
                <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--admin-text-muted)' }}>ID: {d.id}</span>
                <span className={`admin-status-pill ${isDelayed ? 'rejected' : 'approved'}`}>
                  {isDelayed ? 'SLA Alert (Delayed)' : d.status}
                </span>
              </div>

              <div className="admin-item-body">
                <h4 className="admin-item-title" style={{ color: 'var(--admin-text-primary)' }}>Rider: {d.riderName}</h4>
                <p style={{ margin: '2px 0 10px 0', fontSize: 11, color: 'var(--admin-text-muted)' }}>Customer: {d.customerName} ({d.orderType})</p>
                
                <div className="admin-item-row" style={{ borderTop: '1px solid #f1f5f9', paddingTop: 8 }}>
                  <span className="admin-item-label">Delivery Address</span>
                  <span className="admin-item-value" style={{ fontSize: 11, fontWeight: 600 }}>{d.address}</span>
                </div>
                <div className="admin-item-row">
                  <span className="admin-item-label">Elapsed Dispatch Time</span>
                  <span className="admin-item-value" style={{ color: isDelayed ? '#ef4444' : 'inherit', fontWeight: 800 }}>{d.elapsedMinutes} mins</span>
                </div>
                <div className="admin-item-row">
                  <span className="admin-item-label">Target SLA Threshold</span>
                  <span className="admin-item-value">{d.slaMinutes} mins</span>
                </div>
              </div>

              <div className="admin-item-actions">
                <button className="admin-btn-sm reject" style={{ padding: '8px 12px', border: '1px solid #cbd5e1', color: '#475569', background: 'none' }} onClick={() => handleReassign(d.id, d.riderName)}>
                  ⚠ Escalation Reassign
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
};

export default DeliveryTrackingTab;
