import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAdmin } from '../context/AdminContext';
import { adminGet, adminPost, adminPatch, qs } from '../../../utils/adminApi';
import { authPut, authDelete } from '../../../utils/adminApi';

/**
 * Coupon management.
 *
 * A coupon is a code plus the rules that decide whether it applies, how much it
 * is worth, and where. The form mirrors those rules exactly so nothing is
 * configurable here that the server would then ignore.
 */

const DISCOUNT_TYPES = [
  { value: 'percentage', label: 'Percentage off', hint: '% of the eligible items' },
  { value: 'fixed', label: 'Flat amount off', hint: 'a fixed ₹ discount' },
  { value: 'free_shipping', label: 'Free delivery', hint: 'waives the delivery charge' },
];

const CHANNELS = [
  { value: 'all', label: 'Both storefronts' },
  { value: 'ecommerce', label: 'Shop All only' },
  { value: 'grocery', label: 'Quick only' },
];

const BLANK = {
  code: '', title: '', description: '',
  discountType: 'percentage', value: '', maxDiscount: '',
  minOrderValue: '', channel: 'all',
  totalUsageLimit: '', perUserLimit: 1,
  firstOrderOnly: false, cdsMembersOnly: false, isPublic: true,
  startsAt: '', expiresAt: '',
};

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) : '—');

/** Human summary of what a coupon actually gives. */
const rewardLabel = (c) => {
  if (c.discountType === 'free_shipping') return 'Free delivery';
  if (c.discountType === 'percentage') {
    return `${c.value}% off${c.maxDiscount ? ` (max ₹${c.maxDiscount})` : ''}`;
  }
  return `₹${c.value} off`;
};

const Field = ({ label, hint, children }) => (
  <div className="onboarding-form-group" style={{ flex: 1, minWidth: 150 }}>
    <label className="onboarding-label">{label}</label>
    {children}
    {hint && <span style={{ fontSize: 10, opacity: 0.6 }}>{hint}</span>}
  </div>
);

