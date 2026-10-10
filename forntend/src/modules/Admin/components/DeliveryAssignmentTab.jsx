import React, { useState } from 'react';
import { useAdmin } from '../context/AdminContext';

export const DeliveryAssignmentTab = () => {
  const { triggerToast } = useAdmin();

  // No dispatch-assignment endpoint exists yet — empty until one is wired up.
  const [unassignedOrders, setUnassignedOrders] = useState([]);

  const [selectedOrder, setSelectedOrder] = useState(null);

  const nearbyRiders = [];

  const handleAssign = (riderName) => {
    setUnassignedOrders(unassignedOrders.filter(o => o.id !== selectedOrder.id));
    triggerToast(`Order ${selectedOrder.id} successfully assigned to ${riderName}!`);
    setSelectedOrder(null);
  };

  return (
    <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 20 }}>
      
      {/* Top Header */}
      <div>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: '#0f172a' }}>Unassigned Delivery Orders Queue</h2>
        <p style={{ margin: '4px 0 0 0', fontSize: 12, color: '#64748b' }}>Manual order dispatch and nearest available delivery partner allocation panel.</p>
      </div>

      {/* Unassigned Table */}
      <div style={{ backgroundColor: '#ffffff', borderRadius: 12, border: '1px solid #e2e8f0', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 12.5 }}>
          <thead>
            <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569', fontWeight: 800 }}>
              <th style={{ padding: '12px 16px' }}>Order Ref</th>
              <th style={{ padding: '12px 16px' }}>Customer Name</th>
              <th style={{ padding: '12px 16px' }}>Delivery Address</th>
              <th style={{ padding: '12px 16px' }}>Order Category</th>
              <th style={{ padding: '12px 16px' }}>Hub Distance</th>
              <th style={{ padding: '12px 16px' }}>Priority Level</th>
              <th style={{ padding: '12px 16px', textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {unassignedOrders.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ textAlign: 'center', padding: '35px 0', color: '#10b981', fontWeight: 800 }}>
                  ✓ All orders currently assigned to delivery partners!
                </td>
              </tr>
            ) : (
              unassignedOrders.map(ord => (
                <tr key={ord.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '12px 16px', fontFamily: 'monospace', fontWeight: 800 }}>{ord.id}</td>
                  <td style={{ padding: '12px 16px', fontWeight: 800, color: '#0f172a' }}>{ord.customer}</td>
                  <td style={{ padding: '12px 16px', color: '#475569' }}>{ord.location}</td>
                  <td style={{ padding: '12px 16px', color: '#6366f1', fontWeight: 700 }}>{ord.type}</td>
                  <td style={{ padding: '12px 16px', fontWeight: 700 }}>{ord.distance}</td>
                  <td style={{ padding: '12px 16px' }}>
                    <span style={{
                      padding: '3px 10px',
                      borderRadius: 12,
                      fontSize: 10,
                      fontWeight: 800,
                      backgroundColor: ord.priority.includes('High') ? '#fffbe6' : '#ebfdf2',
                      color: ord.priority.includes('High') ? '#d48806' : '#047857'
                    }}>
                      {ord.priority}
                    </span>
                  </td>
                  <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                    <button
                      onClick={() => setSelectedOrder(ord)}
                      style={{ padding: '6px 12px', borderRadius: 6, backgroundColor: '#10b981', color: '#ffffff', border: 'none', fontSize: 11, fontWeight: 800, cursor: 'pointer' }}
                    >
                      + Assign Partner
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* MANUAL ASSIGNMENT MODAL */}
      {selectedOrder && (
        <div className="admin-modal-overlay">
          <div className="admin-modal-sheet" style={{ maxWidth: 580 }}>
            
            <div className="admin-modal-header">
              <div>
                <h3 className="admin-modal-title">Assign Partner for Order {selectedOrder.id}</h3>
                <span style={{ fontSize: 11, color: '#64748b', fontWeight: 700 }}>Customer: {selectedOrder.customer} • {selectedOrder.location}</span>
              </div>
              <button className="admin-modal-close" onClick={() => setSelectedOrder(null)}>✕</button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '12px 0' }}>
              <span style={{ fontSize: 11, fontWeight: 800, color: '#475569', textTransform: 'uppercase' }}>Available Nearby Riders ({nearbyRiders.length})</span>

              {nearbyRiders.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '20px 0', color: '#94a3b8', fontSize: 12 }}>No nearby riders available.</div>
              ) : nearbyRiders.map(rider => (
                <div key={rider.id} style={{ padding: 12, borderRadius: 10, backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontWeight: 800, color: '#0f172a', fontSize: 13 }}>{rider.name} ({rider.vehicle})</div>
                    <span style={{ fontSize: 11, color: '#64748b' }}>📍 {rider.distance} • Rating: {rider.rating}</span>
                  </div>

                  <button
                    onClick={() => handleAssign(rider.name)}
                    style={{
                      padding: '6px 12px',
                      borderRadius: 6,
                      border: 'none',
                      backgroundColor: rider.status === 'Available' ? '#10b981' : '#cbd5e1',
                      color: '#ffffff',
                      fontWeight: 800,
                      fontSize: 11,
                      cursor: rider.status === 'Available' ? 'pointer' : 'not-allowed'
                    }}
                    disabled={rider.status !== 'Available'}
                  >
                    {rider.status === 'Available' ? 'Assign Rider' : 'Rider Busy'}
                  </button>
                </div>
              ))}
            </div>

          </div>
        </div>
      )}

    </div>
  );
};

export default DeliveryAssignmentTab;
