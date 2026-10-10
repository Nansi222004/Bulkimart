import React, { useEffect, useState } from 'react';
import { useAdmin } from '../context/AdminContext';

/**
 * Admin Subscriptions — read-only monitoring (List + Details only).
 * No admin write/mutate actions here: pause/resume/cancel/accept/decline
 * remain seller/customer-only operations, unchanged elsewhere.
 * Backed by GET /api/admin/subscriptions and GET /api/admin/subscriptions/:id.
 */

const STATUS_OPTIONS = [
  { value: 'all', label: 'All Statuses' },
  { value: 'pending_seller_acceptance', label: 'Pending Acceptance' },
  { value: 'active', label: 'Active' },
  { value: 'paused', label: 'Paused' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'expired', label: 'Expired' },
];

const DELIVERY_ROW_LABEL = {
  scheduled: 'Scheduled',
  packed: 'Packed',
  delivered: 'Delivered',
  skipped: 'Skipped',
  // A past-dated entry nobody ever packed/delivered/skipped — swept to
  // FAILED by subscriptionPrepSweeper.service.js::sweepMissedDeliveriesOnce.
  // Shown to admin as "Missed", not "Failed" — nothing was attempted and
  // failed; the window simply passed with no action.
  failed: 'Missed',
};

const STATUS_PILL_CLASS = {
  pending_seller_acceptance: 'pending',
  active: 'approved',
  paused: 'under-review',
  cancelled: 'rejected',
  expired: 'rejected',
};

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

