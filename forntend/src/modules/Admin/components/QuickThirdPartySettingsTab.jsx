import React, { useEffect, useState } from 'react';
import { adminGet, adminPatch } from '../../../utils/adminApi';

const card = { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14, padding: 18 };

export default function QuickThirdPartySettingsTab() {
  const [state, setState] = useState(null);
  const [exceptions, setExceptions] = useState([]);
  const [form, setForm] = useState({ type: 'flat', value: '', version: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = async () => {
    setBusy(true); setError('');
    try {
      const [{ data }, exceptionResult] = await Promise.all([
        adminGet('/quick-commerce-third-party-config'), adminGet('/financial-reconciliation'),
      ]);
      setState(data); setExceptions(exceptionResult.data || []);
      setForm({ type: data.config?.fee?.type || 'flat', value: data.config?.fee?.value ?? '', version: data.config?.fee?.version || '' });
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  useEffect(() => { load(); }, []);

  const save = async (event) => {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      const { data, message } = await adminPatch('/quick-commerce-third-party-config', {
        enabled: false, fee: { type: form.type, value: Number(form.value), version: form.version },
      });
      setState(data); setNotice(message || 'Draft saved. Activation remains disabled.');
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  return <div style={{ display: 'grid', gap: 16 }}>
    <div><h2 style={{ margin: 0, color: '#0f172a' }}>Quick Commerce third-party delivery</h2>
      <p style={{ color: '#64748b' }}>Draft configuration and financial safeguards. Live activation defaults to disabled.</p></div>
    {error && <div style={{ padding: 12, borderRadius: 9, background: '#fef2f2', color: '#991b1b' }}>{error}</div>}
    {notice && <div style={{ padding: 12, borderRadius: 9, background: '#ecfdf5', color: '#166534' }}>{notice}</div>}
    <div style={{ ...card, borderColor: state?.activationReady ? '#86efac' : '#fdba74', background: state?.activationReady ? '#f0fdf4' : '#fff7ed' }}>
      <strong>Live status: {state?.config?.enabled ? 'Enabled' : 'Disabled'}</strong>
      <div style={{ marginTop: 6, fontSize: 13 }}>{state?.activationReady ? 'All activation checks passed.' : 'Activation is blocked until every policy and provider check is approved.'}</div>
      <ul>{(state?.blockers || []).map((item) => <li key={item}>{item}</li>)}</ul>
      <div style={{ fontSize: 12 }}>Provider configured: {state?.provider?.configured ? 'Yes' : 'No'} · Quick capability verified: {state?.provider?.quickCommerce ? 'Yes' : 'No'}</div>
    </div>
    <form onSubmit={save} style={card}>
      <h3 style={{ marginTop: 0 }}>Service-fee draft</h3>
      <p style={{ color: '#64748b', fontSize: 12 }}>Percentage fees use the provider's eligible <code>freight_charge</code>. Saving a draft does not approve tax, limits, refunds, COD, or activation.</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 12 }}>
        <label>Type<select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} style={{ display: 'block', width: '100%', padding: 10, marginTop: 5 }}><option value="flat">Flat</option><option value="percent">Percent</option></select></label>
        <label>Value<input type="number" min="0" step="0.01" required value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} style={{ display: 'block', width: '100%', boxSizing: 'border-box', padding: 10, marginTop: 5 }} /></label>
        <label>Version<input required value={form.version} onChange={(e) => setForm({ ...form, version: e.target.value })} style={{ display: 'block', width: '100%', boxSizing: 'border-box', padding: 10, marginTop: 5 }} /></label>
      </div>
      <div style={{ marginTop: 12, fontSize: 12 }}><strong>Fixed basis:</strong> eligible courier freight · <strong>Option B:</strong> customer delivery charge applies first; vendor owes remaining freight plus service fee.</div>
      <button disabled={busy} style={{ marginTop: 14, padding: '10px 18px', border: 0, borderRadius: 8, color: '#fff', background: '#0891b2' }}>{busy ? 'Saving…' : 'Save disabled draft'}</button>
    </form>
    <div style={card}><h3 style={{ marginTop: 0 }}>Reconciliation exceptions</h3>
      {exceptions.length ? exceptions.map((item) => <div key={item._id} style={{ padding: '10px 0', borderTop: '1px solid #f1f5f9' }}>
        <strong>{item.snapshotNo}</strong> · {item.discrepancy}<div style={{ color: '#64748b', fontSize: 12 }}>{item.reason} · Retry disabled</div>
      </div>) : <div style={{ color: '#64748b' }}>No persisted Quick third-party snapshots require reconciliation.</div>}
    </div>
  </div>;
}
