import React, { useEffect, useState } from 'react';
import FinanceReview from './FinanceReview';
import { adminGet, adminPatch } from '../../../utils/adminApi';
import { hint } from './financeText';

const card = { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14, padding: 18, minWidth: 0 };
const input = { display: 'block', width: '100%', boxSizing: 'border-box', padding: 10, marginTop: 5, minHeight: 44 };
const initial = { type: '', value: '', version: '', calculationBasis: '', minimum: '', maximum: '', taxTreatment: '', taxRate: '', currency: 'INR', effectiveAt: '', paymentRequired: true, enabled: false };
const amount = value => value == null ? '—' : '₹' + Number(value).toLocaleString('en-IN', { minimumFractionDigits: 2 });

export default function QuickThirdPartySettingsTab({ view = 'all' } = {}) {
  const [review, setReview] = useState(false);
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
  useEffect(() => { load(); if (view !== 'settings') loadRecords(1); }, []);
  const save = async event => {
    event.preventDefault(); setError(''); setNotice('');
    if (form.type === 'percent' && Number(form.value) > 100) return setError('Percentage cannot exceed 100.');
    if (form.minimum !== '' && form.maximum !== '' && Number(form.minimum) > Number(form.maximum)) return setError('Minimum cannot exceed maximum.');
    if (form.taxTreatment === 'exempt' && Number(form.taxRate) !== 0) return setError('Exempt tax requires an explicit zero rate.');
    if (!review) { setReview(true); return; }
    setBusy(true);
    try {
      const fee = { type: form.type, value: Number(form.value), version: form.version, calculationBasis: form.calculationBasis, minimum: form.minimum === '' ? null : Number(form.minimum), maximum: form.maximum === '' ? null : Number(form.maximum), taxTreatment: form.taxTreatment, taxRate: Number(form.taxRate) };
      const { data } = await adminPatch('/quick-commerce-third-party-config', { fee, revision: state?.config?.revision || 0, currency: form.currency, effectiveAt: new Date(form.effectiveAt + 'Z').toISOString(), paymentRequired: form.paymentRequired, enabled: form.enabled });
      setState(data); setReview(false); setNotice('Configuration saved. Charging remains subject to all approval checks.');
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const field = (key, label, props = {}, help = null) => <label key={key}>{label}<input style={input} value={form[key]} onChange={e => change(key,e.target.value)} {...props} />{help}</label>;
  const describe = c => { const fee = c?.fee || c || {}; return [fee.type === 'percent' ? `${fee.value}% of ${fee.calculationBasis === 'vendor_freight_share' ? 'seller freight share' : 'courier freight'}` : fee.value != null ? `₹${fee.value} fixed` : null, fee.minimum != null ? `min ₹${fee.minimum}` : null, fee.maximum != null ? `max ₹${fee.maximum}` : null, fee.taxTreatment ? `GST ${fee.taxTreatment} ${fee.taxRate}%` : null, fee.version ? `version ${fee.version}` : null, c?.enabled != null ? (c.enabled ? 'on' : 'off') : null].filter(Boolean).join(' · ') || 'No details recorded'; };
  return <div style={{ display: 'grid', gap: 16, color: '#0B2D6B' }}>
    <h2>Shiprocket Service Fee Configuration</h2>
    {error && <p role="alert" style={{ color: '#b91c1c' }}>{error}</p>}{notice && <p role="status">{notice}</p>}
    <div style={{ ...card, background: '#fff7ed' }}><strong>Charging sellers: {state?.config?.enabled && state?.activationReady ? 'On' : 'Off'}</strong><p>Status: { !state ? 'Loading' : !state.config?.revision ? 'Not configured' : !state.config.enabled ? 'Saved but switched off' : !state.activationReady ? 'Switched on, waiting for server approvals' : new Date(state.config.effectiveAt) > new Date() ? 'Starts later' : 'Active' }. Saving replaces the current fee. Charging requires approved policies, provider verification and an effective fee rule.</p>{state?.blockers?.length > 0 && <><p>Still needed before charging:</p><ul>{state.blockers.map(item => <li key={item}>{item}</li>)}</ul></>}</div>
    {view !== 'records' && <>
    {review ? <FinanceReview title={form.enabled ? 'Review Shiprocket fee (switch on)' : 'Review Shiprocket fee (saved switched off)'} values={{Method:form.type,Value:form.value,Base:form.calculationBasis,'Minimum ₹':form.minimum || 'None','Maximum ₹':form.maximum || 'None',GST:form.taxTreatment+' '+form.taxRate+'%',Version:form.version,'Starts (UTC)':form.effectiveAt,'Seller pays before shipping':form.paymentRequired ? 'Yes' : 'No',Status:form.enabled?'Switch on (server approvals still apply)':'Saved switched off'}} busy={busy} onConfirm={()=>save({preventDefault(){}})} onCancel={()=>setReview(false)} /> : <form onSubmit={save} onInvalid={e=>e.target.closest('details')?.setAttribute('open','')} style={card}>
      <h3>Fee charged to sellers for Shiprocket shipping</h3><p className="finance-muted">For Quick Commerce orders shipped through Shiprocket, the seller pays: courier cost not covered by the customer’s delivery charge + Bulkimart’s service fee + GST on that fee. Only the service fee is Bulkimart income; the courier part pays Shiprocket.</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,200px),1fr))', gap: 16 }}>
        <label>Calculation method<select required style={input} value={form.type} onChange={e => change('type',e.target.value)}><option value="">Choose</option><option value="flat">Fixed amount</option><option value="percent">Percentage</option></select>{hint('Fixed = same ₹ per shipment. Percentage = share of the base below.')}</label>
        {field('value', form.type === 'percent' ? 'Percentage rate' : 'Fixed fee (INR)', { required: true, type: 'number', min: 0, step: '0.01', max: form.type === 'percent' ? 100 : undefined }, hint(form.type === 'percent' ? 'Percent of the chosen base.' : '₹ per shipment.', form.type === 'percent' ? '5 → ₹3 on ₹60 courier cost' : '10'))}
        <label>Calculation base<select required style={input} value={form.calculationBasis} onChange={e => change('calculationBasis',e.target.value)}><option value="">Choose</option><option value="eligible_courier_freight">Eligible courier freight</option><option value="vendor_freight_share">Seller freight after customer contribution</option></select>{hint('Full courier cost, or only the part the seller pays after the customer’s delivery charge.')}</label>
        </div><details><summary>Limits and GST</summary><div className="finance-grid">{field('minimum','Minimum fee (INR, optional)',{type:'number',min:0,step:'0.01'}, hint('Never charge less than this per shipment.'))}{field('maximum','Maximum fee (INR, optional)',{type:'number',min:0,step:'0.01'}, hint('Never charge more than this per shipment.'))}
        <label>Tax treatment<select required style={input} value={form.taxTreatment} onChange={e => change('taxTreatment',e.target.value)}><option value="">Choose</option><option value="inclusive">Fee includes tax</option><option value="exclusive">Tax added to fee</option><option value="exempt">Exempt</option></select>{hint('GST on the service fee. “Exempt” needs a 0% rate.')}</label>
        {field('taxRate','Approved tax rate (%)',{required:true,type:'number',min:0,max:100,step:'0.01'}, hint('GST rate on the service fee.', '18'))}
        </div></details><div className="finance-grid">{field('version','Business rule version',{required:true,maxLength:100}, hint('Your own label for this fee, shown on seller statements.', 'SR-FEE-2026-10'))}{field('effectiveAt','Effective date/time (UTC)',{required:true,type:'datetime-local'}, hint('UTC time — India time minus 5 h 30 min.'))}
        <label>Currency<select style={input} value={form.currency} onChange={e=>change('currency',e.target.value)}><option value="INR">INR</option></select></label>
      </div>
      <p><label><input type="checkbox" checked={form.paymentRequired} disabled={form.paymentRequired} onChange={()=>change('paymentRequired',true)} /> Seller must pay before the shipment is created</label></p>
      <p><label><input type="checkbox" checked={form.enabled} onChange={e=>change('enabled',e.target.checked)} /> Switch on charging</label></p>{hint('Leave off to save the fee without charging sellers yet.')}
      <button disabled={busy || !state} style={{...input,width:'auto',border:0,borderRadius:8,background:'#08B9E8',color:'#0B2D6B'}}>Review configuration</button>
    </form>}
    <section style={card}><h3>Change history</h3>{state?.config?.history?.length ? [...state.config.history].reverse().map(item=><details key={item.revision}><summary style={{padding:12}}>Revision {item.revision} · {new Date(item.changedAt).toLocaleString()} · administrator {item.changedBy}</summary><p>{describe(item.configuration)}</p></details>):<p>No fee configurations have been saved.</p>}</section>
    </>}
    {view !== 'settings' && <section style={card}><h3>Seller fee payments and reconciliation</h3>
      <form onSubmit={e=>{e.preventDefault();loadRecords(1);}} style={{display:'flex',gap:12,flexWrap:'wrap'}}><input aria-label="Search order or seller" placeholder="Order number or store name" value={query} onChange={e=>setQuery(e.target.value)} style={input}/><select aria-label="Payment status" value={status} onChange={e=>setStatus(e.target.value)} style={input}><option value="">All payment states</option>{['pending','paid','failed','refunded','partial_refund'].map(value=><option key={value}>{value}</option>)}</select><label><input type="checkbox" checked={exceptions} onChange={e=>setExceptions(e.target.checked)}/> Reconciliation exceptions</label><button disabled={busy} style={{minHeight:44}}>Search / refresh</button></form>
      {!rows.length && <p>No fee collection records match these filters.</p>}
      {rows.map(row=>{const snap=row.quickFeeSnapshotId;return <article key={row._id} style={{borderTop:'1px solid #e2e8f0',padding:'16px 0',overflowWrap:'anywhere'}}><strong>{snap?.orderId?.orderNo} · {snap?.sellerId?.storeDetails?.name || snap?.sellerId?.businessName}</strong><p>Freight {amount(snap?.eligibleCourierFreight)} · Customer contribution {amount(snap?.customerFreightContribution)} · Seller freight {amount(snap?.vendorFreightShare)}</p><p>Service fee {amount(snap?.serviceFee?.netAmount)} · Tax {amount(snap?.serviceFee?.taxAmount)} · Total {amount(row.amount)}</p><p>Payment: {row.status} · Shipment: {snap?.orderId?.shiprocket?.status || 'Inactive'} · Provider order: {row.gateway?.orderId || 'Not issued'} · Payment reference: {row.gateway?.paymentId || '—'}</p>{(row.refundObligations?.length > 0 || row.gatewayAttempts?.some(a=>['initializing','creation_unknown'].includes(a.status))) && <p role="status">Reconciliation required — use the existing payment recovery tools. Do not create another charge.</p>}</article>})}
      <div style={{display:'flex',gap:12,alignItems:'center'}}><button disabled={busy || page===1} onClick={()=>loadRecords(page-1)} style={{minHeight:44}}>Previous</button><span>Page {page}</span><button disabled={busy || rows.length<25 || (total>0 && page*25>=total)} onClick={()=>loadRecords(page+1)} style={{minHeight:44}}>Next</button></div>
    </section>}
  </div>;
}
