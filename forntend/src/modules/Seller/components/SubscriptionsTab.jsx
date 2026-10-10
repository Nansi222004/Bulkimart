import React, { useEffect, useState } from 'react';
import { useSeller } from '../context/SellerContext';
import { EmptyState } from './EmptyState';

/**
 * Subscriptions — live from GET /api/subscriptions/seller.
 *
 * Same shape as OrdersTab: a status filter row, a card list, a details
 * modal — nothing here invents a new visual language for the Seller
 * module. The one thing genuinely different from an order is that a
 * subscription has its own multi-delivery calendar (`deliverySchedule`),
 * so the details modal has a fourth section — history — that OrdersTab
 * doesn't need.
 *
 * "Active"/"Upcoming"/"Completed" are display-only groupings computed here
 * from the real `status` + `progress` fields — not new backend statuses.
 * The backend enum stays exactly `pending_seller_acceptance | active |
 * paused | cancelled | expired`.
 */

const groupOf = (sub) => {
  if (sub.status === 'pending_seller_acceptance') return 'pending';
  if (sub.status === 'paused') return 'paused';
  if (sub.status === 'cancelled') return 'cancelled';
  if (sub.status === 'expired') return 'completed';
  // status === 'active'
  return (sub.progress?.completed || 0) > 0 ? 'active' : 'upcoming';
};

const TABS = [
  { label: 'All', value: 'all' },
  { label: 'Pending', value: 'pending' },
  { label: 'Upcoming', value: 'upcoming' },
  { label: 'Active', value: 'active' },
  { label: 'Paused', value: 'paused' },
  { label: 'Completed', value: 'completed' },
  { label: 'Cancelled', value: 'cancelled' },
];

const PILL = {
  pending: { bg: '#fef3c7', fg: '#92400e' },
  upcoming: { bg: '#dbeafe', fg: '#1e40af' },
  active: { bg: '#dcfce7', fg: '#166534' },
  paused: { bg: '#f1f5f9', fg: '#475569' },
  completed: { bg: '#ede9fe', fg: '#6d28d9' },
  cancelled: { bg: '#fee2e2', fg: '#b91c1c' },
};

