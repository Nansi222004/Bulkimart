import React, { useEffect, useMemo, useState } from 'react';
import { adminGet, adminPost } from '../../../utils/adminApi';

// Admin → Settings → Payment Settings → COD Charges (backend: services/codCharge.service.js).
// Saving creates a new version; existing orders keep the fee they were charged.
const card = { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14, padding: 18, minWidth: 0 };
const input = { display: 'block', width: '100%', boxSizing: 'border-box', padding: 10, marginTop: 5, minHeight: 44, borderRadius: 8, border: '1px solid #cbd5e1', fontSize: 14 };
const hint = { fontSize: 12, color: '#64748b', marginTop: 4 };
const blank = { isEnabled: false, feeType: 'FIXED', fixedAmount: '', percentage: '', minOrderAmount: '', maxFee: '', gstRatePercent: '0', description: 'COD Handling Fee', note: '' };
const money = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

// Same formula as the server, for the live example only.
const previewFee = (form, amount) => {
  if (!form.isEnabled) return null;
  if (form.minOrderAmount !== '' && amount < Number(form.minOrderAmount)) return null;
  let fee = form.feeType === 'PERCENTAGE' ? Math.round(amount * Number(form.percentage || 0)) / 100 : Number(form.fixedAmount || 0);
  if (form.maxFee !== '') fee = Math.min(fee, Number(form.maxFee));
  if (!(fee > 0)) return null;
  const tax = Math.round(fee * Number(form.gstRatePercent || 0)) / 100;
  return { fee, tax, total: Math.round((fee + tax) * 100) / 100 };
};

const describe = (row) => !row.isEnabled ? 'Off' : [
  row.feeType === 'PERCENTAGE' ? `${row.percentage}% of order` : `${money(row.fixedAmount)} per order`,
  row.minOrderAmount != null ? `from ${money(row.minOrderAmount)}` : null,
  row.maxFee != null ? `max ${money(row.maxFee)}` : null,
  row.gstRatePercent ? `+${row.gstRatePercent}% GST` : null,
].filter(Boolean).join(' · ');

