import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {hookHarness} from '../tests/service-hookHarness.mjs';
let vite,Billing,Finance,Metrics,observer,Block;
before(async()=>{
  vite=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom'});
  Billing=(await vite.ssrLoadModule('/src/components/advertising/AdvertisingBillingPanel.jsx')).default;
  Finance=(await vite.ssrLoadModule('/src/components/advertising/AdvertisingFinancePanel.jsx')).default;
  Metrics=(await vite.ssrLoadModule('/src/components/advertising/AdvertisingMetrics.jsx')).default;
  observer=(await vite.ssrLoadModule('/src/components/advertising/advertisingTelemetry.js')).observeAdImpressions;
  Block=(await vite.ssrLoadModule('/src/components/advertising/SponsoredCategoryBlock.jsx')).default;
});
after(async()=>vite.close());
const content=n=>n==null?'':typeof n!=='object'?String(n):[n.props?.children].flat(Infinity).map(content).join(' ');
const envelope=data=>({success:true,data});
const fixture=()=>({campaign:{id:'campaign-fixture',version:9,review:'APPROVED',funding:'PAYMENT_PENDING',delivery:'NOT_SCHEDULED',terms:{durationDays:9}},
  payment:{reference:'AD-fixture',status:'pending',creation:'ISSUED',receiptPaise:0,refundedPaise:0,recognizedPaise:0,refunds:[]},paidAuthorization:true,
  quote:{basePaise:10000,taxPaise:500,totalPaise:10500,policy:{approvalReference:'synthetic-approved-policy',issuer:'Fixture issuer',taxTreatment:'EXCLUSIVE',taxRateBps:500,refunds:{cancellationBps:10000,suspensionBps:10000,unavailableBps:10000,unusedBps:10000}}}});

test('seller checkout uses backend amount and dedicated verification; pending gateway data never becomes paid UI',async()=>{
  const h=hookHarness(Billing,{id:'campaign-fixture',capabilities:{paymentsEnabled:true}});let sdk;
  try{
    h.requests[0].resolve(envelope(fixture()));await h.settle();
    // The seller sees the total with its GST split, not the finance policy.
    assert.match(content(h.tree),/₹105\.00/);assert.match(content(h.tree),/₹5\.00 GST/);assert.doesNotMatch(content(h.tree),/Fixture issuer|synthetic-approved-policy/);
    window.Razorpay=class{constructor(options){sdk=options;}on(){}open(){}close(){}};
    const pending=h.click('Pay ₹105.00');assert.equal(h.requests.length,2);
    const body=JSON.parse(h.requests[1].options.body);assert.deepEqual(Object.keys(body).sort(),['idempotencyKey','version']);assert.equal(body.version,9);
    h.requests[1].resolve(envelope({checkout:{orderId:'campaign-fixture',keyId:'rzp_test_fixture',razorpayOrderId:'order_fixture',amountPaise:10500,currency:'INR',verificationPath:'/api/sellers/advertising/payment-verification'}}));await h.settle();
    assert.equal(sdk.amount,10500);
    const verifying=sdk.handler({razorpay_order_id:'order_fixture',razorpay_payment_id:'pay_fixture',razorpay_signature:'synthetic-signature'});
    assert.match(h.requests[2].url,/sellers\/advertising\/payment-verification$/);
    h.requests[2].resolve(envelope({status:'pending'}));await verifying;await pending;await h.settle();
    h.requests[3].resolve(envelope(fixture()));await h.settle();
    assert.match(content(h.tree),/Payment in progress/);assert.doesNotMatch(content(h.tree),/Paid\./);
  }finally{h.close();}
});

