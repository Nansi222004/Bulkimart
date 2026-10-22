import React, { useEffect, useState } from 'react';
import { authGet, authPost } from '../../../utils/adminApi';
import FinanceReview from './FinanceReview';
import './FinanceWorkflow.css';

const modes = [['quick','Quick Commerce'],['same_day','Same-Day']];
const money = value => value == null ? 'Not configured' : '₹' + Number(value).toLocaleString('en-IN', {minimumFractionDigits:2});
const status = row => !row || row.source === 'default' ? 'Not configured' : !row.isActive ? 'Draft / Disabled' : new Date(row.effectiveFrom) > new Date() ? 'Scheduled' : 'Active';
const empty = {base:'',perKm:'',minPayout:'',maxPayout:'',effectiveFrom:'',note:'',isActive:false};

export function RateCard({mode, current, onSaved}) {
  const [draft,setDraft]=useState(empty), [review,setReview]=useState(false), [busy,setBusy]=useState(false), [error,setError]=useState(''), [message,setMessage]=useState('');
  useEffect(()=>{ if(current && current.source !== 'default') setDraft({...empty,base:current.base ?? '',perKm:current.perKm ?? '',minPayout:current.minPayout ?? '',maxPayout:current.maxPayout ?? ''}); },[current]);
  const edit=(key,value)=>setDraft(old=>({...old,[key]:value}));
  const submit=async event=>{
    event.preventDefault();setError('');setMessage('');
    if(['base','perKm','minPayout'].some(key=>draft[key]==='' || !Number.isFinite(Number(draft[key])) || Number(draft[key])<0)) return setError('Enter non-negative base pay, distance pay and minimum payout.');
    if(draft.maxPayout!=='' && Number(draft.maxPayout)<Number(draft.minPayout)) return setError('Maximum payout must be at least the minimum.');
    if(draft.note.trim().length<5) return setError('A change reason of at least five characters is required.');
    if(!review){setReview(true);return;}
    setBusy(true);
    try{await authPost('/api/admin/delivery-rates',{...draft,mode:mode[0],base:Number(draft.base),perKm:Number(draft.perKm),minPayout:Number(draft.minPayout),maxPayout:draft.maxPayout===''?null:Number(draft.maxPayout),effectiveFrom:draft.effectiveFrom?new Date(draft.effectiveFrom).toISOString():undefined});setReview(false);setDraft(old=>({...old,isActive:false,note:''}));setMessage('Saved and reloaded. Drafts do not change active rates.');await onSaved();}catch(e){setError(e.message);}finally{setBusy(false);}
  };
  return <section className="finance-panel"><h3>{mode[1]} rider pay</h3><p>Affects delivery partners: base INR per completed trip plus INR per verified kilometre, subject to limits. Customer tariffs and courier freight are separate.</p><p>Status: <strong>{status(current)}</strong> · Rate version: {current?._id || 'Not configured'} · Effective: {current?.effectiveFrom ? new Date(current.effectiveFrom).toLocaleString() : 'Not configured'}</p>
    {current?.source==='default' && <p>Existing runtime fallback remains in use; no approved database rate is prefilled.</p>}
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    {review ? <FinanceReview title={draft.isActive?'Review rate activation':'Review rider draft'} values={{Mode:mode[1], 'Base INR':draft.base,'INR / km':draft.perKm,'Minimum INR':draft.minPayout,'Maximum INR':draft.maxPayout || 'None',Effective:draft.effectiveFrom || 'Server save time',Status:draft.isActive?'Activation requested; server prerequisites required':'Draft',Reason:draft.note}} busy={busy} onConfirm={()=>submit({preventDefault(){}})} onCancel={()=>setReview(false)} /> : <form onSubmit={submit} onInvalid={e=>e.target.closest('details')?.setAttribute('open','')}>
      <div className="finance-grid">{[['base','Base pay (INR / delivery)'],['perKm','Distance pay (INR / km)']].map(([key,label])=><label key={key}>{label}<input required type="number" min="0" step="0.01" value={draft[key]} onChange={e=>edit(key,e.target.value)} /></label>)}</div>
      <details><summary>Advanced options — payout limits</summary><div className="finance-grid">{[['minPayout','Minimum payout (INR)'],['maxPayout','Maximum payout (INR, optional)']].map(([key,label])=><label key={key}>{label}<input required={key==='minPayout'} type="number" min="0" step="0.01" value={draft[key]} onChange={e=>edit(key,e.target.value)} /></label>)}</div></details>
      <label>Effective date / time (local)<input type="datetime-local" value={draft.effectiveFrom} onChange={e=>edit('effectiveFrom',e.target.value)}/><small>Saved as UTC; blank uses server save time.</small></label>
      <label>Change reason<input required minLength={5} value={draft.note} onChange={e=>edit('note',e.target.value)}/></label>
      <label className="finance-check"><input type="checkbox" checked={draft.isActive} onChange={e=>edit('isActive',e.target.checked)}/>Request activation under recorded approvals</label><p>Activation is blocked by release prerequisites unless policy, end-to-end approval and an independently approved customer distance tariff are present. Saving a draft never copies rider pay into customer prices.</p>
      <button disabled={busy} type="submit">Review {draft.isActive?'activation':'draft'}</button>
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
    if(editDistance && draft.note.trim().length<5)return setError('Approved distance tariffs require a change reason of at least five characters.');
    if(!review){setReview(true);return;}setBusy(true);
    try{await authPost('/api/admin/delivery-charge',{flatFee:Number(draft.flatFee),...(editDistance?{distanceRates:{quick:Number(draft.quick),same_day:Number(draft.same_day)},note:draft.note}:{})});setReview(false);setEditDistance(false);await load();setMessage('Customer tariff saved and reloaded from the server.');}catch(e){setError(e.message);}finally{setBusy(false);}
  };
  return <section className="finance-workflow"><h2>Customer Delivery Charges</h2><p>Affects customers. When a valid distance is supplied, the applicable per-kilometre tariff may apply; otherwise the existing flat fallback applies. Free-shipping coupon behavior is unchanged. Rider pay and courier freight are independent.</p>
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}{loading?<p>Loading persisted tariffs…</p>:<>
    <div className="finance-panel"><p>Status: <strong>{status(current)}</strong> · Effective: {current?.effectiveFrom ? new Date(current.effectiveFrom).toLocaleString() : 'Not configured'}</p><p>Persisted flat fallback: {current?.source==='default'?'Not configured':money(current?.flatFee)}</p><p>Quick tariff: {money(current?.distanceRates?.quick)} / km · Same-Day tariff: {money(current?.distanceRates?.same_day)} / km</p><p>This API applies changes immediately. It has no draft or future scheduling capability; review customer-pricing approval before saving.</p>
    {review?<FinanceReview title="Review immediate customer pricing change" values={{'Flat fallback INR':draft.flatFee,'Quick INR / km':editDistance?draft.quick:'Preserve existing tariff','Same-Day INR / km':editDistance?draft.same_day:'Preserve existing tariff',Effective:'Immediately on save',Reason:draft.note || 'Flat fallback update'}} busy={busy} onConfirm={()=>save({preventDefault(){}})} onCancel={()=>setReview(false)}/>:<form onSubmit={save} onInvalid={e=>e.target.closest('details')?.setAttribute('open','')}>
      <label>Flat fallback charge (INR)<input required type="number" step="0.01" min="0" value={draft.flatFee} onChange={e=>edit('flatFee',e.target.value)}/></label>
      <details><summary>Advanced options — independent distance tariffs</summary><label className="finance-check"><input type="checkbox" checked={editDistance} onChange={e=>setEditDistance(e.target.checked)}/>Change independently approved customer distance tariffs</label><p>Distance changes require existing server release approvals. No rider rate is copied.</p>{editDistance && <div className="finance-grid">{modes.map(([key,label])=><label key={key}>{label} customer tariff (INR / km)<input required min="0" step="0.01" type="number" value={draft[key]} onChange={e=>edit(key,e.target.value)}/></label>)}<label>Approved change reason<input required minLength={5} value={draft.note} onChange={e=>edit('note',e.target.value)}/></label></div>}</details>
      <button type="submit" disabled={busy}>Review customer tariff</button></form>}</div>
    <section className="finance-panel"><h3>Tariff version history</h3>{history.length?history.map(row=><details key={row._id}><summary>{money(row.flatFee)} · {status(row)} · {new Date(row.effectiveFrom || row.createdAt).toLocaleString()}</summary><p>Version {row._id} · Actor {row.updatedBy?.name || row.updatedBy?.email || row.updatedBy || 'Unavailable'} · Reason {row.note || 'Not recorded'}</p><p>Quick {money(row.distanceRates?.quick)} / km · Same-Day {money(row.distanceRates?.same_day)} / km</p></details>):<p>No persisted tariff history.</p>}</section></>}
    <button type="button" disabled={busy || loading} onClick={load}>Reload customer tariffs</button>
  </section>;
}

