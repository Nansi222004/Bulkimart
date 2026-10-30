import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';
import {hookHarness} from '../tests/service-hookHarness.mjs';
let vite,Panel;
before(async()=>{vite=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom'});Panel=(await vite.ssrLoadModule('/src/components/parcels/ParcelAdminPanel.jsx')).default;});
after(async()=>await vite?.close());
const id='507f1f77bcf86cd799439022',pid='507f1f77bcf86cd799439023';
const booking={_id:id,reference:'PD-507F1F77BCF86CD799439022',version:3,status:'needs_admin_assignment',paymentMethod:'online',paymentStatus:'paid',feePaise:2040,details:{pickup:{name:'Sender',address:'Pickup street',pincode:'452001',phone:'9876500011'},dropoff:{name:'Recipient',address:'Drop street',pincode:'452006'}},pricing:{driverPaise:1020},cash:{status:'not_applicable'},finance:{held:true},drivers:[{_id:pid,name:'Ritik Tiwari'}],assignment:{reason:'no_eligible_driver',attempts:[{partnerId:pid,token:'SECRET-OFFER-TOKEN',number:1,outcome:'timeout',offeredAt:'2026-10-25T12:00:00Z'}]},history:[{status:'needs_admin_assignment',reason:'no_eligible_driver',at:'2026-10-25T12:03:00Z'}],ledger:[{_id:'ledger',account:'parcel_collections',amount:20.4,direction:'credit',createdAt:'2026-10-25T12:00:00Z'}],payment:{gatewayAttempts:[{attemptId:'SECRET-ATTEMPT',amountPaise:2040,createdAt:'2026-10-25T12:00:00Z'}],refundObligations:[]}};
async function reply(h,data,status=200){h.requests.at(-1).resolve({data,meta:{pages:1},message:status===409?'Driver unavailable':undefined},status);await h.settle();}
const html=h=>renderToStaticMarkup(h.tree);
test('list uses friendly statuses and compact booking cards; filters keep backend status values',async()=>{
  const h=hookHarness(Panel,{},'/admin/parcel-delivery');
  try{
    await reply(h,[booking]);const output=html(h);assert.ok(output.includes('Parcel #439022'));assert.ok(output.includes('Needs a delivery partner'));assert.ok(output.includes('Paid online'));assert.ok(output.includes('Sender'));assert.ok(!output.includes('needs admin assignment'));assert.ok(h.find(n=>n.props?.className==='parcel-admin-booking-row'));
    h.click('Needs a delivery partner');assert.match(h.requests.at(-1).url,/status=needs_admin_assignment/);await reply(h,[]);assert.ok(html(h).includes('No bookings found'));
  }finally{h.close();}
});
test('detail replaces raw JSON and tokens with named request history and accurate rupee amounts',async()=>{
  const h=hookHarness(Panel,{},'/admin/parcel-delivery?parcel='+id);
  try{
    await reply(h,booking);const output=html(h);
    for(const text of ['Choose a delivery partner','Ritik Tiwari','No reply in time','Payment summary','Paid online','₹20.40'])assert.ok(output.includes(text),text);
    for(const text of ['SECRET-OFFER-TOKEN','SECRET-ATTEMPT','no_eligible_driver','refundedPaise','<pre','Assignment and finance audit'])assert.ok(!output.includes(text),text);
    assert.equal(h.find(n=>n.type==='pre'),undefined);assert.ok(output.includes('customer has already paid'));
  }finally{h.close();}
});
test('partner search shows names and sends the existing protected assignment payload',async()=>{
  const h=hookHarness(Panel,{},'/admin/parcel-delivery?parcel='+id);
  const previous=globalThis.FormData;
  try{
    await reply(h,booking);h.click('Find available partners');await reply(h,[{_id:pid,name:'Ritik Tiwari',vehicleType:'bike',pickupDistanceKm:1.2,zones:['452001','452006']}]);
    const output=html(h);assert.ok(output.includes('Ritik Tiwari'));assert.ok(output.includes('1.2 km from pickup'));assert.ok(!output.includes(pid+' ·'));
    globalThis.FormData=class{get(key){return {partnerId:pid,reason:'Rider is now available'}[key];}};
    h.find(n=>n.type==='form').props.onSubmit({preventDefault(){},currentTarget:{}});h.rerender();
    const write=h.requests.at(-1);assert.match(write.url,/\/assign$/);assert.deepEqual(JSON.parse(write.options.body),{partnerId:pid,reason:'Rider is now available',version:3});
    await reply(h,booking);await reply(h,{...booking,status:'searching_for_driver'});assert.ok(html(h).includes('Pickup request sent'));
  }finally{globalThis.FormData=previous;h.close();}
});
test('no available partners gives an actionable explanation instead of an empty driver selector',async()=>{
  const h=hookHarness(Panel,{},'/admin/parcel-delivery?parcel='+id);
  try{await reply(h,booking);h.click('Find available partners');await reply(h,[]);assert.ok(html(h).includes('go on duty'));assert.equal(h.find(n=>n.type==='select'&&n.props.name==='partnerId'),undefined);}finally{h.close();}
});
test('staff without finance records see no payment tools or financial review controls',async()=>{
  const h=hookHarness(Panel,{},'/admin/parcel-delivery?parcel='+id);
  try{await reply(h,{...booking,payment:undefined,ledger:undefined,finance:{held:true}});const output=html(h);assert.ok(!output.includes('Payment troubleshooting'));assert.ok(!output.includes('Confirm online payment reached the bank'));}finally{h.close();}
});
test('Admin explains why an online named partner is unavailable instead of hiding the reason',async()=>{
  const h=hookHarness(Panel,{},'/admin/parcel-delivery?parcel='+id);
  try{
    await reply(h,booking);h.click('Find available partners');h.requests.at(-1).resolve({data:[],meta:{unavailableDrivers:[{_id:pid,name:'Ritik Tiwari',reason:'location_outdated',locationAgeSeconds:1140,locationMaxAgeSeconds:300,pickupDistanceKm:3.63,assignmentRadiusKm:5}]}});await h.settle();
    const output=html(h);for(const text of ['Ritik Tiwari','within 5 minutes','19 minutes ago','3.63 km','tap Update location'])assert.ok(output.includes(text),text);
    assert.ok(!output.includes('location_outdated'));assert.equal(h.find(n=>n.props?.className==='parcel-admin-unavailable').props.open,true);
  }finally{h.close();}
});
