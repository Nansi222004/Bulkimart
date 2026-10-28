import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {hookHarness} from '../tests/service-hookHarness.mjs';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
let v,Parcel,Flow,ui,Status;
before(async()=>{v=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom'});Parcel=(await v.ssrLoadModule('/src/components/parcels/ParcelDelivery.jsx')).default;Flow=(await v.ssrLoadModule('/src/components/parcels/ParcelBookingFlow.jsx')).default;ui=await v.ssrLoadModule('/src/components/services/CustomerServices.jsx');Status=(await v.ssrLoadModule('/src/components/parcels/ParcelCustomerStatus.jsx')).default;});
after(async()=>v?.close());
const id='507f1f77bcf86cd799439022', track='/parcel-delivery/track/'+id;
const booking={_id:id,reference:'PD-TEST',status:'delivered',feePaise:100,cash:{status:'not_applicable'},refund:{status:'none'},details:{pickup:{address:'Pickup'},dropoff:{address:'Dropoff'}},history:[]};
const has=(h,text)=>h.find(n=>[n.props?.children].flat(Infinity).some(c=>typeof c==='string'&&c.includes(text)) || n.type===Status&&renderToStaticMarkup(React.createElement(Status,n.props)).includes(text));
const noForm=h=>{assert.equal(h.find(n=>n.type==='form'),undefined);assert.equal(h.find(n=>n.type===Flow),undefined);};
const read=h=>h.requests.findLast(r=>r.url.includes('/bookings'));
async function reply(h,data,status=200){read(h).resolve({data,meta:{pages:1},message:status>=400?'Synthetic read failure':undefined},status);await h.settle();}
for(const code of [401,403,404,503])test('tracking read failure '+code+' never renders booking and retries successfully',async()=>{const h=hookHarness(Parcel,{},track);try{await reply(h,null,code);assert.ok(has(h,'Unable to load parcel tracking'));noForm(h);h.click('Retry');await reply(h,booking);assert.ok(has(h,'PD-TEST'));h.click('Refresh status');await reply(h,null,503);noForm(h);assert.ok(has(h,'Unable to load parcel tracking'));}finally{h.close();}});
for(const data of [null,{}, {details:null}])test('missing or malformed tracking data is safe '+JSON.stringify(data),async()=>{const h=hookHarness(Parcel,{},track);try{await reply(h,data);noForm(h);assert.ok(has(h,'unavailable')||has(h,'Unable to load parcel tracking'));}finally{h.close();}});
for(const path of ['/parcel-delivery/track','/parcel-delivery/track/bad','/parcel-delivery/track/'+id+'/extra'])test('invalid tracking path '+path,()=>{const h=hookHarness(Parcel,{},path);try{assert.ok(has(h,'Invalid parcel link'));noForm(h);assert.equal(read(h),undefined);}finally{h.close();}});
test('tracking succeeds without policy and browser back ignores older request',async()=>{const h=hookHarness(Parcel,{},track);try{const old=read(h);window.history.pushState(null,'','/parcel-delivery/history');window.dispatchEvent(new Event('popstate'));h.rerender();await reply(h,[]);old.resolve({data:booking});await h.settle();assert.ok(has(h,'No parcel bookings yet.'));assert.equal(has(h,'PD-TEST'),undefined);}finally{h.close();}});
test('unmount aborts tracking and late response cannot update',async()=>{const h=hookHarness(Parcel,{},track);try{const r=read(h);h.unmount();const count=h.updates;r.resolve({data:booking});await h.settle();assert.equal(h.updates,count);assert.equal(r.options.signal.aborted,true);}finally{h.close();}});
test('history empty only after successful empty read',async()=>{const h=hookHarness(Parcel,{},'/parcel-delivery/history');try{assert.ok(has(h,'Loading parcel history'));assert.equal(has(h,'No parcel bookings yet.'),undefined);await reply(h,[]);assert.ok(has(h,'No parcel bookings yet.'));}finally{h.close();}});
for(const code of [401,403,503])test('history failure '+code+' is not empty and retry recovers',async()=>{const h=hookHarness(Parcel,{},'/parcel-delivery/history');try{await reply(h,null,code);assert.ok(has(h,'Unable to load parcel history'));assert.equal(has(h,'No parcel bookings yet.'),undefined);h.click('Retry');await reply(h,[booking]);assert.ok(h.find(n=>n.props?.className==='parcel-row'));h.click('Refresh status');await reply(h,null,503);assert.ok(h.find(n=>n.props?.className==='parcel-row'));assert.ok(has(h,'Previously loaded deliveries'));assert.equal(has(h,'No parcel bookings yet.'),undefined);h.find(n=>n.props?.className==='parcel-row').props.onClick();assert.equal(window.location.pathname,track);}finally{h.close();}});
test('legal entry enabled destination and disabled/error states',async()=>{const h=hookHarness(ui.LegalServiceCard);try{h.requests[0].resolve({data:{catalogue:true}});await h.settle();h.requests[1].resolve({data:[{_id:id}],meta:{total:1}});await h.settle();assert.ok(h.find(n=>n.props?.href==='/legal-services'));}finally{h.close();}for(const status of [200,503]){const r=hookHarness(ui.LegalServiceCard);try{r.requests[0].resolve({data:{catalogue:false}},status);await r.settle();assert.ok(has(r,status===200?'currently available':'could not be checked'));assert.equal(r.find(n=>n.props?.href==='/legal-services'),undefined);}finally{r.close();}}});
test('home mounts two independent cards with separate capabilities',()=>{const h=hookHarness(ui.HomeServiceEntries);try{assert.ok(h.find(n=>n.type===ui.LegalServiceCard));assert.ok(h.find(n=>n.type===ui.ParcelServiceCard));}finally{h.close();}});
import {readFile} from 'node:fs/promises';
test('home keeps separate cards in existing Quick Home and Shop All discovery area',async()=>{const s=await readFile(new URL('../src/modules/User/pages/LandingPage.jsx',import.meta.url),'utf8');assert.match(s,/activeMode === 'shop-all' \|\| activeSubNav === 'grocery--home'/);assert.match(s,/<QuickActions \/>\s*<HomeServiceEntries \/>/);assert.match(s,/<BottomNav \/>/);for(const nav of ['categories','orders','cart','checkout','legal-services'])assert.ok(s.includes("case '"+nav+"':"));});
test('booking without policy renders unavailable safely',async()=>{const h=hookHarness(Parcel,{},'/parcel-delivery/book');try{h.requests.find(r=>r.url.endsWith('/capabilities')).resolve({data:enabledFlags});await h.settle();h.requests.find(r=>r.url.endsWith('/catalogue')).resolve({data:null});await h.settle();assert.ok(has(h,'Parcel booking is currently unavailable'));noForm(h);}finally{h.close();}});

test('booking received notice belongs only to the newly confirmed reference',async()=>{
  const h=hookHarness(Parcel,{},'/parcel-delivery/book'),otherId='507f1f77bcf86cd799439033';
  try{
    h.requests.find(r=>r.url.endsWith('/capabilities')).resolve({data:enabledFlags});await h.settle();
    h.requests.find(r=>r.url.endsWith('/catalogue')).resolve({data:readyPolicy});await h.settle();
    h.find(n=>n.type===Flow).props.onBooked({_id:id});h.rerender();await reply(h,booking);
    assert.ok(has(h,'Booking received.'));
    h.click('Delivery history');await reply(h,[{...booking,_id:otherId}]);
    h.find(n=>n.props?.className==='parcel-row').props.onClick();h.rerender();await reply(h,{...booking,_id:otherId});
    assert.equal(has(h,'Booking received.'),undefined);
  }finally{h.close();}
});

const enabledFlags={catalogue:true,booking:true,auto_assignment:true,admin_fallback:true,fulfilment:true,online_payment:true,pay_driver:false,productionBlocked:false};
const readyPolicy={ready:true,areas:[{name:'Test area'}],categories:['documents'],prohibitedItems:[]};

const onlineBooking={...booking,status:'payment_pending',paymentStatus:'pending',paymentMethod:'online',policyVersion:1};
async function newOnlineBooking(h){
  h.requests.find(r=>r.url.endsWith('/capabilities')).resolve({data:enabledFlags});await h.settle();
  h.requests.find(r=>r.url.endsWith('/catalogue')).resolve({data:readyPolicy});await h.settle();
  h.find(n=>n.type===Flow).props.onBooked(onlineBooking);h.rerender();await reply(h,onlineBooking);
}
test('confirmed new online booking immediately initializes checkout once without a second Pay click',async()=>{
  const h=hookHarness(Parcel,{},'/parcel-delivery/book');
  let options,opens=0;
  window.Razorpay=class{constructor(value){options=value;}on(){}open(){opens++;}close(){}};
  try{
    await newOnlineBooking(h);
    assert.ok(has(h,'Opening secure Razorpay checkout'));
    assert.equal(h.find(n=>n.type===Status),undefined,'Pending tracking must stay hidden while checkout is opening');
    const payment=h.requests.find(r=>r.url.endsWith('/payment'));
    assert.ok(payment,'Booking confirmation must immediately request the existing payment endpoint');
    assert.equal(JSON.parse(payment.options.body).policyVersion,1);
    payment.resolve({data:{orderId:id,razorpayOrderId:'order_synthetic',keyId:'rzp_test_synthetic',amountPaise:100,currency:'INR',verificationPath:'/api/parcel-delivery/payments/verify'}});await h.settle();
    assert.equal(opens,1);h.rerender();await h.settle();assert.equal(opens,1);
    options.modal.ondismiss();await h.settle();await reply(h,onlineBooking);assert.ok(has(h,'Payment was not completed'));
    assert.equal(h.requests.filter(r=>r.url.endsWith('/payment')).length,1);
  }finally{h.close();}
});

test('customer receipt uses clear progress, hides irrelevant finance fields and confirms only after payment',()=>{
  const unpaid=renderToStaticMarkup(React.createElement(Status,{booking:onlineBooking,justBooked:true}));
  assert.ok(unpaid.includes('Complete your payment'));assert.ok(!unpaid.includes('Booking received.'));assert.ok(!unpaid.includes('Cash:'));assert.ok(!unpaid.includes('Refund: none'));
  const paid=renderToStaticMarkup(React.createElement(Status,{booking:{...onlineBooking,paymentStatus:'paid',status:'searching_for_driver'},justBooked:true}));
  assert.ok(paid.includes('Finding your delivery partner'));assert.ok(paid.includes('Payment successful.'));assert.ok(paid.includes('Paid online'));assert.ok(paid.includes('<summary>Booking details</summary>'));
});

test('existing online tracking remains recoverable and never opens checkout merely from a page visit',async()=>{
  const h=hookHarness(Parcel,{},track);
  try{await reply(h,onlineBooking);assert.equal(h.requests.some(r=>r.url.endsWith('/payment')),false);assert.ok(has(h,'Pay '));}finally{h.close();}
});

test('new online checkout initialization error stays visible and manual retry uses the same attempt key',async()=>{
  const h=hookHarness(Parcel,{},'/parcel-delivery/book');
  try{
    await newOnlineBooking(h);const first=h.requests.find(r=>r.url.endsWith('/payment'));assert.ok(first);
    first.resolve({message:'Synthetic gateway unavailable'},503);await h.settle();assert.ok(has(h,'Synthetic gateway unavailable'));
    const pay=h.find(n=>n.type==='button'&&[n.props?.children].flat().some(c=>typeof c==='string'&&c.startsWith('Pay ')));
    pay.props.onClick();h.flush();
    const retry=h.requests.findLast(r=>r.url.endsWith('/payment'));assert.notEqual(first,retry);assert.equal(first.options.headers['Idempotency-Key'],retry.options.headers['Idempotency-Key']);
    retry.resolve({message:'Synthetic recoverable gateway error'},503);await h.settle();
  }finally{h.close();}
});
test('disabled catalogue shows availability without requesting the disabled endpoint',async()=>{
  const h=hookHarness(Parcel,{},'/parcel-delivery/book');
  try{h.requests.find(r=>r.url.endsWith('/capabilities')).resolve({data:{catalogue:false}});await h.settle();
    assert.ok(has(h,'Parcel booking is currently unavailable'));noForm(h);
    assert.equal(h.requests.some(r=>r.url.endsWith('/catalogue')),false);
    assert.equal(has(h,'Unable to load parcel delivery'),undefined);
    h.click('Check availability');h.requests.findLast(r=>r.url.endsWith('/capabilities')).resolve({data:enabledFlags});await h.settle();
    h.requests.findLast(r=>r.url.endsWith('/catalogue')).resolve({data:readyPolicy});await h.settle();
    assert.ok(h.find(n=>n.type===Flow));
  }finally{h.close();}
});
for(const override of [{fulfilment:false},{admin_fallback:false},{productionBlocked:true},{online_payment:false}])test('booking respects dispatch, production and payment prerequisites '+JSON.stringify(override),async()=>{
  const h=hookHarness(Parcel,{},'/parcel-delivery/book');
  try{h.requests.find(r=>r.url.endsWith('/capabilities')).resolve({data:{...enabledFlags,...override}});await h.settle();
    noForm(h);assert.ok(has(h,'Parcel booking is currently unavailable'));assert.equal(h.requests.some(r=>r.url.endsWith('/catalogue')),false);
  }finally{h.close();}
});
test('ineffective policy never opens the booking form',async()=>{
  const h=hookHarness(Parcel,{},'/parcel-delivery/book');
  try{h.requests.find(r=>r.url.endsWith('/capabilities')).resolve({data:enabledFlags});await h.settle();
    h.requests.find(r=>r.url.endsWith('/catalogue')).resolve({data:{...readyPolicy,ready:false}});await h.settle();
    noForm(h);assert.ok(has(h,'Parcel booking is currently unavailable'));
  }finally{h.close();}
});
test('parcel card offers a usable service link while booking is disabled',async()=>{
  const h=hookHarness(ui.ParcelServiceCard);
  try{h.requests[0].resolve({data:{catalogue:false}});await h.settle();
    assert.ok(h.find(n=>n.props?.href==='/parcel-delivery/book'&&n.props.children==='Send a Parcel'));
    assert.ok(h.find(n=>n.props?.href==='/parcel-delivery/history'));
    assert.equal(h.requests.length,1);assert.ok(has(h,'currently unavailable'));
  }finally{h.close();}
});
test('the cancel option follows the server and disappears once the parcel is picked up',async()=>{
  const summary=h=>h.find(n=>n.type==='summary'&&[n.props.children].flat().includes('Cancel this booking'));
  for(const [status,canCancel] of [['driver_assigned',true],['arrived_at_pickup',true],['picked_up',false],['in_transit',false],['arrived_at_dropoff',false]]){
    const h=hookHarness(Parcel,{},track);
    try{
      await reply(h,{...booking,status,canCancel,version:1});
      assert.equal(!!summary(h),canCancel,`${status}: cancel option ${canCancel?'shown':'hidden'}`);
      assert.equal(!!has(h,'can no longer be cancelled'),!canCancel,`${status}: picked-up note`);
    }finally{h.close();}
  }
});
test('tracking shows the delivery partner, a wallet refund and a live update time',async()=>{
  const partner={name:'Ravi Rider',vehicleType:'bike',vehicleNo:'KA01AB1234',rating:4.8,phone:'9876500013'};
  const h=hookHarness(Parcel,{},track);
  try{
    await reply(h,{...booking,status:'in_transit',partner});
    const output=renderToStaticMarkup(h.find(n=>n.type===Status)&&React.createElement(Status,h.find(n=>n.type===Status).props));
    for(const text of ['Your delivery partner','Ravi Rider','Bike · KA01AB1234 · ★ 4.8','href="tel:9876500013"'])assert.ok(output.includes(text),text);
    assert.ok(has(h,'Live · updated'),'Live update time is shown');
    h.click('Refresh status');await reply(h,{...booking,status:'cancelled',partner:undefined,refund:{status:'confirmed',refundedPaise:2040,toWallet:true}});
    const cancelled=renderToStaticMarkup(React.createElement(Status,h.find(n=>n.type===Status).props));
    assert.ok(cancelled.includes('refunded to your Bulkimart wallet'));assert.ok(cancelled.includes('₹20.40'));assert.ok(!cancelled.includes('Ravi Rider'));
  }finally{h.close();}
});
