import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {hookHarness} from '../tests/service-hookHarness.mjs';
let vite,Operations,socket;
before(async()=>{
  vite=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom'});
  Operations=(await vite.ssrLoadModule('/src/components/parcels/ParcelOperations.jsx')).ParcelDriverOperations;
  socket=(await vite.ssrLoadModule('/src/utils/socket.js')).socket;
});
after(async()=>{socket?.disconnect();await vite?.close();});
const id='507f1f77bcf86cd799439022';
const row={_id:id,reference:'PD-OFFER',status:'searching_for_driver',version:1,feePaise:2000,paymentMethod:'pay_driver',paymentStatus:'cash_due',offer:{token:'test-broadcast',expiresAt:new Date(Date.now()+60000).toISOString()}};
const last=h=>h.requests.at(-1);
async function respond(h,data,status=200){last(h).resolve({data,meta:{pages:1},message:status===404?'Booking not found':status===409?'Offer no longer available':undefined},status);await h.settle();}
const notify=()=>{for(const fn of socket.listeners('notification_new'))fn({event:'PARCEL_UPDATED'});};
test('new offer notifications refresh the list and stop after unmount',async()=>{
  const before=socket.listeners('notification_new').length,h=hookHarness(Operations,{},'/delivery/parcels');
  try{
    await respond(h,[]);notify();await h.settle();assert.match(last(h).url,/\/bookings\?page=1/);
    await respond(h,[row]);assert.ok(h.find(n=>n.props?.className?.includes('parcel-rider-list-card')));
    h.unmount();assert.equal(socket.listeners('notification_new').length,before);
  }finally{h.close();}
});
test('withdrawal notification removes an open offer and returns to the list',async()=>{
  const h=hookHarness(Operations,{},'/delivery/parcels?parcel='+id);
  try{
    await respond(h,row);assert.ok(h.find(n=>n.type==='button'&&n.props.children==='Accept parcel'));
    notify();await h.settle();assert.match(last(h).url,new RegExp('/bookings/'+id+'$'));
    await respond(h,null,404);await respond(h,[]);
    assert.equal(h.find(n=>n.type==='button'&&n.props.children==='Accept parcel'),undefined);
    assert.ok(h.find(n=>n.props?.role==='status'&&String(n.props.children).includes('no longer available')));
  }finally{h.close();}
});
test('losing acceptance removes stale buttons and refreshes available parcels',async()=>{
  const h=hookHarness(Operations,{},'/delivery/parcels?parcel='+id);
  try{
    await respond(h,row);h.click('Accept parcel');assert.equal(last(h).options.method,'POST');
    await respond(h,null,409);assert.match(last(h).url,/\/bookings\?page=1/);await respond(h,[]);
    assert.equal(h.find(n=>n.type==='button'&&n.props.children==='Accept parcel'),undefined);
  }finally{h.close();}
});
test('fallback polling refreshes the list and is cleaned up',async()=>{
  const originalSet=globalThis.setInterval,originalClear=globalThis.clearInterval;
  let tick,cleared=false;globalThis.setInterval=(fn,ms)=>{assert.equal(ms,10000);tick=fn;return 123456;};globalThis.clearInterval=id=>{if(id===123456)cleared=true;else originalClear(id);};
  let h;try{
    h=hookHarness(Operations,{},'/delivery/parcels');await respond(h,[]);tick();await h.settle();await respond(h,[row]);
    assert.ok(h.find(n=>n.props?.className?.includes('parcel-rider-list-card')));h.unmount();assert.equal(cleared,true);
  }finally{h?.close();globalThis.setInterval=originalSet;globalThis.clearInterval=originalClear;}
});
test('background refresh keeps an assigned rider proof form mounted',async()=>{
  const h=hookHarness(Operations,{},'/delivery/parcels?parcel='+id);
  const active={...row,status:'arrived_at_pickup',offer:undefined,cash:{status:'outstanding'},history:[]};
  try{
    await respond(h,active);assert.ok(h.find(n=>n.type==='input'&&n.props.name==='code'));
    notify();await h.settle();assert.ok(h.find(n=>n.type==='input'&&n.props.name==='code'));
    await respond(h,active);assert.ok(h.find(n=>n.type==='input'&&n.props.name==='code'));
  }finally{h.close();}
});