export const SubscriptionsTab = () => {
  const {
    subscriptions, subscriptionsLoading, subscriptionsError, fetchSubscriptions,
    selectedSubscription, subscriptionDetailLoading, fetchSubscriptionById, setSelectedSubscription,
  } = useAdmin();

  const [statusFilter, setStatusFilter] = useState('all');

  useEffect(() => {
    fetchSubscriptions(statusFilter);
  }, [statusFilter, fetchSubscriptions]);

  const d = selectedSubscription;

  return (
    <>
      <div className="admin-action-row">
        <select
          className="admin-filter-select"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      <div className="admin-list-container">
        {subscriptionsLoading && (
          <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--admin-text-muted)' }}>
            Loading subscriptions…
          </div>
        )}

        {!subscriptionsLoading && subscriptionsError && (
          <div style={{ textAlign: 'center', padding: '32px 16px', color: 'var(--admin-danger, #ef4444)' }}>
            <div style={{ fontWeight: 800, marginBottom: 6 }}>Could not load subscriptions</div>
            <div style={{ fontSize: 12, opacity: 0.8 }}>{subscriptionsError}</div>
            <button
              className="admin-btn-sm details"
              style={{ marginTop: 12 }}
              onClick={() => fetchSubscriptions(statusFilter)}
            >
              Retry
            </button>
          </div>
        )}

        {!subscriptionsLoading && !subscriptionsError && subscriptions.length === 0 && (
          <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--admin-text-muted)' }}>
            No subscriptions found for this filter.
          </div>
        )}

        {!subscriptionsLoading && !subscriptionsError && subscriptions.map((sub) => {
          const itemCount = (sub.customItems || []).length;
          return (
            <div key={sub._id} className="admin-item-card">
              <div className="admin-item-header">
                <h3 className="admin-item-title">{sub.userId?.name || 'Customer'} · {sub.sellerId?.businessName || 'Seller'}</h3>
                <span className={`admin-status-pill ${STATUS_PILL_CLASS[sub.status] || 'pending'}`}>{prettyStatus(sub.status)}</span>
              </div>

              <div className="admin-item-body">
                <Row label="Frequency" value={prettyStatus(sub.frequency)} />
                <Row label="Time Slot" value={sub.timeSlot} />
                <Row label="Items" value={`${itemCount} item${itemCount === 1 ? '' : 's'}`} />
                <Row label="Next Delivery" value={fmtDate(sub.nextDeliveryDate)} />
                <Row label="Progress" value={`${sub.progress?.completed || 0} delivered / ${sub.progress?.remaining || 0} remaining / ${sub.progress?.total || 0} total`} />
                <Row label="Customer Phone" value={sub.userId?.phone} mono />
              </div>

              <div className="admin-item-actions">
                <button className="admin-btn-sm details" onClick={() => fetchSubscriptionById(sub._id)}>View Details</button>
              </div>
            </div>
          );
        })}
      </div>

      {(subscriptionDetailLoading || d) && (
        <div className="admin-modal-overlay">
          <div className="admin-modal-sheet">
            <div className="admin-modal-header">
              <h3 className="admin-modal-title">Subscription Details</h3>
              <button className="admin-modal-close" onClick={() => setSelectedSubscription(null)}>✕</button>
            </div>

            {subscriptionDetailLoading && (
              <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--admin-text-muted)' }}>
                Loading subscription…
              </div>
            )}

            {d && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div className="admin-item-header" style={{ paddingBottom: 8 }}>
                  <h3 className="admin-item-title">{d.userId?.name || 'Customer'}</h3>
                  <span className={`admin-status-pill ${STATUS_PILL_CLASS[d.status] || 'pending'}`}>{prettyStatus(d.status)}</span>
                </div>

                <Section title="Customer & Seller">
                  <Row label="Customer" value={d.userId?.name} />
                  <Row label="Customer Phone" value={d.userId?.phone} mono />
                  <Row label="Seller" value={d.sellerId?.businessName || d.sellerId?.storeDetails?.name} />
                </Section>

                <Section title="Schedule">
                  <Row label="Frequency" value={prettyStatus(d.frequency)} />
                  <Row label="Delivery Day" value={d.deliveryDay} />
                  <Row label="Time Slot" value={d.timeSlot} />
                  <Row label="Start Date" value={fmtDate(d.startDate)} />
                  <Row label="Next Delivery" value={fmtDate(d.nextDeliveryDate)} />
                  <Row label="Deliveries" value={`${d.progress?.completed || 0} delivered / ${d.progress?.remaining || 0} remaining / ${d.progress?.total || 0} total`} />
                </Section>

                <Section title="Pricing">
                  <Row label="Final Amount" value={d.pricing?.finalAmount != null ? `₹${d.pricing.finalAmount}` : '—'} />
                  <Row label="Per Delivery Amount" value={d.pricing?.perDeliveryAmount != null ? `₹${d.pricing.perDeliveryAmount}` : '—'} />
                </Section>

                <Section title={`Products (${(d.customItems || []).length})`}>
                  {(d.customItems || []).length ? (
                    (d.customItems || []).map((item, idx) => (
                      <Row key={idx} label={item.productId?.name || 'Item'} value={`× ${item.qty}`} />
                    ))
                  ) : (
                    <div style={{ fontSize: 11, opacity: 0.7 }}>No items.</div>
                  )}
                </Section>

                <Section title={`Delivery History (${(d.deliverySchedule || []).length})`}>
                  {(d.deliverySchedule || []).length ? (
                    (d.deliverySchedule || []).map((row) => (
                      <div key={row._id} className="admin-item-row">
                        <span className="admin-item-label">{fmtDate(row.date)}{d.timeSlot ? ` · ${d.timeSlot}` : ''}</span>
                        <span
                          className="admin-item-value"
                          style={{
                            color: row.status === 'delivered' ? '#166534'
                              : row.status === 'failed' ? '#b91c1c'
                              : row.status === 'skipped' ? '#94a3b8'
                              : 'var(--admin-primary)',
                            fontWeight: 700,
                          }}
                        >
                          {DELIVERY_ROW_LABEL[row.status] || row.status}
                          {row.orderId ? ` · Order ${String(row.orderId).slice(-6)}` : ''}
                        </span>
                      </div>
                    ))
                  ) : (
                    <div style={{ fontSize: 11, opacity: 0.7 }}>No delivery rows yet.</div>
                  )}
                </Section>

                <Section title="Delivery Address">
                  <div style={{ fontSize: 11, color: 'var(--admin-text-secondary)', lineHeight: 1.6 }}>
                    {d.shippingAddress?.name}
                    {d.shippingAddress?.phone ? ` · ${d.shippingAddress.phone}` : ''}
                    <br />
                    {d.shippingAddress?.line1}
                    <br />
                    {d.shippingAddress?.city}
                    {d.shippingAddress?.state ? `, ${d.shippingAddress.state}` : ''}
                    {d.shippingAddress?.pincode ? ` — ${d.shippingAddress.pincode}` : ''}
                  </div>
                </Section>

                <div className="admin-item-actions" style={{ marginTop: 4 }}>
                  <button className="admin-btn-sm details" onClick={() => setSelectedSubscription(null)}>Close</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
};

export default SubscriptionsTab;
