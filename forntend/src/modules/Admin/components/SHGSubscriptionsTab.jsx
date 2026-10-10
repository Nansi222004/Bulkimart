import React, { useEffect, useState } from 'react';
import { useAdmin } from '../context/AdminContext';

/**
 * Admin view of the SHG seller business-subscription system:
 * the plan catalog (editable) plus the purchased subscription records
 * (read-only monitoring).
 *
 * Editing a plan's price/duration only changes what FUTURE purchases cost —
 * every already-purchased subscription carries its own snapshot server-side
 * and is never rewritten.
 */

const STATUS_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'expiring', label: 'Expiring (7 days)' },
  { value: 'expired', label: 'Expired' },
  { value: 'payment_pending', label: 'Payment Pending' },
];

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');

const Row = ({ label, value, mono }) => (
  <div className="admin-item-row">
    <span className="admin-item-label">{label}</span>
    <span className="admin-item-value" style={mono ? { fontFamily: 'monospace' } : undefined}>{value || '—'}</span>
  </div>
);

const PlanEditor = ({ plan, onSave }) => {
  const [price, setPrice] = useState(plan.price);
  const [durationMonths, setDurationMonths] = useState(plan.durationMonths);
  const dirty = Number(price) !== plan.price || Number(durationMonths) !== plan.durationMonths;

  return (
    <div className="admin-item-card">
      <div className="admin-item-header">
        <h3 className="admin-item-title">{plan.name}</h3>
        <span className={`admin-status-pill ${plan.isActive ? 'approved' : 'rejected'}`}>
          {plan.isActive ? 'Active' : 'Disabled'}
        </span>
      </div>

      <div className="admin-item-body">
        <div className="admin-item-row">
          <span className="admin-item-label">Price (₹)</span>
          <input
            type="number"
            className="admin-search-input"
            style={{ maxWidth: 120 }}
            value={price}
            onChange={(e) => setPrice(e.target.value)}
          />
        </div>
        <div className="admin-item-row">
          <span className="admin-item-label">Duration (months)</span>
          <input
            type="number"
            className="admin-search-input"
            style={{ maxWidth: 120 }}
            value={durationMonths}
            onChange={(e) => setDurationMonths(e.target.value)}
          />
        </div>
      </div>

      <div className="admin-item-actions">
        <button
          className="admin-btn-sm approve"
          disabled={!dirty}
          style={{ opacity: dirty ? 1 : 0.5 }}
          onClick={() => onSave(plan._id, { price: Number(price), durationMonths: Number(durationMonths) })}
        >
          Save changes
        </button>
        <button
          className={`admin-btn-sm ${plan.isActive ? 'reject' : 'approve'}`}
          onClick={() => onSave(plan._id, { isActive: !plan.isActive })}
        >
          {plan.isActive ? 'Disable' : 'Enable'}
        </button>
      </div>
    </div>
  );
};

export const SHGSubscriptionsTab = () => {
  const {
    shgPlans, fetchShgPlans, updateShgPlan,
    shgSubscriptions, shgSubscriptionsLoading, shgSubscriptionsError, fetchShgSubscriptions,
  } = useAdmin();

  const [statusFilter, setStatusFilter] = useState('all');
  const [view, setView] = useState('subscriptions'); // 'subscriptions' | 'plans'

  useEffect(() => { fetchShgPlans(); }, [fetchShgPlans]);
  useEffect(() => { fetchShgSubscriptions(statusFilter); }, [statusFilter, fetchShgSubscriptions]);

  return (
    <>
      <div className="admin-action-row">
        <button
          className={`admin-btn-sm ${view === 'subscriptions' ? 'approve' : 'details'}`}
          onClick={() => setView('subscriptions')}
        >
          Subscriptions
        </button>
        <button
          className={`admin-btn-sm ${view === 'plans' ? 'approve' : 'details'}`}
          onClick={() => setView('plans')}
        >
          Plans ({shgPlans.length})
        </button>

        {view === 'subscriptions' && (
          <select
            className="admin-filter-select"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        )}
      </div>

      <div className="admin-list-container">
        {view === 'plans' && (
          <>
            <div style={{ fontSize: 11, opacity: 0.7, marginBottom: 12, lineHeight: 1.5 }}>
              Changing a price or duration only affects new purchases. Sellers who
              already bought a plan keep the price and end date they paid for.
            </div>
            {shgPlans.map((plan) => (
              <PlanEditor key={plan._id} plan={plan} onSave={updateShgPlan} />
            ))}
          </>
        )}

        {view === 'subscriptions' && (
          <>
            {shgSubscriptionsLoading && (
              <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--admin-text-muted)' }}>
                Loading subscriptions…
              </div>
            )}

            {!shgSubscriptionsLoading && shgSubscriptionsError && (
              <div style={{ textAlign: 'center', padding: '32px 16px', color: 'var(--admin-danger, #ef4444)' }}>
                <div style={{ fontWeight: 800, marginBottom: 6 }}>Could not load subscriptions</div>
                <div style={{ fontSize: 12, opacity: 0.8 }}>{shgSubscriptionsError}</div>
                <button className="admin-btn-sm details" style={{ marginTop: 12 }} onClick={() => fetchShgSubscriptions(statusFilter)}>
                  Retry
                </button>
              </div>
            )}

            {!shgSubscriptionsLoading && !shgSubscriptionsError && shgSubscriptions.length === 0 && (
              <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--admin-text-muted)' }}>
                No SHG subscriptions in this list.
              </div>
            )}

            {!shgSubscriptionsLoading && !shgSubscriptionsError && shgSubscriptions.map((sub) => {
              const expired = sub.status === 'expired' || (sub.endDate && new Date(sub.endDate) < new Date());
              const pill = sub.status === 'payment_pending' ? 'pending' : expired ? 'rejected' : 'approved';
              const label = sub.status === 'payment_pending' ? 'Payment Pending' : expired ? 'Expired' : 'Active';
              return (
                <div key={sub._id} className="admin-item-card">
                  <div className="admin-item-header">
                    <h3 className="admin-item-title">{sub.shgStoreId?.groupName || 'SHG Store'}</h3>
                    <span className={`admin-status-pill ${pill}`}>{label}</span>
                  </div>

                  <div className="admin-item-body">
                    <Row label="Plan" value={sub.planName} />
                    <Row label="Duration" value={sub.durationMonths ? `${sub.durationMonths} months` : '—'} />
                    <Row label="Amount Paid" value={sub.amount != null ? `₹${sub.amount.toLocaleString('en-IN')}` : '—'} />
                    <Row label="Start Date" value={fmtDate(sub.startDate)} />
                    <Row label="End Date" value={fmtDate(sub.endDate)} />
                    <Row label="Location" value={[sub.shgStoreId?.district, sub.shgStoreId?.state].filter(Boolean).join(', ')} />
                    <Row label="Payment Status" value={sub.paymentId?.status} />
                    <Row label="Payment Ref" value={sub.paymentId?.gateway?.merchantOrderId} mono />
                  </div>
                </div>
              );
            })}
          </>
        )}
      </div>
    </>
  );
};

export default SHGSubscriptionsTab;
