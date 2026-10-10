import React, { useEffect, useState } from 'react';
import { useSHG } from '../context/SHGContext';

/**
 * Customer grocery subscriptions this SHG group fulfils — live from
 * GET /api/subscriptions/shg.
 *
 * The Seller module's SubscriptionsTab is the same screen for a Seller;
 * this is its SHG-styled counterpart (shg-* classes, same as every other
 * tab in this panel) reading the SHG-scoped endpoint. The accept/decline
 * ring and the pack checklist are genuinely shared components — only the
 * list view differs, because each panel loads its own vendor's plans.
 *
 * Not to be confused with the group's OWN platform subscription (the paid
 * plan that unlocks listing products) — that lives in SubscriptionBanner.
 */

const groupOf = (sub) => {
  if (sub.status === 'pending_seller_acceptance') return 'pending';
  if (sub.status === 'paused') return 'paused';
  if (sub.status === 'cancelled') return 'cancelled';
  if (sub.status === 'expired') return 'completed';
  return (sub.progress?.completed || 0) > 0 ? 'active' : 'upcoming';
};

const TABS = ['All', 'Pending', 'Upcoming', 'Active', 'Paused', 'Completed', 'Cancelled'];

const BADGE_CLASS = {
  pending: 'pending',
  upcoming: 'active',
  active: 'active',
  paused: 'pending',
  completed: 'active',
  cancelled: 'rejected',
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

const SHGSubscriptionsTab = () => {
  const {
    shgSubscriptions,
    shgSubscriptionsLoading,
    shgSubscriptionsError,
    fetchShgSubscriptions,
  } = useSHG();

  const [tab, setTab] = useState('All');
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    fetchShgSubscriptions();
  }, [fetchShgSubscriptions]);

  const shown = tab === 'All'
    ? (shgSubscriptions || [])
    : (shgSubscriptions || []).filter((s) => groupOf(s) === tab.toLowerCase());

  return (
    <div className="shg-tab-content" style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
      <div className="shg-tab-row" style={{ borderTop: 'none' }}>
        {TABS.map((t) => (
          <button
            key={t}
            className={`shg-filter-tab ${tab === t ? 'active' : ''}`}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 18px 32px' }}>
        <div className="shg-card">
          {shgSubscriptionsLoading ? (
            <div className="shg-empty-state">
              <p className="shg-empty-text">Loading subscriptions…</p>
            </div>
          ) : shgSubscriptionsError ? (
            <div className="shg-empty-state">
              <div className="shg-empty-icon">⚠️</div>
              <p className="shg-empty-text">{shgSubscriptionsError}</p>
              <button className="shg-filter-tab" onClick={() => fetchShgSubscriptions()} style={{ marginTop: 10 }}>
                Try again
              </button>
            </div>
          ) : shown.length === 0 ? (
            <div className="shg-empty-state">
              <div className="shg-empty-icon">🔁</div>
              <p className="shg-empty-text">
                {tab === 'All'
                  ? 'No customer subscriptions yet. Recurring plans bought from your Quick Commerce listings appear here.'
                  : 'No subscriptions are currently in this stage.'}
              </p>
            </div>
          ) : (
            shown.map((sub) => {
              const group = groupOf(sub);
              const itemCount = (sub.customItems || []).length;
              return (
                <div
                  key={sub._id}
                  className="shg-order-row"
                  onClick={() => setSelected(sub)}
                >
                  <div className="shg-order-id">{String(sub._id).slice(-6).toUpperCase()}</div>

                  <div className="shg-order-meta">
                    <div className="shg-order-customer">{sub.userId?.name || 'Customer'}</div>
                    <div className="shg-order-detail">
                      {itemCount} item{itemCount === 1 ? '' : 's'} · {sub.frequency}
                      {sub.timeSlot ? ` · ${sub.timeSlot}` : ''}
                      {' · '}next {fmtDate(sub.nextDeliveryDate)}
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div className="shg-order-amount">₹{sub.pricing?.finalAmount ?? 0}</div>
                    <span className={`shg-status-badge ${BADGE_CLASS[group]}`}>{LABEL[group]}</span>
                    <span className="menu-chevron" style={{ opacity: 0.4 }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="9 18 15 12 9 6"/></svg>
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {selected && (
        <div className="shg-modal-overlay" onClick={() => setSelected(null)}>
          <div className="shg-modal-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="shg-modal-header">
              <h3 className="shg-modal-title">{selected.userId?.name || 'Customer'}'s subscription</h3>
              <button className="shg-modal-close" onClick={() => setSelected(null)}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, fontSize: 12.5 }}>
              <section>
                <h4 style={{ margin: '0 0 6px', fontSize: 12, fontWeight: 800, color: 'var(--shg-text-muted)', textTransform: 'uppercase' }}>Plan</h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div><strong>Status:</strong> {LABEL[groupOf(selected)]}</div>
                  <div style={{ textTransform: 'capitalize' }}>
                    <strong>Frequency:</strong> {selected.frequency}{selected.deliveryDay ? ` · ${selected.deliveryDay}` : ''}
                  </div>
                  <div><strong>Time slot:</strong> {selected.timeSlot || '—'}</div>
                  <div><strong>Start:</strong> {fmtDate(selected.startDate)}</div>
                  <div><strong>Next delivery:</strong> {fmtDate(selected.nextDeliveryDate)}</div>
                  <div>
                    <strong>Deliveries:</strong> {selected.progress?.completed || 0} delivered ·{' '}
                    {selected.progress?.remaining || 0} remaining · {selected.progress?.total || 0} total
                  </div>
                </div>
              </section>

              <section>
                <h4 style={{ margin: '0 0 6px', fontSize: 12, fontWeight: 800, color: 'var(--shg-text-muted)', textTransform: 'uppercase' }}>Products</h4>
                {(selected.customItems || []).map((item, idx) => (
                  <div key={idx}>{item.productId?.name || 'Item'} × {item.qty}</div>
                ))}
              </section>

              <section>
                <h4 style={{ margin: '0 0 6px', fontSize: 12, fontWeight: 800, color: 'var(--shg-text-muted)', textTransform: 'uppercase' }}>Delivery history</h4>
                {(selected.deliverySchedule || []).map((row) => (
                  <div key={row._id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                    <span>{fmtDate(row.date)}{selected.timeSlot ? ` · ${selected.timeSlot}` : ''}</span>
                    <span style={{
                      fontWeight: 700,
                      color: row.status === 'delivered' ? '#166534'
                        : row.status === 'failed' ? '#b91c1c'
                        : row.status === 'skipped' ? '#94a3b8'
                        : 'var(--shg-primary, #16a34a)',
                    }}>
                      {DELIVERY_ROW_LABEL[row.status] || row.status}
                      {row.orderId ? ` · Order ${String(row.orderId).slice(-6)}` : ''}
                    </span>
                  </div>
                ))}
              </section>

              <section>
                <h4 style={{ margin: '0 0 6px', fontSize: 12, fontWeight: 800, color: 'var(--shg-text-muted)', textTransform: 'uppercase' }}>Delivery address</h4>
                <span style={{ lineHeight: 1.6, color: 'var(--shg-text-secondary)' }}>
                  {selected.shippingAddress?.name}
                  {selected.shippingAddress?.phone ? ` · ${selected.shippingAddress.phone}` : ''}
                  <br />
                  {selected.shippingAddress?.line1}
                  <br />
                  {selected.shippingAddress?.city}
                  {selected.shippingAddress?.state ? `, ${selected.shippingAddress.state}` : ''}
                  {selected.shippingAddress?.pincode ? ` — ${selected.shippingAddress.pincode}` : ''}
                </span>
              </section>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SHGSubscriptionsTab;
