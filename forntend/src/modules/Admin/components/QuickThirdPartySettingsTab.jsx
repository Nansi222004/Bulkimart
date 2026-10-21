import React, { useEffect, useState } from 'react';
import { adminGet, adminPatch } from '../../../utils/adminApi';

const card = { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14, padding: 18, minWidth: 0 };
const input = { display: 'block', width: '100%', boxSizing: 'border-box', padding: 10, marginTop: 5, minHeight: 44 };
const initial = { type: '', value: '', version: '', calculationBasis: '', minimum: '', maximum: '', taxTreatment: '', taxRate: '', currency: 'INR', effectiveAt: '', paymentRequired: true, enabled: false };
const amount = value => value == null ? '—' : '₹' + Number(value).toLocaleString('en-IN', { minimumFractionDigits: 2 });

export default function QuickThirdPartySettingsTab() {
  const [state, setState] = useState(null), [form, setForm] = useState(initial);
  const [rows, setRows] = useState([]), [page, setPage] = useState(1), [total, setTotal] = useState(0);
  const [query, setQuery] = useState(''), [status, setStatus] = useState(''), [exceptions, setExceptions] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const change = (key, value) => setForm(old => ({ ...old, [key]: value }));
  const load = async () => {
    setBusy(true); setError('');
    try {
      const { data } = await adminGet('/quick-commerce-third-party-config'); setState(data);
      const cfg = data.config || {}, fee = cfg.fee || {};
      setForm({ ...initial, ...fee, type: fee.type || '', calculationBasis: fee.calculationBasis || '', taxTreatment: ['inclusive','exclusive','exempt'].includes(fee.taxTreatment) ? fee.taxTreatment : '', value: fee.value ?? '', taxRate: fee.taxRate ?? '', minimum: fee.minimum ?? '', maximum: fee.maximum ?? '', version: fee.version || '', currency: cfg.currency || 'INR', effectiveAt: cfg.effectiveAt ? new Date(cfg.effectiveAt).toISOString().slice(0,16) : '', paymentRequired: cfg.paymentRequired ?? true, enabled: cfg.enabled === true });
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const loadRecords = async (nextPage = page) => {
    setBusy(true); setError('');
    try {
      const response = await adminGet('/quick-commerce-shiprocket-fees?' + new URLSearchParams({ q: query, status, exceptions: String(exceptions), page: String(nextPage) }));
      setRows(response.data || []); setTotal(response.meta?.total || response.pagination?.total || 0); setPage(nextPage);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  useEffect(() => { load(); loadRecords(1); }, []);
  const save = async event => {
    event.preventDefault(); setError(''); setNotice('');
    if (form.type === 'percent' && Number(form.value) > 100) return setError('Percentage cannot exceed 100.');
    if (form.minimum !== '' && form.maximum !== '' && Number(form.minimum) > Number(form.maximum)) return setError('Minimum cannot exceed maximum.');
    if (form.taxTreatment === 'exempt' && Number(form.taxRate) !== 0) return setError('Exempt tax requires an explicit zero rate.');
    setBusy(true);
    try {
      const fee = { type: form.type, value: Number(form.value), version: form.version, calculationBasis: form.calculationBasis, minimum: form.minimum === '' ? null : Number(form.minimum), maximum: form.maximum === '' ? null : Number(form.maximum), taxTreatment: form.taxTreatment, taxRate: Number(form.taxRate) };
      const { data } = await adminPatch('/quick-commerce-third-party-config', { fee, revision: state?.config?.revision || 0, currency: form.currency, effectiveAt: new Date(form.effectiveAt + 'Z').toISOString(), paymentRequired: form.paymentRequired, enabled: form.enabled });
      setState(data); setNotice('Configuration saved. Charging remains subject to all approval checks.');
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const field = (key, label, props = {}) => <label key={key}>{label}<input style={input} value={form[key]} onChange={e => change(key,e.target.value)} {...props} /></label>;
  return <div style={{ display: 'grid', gap: 16, color: '#0B2D6B' }}>
    <h2>Shiprocket Service Fee Configuration</h2>
    {error && <p role="alert" style={{ color: '#b91c1c' }}>{error}</p>}{notice && <p role="status">{notice}</p>}
    <div style={{ ...card, background: '#fff7ed' }}><strong>Live charging: {state?.config?.enabled && state?.activationReady ? 'Enabled' : 'Disabled'}</strong><p>Business fee values, tax treatment, seller collection and reconciliation are not approved. Saving a draft does not enable charging.</p><ul>{state?.blockers?.map(item => <li key={item}>{item}</li>)}</ul></div>
    <form onSubmit={save} style={card}>
      <h3>Fee rule</h3><p>Customer contribution offsets courier freight first. The Bulkimart service fee is separate from courier freight. No new customer charge is applied.</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,200px),1fr))', gap: 16 }}>
        <label>Calculation method<select required style={input} value={form.type} onChange={e => change('type',e.target.value)}><option value="">Select approved method</option><option value="flat">Fixed amount</option><option value="percent">Percentage</option></select></label>
        {field('value', form.type === 'percent' ? 'Percentage rate' : 'Fixed fee (INR)', { required: true, type: 'number', min: 0, step: '0.01', max: form.type === 'percent' ? 100 : undefined })}
        <label>Calculation base<select required style={input} value={form.calculationBasis} onChange={e => change('calculationBasis',e.target.value)}><option value="">Select approved base</option><option value="eligible_courier_freight">Eligible courier freight</option><option value="vendor_freight_share">Seller freight after customer contribution</option></select></label>
        {field('minimum','Minimum fee (optional)',{type:'number',min:0,step:'0.01'})}{field('maximum','Maximum fee (optional)',{type:'number',min:0,step:'0.01'})}
        <label>Tax treatment<select required style={input} value={form.taxTreatment} onChange={e => change('taxTreatment',e.target.value)}><option value="">Select approved treatment</option><option value="inclusive">Fee includes tax</option><option value="exclusive">Tax added to fee</option><option value="exempt">Exempt</option></select></label>
        {field('taxRate','Approved tax rate (%)',{required:true,type:'number',min:0,max:100,step:'0.01'})}
        {field('version','Business rule version',{required:true,maxLength:100})}{field('effectiveAt','Effective date/time (UTC)',{required:true,type:'datetime-local'})}
        <label>Currency<select style={input} value={form.currency} onChange={e=>change('currency',e.target.value)}><option value="INR">INR — existing provider</option></select></label>
      </div>
      <p><label><input type="checkbox" checked={form.paymentRequired} onChange={e=>change('paymentRequired',e.target.checked)} /> Require verified seller payment before shipment creation</label></p>
      <p><label><input type="checkbox" checked={form.enabled} onChange={e=>change('enabled',e.target.checked)} /> Enable (server approval gates still apply)</label></p>
      <button disabled={busy || !state} style={{...input,width:'auto',border:0,borderRadius:8,background:'#08B9E8',color:'#0B2D6B'}}>Save configuration</button>
    </form>
    <section style={card}><h3>Change history</h3>{state?.config?.history?.length ? [...state.config.history].reverse().map(item=><details key={item.revision}><summary style={{padding:12}}>Revision {item.revision} · {new Date(item.changedAt).toLocaleString()} · administrator {item.changedBy}</summary><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{JSON.stringify(item.configuration,null,2)}</pre></details>):<p>No fee configurations have been saved.</p>}</section>
    <section style={card}><h3>Seller fee payments and reconciliation</h3>
      <form onSubmit={e=>{e.preventDefault();loadRecords(1);}} style={{display:'flex',gap:12,flexWrap:'wrap'}}><input aria-label="Search order or seller" placeholder="Order number or store name" value={query} onChange={e=>setQuery(e.target.value)} style={input}/><select aria-label="Payment status" value={status} onChange={e=>setStatus(e.target.value)} style={input}><option value="">All payment states</option>{['pending','paid','failed','refunded','partial_refund'].map(value=><option key={value}>{value}</option>)}</select><label><input type="checkbox" checked={exceptions} onChange={e=>setExceptions(e.target.checked)}/> Reconciliation exceptions</label><button disabled={busy} style={{minHeight:44}}>Search / refresh</button></form>
      {!rows.length && <p>No fee collection records match these filters.</p>}
      {rows.map(row=>{const snap=row.quickFeeSnapshotId;return <article key={row._id} style={{borderTop:'1px solid #e2e8f0',padding:'16px 0',overflowWrap:'anywhere'}}><strong>{snap?.orderId?.orderNo} · {snap?.sellerId?.storeDetails?.name || snap?.sellerId?.businessName}</strong><p>Freight {amount(snap?.eligibleCourierFreight)} · Customer contribution {amount(snap?.customerFreightContribution)} · Seller freight {amount(snap?.vendorFreightShare)}</p><p>Service fee {amount(snap?.serviceFee?.netAmount)} · Tax {amount(snap?.serviceFee?.taxAmount)} · Total {amount(row.amount)}</p><p>Payment: {row.status} · Shipment: {snap?.orderId?.shiprocket?.status || 'Inactive'} · Provider order: {row.gateway?.orderId || 'Not issued'} · Payment reference: {row.gateway?.paymentId || '—'}</p>{(row.refundObligations?.length > 0 || row.gatewayAttempts?.some(a=>['initializing','creation_unknown'].includes(a.status))) && <p role="status">Reconciliation required — use the existing payment recovery tools. Do not create another charge.</p>}</article>})}
      <div style={{display:'flex',gap:12,alignItems:'center'}}><button disabled={busy || page===1} onClick={()=>loadRecords(page-1)} style={{minHeight:44}}>Previous</button><span>Page {page}</span><button disabled={busy || rows.length<25 || (total>0 && page*25>=total)} onClick={()=>loadRecords(page+1)} style={{minHeight:44}}>Next</button></div>
    </section>
  </div>;
}
