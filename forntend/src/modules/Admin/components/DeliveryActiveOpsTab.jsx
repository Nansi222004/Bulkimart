import React, { useState } from 'react';
import { useAdmin } from '../context/AdminContext';

export const DeliveryActiveOpsTab = () => {
  const { triggerToast } = useAdmin();

  // No live-delivery-ops endpoint exists yet — empty until one is wired up.
  const [activeDeliveries, setActiveDeliveries] = useState([]);

  const [selectedDelivery, setSelectedDelivery] = useState(null);

  const handleUpdateStatus = (id, newStatus) => {
    setActiveDeliveries(activeDeliveries.map(d => d.id === id ? { ...d, status: newStatus } : d));
    triggerToast(`Delivery status updated to '${newStatus}'`);
    setSelectedDelivery(null);
  };

  return (
    <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 20 }}>
      
      {/* Header */}
      <div>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: '#0f172a' }}>Live Active Deliveries Lifecycle Monitor</h2>
        <p style={{ margin: '4px 0 0 0', fontSize: 12, color: '#64748b' }}>Track active delivery dispatches in real-time through assigned → pickup → out for delivery → OTP confirmation.</p>
      </div>

      {/* Table */}
      <div style={{ backgroundColor: '#ffffff', borderRadius: 12, border: '1px solid #e2e8f0', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 12.5 }}>
          <thead>
            <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569', fontWeight: 800 }}>
              <th style={{ padding: '12px 16px' }}>Delivery ID</th>
              <th style={{ padding: '12px 16px' }}>Order Ref</th>
              <th style={{ padding: '12px 16px' }}>Customer</th>
              <th style={{ padding: '12px 16px' }}>Assigned Partner</th>
              <th style={{ padding: '12px 16px' }}>Pickup Location</th>
              <th style={{ padding: '12px 16px' }}>Delivery Address</th>
              <th style={{ padding: '12px 16px' }}>ETA</th>
              <th style={{ padding: '12px 16px' }}>Status</th>
              <th style={{ padding: '12px 16px', textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {activeDeliveries.length === 0 ? (
              <tr>
                <td colSpan={9} style={{ textAlign: 'center', padding: '30px 0', color: '#94a3b8' }}>
                  No active deliveries in progress.
                </td>
              </tr>
            ) : activeDeliveries.map(del => (
              <tr key={del.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                <td style={{ padding: '12px 16px', fontFamily: 'monospace', fontWeight: 800 }}>{del.id}</td>
                <td style={{ padding: '12px 16px', fontFamily: 'monospace', color: '#6366f1', fontWeight: 700 }}>{del.orderId}</td>
                <td style={{ padding: '12px 16px', fontWeight: 800, color: '#0f172a' }}>{del.customer}</td>
                <td style={{ padding: '12px 16px', color: '#10b981', fontWeight: 700 }}>{del.rider}</td>
                <td style={{ padding: '12px 16px', color: '#64748b' }}>{del.pickup}</td>
                <td style={{ padding: '12px 16px', color: '#64748b' }}>{del.drop}</td>
                <td style={{ padding: '12px 16px', fontWeight: 700 }}>{del.eta}</td>
                <td style={{ padding: '12px 16px' }}>
                  <span style={{
                    padding: '3px 10px',
                    borderRadius: 12,
                    fontSize: 10,
                    fontWeight: 800,
                    backgroundColor: del.status === 'Out for Delivery' ? '#ebfdf2' : del.status === 'Picked Up' ? '#eff6ff' : '#fffbe6',
                    color: del.status === 'Out for Delivery' ? '#047857' : del.status === 'Picked Up' ? '#1d4ed8' : '#d48806'
                  }}>
                    {del.status}
                  </span>
                </td>
                <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                  <button onClick={() => setSelectedDelivery(del)} style={{ padding: '4px 10px', borderRadius: 6, backgroundColor: '#0f172a', color: '#ffffff', border: 'none', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>Manage Status</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* MANAGE STATUS MODAL */}
      {selectedDelivery && (
        <div className="admin-modal-overlay">
          <div className="admin-modal-sheet">
            <div className="admin-modal-header">
              <h3 className="admin-modal-title">Delivery Status Override</h3>
              <button className="admin-modal-close" onClick={() => setSelectedDelivery(null)}>✕</button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div className="admin-item-row"><span className="admin-item-label">Delivery ID</span><span className="admin-item-value" style={{ fontFamily: 'monospace', fontWeight: 800 }}>{selectedDelivery.id}</span></div>
              <div className="admin-item-row"><span className="admin-item-label">Assigned Rider</span><span className="admin-item-value" style={{ color: '#10b981', fontWeight: 800 }}>{selectedDelivery.rider}</span></div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
                <span style={{ fontSize: 11, fontWeight: 800, color: '#475569' }}>Advance Delivery Lifecycle Stage</span>
                {['Pickup Pending', 'Picked Up', 'Out for Delivery', 'Delivered (OTP Verified)'].map(st => (
                  <button
                    key={st}
                    onClick={() => handleUpdateStatus(selectedDelivery.id, st)}
                    style={{
                      padding: 8,
                      borderRadius: 6,
                      border: '1px solid #cbd5e1',
                      backgroundColor: selectedDelivery.status === st ? '#ebfdf2' : '#ffffff',
                      color: selectedDelivery.status === st ? '#047857' : '#475569',
                      fontWeight: selectedDelivery.status === st ? 800 : 600,
                      fontSize: 12,
                      cursor: 'pointer',
                      textAlign: 'left'
                    }}
                  >
                    • {st}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default DeliveryActiveOpsTab;
