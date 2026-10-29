import React, {useEffect,useRef,useState} from 'react';
import {advertisingApi,advertisingMoney} from './advertisingApi';
import {openRazorpayCheckout} from '../../utils/razorpayCheckout';
const when=d=>new Date(d).toLocaleString('en-IN',{dateStyle:'medium',timeStyle:'short'});
// One sentence telling the seller where the campaign stands and what happens next.
export function sellerPaymentStatus(c,data,p){
  if(c.pilot?.enabled) return 'A free test run is active. Payment is available after Bulkimart stops the test.';
  const live={ACTIVE:`Live until ${c.paid?.endAt?when(c.paid.endAt):'the end of the package'}.`,SCHEDULED:`Paid. Your ad starts on ${c.paid?.startAt?when(c.paid.startAt):'the start date'}.`,
    SELLER_PAUSED:'Paused.',UNAVAILABLE:'Paused: your products cannot be shown right now (for example, out of stock).',COMPLETED:'Finished.',EXHAUSTED:'Finished.',CANCELLED:'Cancelled.',ADMIN_SUSPENDED:'Suspended by Bulkimart.'}[c.delivery];
  if(live)return live;
  const funding={REFUND_PENDING:'Refund in progress.',PARTIALLY_REFUNDED:'Partly refunded.',REFUNDED:'Refunded.',RECONCILIATION_REQUIRED:'We are checking your payment. Please wait.',
    PAYMENT_FAILED:'Payment failed. Please try again.',PAYMENT_PENDING:p?.checkoutExpired?'The payment time ran out. Cancel this campaign and create a new one.':'Payment in progress. If you have already paid, tap Refresh.'}[c.funding];
  if(funding)return funding;
  return {DRAFT:'Draft: submit it for review when ready.',PENDING_REVIEW:'Waiting for Bulkimart to review your campaign.',CHANGES_REQUESTED:'Bulkimart asked for changes. Edit the campaign and submit it again.',
    REJECTED:'Bulkimart did not approve this campaign.'}[c.review]||(data.paidAuthorization?'Approved. Pay to start your ad.':'Approved. Bulkimart is getting your payment ready.');
}
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
  // Sellers see one plain status, the price and what they can do next; the finance detail is admin-only.
  if(!admin){
    const final=['CANCELLED','COMPLETED','ADMIN_SUSPENDED','EXHAUSTED'].includes(c?.delivery);
    const canPay=!!(q&&data.paidAuthorization&&c.review==='APPROVED'&&['UNPAID','PAYMENT_PENDING','PAYMENT_FAILED'].includes(c.funding)&&!p?.checkoutExpired&&!c.pilot?.enabled&&c.delivery==='NOT_SCHEDULED');
    // An unpaid, unscheduled campaign is cancelled from the campaign itself; this one may involve a refund.
    const canCancel=data&&!final&&!(c.funding==='UNPAID'&&c.delivery==='NOT_SCHEDULED');
    return <section className="ad-card ad-pay-card" aria-label="Payment">
      <div className="ad-pay-head"><h3>Payment</h3><button type="button" disabled={busy} onClick={()=>setRefresh(n=>n+1)}>Refresh</button></div>
      {error&&<p role="alert" className="ad-error">{error}</p>}
      {!data&&!error&&<p role="status">Loading…</p>}
      {data&&<>
        <p className="ad-pay-status" role="status">{sellerPaymentStatus(c,data,p)}</p>
        {q&&<p>{c.terms?.name}: <strong>{advertisingMoney(q.totalPaise)}</strong>{q.taxPaise?` (${advertisingMoney(q.basePaise)} + ${advertisingMoney(q.taxPaise)} GST)`:''} for {c.terms.durationDays} days</p>}
        {p?.refundedPaise>0&&<p>Refunded {advertisingMoney(p.refundedPaise)} to your original payment method.</p>}
        {canPay&&<button className="ad-primary" disabled={busy||!capabilities.paymentsEnabled} onClick={pay}>{`Pay ${advertisingMoney(q.totalPaise)}`}</button>}
        {canPay&&!capabilities.paymentsEnabled&&<p>Online payment is not available right now. Please try again later.</p>}
        {canCancel&&<details className="ad-pay-cancel"><summary>Cancel this campaign</summary>
          <label>Why are you cancelling?<textarea maxLength={2000} value={reason} onChange={e=>setReason(e.target.value)}/></label>
          <p>Any refund follows the package terms you accepted.</p>
          <button disabled={busy||!reason.trim()} onClick={()=>act('cancel',{version:c.version,reason})}>Cancel campaign</button>
        </details>}
      </>}
    </section>;
  }
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
      <label>Action reason<textarea maxLength={2000} value={reason} onChange={e=>setReason(e.target.value)}/></label>
      {admin&&finance&&q&&c.review==='APPROVED'&&c.funding==='UNPAID'&&!data.paidAuthorization&&<><label>Approved external invoice reference (when required)<input maxLength={200} value={invoice} onChange={e=>setInvoice(e.target.value)}/></label><button disabled={busy||!reason.trim()} onClick={()=>act('billing-authorize',{version:c.version,reason,invoiceReference:invoice})}>Request seller payment</button></>}
      {admin&&reconcile&&p&&<><label>Gateway order ID for uncertain creation<input value={gatewayOrder} onChange={e=>setGatewayOrder(e.target.value)}/></label><button disabled={busy} onClick={()=>act('reconcile',gatewayOrder?{gatewayOrderId:gatewayOrder}:{})}>Reconcile gateway payment</button></>}
      {admin&&refund&&p&&<>
        {data.gateway&&<label>Captured payment for refund<select value={capture} onChange={e=>setCapture(e.target.value)}><option value="">Primary capture</option>{data.gateway.captures.map(r=><option key={r.id} value={r.id}>{r.id} · {advertisingMoney(r.amountPaise)} · {r.disposition}</option>)}</select></label>}
        <label>Refund amount (INR)<input type="number" min="0.01" step="0.01" value={amount} onChange={e=>setAmount(e.target.value)}/></label><label>Approved credit-note reference (when required)<input maxLength={200} value={creditNote} onChange={e=>setCreditNote(e.target.value)}/></label><button disabled={busy||!reason.trim()||!amount||!capabilities.refundsEnabled} onClick={()=>{operationKey.current ||= crypto.randomUUID();return act('refund',{key:operationKey.current,amountPaise:Math.round(Number(amount)*100),reason,creditNoteReference:creditNote,...(capture?{captureId:capture}:{})});}}>Request authorized refund</button></>}
      {admin&&finance&&c.delivery==='COMPLETED'&&<><label>Service-delivery finance review evidence<input maxLength={200} value={evidence} onChange={e=>setEvidence(e.target.value)}/></label><button disabled={busy||!evidence||!reason.trim()} onClick={()=>act('recognize',{reason,evidenceReference:evidence})}>Recognize reviewed service revenue</button></>}
    </>}
  </section>;
}
