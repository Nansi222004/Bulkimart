import React, { useEffect, useState } from 'react';
import { useAdmin } from '../context/AdminContext';

/**
 * Customer Premium Membership plan catalog.
 *
 * Premium Membership is what lets a customer create Product Subscriptions;
 * the subscriptions themselves are managed under Product Subscriptions.
 *
 * A plan card is READ-ONLY until Edit is pressed. It used to render live
 * inputs on every card, so a stray keystroke or scroll over a number field
 * silently altered a live price — and nothing marked the card as being mid
 * edit. Editing is now a deliberate mode with an explicit Cancel that puts
 * the original values back.
 */

const money = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;

const PlanCard = ({ plan, onSave }) => {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(plan.name);
  const [price, setPrice] = useState(plan.price);
  const [durationMonths, setDurationMonths] = useState(plan.durationMonths);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const startEdit = () => {
    // Always re-seed from the plan, so a cancelled edit followed by a second
    // one does not resume the abandoned values.
    setName(plan.name);
    setPrice(plan.price);
    setDurationMonths(plan.durationMonths);
    setError('');
    setEditing(true);
  };

  const cancel = () => {
    setEditing(false);
    setError('');
  };

  const dirty = name !== plan.name
    || Number(price) !== plan.price
    || Number(durationMonths) !== plan.durationMonths;

  const submit = async () => {
    // The same rules the server enforces, checked here so a mistake is caught
    // before a round trip rather than coming back as a toast.
    if (!name.trim()) return setError('A plan name is required.');
    if (!Number.isFinite(Number(price)) || Number(price) < 0) return setError('Price cannot be negative.');
    if (!Number.isFinite(Number(durationMonths)) || Number(durationMonths) < 1) {
      return setError('Duration must be at least 1 month.');
    }

    setSaving(true);
    const res = await onSave(plan._id, {
      name: name.trim(), price: Number(price), durationMonths: Number(durationMonths),
    });
    setSaving(false);
    if (res?.ok !== false) setEditing(false);
  };

  const toggleActive = async () => {
    setSaving(true);
    await onSave(plan._id, { isActive: !plan.isActive });
    setSaving(false);
  };

  return (
    <div className="admin-item-card" style={editing ? { borderColor: 'var(--admin-primary)' } : undefined}>
      <div className="admin-item-header">
        <h3 className="admin-item-title">{editing ? 'Editing plan' : plan.name}</h3>
        <span className={`admin-status-pill ${plan.isActive ? 'approved' : 'rejected'}`}>
          {plan.isActive ? 'Active' : 'Disabled'}
        </span>
      </div>

      <div className="admin-item-body">
        {editing ? (
          <>
            <div className="admin-item-row">
              <span className="admin-item-label">Plan name</span>
              <input
                className="admin-search-input"
                style={{ maxWidth: 160 }}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="admin-item-row">
              <span className="admin-item-label">Price (₹)</span>
              <input
                type="number" min="0"
                className="admin-search-input"
                style={{ maxWidth: 120 }}
                value={price}
                onChange={(e) => setPrice(e.target.value)}
              />
            </div>
            <div className="admin-item-row">
              <span className="admin-item-label">Duration (months)</span>
              <input
                type="number" min="1"
                className="admin-search-input"
                style={{ maxWidth: 120 }}
                value={durationMonths}
                onChange={(e) => setDurationMonths(e.target.value)}
              />
            </div>
          </>
        ) : (
          <>
            <div className="admin-item-row">
              <span className="admin-item-label">Price</span>
              <span className="admin-item-value" style={{ fontWeight: 800 }}>{money(plan.price)}</span>
            </div>
            <div className="admin-item-row">
              <span className="admin-item-label">Duration</span>
              <span className="admin-item-value">
                {plan.durationMonths} month{plan.durationMonths === 1 ? '' : 's'}
              </span>
            </div>
            <div className="admin-item-row">
              <span className="admin-item-label">Per month</span>
              <span className="admin-item-value">
                {money(Math.round(plan.price / Math.max(plan.durationMonths, 1)))}
              </span>
            </div>
          </>
        )}
      </div>

      {error && (
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--admin-error)', marginBottom: 8 }}>{error}</div>
      )}

      <div className="admin-item-actions">
        {editing ? (
          <>
            <button
              className="admin-btn-sm approve"
              disabled={!dirty || saving}
              style={{ opacity: dirty && !saving ? 1 : 0.5 }}
              onClick={submit}
            >
              {saving ? 'Saving…' : 'Save changes'}
            </button>
            <button className="admin-btn-sm details" disabled={saving} onClick={cancel}>
              Cancel
            </button>
          </>
        ) : (
          <>
            <button className="admin-btn-sm details" onClick={startEdit}>Edit</button>
            <button
              className={`admin-btn-sm ${plan.isActive ? 'reject' : 'approve'}`}
              disabled={saving}
              onClick={toggleActive}
            >
              {plan.isActive ? 'Disable' : 'Enable'}
            </button>
          </>
        )}
      </div>
    </div>
  );
};