const LABEL = {
  pending: 'Pending acceptance',
  upcoming: 'Upcoming',
  active: 'Active',
  paused: 'Paused',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

const DELIVERY_ROW_LABEL = {
  scheduled: 'Scheduled',
  packed: 'Packed',
  delivered: 'Delivered',
  skipped: 'Skipped',
  failed: 'Failed',
};

const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

export const SubscriptionsTab = () => {
  const { sellerSubscriptions, sellerSubscriptionsLoading, sellerSubscriptionsError, fetchSellerSubscriptions } = useSeller();
  const [tab, setTab] = useState('all');
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    fetchSellerSubscriptions();
  }, [fetchSellerSubscriptions]);

  const shown = tab === 'all'
    ? (sellerSubscriptions || [])
    : (sellerSubscriptions || []).filter((s) => groupOf(s) === tab);

  return (
    <>
      <div className="seller-scroll-tabs">
        {TABS.map((t) => (
          <button
            key={t.value}
            className={`seller-tab-btn ${tab === t.value ? 'active' : ''}`}
            onClick={() => setTab(t.value)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="orders-tab-list">
        {sellerSubscriptionsLoading ? (
          <div style={{ padding: '40px 16px', textAlign: 'center', color: '#64748b', fontSize: 12 }}>
            Loading your subscriptions…
          </div>
        ) : sellerSubscriptionsError ? (
          <div style={{ padding: '40px 16px', textAlign: 'center' }}>
            <div style={{ fontSize: 12, color: '#b91c1c', fontWeight: 700, marginBottom: 10 }}>{sellerSubscriptionsError}</div>
            <button className="seller-tab-btn" onClick={() => fetchSellerSubscriptions()}>Try again</button>
          </div>
        ) : shown.length === 0 ? (
          <EmptyState
            icon="🔁"
            title={tab === 'all' ? 'No subscriptions yet' : 'Nothing in this stage'}
            message={
              tab === 'all'
                ? 'Recurring subscription orders from customers will appear here.'
                : 'No subscriptions are currently in this stage.'
            }
          />
        ) : (
          shown.map((sub) => {
            const group = groupOf(sub);
            const pill = PILL[group];
            const itemCount = (sub.customItems || []).length;
            return (
              <div key={sub._id} className="order-fulfillment-card">
                <div className="order-f-header">
                  <span className="order-f-id">
                    {sub.userId?.name || 'Customer'} · {sub.frequency}
                  </span>
                  <span className="order-f-status-pill" style={{ backgroundColor: pill.bg, color: pill.fg }}>
                    {LABEL[group]}
                  </span>
                </div>

                <div className="order-f-body">
                  <div className="order-f-customer">
                    <h4>{itemCount} item{itemCount === 1 ? '' : 's'} · {sub.timeSlot || 'No time slot'}</h4>
                    <p>
                      Next delivery: {sub.nextDeliveryDate ? fmtDate(sub.nextDeliveryDate) : '—'}
                      {' · '}{sub.progress?.completed || 0} delivered, {sub.progress?.remaining || 0} remaining
                    </p>
                  </div>
                </div>

                <div className="order-f-actions">
                  <button className="order-action-btn-sm details" onClick={() => setSelected(sub)}>
                    Details
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {selected && (
        <div className="seller-modal-overlay">
          <div className="seller-modal-sheet" style={{ maxHeight: '90%' }}>
            <div className="modal-sheet-header">
              <h3 className="modal-sheet-title">{selected.userId?.name || 'Customer'}'s subscription</h3>
              <button className="modal-close-btn" onClick={() => setSelected(null)}>✕</button>
            </div>

            <div className="review-summary-card">
              <div className="review-item-row">
                <span className="review-item-key">Status</span>
                <span className="review-item-val" style={{ color: 'var(--primary)' }}>{LABEL[groupOf(selected)]}</span>
              </div>
              <div className="review-item-row">
                <span className="review-item-key">Frequency</span>
                <span className="review-item-val" style={{ textTransform: 'capitalize' }}>
                  {selected.frequency}{selected.deliveryDay ? ` · ${selected.deliveryDay}` : ''}
                </span>
              </div>
              <div className="review-item-row">
                <span className="review-item-key">Time slot</span>
                <span className="review-item-val">{selected.timeSlot || '—'}</span>
              </div>
              <div className="review-item-row">
                <span className="review-item-key">Start date</span>
                <span className="review-item-val">{fmtDate(selected.startDate)}</span>
              </div>
              <div className="review-item-row">
                <span className="review-item-key">Next delivery</span>
                <span className="review-item-val">{fmtDate(selected.nextDeliveryDate)}</span>
              </div>
              <div className="review-item-row">
                <span className="review-item-key">Deliveries</span>
                <span className="review-item-val">
                  {selected.progress?.completed || 0} delivered / {selected.progress?.remaining || 0} remaining / {selected.progress?.total || 0} total
                </span>
              </div>
            </div>

            <div className="review-summary-card">
              <h4 className="review-card-title" style={{ marginBottom: 8 }}>Products</h4>
              {(selected.customItems || []).map((item, idx) => (
                <div key={idx} className="review-item-row">
                  <span className="review-item-key">{item.productId?.name || 'Item'} × {item.qty}</span>
                </div>
              ))}
            </div>

            <div className="review-summary-card">
              <h4 className="review-card-title" style={{ marginBottom: 8 }}>Delivery history</h4>
              {(selected.deliverySchedule || []).map((row) => (
                <div key={row._id} className="review-item-row">
                  <span className="review-item-key">
                    {fmtDate(row.date)}{selected.timeSlot ? ` · ${selected.timeSlot}` : ''}
                  </span>
                  <span
                    className="review-item-val"
                    style={{
                      color: row.status === 'delivered' ? '#166534'
                        : row.status === 'failed' ? '#b91c1c'
                        : row.status === 'skipped' ? '#94a3b8'
                        : 'var(--primary)',
                      fontWeight: 700,
                    }}
                  >
                    {DELIVERY_ROW_LABEL[row.status] || row.status}
                    {row.orderId ? ` · Order ${String(row.orderId).slice(-6)}` : ''}
                  </span>
                </div>
              ))}
            </div>

            <div className="review-summary-card">
              <h4 className="review-card-title" style={{ marginBottom: 8 }}>Delivery Address</h4>
              <span className="review-item-val" style={{ display: 'block', fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                {selected.shippingAddress?.name}
                {selected.shippingAddress?.phone ? ` · ${selected.shippingAddress.phone}` : ''}
                <br />
                {selected.shippingAddress?.line1}
                <br />
                {selected.shippingAddress?.city}
                {selected.shippingAddress?.state ? `, ${selected.shippingAddress.state}` : ''}
                {selected.shippingAddress?.pincode ? ` — ${selected.shippingAddress.pincode}` : ''}
              </span>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default SubscriptionsTab;
