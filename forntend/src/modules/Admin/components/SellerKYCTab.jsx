import React, { useState } from 'react';
import { useAdmin } from '../context/AdminContext';
import { adminGet, qs } from '../../../utils/adminApi';
import { SellerDetailModal } from './SellerDetailModal';

export const SellerKYCTab = () => {
  const { triggerToast, sellerDetail, sellerDetailLoading, fetchSellerDetail, setSellerDetail } = useAdmin();
  const [searchQuery, setSearchQuery] = useState('');
  const [kycLogs, setKycLogs] = useState([]);
  const [loading, setLoading] = useState(false);

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const { data } = await adminGet('/sellers' + qs({ status: 'pending', limit: 100 }));
      setKycLogs((data || []).map(s => ({
        id: s._id,
        name: s.businessName || s.storeName || 'Vendor',
        email: s.email || s.phone || '—',
        type: s.vendorType || 'General Vendor',
        gstin: s.gstin || '—',
        fssai: s.fssai || '—',
        bankStatus: 'Submitted',
        status: 'Pending',
      })));
    } catch {
      setKycLogs([]);
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => {
    fetchLogs();
  }, []);

  const filteredLogs = kycLogs.filter(log =>
    log.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    log.gstin.toLowerCase().includes(searchQuery.toLowerCase())
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
            placeholder="Search by vendor name or GSTIN..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      <div className="admin-list-container">
        {filteredLogs.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--admin-text-muted)', width: '100%' }}>
            {loading ? 'Loading pending sellers…' : 'No sellers pending KYC review.'}
          </div>
        ) : filteredLogs.map(log => (
          <div key={log.id} className="admin-item-card">
            <div className="admin-item-header">
              <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--admin-text-muted)' }}>ID: #{log.id}</span>
              <span className={`admin-status-pill ${log.status === 'Approved' ? 'approved' : log.status === 'Rejected' ? 'rejected' : 'pending'}`}>
                {log.status}
              </span>
            </div>

            <div className="admin-item-body">
              <h4 className="admin-item-title">{log.name}</h4>
              <p style={{ margin: '2px 0 10px 0', fontSize: 11, color: 'var(--admin-text-muted)' }}>{log.email}</p>
              
              <div className="admin-item-row" style={{ borderTop: '1px solid #f1f5f9', paddingTop: 8 }}>
                <span className="admin-item-label">GSTIN (Tax Registration)</span>
                <span className="admin-item-value">{log.gstin}</span>
              </div>
              <div className="admin-item-row">
                <span className="admin-item-label">FSSAI Food License</span>
                <span className="admin-item-value">{log.fssai}</span>
              </div>
              <div className="admin-item-row">
                <span className="admin-item-label">Bank Account Verification</span>
                <span className="admin-item-value" style={{ color: log.bankStatus === 'Verified' ? '#059669' : '#d97706' }}>{log.bankStatus}</span>
              </div>
            </div>

            <div className="admin-item-actions">
              <button className="admin-btn-sm details" onClick={() => fetchSellerDetail(log.id)}>
                Audit Documents
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* DOCUMENT AUDITING SHEET */}
      {(sellerDetailLoading || sellerDetail) && (
        <SellerDetailModal
          seller={sellerDetail}
          loading={sellerDetailLoading}
          onClose={() => setSellerDetail(null)}
          onRefresh={fetchLogs}
        />
      )}
    </>
  );
};

export default SellerKYCTab;
