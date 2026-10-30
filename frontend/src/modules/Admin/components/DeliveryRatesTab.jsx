import React, { useEffect, useState } from 'react';
import { authGet, authPost } from '../../../utils/adminApi';
import FinanceReview from './FinanceReview';
import { hint } from './financeText';
import './FinanceWorkflow.css';

const modes = [['quick','Quick Commerce'],['same_day','Same-Day']];
const money = value => value == null ? 'Not configured' : '₹' + Number(value).toLocaleString('en-IN', {minimumFractionDigits:2});
const status = row => !row || row.source === 'default' ? 'Not configured' : !row.isActive ? 'Draft (not in use)' : new Date(row.effectiveFrom) > new Date() ? 'Starts later' : 'Active';
const empty = {base:'',perKm:'',minPayout:'',maxPayout:'',effectiveFrom:'',note:'',isActive:false};

export function RateCard({mode, current, onSaved}) {
  const [draft,setDraft]=useState(empty), [review,setReview]=useState(false), [busy,setBusy]=useState(false), [error,setError]=useState(''), [message,setMessage]=useState('');
  useEffect(()=>{ if(current && current.source !== 'default') setDraft({...empty,base:current.base ?? '',perKm:current.perKm ?? '',minPayout:current.minPayout ?? '',maxPayout:current.maxPayout ?? ''}); },[current]);
  const edit=(key,value)=>setDraft(old=>({...old,[key]:value}));
  const submit=async event=>{
    event.preventDefault();setError('');setMessage('');
    if(['base','perKm','minPayout'].some(key=>draft[key]==='' || !Number.isFinite(Number(draft[key])) || Number(draft[key])<0)) return setError('Enter non-negative base pay, distance pay and minimum payout.');
    if(draft.maxPayout!=='' && Number(draft.maxPayout)<Number(draft.minPayout)) return setError('Maximum payout must be at least the minimum.');
    const note = draft.note?.trim()?.length >= 5 ? draft.note.trim() : (draft.note?.trim()?.length === 0 ? 'Rider pay rate update' : draft.note.trim());
    if(note.length < 5) return setError('A change reason of at least five characters is required.');
    if(!review){setReview(true);return;}
    setBusy(true);
    try{await authPost('/api/admin/delivery-rates',{...draft,note,mode:mode[0],base:Number(draft.base),perKm:Number(draft.perKm),minPayout:Number(draft.minPayout),maxPayout:draft.maxPayout===''?null:Number(draft.maxPayout),effectiveFrom:draft.effectiveFrom?new Date(draft.effectiveFrom).toISOString():undefined});setReview(false);setDraft(old=>({...old,isActive:false,note:''}));setMessage('Saved and reloaded. Drafts do not change active rates.');await onSaved();}catch(e){setError(e.message);}finally{setBusy(false);}
  };
  const fieldHints = {
    base: hint('Paid for every completed delivery, before distance.', '20'),
    perKm: hint('Added for each kilometre of the verified route.', '₹20 base + ₹5/km × 4 km = ₹40'),
    minPayout: hint('A trip never pays less than this, even when it is very short.', '30'),
    maxPayout: hint('A trip never pays more than this. Leave blank for no cap.', '150'),
  };
  return <section className="finance-panel"><h3>{mode[1]} rider pay</h3><p className="finance-muted">What a rider earns per {mode[1]} delivery. Customer delivery charges are set separately and never copied from this.</p><p>Status: <strong>{status(current)}</strong> · Rate version: {current?._id || 'Not configured'} · Starts: {current?.effectiveFrom ? new Date(current.effectiveFrom).toLocaleString() : 'Not configured'}</p>
    {current?.source==='default' && <p className="finance-notice">No rate saved yet, so the built-in default is being used. Save one below.</p>}
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    {review ? <FinanceReview title={draft.isActive?'Review new active rate':'Review draft rate'} values={{Mode:mode[1], 'Base pay':`₹${draft.base}`,'Per km':`₹${draft.perKm}`,'Minimum per trip':`₹${draft.minPayout}`,'Maximum per trip':draft.maxPayout ? `₹${draft.maxPayout}` : 'None',Starts:draft.effectiveFrom || 'When saved',Status:draft.isActive?'Use this rate (server approvals still apply)':'Draft — current rate stays in use',Reason:draft.note}} busy={busy} onConfirm={()=>submit({preventDefault(){}})} onCancel={()=>setReview(false)} /> : <form onSubmit={submit} onInvalid={e=>e.target.closest('details')?.setAttribute('open','')}>
      <div className="finance-grid">{[['base','Base pay (INR / delivery)'],['perKm','Distance pay (INR / km)']].map(([key,label])=><label key={key}>{label}<input required type="number" min="0" step="0.01" value={draft[key]} onChange={e=>edit(key,e.target.value)} placeholder="0" />{fieldHints[key]}</label>)}</div>
      <details className="finance-advanced" style={{ margin: '14px 0', border: '1px solid #e2e8f0', borderRadius: 10, padding: '12px 14px', background: '#f8fafc' }}><summary style={{ cursor: 'pointer', fontWeight: 600, color: '#0369a1' }}>⚙️ More options (Trip limits, schedule & change reason)</summary><div className="finance-grid" style={{ marginTop: 12 }}>
        {[['minPayout','Minimum payout (INR)'],['maxPayout','Maximum payout (INR, optional)']].map(([key,label])=><label key={key}>{label}<input required={key==='minPayout'} type="number" min="0" step="0.01" value={draft[key]} onChange={e=>edit(key,e.target.value)} placeholder="0" />{fieldHints[key]}</label>)}
        <label>Starts from (optional)<input type="datetime-local" value={draft.effectiveFrom} onChange={e=>edit('effectiveFrom',e.target.value)}/>{hint('Leave blank to apply immediately on save.')}</label>
        <label>Change reason<input minLength={5} value={draft.note} onChange={e=>edit('note',e.target.value)} placeholder="Optional note for change history" />{hint('Shown in change history.', 'Fuel price adjustment')}</label>
      </div></details>
      <label className="finance-check"><input type="checkbox" checked={draft.isActive} onChange={e=>edit('isActive',e.target.checked)}/>Use this rate for deliveries</label>{hint('Enable this rate for deliveries immediately.')}
      <button disabled={busy} type="submit" style={{ marginTop: 10 }}>Review {draft.isActive?'rate':'draft'}</button>
    </form>}
  </section>;
}

