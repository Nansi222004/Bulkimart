import React, { useState } from 'react';
import { gstApi } from './gstApi';
export default function GstFeeEditor() {
  const [open,setOpen]=useState(false),[fee,setFee]=useState(null),[amount,setAmount]=useState(''),[terms,setTerms]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  const [loaded,setLoaded]=useState(false);
  const populate = data => {setFee(data);setAmount(data ? (data.amountPaise/100).toFixed(2) : '');setTerms(data?.terms || '');};
  async function load(){setOpen(true);setBusy(true);setLoaded(false);setMessage('');try{populate(await gstApi(true,'/fee-policy'));setLoaded(true);}catch(e){setMessage(e.message);}finally{setBusy(false);}}
  async function save(e){e.preventDefault();if(busy||!loaded)return;setBusy(true);setMessage('');try{
    if(!/^\d+(\.\d{1,2})?$/.test(amount))throw new Error('Enter a positive fee with at most two decimal places');
    populate(await gstApi(true,'/fee-policy',{method:'PUT',json:{amountPaise:Math.round(Number(amount)*100),terms,version:fee?.version||0}}));setMessage('Service fee saved. Existing request fees stay unchanged; new requests use this fee.');
  }catch(e){setMessage(e.message);}finally{setBusy(false);}}
  return <div className="gst-fee-editor"><button type="button" disabled={busy} onClick={load}>GST service fee settings</button>{open&&<form onSubmit={save}>
    <h3>GST assistance service fee</h3><p>Set the total amount vendors pay Bulkimart. Finance permission is required to save.</p>
    <fieldset disabled={busy||!loaded}><label>Total service fee (₹)<input required type="number" min="0.01" step="0.01" value={amount} onChange={e=>setAmount(e.target.value)}/></label>
    <label>Payment and cancellation terms<textarea required maxLength={5000} value={terms} onChange={e=>setTerms(e.target.value)}/></label>
    <button disabled={busy||!loaded||!amount||!terms.trim()}>Save service fee</button> <button type="button" disabled={busy} onClick={()=>setOpen(false)}>Close fee settings</button></fieldset></form>}{message&&<p role="status">{message}</p>}</div>;
}
