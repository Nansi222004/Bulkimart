import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {hookHarness} from '../tests/service-hookHarness.mjs';
import {startRiderPresence} from '../src/modules/Delivery/utils/riderPresence.js';
let vite,Inbox,socket;
before(async()=>{vite=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom'});Inbox=(await vite.ssrLoadModule('/src/components/parcels/ParcelRiderInbox.jsx')).default;socket=(await vite.ssrLoadModule('/src/utils/socket.js')).socket;});
after(async()=>{socket?.disconnect();await vite?.close();});
const row={_id:'507f1f77bcf86cd799439022',status:'searching_for_driver',version:1,pickupArea:'452001',dropoffArea:'452006',earningPaise:1000,offer:{token:'broadcast',expiresAt:new Date(Date.now()+60000).toISOString()}};
async function reply(h,data,status=200){h.requests.at(-1).resolve({data,message:status===409?'Offer unavailable':undefined},status);await h.settle();}
const notify=()=>{for(const fn of socket.listeners('notification_new'))fn({event:'PARCEL_UPDATED'});};
test('dashboard receives parcel offers, accepts once, and shows the assigned pickup link',async()=>{
  const h=hookHarness(Inbox,{enabled:true},'/delivery/dashboard');
  try{
    await reply(h,[]);notify();await h.settle();await reply(h,[row]);
    assert.ok(h.find(n=>n.props?.children==='New parcel request'));
    const acceptButton=h.find(n=>n.props?.children==='Accept parcel');acceptButton.props.onClick();h.rerender();assert.equal(JSON.parse(h.requests.at(-1).options.body).token,'broadcast');
    const count=h.requests.length;acceptButton.props.onClick();h.rerender();assert.equal(h.requests.length,count);
    await reply(h,{...row,offer:undefined,status:'driver_assigned'});await reply(h,[{...row,offer:undefined,status:'driver_assigned'}]);
    assert.ok(h.find(n=>n.props?.children==='Open pickup and delivery task'));
    assert.equal(h.find(n=>n.props?.children==='Accept parcel'),undefined);
  }finally{h.close();}
});
test('withdrawal refresh removes another rider offer and ignores late reads',async()=>{
  const h=hookHarness(Inbox,{enabled:true},'/delivery/dashboard');
  try{await reply(h,[row]);notify();await h.settle();const old=h.requests.at(-1);notify();await h.settle();await reply(h,[]);old.resolve({data:[row]});await h.settle();assert.equal(h.find(n=>n.props?.children==='Accept parcel'),undefined);}finally{h.close();}
});
test('losing an acceptance clears the dashboard offer',async()=>{
  const h=hookHarness(Inbox,{enabled:true},'/delivery/dashboard');
  try{await reply(h,[row]);h.click('Accept parcel');await reply(h,null,409);await reply(h,[]);assert.equal(h.find(n=>n.props?.children==='Accept parcel'),undefined);assert.ok(h.find(n=>n.props?.role==='status'));}finally{h.close();}
});
test('presence asks for fresh GPS every minute and never posts after cleanup',async()=>{
  const originalSet=globalThis.setInterval,originalClear=globalThis.clearInterval;let tick,success,requests=0,sent=[];
  globalThis.setInterval=(fn,ms)=>{assert.equal(ms,60000);tick=fn;return 77;};globalThis.clearInterval=()=>{};
  try{
    const stop=startRiderPresence({geolocation:{getCurrentPosition(ok,_fail,options){requests++;success=ok;assert.equal(options.maximumAge,0);}},send:async p=>sent.push(p)});
    await success({coords:{latitude:22.74,longitude:75.84}});tick();assert.equal(requests,2);stop();await success({coords:{latitude:0,longitude:0}});tick();assert.equal(requests,2);assert.equal(sent.length,1);
  }finally{globalThis.setInterval=originalSet;globalThis.clearInterval=originalClear;}
});
test('Update location restarts a request that is still waiting and reports progress',async()=>{
  let calls=[],pendingStates=[],sent=[];
  const stop=startRiderPresence({gpsTimeoutMs:60000,geolocation:{getCurrentPosition(ok){calls.push(ok);}},send:async point=>sent.push(point),onPendingChange:value=>pendingStates.push(value)});
  try{
    assert.deepEqual(pendingStates,[true]);
    stop.refresh();assert.equal(calls.length,2,'a manual tap must not be swallowed while the first fix is pending');
    await calls[0]({coords:{latitude:1,longitude:1}});assert.equal(sent.length,0,'the superseded fix is ignored');
    await calls[1]({coords:{latitude:22.74,longitude:75.84}});assert.equal(sent.length,1);assert.equal(pendingStates.at(-1),false);
  }finally{stop();}
});
test('a blocked location permission tells the rider how to turn it back on',async()=>{
  const messages=[];
  const stop=startRiderPresence({geolocation:{getCurrentPosition(_ok,fail){fail({code:1});}},send:async()=>{},onError:message=>messages.push(message)});
  try{assert.match(messages.at(-1),/permission is blocked/);}finally{stop();}
});
test('a stalled GPS permission request times out, permits retry, and ignores its late fix',async()=>{
  let calls=[],messages=[],sent=[];
  const stop=startRiderPresence({gpsTimeoutMs:5,geolocation:{getCurrentPosition(ok){calls.push(ok);}},send:async point=>sent.push(point),onError:message=>messages.push(message)});
  try{
    await new Promise(resolve=>setTimeout(resolve,15));assert.ok(messages.at(-1).includes('tap Update location'));stop.refresh();assert.equal(calls.length,2);
    await calls[0]({coords:{latitude:0,longitude:0}});assert.equal(sent.length,0);
    await calls[1]({coords:{latitude:22.74,longitude:75.84}});assert.equal(sent.length,1);
  }finally{stop();}
});