test('billing without a policy cannot offer usable checkout or invented taxes',async()=>{
  const h=hookHarness(Billing,{id:'campaign-fixture',capabilities:{paymentsEnabled:true}});
  try{const f=fixture();delete f.quote;h.requests[0].resolve(envelope(f));await h.settle();assert.equal(h.find(n=>n.type==='button'&&/^Pay/.test(content(n))),undefined,'No price, no payment button');assert.doesNotMatch(content(h.tree),/configured rate:|GST at|GST\)/);}finally{h.close();}
  // The admin is told in plain words why the seller cannot pay and how to fix it.
  const a=hookHarness(Billing,{id:'campaign-fixture',admin:true,permissions:['advertising_review','advertising_finance']});
  try{const f=fixture();delete f.quote;a.requests[0].resolve(envelope(f));await a.settle();const text=content(a.tree);
    assert.match(text,/The seller cannot pay for this campaign yet: it was submitted when its package had no GST and refund terms saved\./);assert.match(text,/Packages and policies/);
    assert.doesNotMatch(text,/versioned|UNPAID|NOT_SCHEDULED|PENDING_REVIEW|Funding:|Delivery:/);
    assert.equal(a.find(n=>n.type==='button'&&n.props.children==='Request seller payment'),undefined,'No payment request without a price');}finally{a.close();}
});

test('finance-only workspace exposes authorization queue and backend discrepancies',async()=>{
  const h=hookHarness(Finance,{permissions:['advertising_finance'],capabilities:{paymentsEnabled:true}});
  try{h.requests[0].resolve(envelope({totals:{receivedPaise:10500,refundedPaise:0,recognizedPaise:0},authorizationQueue:[{id:'new-campaign',name:'Actual approved campaign'}],rows:[],discrepancies:[{paymentId:'p1',code:'REFUND_RESULT_UNKNOWN'}],total:0,limit:20}));await h.settle();assert.match(content(h.tree),/REFUND_RESULT_UNKNOWN/);h.click('Review accepted campaign billing');assert.equal(h.find(n=>n.type===Billing).props.id,'new-campaign');}finally{h.close();}
});

test('review permission does not expose financial authorization, reconciliation or refund actions',async()=>{
  const h=hookHarness(Billing,{id:'campaign-fixture',admin:true,permissions:['advertising_review']});
  try{h.requests[0].resolve(envelope(fixture()));await h.settle();assert.equal(h.find(n=>n.type==='button'&&['Request seller payment','Request refund','Check payment with Razorpay','Check this refund with Razorpay','Mark ad money as earned'].includes(n.props.children)),undefined);}finally{h.close();}
});

test('viewability requires continuous half-visible time in a visible document and deduplicates one card',()=>{
  let callback,visibility;const timers=new Map(),sent=[],node={dataset:{adIndex:'0'}};let counter=0,unobserved=0,disconnected=0;
  const platform={document:{visibilityState:'visible',addEventListener:(_e,fn)=>{visibility=fn;},removeEventListener:()=>{}},setTimeout:fn=>{timers.set(++counter,fn);return counter;},clearTimeout:id=>timers.delete(id),IntersectionObserver:class{constructor(fn,options){callback=fn;assert.deepEqual(options.threshold,[0,0.5,1]);}observe(){}unobserve(){unobserved++;}disconnect(){disconnected++;}}};
  const cleanup=observer({querySelectorAll:()=>[node]},[{serveToken:'signed-fixture'}],(...args)=>sent.push(args),platform);
  callback([{target:node,isIntersecting:true,intersectionRatio:0.49}]);assert.equal(timers.size,0);
  callback([{target:node,isIntersecting:true,intersectionRatio:0.5}]);assert.equal(timers.size,1);
  platform.document.visibilityState='hidden';visibility();assert.equal(timers.size,0);assert.equal(sent.length,0);
  platform.document.visibilityState='visible';visibility();assert.equal(timers.size,1);
  [...timers.values()][0]();assert.deepEqual(sent,[['signed-fixture','IMPRESSION']]);assert.equal(unobserved,1);
  callback([{target:node,isIntersecting:true,intersectionRatio:1}]);assert.equal(sent.length,1);
  cleanup();assert.equal(disconnected,1);
});