export const DeliveryRatesTab=({includeCustomer=true}={})=>{
  const [current,setCurrent]=useState([]),[history,setHistory]=useState([]),[loading,setLoading]=useState(true),[error,setError]=useState('');
  const load=async()=>{setLoading(true);setError('');try{const {data}=await authGet('/api/admin/delivery-rates');setCurrent(data.current || []);setHistory(data.history || []);}catch(e){setError(e.message);}finally{setLoading(false);}};
  useEffect(()=>{load();},[]);
  return <section className="finance-workflow"><h2>Delivery Partner Rates</h2><p>Configure approved rider earnings separately for Quick Commerce and Same-Day trips. No separate E-Commerce rate card, bonuses or waiting compensation is supported by this API.</p>{error && <p role="alert">{error}</p>}{loading?<p>Loading rates…</p>:<div className="finance-grid">{modes.map(mode=><RateCard key={mode[0]} mode={mode} current={current.find(row=>row.mode===mode[0])} onSaved={load}/>)}</div>}
    <section className="finance-panel"><h3>Rate version history</h3>{history.length?history.map(row=><details key={row._id}><summary>{row.mode} · {status(row)} · {new Date(row.effectiveFrom || row.createdAt).toLocaleString()}</summary><p>Version {row._id} · Base {money(row.base)} · Per km {money(row.perKm)} · Minimum {money(row.minPayout)} · Maximum {money(row.maxPayout)}</p><p>Actor {row.updatedBy?.name || row.updatedBy?.email || 'Unavailable'} · Reason {row.note || 'Not recorded'}</p></details>):<p>No saved rider rate versions.</p>}</section><button type="button" disabled={loading} onClick={load}>Reload rider rates</button>{includeCustomer && <CustomerDeliveryChargeCard/>}</section>;
};
export default DeliveryRatesTab;
