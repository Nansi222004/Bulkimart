import ModalPortal from '../../../components/ModalPortal';
import { useFeedback } from '../../../components/feedback/FeedbackProvider';
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
  firstOrderOnly: false, isPublic: true,
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

const inputStyle = {
  width: '100%',
  padding: '10px 12px',
  borderRadius: 8,
  border: '1.5px solid #cbd5e1',
  backgroundColor: '#f8fafc',
  fontSize: 13,
  fontWeight: 600,
  color: '#0f172a',
  outline: 'none',
  boxSizing: 'border-box',
};

const selectStyle = {
  ...inputStyle,
  cursor: 'pointer',
};

const Field = ({ label, hint, children, style = {} }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1, minWidth: 160, ...style }}>
    <label style={{ fontSize: 12, fontWeight: 700, color: '#334155' }}>{label}</label>
    {children}
    {hint && <span style={{ fontSize: 11, color: '#64748b' }}>{hint}</span>}
  </div>
);

export const CouponsTab = () => {
  const ui = useFeedback();
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

  const tomorrowStr = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().split('T')[0];
  }, []);

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

    if (form.expiresAt) {
      const todayStr = new Date().toISOString().split('T')[0];
      if (form.expiresAt <= todayStr) {
        setFormError('Expiration date cannot be today or in the past. It must be set to tomorrow or later.');
        setSaving(false);
        return;
      }
    }

    if (form.expiresAt) {
      const todayStr = new Date().toISOString().split('T')[0];
      if (form.expiresAt <= todayStr) {
        setFormError('Expiration date cannot be today or in the past. It must be set to tomorrow or later.');
        setSaving(false);
        return;
      }
    }

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
    } catch (err) { triggerToast(err.message, {type:'error'}); }
  };

  const remove = async (c) => {
    return ui.perform(`Delete coupon "${c.code}"?`, async () => {
    try {
      // A coupon that has been used is deactivated instead of erased — it is
      // part of order history. The server decides which happens.
      const { message } = await authDelete(`/api/admin/coupons/${c._id}`);
      triggerToast(message);
      await load();
    } catch (err) { triggerToast(err.message, {type:'error'}); }

});
};

  const viewUses = async (c) => {
    try {
      const { data, meta: m } = await adminGet(`/coupons/${c._id}/redemptions`);
      setRedemptions({ coupon: c, rows: data || [], meta: m || {} });
    } catch (err) { triggerToast(err.message, {type:'error'}); }
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
              {(c.firstOrderOnly || !c.isPublic) && (
                <div className="admin-item-row">
                  <span className="admin-item-label">Restricted</span>
                  <span className="admin-item-value">
                    {[c.firstOrderOnly && 'first order only', !c.isPublic && 'hidden from offers list']
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
        <ModalPortal className="admin-modal-overlay">
          <div className="admin-modal-sheet" style={{ maxWidth: 640, margin: 'auto', borderRadius: 16, padding: '24px 28px', backgroundColor: '#ffffff', boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.15)', maxHeight: '90vh', overflowY: 'auto' }}>
            <div className="admin-modal-header" style={{ marginBottom: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 20 }}>🎟️</span>
                <h3 className="admin-modal-title" style={{ fontSize: 18, fontWeight: 800, margin: 0, color: '#0f172a' }}>
                  {editing ? 'Edit Coupon' : 'Create New Coupon'}
                </h3>
              </div>
              <button className="admin-modal-close" onClick={() => setShowForm(false)}>✕</button>
            </div>

            <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                <Field label="Coupon Code *" hint="3–24 letters, numbers, - or _">
                  <input
                    style={{ ...inputStyle, fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: '1px' }}
                    value={form.code}
                    onChange={set('code')}
                    maxLength={24}
                    required
                    placeholder="e.g. DIWALI20"
                  />
                </Field>
                <Field label="Display Title *" hint="Customer-visible promo headline">
                  <input
                    style={inputStyle}
                    value={form.title}
                    onChange={set('title')}
                    required
                    placeholder="e.g. 20% off this festive season"
                  />
                </Field>
              </div>

              <Field label="Description (Optional)" hint="Additional terms or details shown to customer">
                <input
                  style={inputStyle}
                  value={form.description}
                  onChange={set('description')}
                  placeholder="e.g. Applicable on orders above ₹499"
                />
              </Field>

              <Field label="Reward Type *">
                <select style={selectStyle} value={form.discountType} onChange={set('discountType')}>
                  {DISCOUNT_TYPES.map((d) => (
                    <option key={d.value} value={d.value}>
                      {d.label} — {d.hint}
                    </option>
                  ))}
                </select>
              </Field>

              {!isShip && (
                <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                  <Field label={isPct ? 'Discount Percentage * (1–100%)' : 'Flat Amount Off (₹) *'}>
                    <input
                      type="number"
                      style={inputStyle}
                      min="1"
                      max={isPct ? 100 : undefined}
                      value={form.value}
                      onChange={set('value')}
                      required
                      placeholder={isPct ? '20' : '100'}
                    />
                  </Field>
                  {isPct && (
                    <Field label="Maximum Discount Cap (₹)" hint="0 or blank = uncapped discount">
                      <input
                        type="number"
                        style={inputStyle}
                        min="0"
                        value={form.maxDiscount}
                        onChange={set('maxDiscount')}
                        placeholder="e.g. 500"
                      />
                    </Field>
                  )}
                </div>
              )}

              <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                <Field label="Minimum Order Value (₹)" hint="0 = no minimum required">
                  <input
                    type="number"
                    style={inputStyle}
                    min="0"
                    value={form.minOrderValue}
                    onChange={set('minOrderValue')}
                    placeholder="0"
                  />
                </Field>
                <Field label="Applicable Storefront">
                  <select style={selectStyle} value={form.channel} onChange={set('channel')}>
                    {CHANNELS.map((c) => (
                      <option key={c.value} value={c.value}>{c.label}</option>
                    ))}
                  </select>
                </Field>
              </div>

              <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                <Field label="Total Usage Limit" hint="0 = unlimited redemptions across all users">
                  <input
                    type="number"
                    style={inputStyle}
                    min="0"
                    value={form.totalUsageLimit}
                    onChange={set('totalUsageLimit')}
                    placeholder="0"
                  />
                </Field>
                <Field label="Uses Per Customer" hint="0 = unlimited per customer">
                  <input
                    type="number"
                    style={inputStyle}
                    min="0"
                    value={form.perUserLimit}
                    onChange={set('perUserLimit')}
                    placeholder="1"
                  />
                </Field>
              </div>

              <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                <Field label="Starts On">
                  <input
                    type="date"
                    style={inputStyle}
                    value={form.startsAt}
                    onChange={set('startsAt')}
                  />
                </Field>
                <Field label="Ends On (Expiry Date)" hint="Must be tomorrow or later; blank = never expires">
                  <input
                    type="date"
                    min={tomorrowStr}
                    style={inputStyle}
                    value={form.expiresAt}
                    onChange={set('expiresAt')}
                  />
                </Field>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, margin: '8px 0', padding: '14px', backgroundColor: '#f8fafc', borderRadius: 10, border: '1px solid #e2e8f0' }}>
                {[
                  ['firstOrderOnly', 'Only for first-time customers', 'Restricts redemption to the customer’s very first order'],
                  ['isPublic', 'Show in checkout offers list', 'Display publicly in the available coupon drawer during checkout'],
                ].map(([k, label, desc]) => (
                  <label key={k} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={form[k]}
                      onChange={set(k)}
                      style={{ marginTop: 2, accentColor: 'var(--sa-primary, #2563eb)', width: 16, height: 16 }}
                    />
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#1e293b' }}>{label}</div>
                      <div style={{ fontSize: 11, color: '#64748b' }}>{desc}</div>
                    </div>
                  </label>
                ))}
              </div>

              {formError && (
                <div style={{ padding: '12px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600, background: '#fef2f2', color: '#b91c1c', border: '1px solid #fecaca' }}>
                  ⚠️ {formError}
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
                <button
                  type="button"
                  className="admin-btn-sm details"
                  style={{ flex: 'none', padding: '10px 18px' }}
                  onClick={() => setShowForm(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="admin-btn-sm approve"
                  style={{ flex: 'none', padding: '10px 24px', fontWeight: 800 }}
                  disabled={saving}
                >
                  {saving ? 'Saving…' : editing ? 'Save Changes' : 'Create Coupon'}
                </button>
              </div>
            </form>
          </div>
        </ModalPortal>
      )}

      {/* ---- redemptions ---- */}
      {redemptions && (
        <ModalPortal className="admin-modal-overlay">
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
        </ModalPortal>
      )}
    </div>
  );
};

export default CouponsTab;