export const CouponsTab = () => {
  const { triggerToast } = useAdmin();

  const [coupons, setCoupons] = useState([]);
  const [meta, setMeta] = useState({ total: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [status, setStatus] = useState('all');
  const [search, setSearch] = useState('');

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);   // coupon _id or null
  const [form, setForm] = useState(BLANK);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const [redemptions, setRedemptions] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data, meta: m } = await adminGet(`/coupons${qs({ status, search, limit: 100 })}`);
      setCoupons(data || []);
      setMeta(m || { total: 0 });
    } catch (err) {
      setError(err.message);
      setCoupons([]);
    } finally {
      setLoading(false);
    }
  }, [status, search]);

  useEffect(() => {
    const t = setTimeout(load, search ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, search]);

  const set = (k) => (e) => {
    const v = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setForm((f) => ({ ...f, [k]: v }));
  };

  const openNew = () => { setEditing(null); setForm(BLANK); setFormError(''); setShowForm(true); };

  const openEdit = (c) => {
    setEditing(c._id);
    setFormError('');
    setForm({
      code: c.code, title: c.title, description: c.description || '',
      discountType: c.discountType,
      value: c.value ?? '', maxDiscount: c.maxDiscount || '',
      minOrderValue: c.minOrderValue || '',
      channel: c.channel || 'all',
      totalUsageLimit: c.totalUsageLimit || '',
      perUserLimit: c.perUserLimit ?? 1,
      firstOrderOnly: !!c.firstOrderOnly,
      cdsMembersOnly: !!c.cdsMembersOnly,
      isPublic: c.isPublic !== false,
      startsAt: c.startsAt ? String(c.startsAt).slice(0, 10) : '',
      expiresAt: c.expiresAt ? String(c.expiresAt).slice(0, 10) : '',
    });
    setShowForm(true);
  };

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setFormError('');

    const payload = {
      ...form,
      value: form.discountType === 'free_shipping' ? 0 : Number(form.value || 0),
      maxDiscount: Number(form.maxDiscount || 0),
      minOrderValue: Number(form.minOrderValue || 0),
      totalUsageLimit: Number(form.totalUsageLimit || 0),
      perUserLimit: Number(form.perUserLimit || 0),
      startsAt: form.startsAt || undefined,
      expiresAt: form.expiresAt || undefined,
    };

    try {
      if (editing) await authPut(`/api/admin/coupons/${editing}`, payload);
      else await adminPost('/coupons', payload);
      triggerToast(editing ? 'Coupon updated' : `Coupon "${payload.code}" created`);
      setShowForm(false);
      await load();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (c) => {
    try {
      const { message } = await adminPatch(`/coupons/${c._id}/toggle`, { isActive: !c.isActive });
      triggerToast(message);
      await load();
    } catch (err) { triggerToast(err.message); }
  };

  const remove = async (c) => {
    if (!window.confirm(`Delete coupon "${c.code}"?`)) return;
    try {
      // A coupon that has been used is deactivated instead of erased — it is
      // part of order history. The server decides which happens.
      const { message } = await authDelete(`/api/admin/coupons/${c._id}`);
      triggerToast(message);
      await load();
    } catch (err) { triggerToast(err.message); }
  };

  const viewUses = async (c) => {
    try {
      const { data, meta: m } = await adminGet(`/coupons/${c._id}/redemptions`);
      setRedemptions({ coupon: c, rows: data || [], meta: m || {} });
    } catch (err) { triggerToast(err.message); }
  };

  const stats = useMemo(() => ({
    total: coupons.length,
    active: coupons.filter((c) => c.isActive && !c.expired).length,
    expired: coupons.filter((c) => c.expired).length,
    uses: coupons.reduce((n, c) => n + (c.usedCount || 0), 0),
  }), [coupons]);

  const isPct = form.discountType === 'percentage';
  const isShip = form.discountType === 'free_shipping';

  return (
    <div style={{ padding: 24 }}>
      {/* ---- summary ---- */}
      <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', marginBottom: 20 }}>
        {[
          ['Coupons', stats.total],
          ['Active now', stats.active],
          ['Expired', stats.expired],
          ['Total redemptions', stats.uses],
        ].map(([k, v]) => (
          <div key={k} style={{ background: 'var(--admin-bg-card,#fff)', border: '1px solid var(--admin-border-color)', borderRadius: 10, padding: '12px 14px' }}>
            <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, opacity: 0.65 }}>{k}</div>
            <div style={{ fontSize: 22, fontWeight: 800, marginTop: 2 }}>{v}</div>
          </div>
        ))}
      </div>

      {/* ---- toolbar ---- */}
      <div className="admin-action-row">
        <div className="admin-search-wrapper">
          <input
            className="admin-search-input"
            placeholder="Search by code or title..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select className="admin-filter-select" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="all">All coupons</option>
          <option value="active">Active</option>
          <option value="inactive">Deactivated</option>
          <option value="expired">Expired</option>
        </select>
        <button className="admin-btn-sm approve" onClick={openNew}>+ New Coupon</button>
      </div>

      {/* ---- list ---- */}
      <div className="admin-list-container">
        {loading && <div style={{ padding: 40, textAlign: 'center', opacity: 0.7 }}>Loading coupons…</div>}

        {!loading && error && (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--admin-danger,#ef4444)' }}>
            <div style={{ fontWeight: 800, marginBottom: 6 }}>Could not load coupons</div>
            <div style={{ fontSize: 12 }}>{error}</div>
            <button className="admin-btn-sm details" style={{ marginTop: 12 }} onClick={load}>Retry</button>
          </div>
        )}

        {!loading && !error && coupons.length === 0 && (
          <div style={{ padding: '48px 16px', textAlign: 'center', color: 'var(--admin-text-muted)' }}>
            <div style={{ fontSize: 30, marginBottom: 10 }}>🎟️</div>
            <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 6 }}>No coupons yet</div>
            <div style={{ fontSize: 12, lineHeight: 1.6 }}>
              Create one and shoppers will see it on the cart screen.
            </div>
            <button className="admin-btn-sm approve" style={{ marginTop: 14 }} onClick={openNew}>+ New Coupon</button>
          </div>
        )}

        {!loading && !error && coupons.map((c) => (
          <div key={c._id} className="admin-item-card">
            <div className="admin-item-header">
              <h3 className="admin-item-title" style={{ fontFamily: 'monospace', letterSpacing: 1 }}>{c.code}</h3>
              <span className={`admin-status-pill ${c.expired ? 'rejected' : c.isActive ? 'approved' : 'pending'}`}>
                {c.expired ? 'Expired' : c.isActive ? 'Active' : 'Off'}
              </span>
            </div>

            <div className="admin-item-body">
              <div className="admin-item-row">
                <span className="admin-item-label">Offer</span>
                <span className="admin-item-value">{c.title} — {rewardLabel(c)}</span>
              </div>
              <div className="admin-item-row">
                <span className="admin-item-label">Applies to</span>
                <span className="admin-item-value">
                  {c.channel === 'all' ? 'Both storefronts' : c.channel === 'grocery' ? 'Quick' : 'Shop All'}
                  {c.minOrderValue ? ` · min ₹${c.minOrderValue}` : ''}
                </span>
              </div>
              <div className="admin-item-row">
                <span className="admin-item-label">Limits</span>
                <span className="admin-item-value">
                  {c.perUserLimit ? `${c.perUserLimit}/customer` : 'unlimited per customer'}
                  {c.totalUsageLimit ? ` · ${c.usedCount}/${c.totalUsageLimit} claimed` : ` · ${c.usedCount} used`}
                </span>
              </div>
              {(c.firstOrderOnly || c.cdsMembersOnly || !c.isPublic) && (
                <div className="admin-item-row">
                  <span className="admin-item-label">Restricted</span>
                  <span className="admin-item-value">
                    {[c.firstOrderOnly && 'first order only', c.cdsMembersOnly && 'CDS members only', !c.isPublic && 'hidden from offers list']
                      .filter(Boolean).join(' · ')}
                  </span>
                </div>
              )}
              <div className="admin-item-row">
                <span className="admin-item-label">Valid</span>
                <span className="admin-item-value">{fmtDate(c.startsAt)} → {c.expiresAt ? fmtDate(c.expiresAt) : 'no end date'}</span>
              </div>
            </div>

            <div className="admin-item-actions">
              <button className="admin-btn-sm details" onClick={() => openEdit(c)}>Edit</button>
              <button className="admin-btn-sm details" onClick={() => viewUses(c)}>Redemptions</button>
              <button className={`admin-btn-sm ${c.isActive ? 'reject' : 'approve'}`} onClick={() => toggle(c)}>
                {c.isActive ? 'Deactivate' : 'Activate'}
              </button>
              <button className="admin-btn-sm reject" onClick={() => remove(c)}>Delete</button>
            </div>
          </div>
        ))}
      </div>

      {/* ---- create / edit ---- */}
      {showForm && (
        <div className="admin-modal-overlay">
          <div className="admin-modal-sheet">
            <div className="admin-modal-header">
              <h3 className="admin-modal-title">{editing ? 'Edit Coupon' : 'New Coupon'}</h3>
              <button className="admin-modal-close" onClick={() => setShowForm(false)}>✕</button>
            </div>

            <form onSubmit={submit}>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <Field label="Code *" hint="letters, numbers, - or _">
                  <input className="onboarding-input" style={{ fontFamily: 'monospace', textTransform: 'uppercase' }}
                    value={form.code} onChange={set('code')} maxLength={24} required placeholder="DIWALI20" />
                </Field>
                <Field label="Title *" hint="shown to the shopper">
                  <input className="onboarding-input" value={form.title} onChange={set('title')} required placeholder="20% off this Diwali" />
                </Field>
              </div>

              <Field label="Description">
                <input className="onboarding-input" value={form.description} onChange={set('description')} placeholder="Optional detail line" />
              </Field>

              <Field label="Reward type *">
                <select className="onboarding-select" value={form.discountType} onChange={set('discountType')}>
                  {DISCOUNT_TYPES.map((d) => <option key={d.value} value={d.value}>{d.label} — {d.hint}</option>)}
                </select>
              </Field>

              {!isShip && (
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  <Field label={isPct ? 'Percentage * (1–100)' : 'Amount off (₹) *'}>
                    <input type="number" className="onboarding-input" min="1" max={isPct ? 100 : undefined}
                      value={form.value} onChange={set('value')} required />
                  </Field>
                  {isPct && (
                    <Field label="Maximum discount (₹)" hint="0 = uncapped; protects margin on large carts">
                      <input type="number" className="onboarding-input" min="0" value={form.maxDiscount} onChange={set('maxDiscount')} />
                    </Field>
                  )}
                </div>
              )}

              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <Field label="Minimum order (₹)" hint="0 = no minimum">
                  <input type="number" className="onboarding-input" min="0" value={form.minOrderValue} onChange={set('minOrderValue')} />
                </Field>
                <Field label="Storefront">
                  <select className="onboarding-select" value={form.channel} onChange={set('channel')}>
                    {CHANNELS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                </Field>
              </div>

              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <Field label="Total uses" hint="0 = unlimited">
                  <input type="number" className="onboarding-input" min="0" value={form.totalUsageLimit} onChange={set('totalUsageLimit')} />
                </Field>
                <Field label="Uses per customer" hint="0 = unlimited">
                  <input type="number" className="onboarding-input" min="0" value={form.perUserLimit} onChange={set('perUserLimit')} />
                </Field>
              </div>

              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <Field label="Starts on"><input type="date" className="onboarding-input" value={form.startsAt} onChange={set('startsAt')} /></Field>
                <Field label="Ends on" hint="blank = never expires">
                  <input type="date" className="onboarding-input" value={form.expiresAt} onChange={set('expiresAt')} />
                </Field>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, margin: '12px 0' }}>
                {[
                  ['firstOrderOnly', 'Only on a customer’s first order'],
                  ['isPublic', 'Show in the offers list on the cart screen'],
                ].map(([k, label]) => (
                  <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: 'pointer' }}>
                    <input type="checkbox" checked={form[k]} onChange={set(k)} />
                    {label}
                  </label>
                ))}
              </div>

              {formError && (
                <div style={{ padding: 10, borderRadius: 8, marginBottom: 10, fontSize: 12,
                              background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.4)' }}>
                  {formError}
                </div>
              )}

              <button type="submit" className="primary-onboarding-btn" disabled={saving}>
                {saving ? 'Saving…' : editing ? 'Save changes' : 'Create coupon'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ---- redemptions ---- */}
      {redemptions && (
        <div className="admin-modal-overlay">
          <div className="admin-modal-sheet">
            <div className="admin-modal-header">
              <h3 className="admin-modal-title">{redemptions.coupon.code} — Redemptions</h3>
              <button className="admin-modal-close" onClick={() => setRedemptions(null)}>✕</button>
            </div>

            <div className="admin-item-row">
              <span className="admin-item-label">Times used</span>
              <span className="admin-item-value">{redemptions.meta.total ?? 0}</span>
            </div>
            <div className="admin-item-row">
              <span className="admin-item-label">Discount given away</span>
              <span className="admin-item-value">₹{redemptions.meta.totalDiscount ?? 0}</span>
            </div>
            <div className="admin-item-row" style={{ marginBottom: 12 }}>
              <span className="admin-item-label">Revenue on those orders</span>
              <span className="admin-item-value">₹{redemptions.meta.revenue ?? 0}</span>
            </div>

            {redemptions.rows.length === 0 ? (
              <div style={{ padding: 24, textAlign: 'center', fontSize: 12, opacity: 0.7 }}>
                Nobody has used this coupon yet.
              </div>
            ) : redemptions.rows.map((r) => (
              <div key={r._id} className="admin-item-row">
                <span className="admin-item-label">
                  {r.userId?.name || r.userId?.phone || 'Customer'} · {r.orderId?.orderNo || '—'}
                </span>
                <span className="admin-item-value">−₹{r.discountAmount}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default CouponsTab;