const NewPlanCard = ({ onCreate }) => {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [durationMonths, setDurationMonths] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const reset = () => {
    setName(''); setPrice(''); setDurationMonths(''); setError(''); setOpen(false);
  };

  const submit = async () => {
    if (!name.trim()) return setError('A plan name is required.');
    if (!Number.isFinite(Number(price)) || Number(price) < 0) return setError('Price cannot be negative.');
    if (!Number.isFinite(Number(durationMonths)) || Number(durationMonths) < 1) {
      return setError('Duration must be at least 1 month.');
    }

    setSaving(true);
    const res = await onCreate({
      name: name.trim(), price: Number(price), durationMonths: Number(durationMonths),
      // Created disabled, so a half-considered price is never on sale the
      // instant it is typed. Enable it from the card once it is right.
      isActive: false,
    });
    setSaving(false);
    if (res?.ok !== false) reset();
  };

  if (!open) {
    return (
      <div className="admin-item-card" style={{ borderStyle: 'dashed', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 150 }}>
        <button className="admin-btn-sm approve inline" onClick={() => setOpen(true)}>
          + Create new plan
        </button>
      </div>
    );
  }

  return (
    <div className="admin-item-card" style={{ borderColor: 'var(--admin-primary)' }}>
      <div className="admin-item-header">
        <h3 className="admin-item-title">New plan</h3>
        <span className="admin-status-pill pending">Draft</span>
      </div>

      <div className="admin-item-body">
        <div className="admin-item-row">
          <span className="admin-item-label">Plan name</span>
          <input
            className="admin-search-input"
            style={{ maxWidth: 160 }}
            placeholder="e.g. 3 Months"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="admin-item-row">
          <span className="admin-item-label">Price (₹)</span>
          <input
            type="number" min="0"
            className="admin-search-input"
            style={{ maxWidth: 120 }}
            placeholder="399"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
          />
        </div>
        <div className="admin-item-row">
          <span className="admin-item-label">Duration (months)</span>
          <input
            type="number" min="1"
            className="admin-search-input"
            style={{ maxWidth: 120 }}
            placeholder="3"
            value={durationMonths}
            onChange={(e) => setDurationMonths(e.target.value)}
          />
        </div>
      </div>

      {error && (
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--admin-error)', marginBottom: 8 }}>{error}</div>
      )}

      <div style={{ fontSize: 10.5, color: 'var(--admin-text-muted)', marginBottom: 8, lineHeight: 1.45 }}>
        Created disabled — customers will not see it until you enable it.
      </div>

      <div className="admin-item-actions">
        <button className="admin-btn-sm approve" disabled={saving} onClick={submit}>
          {saving ? 'Creating…' : 'Create plan'}
        </button>
        <button className="admin-btn-sm details" disabled={saving} onClick={reset}>
          Cancel
        </button>
      </div>
    </div>
  );
};

export const PremiumPlansTab = () => {
  const {
    premiumPlans, premiumPlansLoading, premiumPlansError,
    fetchPremiumPlans, updatePremiumPlan, createPremiumPlan,
  } = useAdmin();

  useEffect(() => { fetchPremiumPlans(); }, [fetchPremiumPlans]);

  return (
    <div className="admin-list-container">
      <div style={{ fontSize: 11, opacity: 0.7, marginBottom: 12, lineHeight: 1.5, width: '100%' }}>
        Premium Membership is what lets a customer create Product Subscriptions.
        Changing a price or duration only affects new purchases — customers who
        already bought a membership keep the price and expiry they paid for.
        Disabling a plan hides it from customers immediately; it does not end
        any membership already sold from it.
      </div>

      {premiumPlansLoading && (
        <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--admin-text-muted)', width: '100%' }}>
          Loading plans…
        </div>
      )}

      {!premiumPlansLoading && premiumPlansError && (
        <div style={{ textAlign: 'center', padding: '32px 16px', color: 'var(--admin-error)', width: '100%' }}>
          <div style={{ fontWeight: 800, marginBottom: 6 }}>Could not load plans</div>
          <div style={{ fontSize: 12, opacity: 0.8 }}>{premiumPlansError}</div>
          <button className="admin-btn-sm details inline" style={{ marginTop: 12 }} onClick={() => fetchPremiumPlans()}>
            Retry
          </button>
        </div>
      )}

      {!premiumPlansLoading && !premiumPlansError && (
        <>
          {premiumPlans.map((plan) => (
            <PlanCard key={plan._id} plan={plan} onSave={updatePremiumPlan} />
          ))}
          {/* Always last, so the catalogue reads as a list with an add slot
              at the end rather than a form competing with the plans. */}
          <NewPlanCard onCreate={createPremiumPlan} />
        </>
      )}
    </div>
  );
};

export default PremiumPlansTab;
