import React, { useEffect } from 'react';
import { useAdmin } from '../context/AdminContext';

const formatDuration = (mins) => {
  if (mins === null || mins === undefined) return '—';
  if (mins < 60) return `${mins} min`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
};

export const DeliveryHistoryTab = () => {
  const { triggerToast, deliveryHistory, deliveryHistoryLoading, deliveryHistoryError, fetchDeliveryHistory } = useAdmin();

  useEffect(() => {
    fetchDeliveryHistory();
  }, [fetchDeliveryHistory]);

  const historyLogs = deliveryHistory.map((d) => ({
    id: d.id,
    partner: d.partner,
    customer: d.customer,
    date: d.deliveredAt ? new Date(d.deliveredAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—',
    duration: formatDuration(d.durationMin),
    otp: d.status === 'delivered' ? (d.otpVerified ? 'OTP Verified' : 'OTP Not Verified') : '—',
    status: d.status === 'delivered' ? 'Delivered' : 'Failed',
  }));

  return (
    <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 20 }}>
      
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: '#0f172a' }}>Completed & Past Delivery History Log</h2>
          <p style={{ margin: '4px 0 0 0', fontSize: 12, color: '#64748b' }}>Archive of fulfilled dispatches, trip durations, customer OTP verifications, and cancellations.</p>
        </div>

        <button onClick={() => triggerToast('Exporting Delivery History Log as CSV...')} style={{ padding: '8px 16px', borderRadius: 8, backgroundColor: '#10b981', color: '#ffffff', border: 'none', fontWeight: 800, fontSize: 12, cursor: 'pointer' }}>Export History CSV</button>
      </div>

      {/* History Table */}
      <div tabIndex={0} role="region" aria-label="Scrollable data table" style={{ backgroundColor: '#ffffff', borderRadius: 12, border: '1px solid #e2e8f0', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 12.5 }}>
          <thead>
            <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569', fontWeight: 800 }}>
              <th style={{ padding: '12px 16px' }}>Order Ref</th>
              <th style={{ padding: '12px 16px' }}>Delivery Partner</th>
              <th style={{ padding: '12px 16px' }}>Customer Name</th>
              <th style={{ padding: '12px 16px' }}>Delivered Timestamp</th>
              <th style={{ padding: '12px 16px' }}>Trip Duration</th>
              <th style={{ padding: '12px 16px' }}>Verification Method</th>
              <th style={{ padding: '12px 16px' }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {deliveryHistoryLoading ? (
              <tr>
                <td colSpan={7} style={{ textAlign: 'center', padding: '30px 0', color: '#94a3b8' }}>
                  Loading delivery history...
                </td>
              </tr>
            ) : deliveryHistoryError ? (
              <tr>
                <td colSpan={7} style={{ textAlign: 'center', padding: '30px 0', color: '#dc2626' }}>
                  Error: {deliveryHistoryError}
                </td>
              </tr>
            ) : historyLogs.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ textAlign: 'center', padding: '30px 0', color: '#94a3b8' }}>
                  No completed deliveries yet.
                </td>
              </tr>
            ) : historyLogs.map(log => (
              <tr key={log.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                <td style={{ padding: '12px 16px', fontFamily: 'monospace', fontWeight: 800 }}>{log.id}</td>
                <td style={{ padding: '12px 16px', fontWeight: 800, color: '#0f172a' }}>{log.partner}</td>
                <td style={{ padding: '12px 16px', color: '#6366f1', fontWeight: 700 }}>{log.customer}</td>
                <td style={{ padding: '12px 16px', color: '#64748b' }}>{log.date}</td>
                <td style={{ padding: '12px 16px', fontWeight: 700 }}>{log.duration}</td>
                <td style={{ padding: '12px 16px', fontFamily: 'monospace', fontSize: 11 }}>{log.otp}</td>
                <td style={{ padding: '12px 16px' }}>
                  <span style={{
                    padding: '3px 10px',
                    borderRadius: 12,
                    fontSize: 10,
                    fontWeight: 800,
                    backgroundColor: log.status === 'Delivered' ? '#ebfdf2' : '#fef2f2',
                    color: log.status === 'Delivered' ? '#047857' : '#b91c1c'
                  }}>
                    {log.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

    </div>
  );
};

export default DeliveryHistoryTab;
