import React, { useRef, useState } from 'react';
import { gstApi } from './gstApi';
import { openRazorpayCheckout } from '../../utils/razorpayCheckout';
export default function GstPaymentPanel({ row, admin=false, onUpdated }) {
  const [accepted,setAccepted]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  const lock=useRef(false),key=useRef(crypto.randomUUID());
  const bill=row.billing;
  if(!bill)return <p>The GST assistance fee is awaiting configuration by Bulkimart. Your seller registration can continue.</p>;
  const payable=!admin&&!['cancelled','rejected','completed'].includes(row.status)&&!['paid','partial_refund','refunded'].includes(bill.status)&&!bill.reviewRequired;
  async function run(pay){if(lock.current)return;lock.current=true;setBusy(true);setMessage('');const token=localStorage.getItem('sellerToken');try{
    if(pay){
      const checkout=await gstApi(false,'/me/payment',{method:'POST',headers:{'Idempotency-Key':key.current},json:{amountPaise:bill.amountPaise,feeVersion:bill.version,acceptTerms:accepted}});
      const result=await openRazorpayCheckout(checkout,{Authorization:`Bearer ${token}`,'Content-Type':'application/json'});
      if(token!==localStorage.getItem('sellerToken'))return;
      setMessage(result.ok?'Payment verified. Bulkimart has received your service fee.':result.message);
    }else{const result=await gstApi(false,'/me/payment-status',{method:'POST',json:{}});setMessage(result.status==='paid'?'Payment verified. Bulkimart has received your service fee.':`Payment status: ${result.status}`);}
    await onUpdated?.();
  }catch(e){setMessage(e.message);}finally{lock.current=false;setBusy(false);}}
  return <section className="gst-payment-panel" aria-label="GST assistance payment"><h4>Bulkimart service fee: ₹{(bill.amountPaise/100).toFixed(2)}</h4><p>Payment status: {bill.status}</p><p>{bill.terms}</p>
    {bill.reviewRequired&&<p role="status">This payment needs Bulkimart review. Contact support for reconciliation or refund assistance.</p>}
    {payable&&<><p>You can finish seller registration before paying. GST assistance work requires verified payment.</p><label><input type="checkbox" checked={accepted} onChange={e=>setAccepted(e.target.checked)}/> I accept the displayed service fee and payment terms.</label><button disabled={busy||!accepted} onClick={()=>run(true)}>Pay ₹{(bill.amountPaise/100).toFixed(2)} to Bulkimart</button></>}
    {!admin&&['pending','failed','paid'].includes(bill.status)&&<button disabled={busy} onClick={()=>run(false)}>Check payment status</button>}
    {message&&<p role="status">{message}</p>}
  </section>;
}
