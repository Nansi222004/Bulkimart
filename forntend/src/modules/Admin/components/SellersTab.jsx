import React, { useEffect, useState } from 'react';
import { useAdmin } from '../context/AdminContext';
import { SellerDetailModal } from './SellerDetailModal';

/** Backend statuses are lowercase; the filter dropdown uses Title Case labels. */
const STATUS_OPTIONS = [
  { value: 'all', label: 'All Statuses' },
  { value: 'pending', label: 'Pending Review' },
  { value: 'under_review', label: 'Under Review' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'suspended', label: 'Suspended' },
  { value: 'incomplete', label: 'Incomplete' },
];

const prettyStatus = (s) => (s || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');

const Row = ({ label, value, mono }) => (
  <div className="admin-item-row">
    <span className="admin-item-label">{label}</span>
    <span className="admin-item-value" style={mono ? { fontFamily: 'monospace' } : undefined}>
      {value || '—'}
    </span>
  </div>
);

const Section = ({ title, children }) => (
  <div style={{ backgroundColor: 'var(--admin-bg-sidebar)', padding: 12, borderRadius: 10, border: '1px solid var(--admin-border-color)' }}>
    <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--admin-text-secondary)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>
      {title}
    </div>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>{children}</div>
  </div>
);

/** Renders an uploaded KYC/bank/legal file. Images preview inline; PDFs get a link. */
const DocumentCard = ({ doc }) => {
  const isPdf = /\.pdf($|\?)/i.test(doc.url);
  return (
    <div style={{ border: '1px solid var(--admin-border-color)', borderRadius: 8, overflow: 'hidden', background: 'var(--admin-bg-card, #1e293b)' }}>
      <div style={{ padding: '6px 8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 10, fontWeight: 800 }}>{doc.label}</span>
        <span style={{ fontSize: 9, opacity: 0.7 }}>{doc.category}</span>
      </div>
      {isPdf ? (
        <div style={{ padding: 16, textAlign: 'center', fontSize: 11 }}>📄 PDF document</div>
      ) : (
        <img
          src={doc.url}
          alt={doc.label}
          style={{ width: '100%', height: 120, objectFit: 'cover', display: 'block', background: '#0f172a' }}
          onError={(e) => { e.currentTarget.style.display = 'none'; }}
        />
      )}
      <a
        href={doc.url}
        target="_blank"
        rel="noopener noreferrer"
        style={{ display: 'block', textAlign: 'center', padding: '6px 0', fontSize: 10, fontWeight: 800, color: 'var(--admin-primary)', textDecoration: 'none', borderTop: '1px solid var(--admin-border-color)' }}
      >
        Open full size ↗
      </a>
    </div>
  );
};

export const SellersTab = ({ defaultStatusFilter = 'all' }) => {
  const {
    sellers, sellersLoading, sellersError,
    sellerDetail, sellerDetailLoading, fetchSellerDetail, setSellerDetail,
    fetchSellers, fetchSellerCounts,
    sellerStatusFilter, setSellerStatusFilter,
    approveSeller, rejectSeller, suspendSeller, setSellerRadius,
    searchQuery, setSearchQuery,
  } = useAdmin();

  // The sidebar passes the status for the tab that was clicked
  // (Pending Approval / Approved Vendors / …).
  useEffect(() => {
    setSellerStatusFilter(defaultStatusFilter);
  }, [defaultStatusFilter, setSellerStatusFilter]);

  // Debounced refetch whenever the tab or the search box changes.
  useEffect(() => {
    const t = setTimeout(() => {
      fetchSellers(sellerStatusFilter, searchQuery);
      fetchSellerCounts();
    }, searchQuery ? 300 : 0);
    return () => clearTimeout(t);
  }, [sellerStatusFilter, searchQuery, fetchSellers, fetchSellerCounts]);

  const d = sellerDetail;

  const [radiusInput, setRadiusInput] = useState('');
  useEffect(() => {
    setRadiusInput(d?.serviceRadiusKm !== undefined && d?.serviceRadiusKm !== null ? String(d.serviceRadiusKm) : '');
  }, [d?._id, d?.serviceRadiusKm]);

  return (
    <>
      {/* Action Row */}
      <div className="admin-action-row">
        <div className="admin-search-wrapper">
          <input
            type="text"
            className="admin-search-input"
            placeholder="Search by business name, store or city..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <select
          className="admin-filter-select"
          value={sellerStatusFilter}
          onChange={(e) => setSellerStatusFilter(e.target.value)}
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      {/* Sellers List */}
      <div className="admin-list-container">
        {sellersLoading && (
          <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--admin-text-muted)' }}>
            Loading vendors…
          </div>
        )}

        {!sellersLoading && sellersError && (
          <div style={{ textAlign: 'center', padding: '32px 16px', color: 'var(--admin-danger, #ef4444)' }}>
            <div style={{ fontWeight: 800, marginBottom: 6 }}>Could not load vendors</div>
            <div style={{ fontSize: 12, opacity: 0.8 }}>{sellersError}</div>
            <button
              className="admin-btn-sm details"
              style={{ marginTop: 12 }}
              onClick={() => fetchSellers(sellerStatusFilter, searchQuery)}
            >
              Retry
            </button>
          </div>
        )}

        {!sellersLoading && !sellersError && sellers.length === 0 && (
          <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--admin-text-muted)' }}>
            No vendors found matching the selected filter criteria.
          </div>
        )}

        {!sellersLoading && !sellersError && sellers.map((seller) => (
            <div
              key={seller._id}
              className="admin-item-card"
            >
              <div className="admin-item-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <h3 className="admin-item-title" style={{ margin: 0 }}>{seller.storeName || seller.businessName}</h3>
                </div>
                <span className={`admin-status-pill ${seller.status}`}>{prettyStatus(seller.status)}</span>
              </div>

              <div className="admin-item-body">
                <Row label="Business Name" value={seller.businessName} />
                <Row label="Owner" value={seller.holderName} />
                <Row label="Login Phone" value={seller.phone} mono />
                <Row label="Location" value={[seller.city, seller.state].filter(Boolean).join(', ')} />
                <Row label="Channels" value={(seller.salesChannels || ['ecommerce']).map((channel) => channel === 'grocery' ? 'Quick Commerce' : channel === 'ecommerce' ? 'E-Commerce' : channel === 'wholesale' ? 'Wholesale' : channel).join(' · ')} />
                {['pending', 'approved', 'rejected', 'suspended'].includes(seller.wholesaleChannel?.status) && (
                  <Row label="Wholesale Request" value={prettyStatus(seller.wholesaleChannel.status)} />
                )}
                <Row label="Submitted" value={fmtDate(seller.submittedAt)} />
                {seller.status === 'rejected' && seller.rejectionReason && (
                  <Row label="Reason" value={seller.rejectionReason} />
                )}
              </div>

              <div className="admin-item-actions">
                {(seller.status === 'pending' || seller.status === 'under_review') && (
                  <>
                    <button className="admin-btn-sm approve" onClick={() => approveSeller(seller._id)}>Approve</button>
                    <button className="admin-btn-sm reject" onClick={() => rejectSeller(seller._id)}>Reject</button>
                  </>
                )}
                {seller.status === 'approved' && (
                  <button className="admin-btn-sm reject" onClick={() => suspendSeller(seller._id)}>Suspend</button>
                )}
                <button className="admin-btn-sm details" onClick={() => fetchSellerDetail(seller._id)}>View Dossier</button>
              </div>
            </div>
          ))}
      </div>

      {/* ================= FULL REGISTRATION DOSSIER ================= */}
      {(sellerDetailLoading || d) && (
        <SellerDetailModal
          seller={d}
          loading={sellerDetailLoading}
          onClose={() => setSellerDetail(null)}
          onRefresh={() => fetchSellers(sellerStatusFilter, searchQuery)}
        />
      )}
    </>
  );
};

export default SellersTab;
