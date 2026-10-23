import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import Billing from '../src/components/advertising/AdvertisingBillingPanel';
import Editor from '../src/components/advertising/AdvertisingBillingPolicyEditor';
import '../src/components/advertising/advertising.css';
// SDK fixture only. Real gateway transport is exercised by the separate probe;
// authoritative capture, webhook and accounting checks use disposable MongoDB.
localStorage.setItem('sellerToken','synthetic-browser-only-session');
window.Razorpay=class{
  constructor(options){this.options=options;}
  on(){}close(){}
  open(){window.__checkoutAmount=this.options.amount;void this.options.handler({razorpay_order_id:'order_browser',razorpay_payment_id:'pay_browser',razorpay_signature:'fixture-only-signature'});}
};
function Fixture(){const [policy,setPolicy]=useState({startCondition:'VERIFIED_PAYMENT_OR_REQUESTED_START'});return <main className="advertising-workspace"><h1>Synthetic advertising billing</h1><Billing id="campaign-browser" capabilities={{paymentsEnabled:true}}/><Editor value={policy} onChange={setPolicy}/></main>;}
createRoot(document.getElementById('root')).render(<Fixture/>);