export function CustomerDeliveryChargeCard() {
  const [current,setCurrent]=useState(null),[history,setHistory]=useState([]),[draft,setDraft]=useState({flatFee:'',quick:'',same_day:'',note:''}),[editDistance,setEditDistance]=useState(false),[review,setReview]=useState(false),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
  const load=async()=>{setLoading(true);try{const {data}=await authGet('/api/admin/delivery-charge');setCurrent(data.current);setHistory(data.history || []);if(data.current?.source!=='default')setDraft({flatFee:data.current?.flatFee ?? '',quick:data.current?.distanceRates?.quick ?? '',same_day:data.current?.distanceRates?.same_day ?? '',note:''});}catch(e){setError(e.message);}finally{setLoading(false);}};
  useEffect(()=>{load();},[]);
  const edit=(key,value)=>setDraft(old=>({...old,[key]:value}));
  const save=async event=>{event.preventDefault();setError('');setMessage('');
    const keys=editDistance?['flatFee','quick','same_day']:['flatFee'];
    if(keys.some(key=>draft[key]==='' || !Number.isFinite(Number(draft[key])) || Number(draft[key])<0))return setError('Enter a non-negative amount in every selected tariff field.');
    const note = draft.note?.trim()?.length >= 5 ? draft.note.trim() : (draft.note?.trim()?.length === 0 ? 'Customer tariff update' : draft.note.trim());
    if(editDistance && note.length<5)return setError('Approved distance tariffs require a change reason of at least five characters.');
    if(!review){setReview(true);return;}setBusy(true);
    try{await authPost('/api/admin/delivery-charge',{flatFee:Number(draft.flatFee),...(editDistance?{distanceRates:{quick:Number(draft.quick),same_day:Number(draft.same_day)},note}:{})});setReview(false);setEditDistance(false);await load();setMessage('Customer tariff saved and reloaded from the server.');}catch(e){setError(e.message);}finally{setBusy(false);}
  };
  return <section className="finance-workflow"><h2>Customer Delivery Charges</h2><p>Delivery charges paid by customers. When distance is known, per-km rate applies; otherwise the flat charge is used.</p>
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}{loading?<p>Loading persisted tariffs…</p>:<>
    <div className="finance-panel"><p>Status: <strong>{status(current)}</strong> · Since: {current?.effectiveFrom ? new Date(current.effectiveFrom).toLocaleString() : 'Not configured'}</p><p>Flat charge: {current?.source==='default'?'Not configured':money(current?.flatFee)}</p><p>Quick per km: {money(current?.distanceRates?.quick)} · Same-Day per km: {money(current?.distanceRates?.same_day)}</p><p className="finance-notice">Changes apply to customers as soon as you save.</p>
    {review?<FinanceReview title="Review customer delivery charge (applies immediately)" values={{'Flat charge':`₹${draft.flatFee}`,'Quick per km':editDistance?`₹${draft.quick}`:'Unchanged','Same-Day per km':editDistance?`₹${draft.same_day}`:'Unchanged',Starts:'Immediately on save',Reason:draft.note || 'Flat charge update'}} busy={busy} onConfirm={()=>save({preventDefault(){}})} onCancel={()=>setReview(false)}/>:<form onSubmit={save} onInvalid={e=>e.target.closest('details')?.setAttribute('open','')}>
      <label>Flat fallback charge (INR)<input required type="number" step="0.01" min="0" value={draft.flatFee} onChange={e=>edit('flatFee',e.target.value)}/>{hint('Charged on every order when the delivery distance is not known. Use 0 for free delivery.', '30')}</label>
      <details><summary>Per-km charges</summary><label className="finance-check"><input type="checkbox" checked={editDistance} onChange={e=>setEditDistance(e.target.checked)}/>Change the per-km charges too</label>{hint('Needs money actions to be live on the server. Rider pay is never copied into these.')}{editDistance && <div className="finance-grid">{modes.map(([key,label])=><label key={key}>{label} customer tariff (INR / km)<input required min="0" step="0.01" type="number" value={draft[key]} onChange={e=>edit(key,e.target.value)}/>{hint(`Customer pays this for each km on a ${label} order.`, '7 → ₹28 for 4 km')}</label>)}<label>Approved change reason<input required minLength={5} value={draft.note} onChange={e=>edit('note',e.target.value)}/>{hint('Shown in the history.', 'New city pricing')}</label></div>}</details>
      <button type="submit" disabled={busy}>Review customer tariff</button></form>}</div>
    <section className="finance-panel"><h3>Tariff version history</h3>{history.length?history.map(row=><details key={row._id}><summary>{money(row.flatFee)} · {status(row)} · {new Date(row.effectiveFrom || row.createdAt).toLocaleString()}</summary><p>Version {row._id} · Actor {row.updatedBy?.name || row.updatedBy?.email || row.updatedBy || 'Unavailable'} · Reason {row.note || 'Not recorded'}</p><p>Quick {money(row.distanceRates?.quick)} / km · Same-Day {money(row.distanceRates?.same_day)} / km</p></details>):<p>No persisted tariff history.</p>}</section></>}
    <button type="button" disabled={busy || loading} onClick={load}>Reload customer tariffs</button>
  </section>;
}