export default function CodChargesTab() {
  const [form, setForm] = useState(blank);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [example, setExample] = useState('500');
  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  const load = async () => {
    setLoading(true); setError('');
    try {
      const { data } = await adminGet('/cod-charge');
      const a = data.active || {};
      setForm({ ...blank, isEnabled: Boolean(a.isEnabled), feeType: a.feeType || 'FIXED', fixedAmount: a.fixedAmount ? String(a.fixedAmount) : '',
        percentage: a.percentage ? String(a.percentage) : '', minOrderAmount: a.minOrderAmount ?? '', maxFee: a.maxFee ?? '',
        gstRatePercent: String(a.gstRatePercent ?? 0), description: a.description || 'COD Handling Fee' });
      setHistory(data.history || []);
    } catch (e) { setError(e.message || 'Could not load COD charges'); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const validation = useMemo(() => {
    const errs = [];
    const n = (v) => Number(v);
    if (form.isEnabled && form.feeType === 'FIXED' && !(n(form.fixedAmount) > 0)) errs.push('Enter a COD handling fee above ₹0.');
    if (form.isEnabled && form.feeType === 'PERCENTAGE' && !(n(form.percentage) > 0 && n(form.percentage) <= 20)) errs.push('Enter a percentage between 0 and 20.');
    if (form.minOrderAmount !== '' && !(n(form.minOrderAmount) >= 0)) errs.push('Minimum order amount must be 0 or more.');
    if (form.maxFee !== '' && !(n(form.maxFee) > 0)) errs.push('Maximum COD fee must be above ₹0, or left empty.');
    if (!(n(form.gstRatePercent) >= 0 && n(form.gstRatePercent) <= 28)) errs.push('GST must be between 0 and 28%.');
    return errs;
  }, [form]);

  const save = async (event) => {
    event.preventDefault(); setError(''); setNotice('');
    if (validation.length) { setError(validation[0]); return; }
    setSaving(true);
    try {
      const res = await adminPost('/cod-charge', { ...form });
      setNotice(res.message || 'Saved');
      await load();
    } catch (e) { setError(e.message || 'Could not save COD charges'); } finally { setSaving(false); }
  };

  const sample = previewFee(form, Number(example) || 0);

  return (
    <div style={{ display: 'grid', gap: 16, color: '#0B2D6B', maxWidth: 960, padding: 24, boxSizing: 'border-box' }}>
      <div>
        <h2 style={{ margin: 0 }}>COD Charges</h2>
        <p style={{ margin: '4px 0 0', color: '#64748b', fontSize: 13 }}>Settings › Payment Settings. A handling fee added to Cash on Delivery orders only. Online payments never pay it. Charged once per order (each delivery is a separate cash collection). It is Bulkimart income, not seller earnings.</p>
      </div>
      {error && <p role="alert" style={{ color: '#b91c1c', margin: 0 }}>{error}</p>}
      {notice && <p role="status" style={{ color: '#047857', margin: 0 }}>{notice}</p>}
      {loading ? <p role="status">Loading COD charges…</p> : (
        <form onSubmit={save} style={{ ...card, display: 'grid', gap: 14 }}>
          <label style={{ display: 'flex', gap: 10, alignItems: 'center', fontWeight: 800, cursor: 'pointer' }}>
            <input type="checkbox" checked={form.isEnabled} onChange={(e) => set('isEnabled', e.target.checked)} style={{ width: 18, height: 18 }} />
            Charge a COD handling fee
          </label>
          <div style={{ opacity: form.isEnabled ? 1 : 0.6, display: 'grid', gap: 14 }}>
            <div role="radiogroup" aria-label="COD fee type" style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {[['FIXED', 'Fixed amount (₹ per order)'], ['PERCENTAGE', 'Percentage of order']].map(([value, label]) => (
                <button type="button" key={value} role="radio" aria-checked={form.feeType === value} onClick={() => set('feeType', value)}
                  style={{ minHeight: 44, padding: '8px 14px', borderRadius: 10, cursor: 'pointer', fontWeight: 700, border: `1.5px solid ${form.feeType === value ? '#08B9E8' : '#cbd5e1'}`, background: form.feeType === value ? '#ecfeff' : '#fff', color: '#0B2D6B' }}>
                  {label}
                </button>
              ))}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))', gap: 14 }}>
              {form.feeType === 'FIXED' ? (
                <label>COD handling fee (₹)<input style={input} type="number" min="0" step="0.01" placeholder="e.g. 20" value={form.fixedAmount} onChange={(e) => set('fixedAmount', e.target.value)} /></label>
              ) : (
                <label>COD fee percentage (%)<input style={input} type="number" min="0" max="20" step="0.01" placeholder="e.g. 2" value={form.percentage} onChange={(e) => set('percentage', e.target.value)} /><div style={hint}>Of items after discounts + delivery (tip excluded).</div></label>
              )}
              <label>Minimum order amount (₹, optional)<input style={input} type="number" min="0" step="0.01" placeholder="No minimum" value={form.minOrderAmount} onChange={(e) => set('minOrderAmount', e.target.value)} /><div style={hint}>Fee applies only to orders at or above this amount.</div></label>
              <label>Maximum COD fee (₹, optional)<input style={input} type="number" min="0" step="0.01" placeholder="No cap" value={form.maxFee} onChange={(e) => set('maxFee', e.target.value)} /><div style={hint}>Cap before GST.</div></label>
              <label>GST on COD fee (%)<input style={input} type="number" min="0" max="28" step="0.01" value={form.gstRatePercent} onChange={(e) => set('gstRatePercent', e.target.value)} /><div style={hint}>0 if the fee already includes tax or is exempt.</div></label>
            </div>
            <label>Customer-facing description<input style={input} maxLength={200} value={form.description} onChange={(e) => set('description', e.target.value)} /><div style={hint}>Shown at checkout, on the order and to the delivery partner.</div></label>
            <div style={{ border: '1px dashed #cbd5e1', borderRadius: 10, padding: 12, background: '#f8fafc', display: 'grid', gap: 6 }} aria-live="polite">
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>Example order amount ₹
                <input type="number" min="0" value={example} onChange={(e) => setExample(e.target.value)} style={{ ...input, width: 120, marginTop: 0 }} />
              </label>
              {sample ? <span>Customer pays {money(Number(example) || 0)} + {form.description || 'COD Handling Fee'} {money(sample.fee)}{sample.tax ? ` + GST ${money(sample.tax)}` : ''} = <strong>{money((Number(example) || 0) + sample.total)}</strong> with COD. Online: {money(Number(example) || 0)}.</span>
                : <span>No COD fee for this amount{form.isEnabled ? '' : ' (charges are off)'}.</span>}
            </div>
          </div>
          <label>Change note (optional)<input style={input} maxLength={300} placeholder="Why this change?" value={form.note} onChange={(e) => set('note', e.target.value)} /></label>
          <button type="submit" disabled={saving} style={{ minHeight: 46, border: 0, borderRadius: 10, background: '#f97316', color: '#fff', fontWeight: 800, fontSize: 15, cursor: saving ? 'wait' : 'pointer' }}>
            {saving ? 'Saving…' : 'Save COD charges'}
          </button>
          <p style={{ ...hint, margin: 0 }}>Applies to new orders only. Orders already placed keep the fee they were charged.</p>
        </form>
      )}
      <section style={card}>
        <h3 style={{ marginTop: 0 }}>Change history</h3>
        {history.length ? history.map((row) => (
          <p key={row._id} style={{ margin: '6px 0', fontSize: 13 }}>
            <strong>{new Date(row.createdAt).toLocaleString('en-IN')}</strong> · {describe(row)}{row.isActive ? ' · current' : ''}{row.updatedBy?.name ? ` · ${row.updatedBy.name}` : ''}{row.note ? ` · "${row.note}"` : ''}
          </p>
        )) : <p style={{ margin: 0 }}>No changes yet. COD charges are off.</p>}
      </section>
    </div>
  );
}
