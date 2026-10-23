import React, {useEffect,useRef,useState} from 'react';
import {advertisingApi,advertisingMoney} from './advertisingApi';
import {openRazorpayCheckout} from '../../utils/razorpayCheckout';
export default function AdvertisingBillingPanel({id,admin=false,permissions=[],capabilities={},onChanged=()=>{}}){
  const [data,setData]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[refresh,setRefresh]=useState(0);
  const [reason,setReason]=useState(''),[invoice,setInvoice]=useState(''),[creditNote,setCreditNote]=useState(''),[amount,setAmount]=useState(''),[evidence,setEvidence]=useState(''),[gatewayOrder,setGatewayOrder]=useState('');
  const operationKey=useRef(null),generation=useRef(0);
  const [capture,setCapture]=useState('');
  const finance=permissions.includes('advertising_finance'),reconcile=permissions.includes('advertising_reconcile'),refund=permissions.includes('advertising_refund');
  useEffect(()=>{let alive=true;generation.current++;setData(null);setError('');setReason('');setInvoice('');setAmount('');setCreditNote('');setEvidence('');setGatewayOrder('');operationKey.current=null;
    setCapture('');advertisingApi(admin,`/campaigns/${id}/billing`).then(b=>alive&&setData(b.data)).catch(e=>alive&&setError(e.message));return()=>{alive=false;generation.current++;};
  },[id,admin,refresh]);
  async function act(action,body){const current=generation.current;setBusy(true);setError('');try{
    await advertisingApi(admin,`/campaigns/${id}/${action}`,{method:'POST',body});
    if(current===generation.current){setRefresh(n=>n+1);onChanged();}
  }catch(e){if(current===generation.current)setError(e.message);}finally{setBusy(false);}}
  async function pay(){const current=generation.current,token=localStorage.getItem('sellerToken');setBusy(true);setError('');try{
    operationKey.current ||= crypto.randomUUID();
    const b=await advertisingApi(false,`/campaigns/${id}/payment-attempts`,{method:'POST',body:{version:data.campaign.version,idempotencyKey:operationKey.current}});
    if(current!==generation.current||token!==localStorage.getItem('sellerToken'))return;
    const result=await openRazorpayCheckout(b.data.checkout,{Authorization:`Bearer ${token}`,'Content-Type':'application/json'});
    if(current===generation.current&&token===localStorage.getItem('sellerToken')){if(!result.ok)setError(result.message||'Verification is pending. Refresh payment status.');setRefresh(n=>n+1);onChanged();}
  }catch(e){if(current===generation.current)setError(e.message);}finally{setBusy(false);}}
  const c=data?.campaign,p=data?.payment,q=data?.quote;
  return <section className="ad-card" aria-label="Advertising billing">
    <h3>Campaign billing and service</h3>{error&&<p role="alert">{error}</p>}
    <button disabled={busy} onClick={()=>setRefresh(n=>n+1)}>Refresh billing status</button>
    {!data&&!error&&<p role="status">Loading billing evidence…</p>}
    {data&&<>
      <p>Review: {c.review} · Funding: {c.funding} · Delivery: {c.delivery}</p>
      <p>{c.terms?.name} · Sponsored category · {c.module}</p>
      {q?<><p>Base: {advertisingMoney(q.basePaise)} · Tax: {advertisingMoney(q.taxPaise)} · Total: <strong>{advertisingMoney(q.totalPaise)}</strong> · {c.terms.durationDays} days</p>
        <p>Accepted policy {q.policy.approvalReference}; issuer: {q.policy.issuer}. Tax treatment: {q.policy.taxTreatment}; configured rate: {q.policy.taxRateBps/100}%.</p>
        <p>Service starts at verified payment or the requested future start, whichever is later. Interruptions stop delivery for review; no automatic extension.</p>
        <p>Approved maximum refund limits: cancellation {q.policy.refunds.cancellationBps/100}%, suspension {q.policy.refunds.suspensionBps/100}%, unavailable service {q.policy.refunds.unavailableBps/100}%, unused service {q.policy.refunds.unusedBps/100}%. Refunds require authorized review.</p>
      </>:<p>Billing is blocked: an accepted versioned tax, invoice, refund and service policy is required.</p>}
      {c.paid?.startAt&&<p>Paid service: {new Date(c.paid.startAt).toLocaleString()} – {new Date(c.paid.endAt).toLocaleString()}</p>}
      {c.pilot&&<p>Pilot authorization is separate from paid service: {c.pilot.enabled?'enabled':'stopped'}.</p>}
      <p>Financial authorization: {data.paidAuthorization?'recorded':'pending'}.</p>
      {p&&<><p>Payment {p.reference}: {p.status} · order creation {p.creation}{p.checkoutExpired?' · checkout expired':''} · reconciliation {p.reconciliation||'pending'}</p>
        {p.gatewayFeePaise!==undefined&&<p>Observed provider fee {advertisingMoney(p.gatewayFeePaise)} · provider tax field {advertisingMoney(p.gatewayFeeTaxPaise)}. Expense and bank settlement review are separate.</p>}
        <p>Received {advertisingMoney(p.receiptPaise)} · refunded {advertisingMoney(p.refundedPaise)} · recognized revenue {advertisingMoney(p.recognizedPaise)}</p>
        {p.invoiceReference&&<p>Approved external invoice reference: {p.invoiceReference}</p>}
        {p.refunds.map(r=><div key={r.key}><p>Refund {advertisingMoney(r.amountPaise)}: {r.status} · {r.reason}{r.creditNoteReference?` · Credit note ${r.creditNoteReference}`:''}</p>{admin&&reconcile&&['UNKNOWN','PENDING','DISPATCHING'].includes(r.status)&&<button disabled={busy} onClick={()=>act('refund-reconcile',{key:r.key})}>Reconcile this refund</button>}</div>)}
      </>}
      {admin&&data.journal&&<details><summary>Immutable advertising accounting events</summary><ul>{data.journal.map(e=><li key={e.id}>{e.entryNo} · {e.account} · {e.direction} · {advertisingMoney(e.amountPaise)} · {new Date(e.at).toLocaleString()}</li>)}</ul>{data.journalTruncated&&<p>Journal display is bounded. Further financial evidence requires an authorized export review.</p>}</details>}
      {!admin&&<>
        <button className="ad-primary" disabled={busy||!q||!data.paidAuthorization||!capabilities.paymentsEnabled||c.review!=='APPROVED'||!['UNPAID','PAYMENT_PENDING','PAYMENT_FAILED'].includes(c.funding)||p?.checkoutExpired||c.delivery!=='NOT_SCHEDULED'} onClick={pay}>Pay accepted campaign amount</button>
        <p>Checkout success is verified by the backend. Closing Checkout leaves payment pending until confirmed or reconciled.</p>
      </>}
      {(admin||!['CANCELLED','COMPLETED','ADMIN_SUSPENDED'].includes(c.delivery))&&<label>Action reason<textarea maxLength={2000} value={reason} onChange={e=>setReason(e.target.value)}/></label>}
      {!admin&&!['CANCELLED','COMPLETED','ADMIN_SUSPENDED'].includes(c.delivery)&&<button disabled={busy||!reason.trim()} onClick={()=>act('cancel',{version:c.version,reason})}>Cancel campaign and request policy review</button>}
      {admin&&finance&&q&&c.review==='APPROVED'&&c.funding==='UNPAID'&&<><label>Approved external invoice reference (when required)<input maxLength={200} value={invoice} onChange={e=>setInvoice(e.target.value)}/></label><button disabled={busy||!reason.trim()} onClick={()=>act('billing-authorize',{version:c.version,reason,invoiceReference:invoice})}>Authorize accepted billing policy</button></>}
      {admin&&reconcile&&p&&<><label>Gateway order ID for uncertain creation<input value={gatewayOrder} onChange={e=>setGatewayOrder(e.target.value)}/></label><button disabled={busy} onClick={()=>act('reconcile',gatewayOrder?{gatewayOrderId:gatewayOrder}:{})}>Reconcile gateway payment</button></>}
      {admin&&refund&&p&&<>
        {data.gateway&&<label>Captured payment for refund<select value={capture} onChange={e=>setCapture(e.target.value)}><option value="">Primary capture</option>{data.gateway.captures.map(r=><option key={r.id} value={r.id}>{r.id} · {advertisingMoney(r.amountPaise)} · {r.disposition}</option>)}</select></label>}
        <label>Refund amount (INR)<input type="number" min="0.01" step="0.01" value={amount} onChange={e=>setAmount(e.target.value)}/></label><label>Approved credit-note reference (when required)<input maxLength={200} value={creditNote} onChange={e=>setCreditNote(e.target.value)}/></label><button disabled={busy||!reason.trim()||!amount||!capabilities.refundsEnabled} onClick={()=>{operationKey.current ||= crypto.randomUUID();return act('refund',{key:operationKey.current,amountPaise:Math.round(Number(amount)*100),reason,creditNoteReference:creditNote,...(capture?{captureId:capture}:{})});}}>Request authorized refund</button></>}
      {admin&&finance&&c.delivery==='COMPLETED'&&<><label>Service-delivery finance review evidence<input maxLength={200} value={evidence} onChange={e=>setEvidence(e.target.value)}/></label><button disabled={busy||!evidence||!reason.trim()} onClick={()=>act('recognize',{reason,evidenceReference:evidence})}>Recognize reviewed service revenue</button></>}
    </>}
  </section>;
}