export const DeliveryRatesTab=({includeCustomer=true}={})=>{
  const [current,setCurrent]=useState([]),[history,setHistory]=useState([]),[loading,setLoading]=useState(true),[error,setError]=useState('');
  const load=async()=>{setLoading(true);setError('');try{const {data}=await authGet('/api/admin/delivery-rates');setCurrent(data.current || []);setHistory(data.history || []);}catch(e){setError(e.message);}finally{setLoading(false);}};
  useEffect(()=>{load();},[]);
  return <section className="finance-workflow"><h2>Rider pay</h2><p>What riders earn per delivery, set separately for Quick Commerce and Same-Day trips. Tips go to the rider on top of this.</p>{error && <p role="alert">{error}</p>}{loading?<p>Loading rates…</p>:<div className="finance-grid">{modes.map(mode=><RateCard key={mode[0]} mode={mode} current={current.find(row=>row.mode===mode[0])} onSaved={load}/>)}</div>}
    <section className="finance-panel"><h3>Rate version history</h3>{history.length?history.map(row=><details key={row._id}><summary>{row.mode} · {status(row)} · {new Date(row.effectiveFrom || row.createdAt).toLocaleString()}</summary><p>Version {row._id} · Base {money(row.base)} · Per km {money(row.perKm)} · Minimum {money(row.minPayout)} · Maximum {money(row.maxPayout)}</p><p>Actor {row.updatedBy?.name || row.updatedBy?.email || 'Unavailable'} · Reason {row.note || 'Not recorded'}</p></details>):<p>No saved rider rate versions.</p>}</section><button type="button" disabled={loading} onClick={load}>Reload rider rates</button>{includeCustomer && <CustomerDeliveryChargeCard/>}</section>;
};
export default DeliveryRatesTab;
