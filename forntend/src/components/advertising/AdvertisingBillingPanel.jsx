import React, {useEffect,useRef,useState} from 'react';
import {advertisingApi,advertisingMoney,plainStatus,GST_CHOICES} from './advertisingApi';
const STOREFRONT={ECOMMERCE:'Shop All',QUICK:'Quick Commerce'};
import {openRazorpayCheckout} from '../../utils/razorpayCheckout';
const when=d=>new Date(d).toLocaleString('en-IN',{dateStyle:'medium',timeStyle:'short'});
// One sentence telling the seller where the campaign stands and what happens next.
export function sellerPaymentStatus(c,data,p){
  if(c.pilot?.enabled) return 'A free test run is active. Payment is available after Bulkimart stops the test.';
  // A stopped paid ad: say plainly that the refund is reviewed by Bulkimart, or that it is on its way.
  const r=data?.refund;
  if(r&&c.funding==='REFUND_PENDING'){
    const stopped={CANCELLED:'Cancelled.',ADMIN_SUSPENDED:'Suspended by Bulkimart.',UNAVAILABLE:'Your ad has stopped because your products cannot be shown.'}[c.delivery]||'Your ad has stopped.';
    const sending=(p?.refunds||[]).filter(x=>['DISPATCHING','UNKNOWN','PENDING'].includes(x.status)).reduce((sum,x)=>sum+x.amountPaise,0);
    if(r.inProgress)return `${stopped} Your refund of ${advertisingMoney(sending)} is on its way to your original payment method.`;
    return r.remainingPaise>0?`${stopped} Bulkimart will review your refund (up to ${advertisingMoney(r.remainingPaise)}) to your original payment method.`:`${stopped} No refund is due under the package terms you accepted.`;
  }
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
    // The refund amount starts at the server's suggestion (the unused share of the run); the admin can change it.
    setCapture('');advertisingApi(admin,`/campaigns/${id}/billing`).then(b=>{if(!alive)return;setData(b.data);if(admin&&b.data?.refund?.suggestedPaise>0&&!b.data.refund.started)setAmount(String(b.data.refund.suggestedPaise/100));}).catch(e=>alive&&setError(e.message));return()=>{alive=false;generation.current++;};
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
          <p>Your ad stops straight away. Bulkimart then reviews your refund{p?.receiptPaise&&q?.policy?.refunds?` (up to ${advertisingMoney(Math.floor(p.receiptPaise*q.policy.refunds.cancellationBps/10000))} under the terms you accepted)`:' under the terms you accepted'} and sends it to your original payment method.</p>
          <button disabled={busy||!reason.trim()} onClick={()=>act('cancel',{version:c.version,reason})}>Cancel campaign</button>
        </details>}
      </>}
    </section>;
  }
  // Admin view: a short summary first; the accepted terms, payment record and each finance action
  // sit in their own folded sections, opened only when needed.
  const percent=bps=>`${bps/100}%`;
  const reasonField=<label className="ad-field"><span className="ad-field-title">Reason</span><textarea maxLength={2000} placeholder="Why are you doing this? It is saved with the action." value={reason} onChange={e=>setReason(e.target.value)}/></label>;
  const canRequestPayment=finance&&q&&c?.review==='APPROVED'&&c?.funding==='UNPAID'&&!data?.paidAuthorization;
  const canCheck=reconcile&&p,canRefund=refund&&p,canEarn=finance&&c?.delivery==='COMPLETED';
  // A stopped paid ad nobody has refunded yet, with the limit and the suggestion for the unused days.
  const r=data?.refund,refundWaiting=Boolean(r&&!r.started&&r.remainingPaise>0);
  const refundNote=r?`Up to ${advertisingMoney(r.remainingPaise)} can be refunded${r.refundedPaise?` (${advertisingMoney(r.refundedPaise)} already refunded)`:''}. Suggested ${advertisingMoney(r.suggestedPaise)}: the ad ran ${r.daysRun} of ${r.durationDays} days${r.daysRun?'':' (it had not started)'}. You decide the amount.`:'';
  return <section className="ad-card ad-billing-panel" aria-label="Payment and ad status">
    <div className="ad-pay-head"><h3>Payment and ad status</h3><button type="button" disabled={busy} onClick={()=>setRefresh(n=>n+1)}>Refresh</button></div>
    {error&&<p role="alert" className="ad-error">{error}</p>}
    {!data&&!error&&<p role="status">Loading payment details…</p>}
    {data&&<>
      <ul className="ad-billing-states" aria-label="Campaign state">
        <li><span>Review</span><strong>{plainStatus('review',c.review)}</strong></li>
        <li><span>Payment</span><strong>{plainStatus('funding',c.funding)}</strong></li>
        <li><span>Ad</span><strong>{plainStatus('delivery',c.delivery)}</strong></li>
      </ul>
      {q?<p className="ad-billing-line"><strong>{c.terms?.name}</strong> · {STOREFRONT[c.module]||c.module} · {q.taxPaise?<>{advertisingMoney(q.basePaise)} + {advertisingMoney(q.taxPaise)} GST = <strong>{advertisingMoney(q.totalPaise)}</strong></>:<><strong>{advertisingMoney(q.totalPaise)}</strong> (no GST)</>} for {c.terms.durationDays} days</p>
        :<p className="ad-notice" role="alert">The seller cannot pay for this campaign yet: it was submitted when its package had no GST and refund terms saved. Open the package in “Packages and policies”, check the GST and click “Save changes”, then click “Request changes” here so the seller submits the campaign again with the saved terms.</p>}
      <p className="ad-billing-line">{['UNPAID','PAYMENT_PENDING','PAYMENT_FAILED'].includes(c.funding)?`Seller can pay: ${data.paidAuthorization?'yes, payment is open':'not yet'}.`:''}{c.paid?.startAt?` Paid ad runs ${when(c.paid.startAt)} – ${when(c.paid.endAt)}.`:''}{c.pilot?` Free test run (separate from the paid ad): ${c.pilot.enabled?'on':'stopped'}.`:''}</p>
      {p&&<div className="ad-metrics-tiles" aria-label="Money">
        <div><strong>{advertisingMoney(p.receiptPaise)}</strong><span>Received from seller</span></div>
        <div><strong>{advertisingMoney(p.refundedPaise)}</strong><span>Refunded</span></div>
        <div><strong>{advertisingMoney(p.recognizedPaise)}</strong><span>Counted as earned (after the ad ends)</span></div>
      </div>}
      {refundWaiting&&<p className="ad-notice ad-refund-waiting" role="alert"><strong>Refund waiting.</strong> {c.delivery==='CANCELLED'?'This paid campaign was cancelled':'This paid ad has stopped'} and no refund has been sent yet. {refundNote}{canRefund?' Use “Refund the seller” below.':' Someone with refund access needs to send it.'}</p>}

      {q&&<details className="ad-fold"><summary>Terms the seller accepted</summary>
        <p>Billed by {q.policy.issuer}. GST: {GST_CHOICES[q.policy.taxTreatment]||q.policy.taxTreatment}{q.policy.taxRateBps?` at ${percent(q.policy.taxRateBps)}`:''}. Terms reference: {q.policy.approvalReference}.</p>
        <p>The ad starts when the seller has paid, or on the chosen start date if that is later. If the ad has to stop, it stays stopped until Bulkimart checks it, and the lost days are not added back automatically.</p>
        <p>Most that can be refunded: {percent(q.policy.refunds.cancellationBps)} if cancelled, {percent(q.policy.refunds.suspensionBps)} if suspended, {percent(q.policy.refunds.unavailableBps)} if the ad cannot be shown, {percent(q.policy.refunds.unusedBps)} of unused days. Every refund needs approval.</p>
      </details>}
      {p&&<details className="ad-fold"><summary>Payment record</summary>
        <p>Payment {p.reference}: {p.status}{p.checkoutExpired?' · payment time ran out':''} · Razorpay order: {p.creation} · Checked with Razorpay: {p.reconciliation||'not yet'}</p>
        {p.gatewayFeePaise!==undefined&&<p>Razorpay fee: {advertisingMoney(p.gatewayFeePaise)} (tax on the fee: {advertisingMoney(p.gatewayFeeTaxPaise)}). The bank payout is checked separately.</p>}
        {p.invoiceReference&&<p>Invoice number: {p.invoiceReference}</p>}
        {p.refunds.map(r=><div key={r.key}><p>Refund {advertisingMoney(r.amountPaise)}: {r.status} · {r.reason}{r.creditNoteReference?` · Credit note ${r.creditNoteReference}`:''}</p>{reconcile&&['UNKNOWN','PENDING','DISPATCHING'].includes(r.status)&&<button disabled={busy} onClick={()=>act('refund-reconcile',{key:r.key})}>Check this refund with Razorpay</button>}</div>)}
        {data.journal&&<details className="ad-fold"><summary>Accounting entries (cannot be changed)</summary><ul>{data.journal.map(e=><li key={e.id}>{e.entryNo} · {e.account} · {e.direction} · {advertisingMoney(e.amountPaise)} · {new Date(e.at).toLocaleString()}</li>)}</ul>{data.journalTruncated&&<p>Only the latest entries are shown. Ask finance for a full export.</p>}</details>}
      </details>}

      {(canRequestPayment||canCheck||canRefund||canEarn)&&<div className="ad-billing-tools">
        <h4>Finance tools</h4>
        {canRequestPayment&&<details className="ad-fold ad-tool"><summary>Open payment for the seller</summary>
          <p>Lets the seller pay for this approved campaign.</p>{reasonField}
          <label className="ad-field"><span className="ad-field-title">Invoice number (only if this package needs one)</span><input maxLength={200} value={invoice} onChange={e=>setInvoice(e.target.value)}/></label>
          <button className="ad-primary" disabled={busy||!reason.trim()} onClick={()=>act('billing-authorize',{version:c.version,reason,invoiceReference:invoice})}>Request seller payment</button>
        </details>}
        {canCheck&&<details className="ad-fold ad-tool"><summary>Check a payment with Razorpay</summary>
          <p>Use only if a payment looks stuck or wrong, for example the seller paid but it still shows “Payment in progress”. Bulkimart asks Razorpay what really happened and updates the campaign.</p>
          <label className="ad-field"><span className="ad-field-title">Razorpay order ID (only if the order was not recorded)</span><input value={gatewayOrder} onChange={e=>setGatewayOrder(e.target.value)}/></label>
          <button disabled={busy} onClick={()=>act('reconcile',gatewayOrder?{gatewayOrderId:gatewayOrder}:{})}>Check payment with Razorpay</button>
        </details>}
        {canRefund&&<details className="ad-fold ad-tool" open={refundWaiting||undefined}><summary>Refund the seller</summary>
          <p>Sends money back to the seller’s original payment method and stops the ad. The amount cannot go above the refund limits in the accepted terms.</p>
          {data.refund&&<p>{refundNote}</p>}{reasonField}
          {data.gateway&&<label className="ad-field"><span className="ad-field-title">Payment to refund</span><select value={capture} onChange={e=>setCapture(e.target.value)}><option value="">Main payment</option>{data.gateway.captures.map(r=><option key={r.id} value={r.id}>{r.id} · {advertisingMoney(r.amountPaise)} · {r.disposition}</option>)}</select></label>}
          <div className="ad-form-grid">
            <label className="ad-field"><span className="ad-field-title">Refund amount (₹)</span><input type="number" min="0.01" step="0.01" value={amount} onChange={e=>setAmount(e.target.value)}/></label>
            <label className="ad-field"><span className="ad-field-title">Credit note number (only if needed)</span><input maxLength={200} value={creditNote} onChange={e=>setCreditNote(e.target.value)}/></label>
          </div>
          {!capabilities.refundsEnabled&&<p>Refunds are not available right now.</p>}
          <button className="ad-danger" disabled={busy||!reason.trim()||!amount||!capabilities.refundsEnabled} onClick={()=>{operationKey.current ||= crypto.randomUUID();return act('refund',{key:operationKey.current,amountPaise:Math.round(Number(amount)*100),reason,creditNoteReference:creditNote,...(capture?{captureId:capture}:{})});}}>Request refund</button>
        </details>}
        {canEarn&&<details className="ad-fold ad-tool"><summary>Mark ad money as earned</summary>
          <p>The ad has finished. After finance has checked it ran, this records the payment as Bulkimart’s income.</p>{reasonField}
          <label className="ad-field"><span className="ad-field-title">Finance check reference (proof the ad ran)</span><input maxLength={200} value={evidence} onChange={e=>setEvidence(e.target.value)}/></label>
          <button className="ad-primary" disabled={busy||!evidence||!reason.trim()} onClick={()=>act('recognize',{reason,evidenceReference:evidence})}>Mark ad money as earned</button>
        </details>}
      </div>}
    </>}
  </section>;
}