test('actual sponsored link records an independent click and navigates even when telemetry fails',async()=>{
  const opened=[],productId='507f1f77bcf86cd799439013';
  const h=hookHarness(Block,{channel:'ecommerce',categoryId:'507f1f77bcf86cd799439011',organicProducts:[]},'/categories',{getDeliveryPoint:()=>null,setSelectedProduct:p=>opened.push(p),addToCart:()=>{}});
  try{h.requests[0].resolve({success:true,data:[{product:{_id:productId,name:'Fixture',price:10,stock:1,type:'ecommerce',variants:[{_id:'v1',price:10,stock:1}]},variantId:'v1',disclosure:'Sponsored',mode:'PAID_CATEGORY',serveToken:'signed-fixture',expiresAt:new Date(Date.now()+60000).toISOString()}],meta:{mode:'SPONSORED_CATEGORY'}});await h.settle();
    h.find(n=>n.type==='button'&&n.props.className==='sponsored-product-link').props.onClick();
    assert.equal(opened[0].id,productId);assert.equal(opened[0].variants[0].id,'v1');assert.equal(h.requests.length,2);
    assert.deepEqual(JSON.parse(h.requests[1].options.body),{token:'signed-fixture',type:'CLICK'});assert.equal(h.requests[1].options.credentials,'omit');
    h.requests[1].reject(Error('Telemetry offline'));await h.settle();assert.equal(opened.length,1);
  }finally{h.close();}
});

test('telemetry summary displays paid and pilot counts separately without conversions or fabricated ROAS',async()=>{
  const h=hookHarness(Metrics,{id:'campaign-fixture'});
  try{h.requests[0].resolve(envelope({rows:[{mode:'PAID_CATEGORY',type:'IMPRESSION',count:4},{mode:'PAID_CATEGORY',type:'CLICK',count:1},{mode:'NON_BILLABLE_PILOT',type:'IMPRESSION',count:9}],note:'Retention bounded synthetic event counts'}));await h.settle();assert.match(content(h.tree),/4/);assert.match(content(h.tree),/9/);assert.match(content(h.tree),/25/);assert.doesNotMatch(content(h.tree),/ROAS:\s*[0-9]/);}finally{h.close();}
});

test('admin payment panel: plain summary first, terms and payment record folded, each finance tool in its own section by permission',async()=>{
  const sections=h=>{const found=[];const walk=n=>{if(!n||typeof n!=='object')return;if(n.type==='summary')found.push(content(n).trim());[n.props?.children].flat(Infinity).forEach(walk);};walk(h.tree);return found;};
  const all=hookHarness(Billing,{id:'campaign-fixture',admin:true,permissions:['advertising_review','advertising_finance','advertising_reconcile','advertising_refund'],capabilities:{refundsEnabled:true}});
  try{const f=fixture();f.campaign.funding='FUNDED';f.campaign.delivery='SCHEDULED';f.payment.receiptPaise=10500;all.requests[0].resolve(envelope(f));await all.settle();const text=content(all.tree);
    assert.match(text,/Review\s+Approved[\s\S]*Payment\s+Paid[\s\S]*Ad\s+Scheduled/);
    assert.match(text,/₹100\.00\s+\+\s+₹5\.00\s+GST\s+=\s+₹105\.00\s+for\s+9\s+days/);
    assert.match(text,/₹105\.00\s+Received from seller[\s\S]*Refunded[\s\S]*Counted as earned \(after the ad ends\)/);
    assert.deepEqual(sections(all),['Terms the seller accepted','Payment record','Check a payment with Razorpay','Refund the seller']);
    assert.match(text,/Use only if a payment looks stuck or wrong/);assert.match(text,/Sends money back to the seller’s original payment method and stops the ad/);
    assert.doesNotMatch(text,/UNPAID|NOT_SCHEDULED|PENDING_REVIEW|FUNDED/);}finally{all.close();}
  const review=hookHarness(Billing,{id:'campaign-fixture',admin:true,permissions:['advertising_review']});
  try{review.requests[0].resolve(envelope(fixture()));await review.settle();assert.doesNotMatch(content(review.tree),/Finance tools/);assert.deepEqual(sections(review),['Terms the seller accepted','Payment record']);}finally{review.close();}
});
