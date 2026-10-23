// Isolated UI fixtures: no production API calls or actual payment checkout.
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import Onboarding from '../src/modules/Seller/pages/OnboardingPage';
import SellerContext from '../src/modules/Seller/context/SellerContext';
import GstAssistance from '../src/components/gst/GstAssistance';
import '../src/modules/Seller/Seller.css';
for (const key of ['sellerToken','adminToken']) localStorage.setItem(key,'gst-browser-fixture');
window.Razorpay=class {constructor(options){this.options=options;}on(){}close(){}open(){this.options.handler({razorpay_order_id:'order_gst_browser',razorpay_payment_id:'pay_gst_browser',razorpay_signature:'fixture-only'});}};
function App(){
  const [step,setStep]=useState(7),[gst,setGst]=useState({choice:'without_gstin'});
  if(window.location.pathname.startsWith('/gst-admin'))return <GstAssistance admin/>;
  if(window.location.pathname.startsWith('/gst-vendor'))return <GstAssistance/>;
  const complete=window.location.search.includes('complete=1');
  const context={onboardingStep:step,setOnboardingStep:setStep,gstDecision:gst,setGstDecision:setGst,panNumber:complete?'ABCDE1234F':'',setPanNumber:()=>{},
    uploadedDocs:complete?{aadhaarFront:{name:'front.pdf',size:100},aadhaarBack:{name:'back.pdf',size:100},passbook:{name:'bank.pdf',size:100}}:{},
    bizForm:{storeName:'Browser test store'},bankForm:{},selectedTypes:['ecommerce'],submitSellerApplication:async()=>({ok:true}),handleDocUpload:()=>{},handleDocDelete:()=>{}};
  return <SellerContext.Provider value={context}><Onboarding/></SellerContext.Provider>;
}
createRoot(document.getElementById('root')).render(<App/>);
