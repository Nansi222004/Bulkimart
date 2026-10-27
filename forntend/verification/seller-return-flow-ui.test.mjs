import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { hookHarness } from '../tests/service-hookHarness.mjs';
let vite, Alerts, Returns, socket;
before(async () => {
  vite = await createServer({ configFile: 'vite.return-verification.config.mjs', server: { middlewareMode: true, hmr: false }, appType: 'custom' });
  Alerts = (await vite.ssrLoadModule('/src/modules/Seller/components/SellerReturnAlerts.jsx')).default;
  Returns = (await vite.ssrLoadModule('/src/modules/Seller/components/SellerReturnsTab.jsx')).default;
  socket = (await vite.ssrLoadModule('/src/utils/socket.js')).socket; socket.connect = () => socket;
});
after(async () => vite?.close());
const id='507f1f77bcf86cd799439011', other='507f1f77bcf86cd799439012';
const row={_id:id,status:'RETURN_REQUESTED',productName:'Amla',quantity:1,returnNumber:'RET-NEW',reason:'DAMAGED',pickup:{status:'NOT_ASSIGNED'}};
const context={sellerProfile:{_id:'seller-fixture',status:'approved'},selectedTypes:['quick']};
const text=n=>n==null?'':typeof n!=='object'?String(n):[n.props?.children].flat(Infinity).map(text).join(' ');
const emit=(event,payload)=>socket.listeners(event).forEach(fn=>fn(payload));
const storage=()=>{const entries=new Map();return {getItem:key=>entries.get(key)||null,setItem:(key,value)=>entries.set(key,value)};};
test('app startup recovers pending returns even when their notification was never persisted',async()=>{
  const tabs=[],sessionStorage=storage();
  const h=hookHarness(Alerts,{subscribePush:async()=>()=>{}},'/seller/dashboard',{...context,setActiveTab:tab=>tabs.push(tab)},{sessionStorage});
  try {
    h.requests[0].resolve({data:[]}); await h.settle();
    h.requests.at(-1).resolve({data:[row]}); await h.settle();
    const detail=h.requests.at(-1); assert.ok(detail.url.endsWith('/returns/'+id));
    detail.resolve({data:row}); await h.settle();
    assert.match(text(h.tree),/New return request/); assert.match(text(h.tree),/RET-NEW/);
    h.click('View return'); await h.settle();
    assert.deepEqual(tabs,['item-returns']);assert.equal(window.location.search,'?return='+id);assert.equal(h.tree,null);
    assert.ok(sessionStorage.getItem('bulkimart:seller-return-alerts:v1:seller-fixture').includes(id));
  } finally {h.close();}
});
test('socket and foreground push hints authorize and deduplicate the same return',async()=>{
  let foreground;
  const h=hookHarness(Alerts,{subscribePush:async fn=>{foreground=fn;return ()=>{};}},'/seller/orders',context,{sessionStorage:storage()});
  try {
    await h.settle(); const before=h.requests.length;
    emit('notification_new',{event:'RETURN_REQUESTED',metadata:{returnId:id}});
    foreground({data:{audience:'seller',event:'RETURN_REQUESTED',returnId:id}});
    assert.equal(h.requests.length,before+1);
    h.requests.at(-1).resolve({data:row});await h.settle();assert.match(text(h.tree),/RET-NEW/);
    h.find(n=>n.props?.['aria-label']==='Dismiss return alert').props.onClick();h.flush();
    emit('notification_new',{event:'RETURN_REQUESTED',metadata:{returnId:id}});assert.equal(h.tree,null);assert.equal(h.requests.length,before+1);
  } finally {h.close();}
});
test('resolved returns and unauthorized return references never become alerts',async()=>{
  const h=hookHarness(Alerts,{subscribePush:async()=>()=>{}},'/seller/dashboard',context);
  try {
    emit('notification_new',{event:'RETURN_REQUESTED',metadata:{returnId:id}});
    h.requests.at(-1).resolve({data:{...row,status:'APPROVED'}});await h.settle();assert.equal(h.tree,null);
    emit('notification_new',{event:'RETURN_REQUESTED',metadata:{returnId:other}});
    h.requests.at(-1).resolve({message:'Return not found'},404);await h.settle();assert.equal(h.tree,null);
  } finally {h.close();}
});
test('startup reconciliation follows notification pages beyond the first page',async()=>{
  const h=hookHarness(Alerts,{subscribePush:async()=>()=>{}},'/seller/dashboard',context);
  try {
    h.requests[0].resolve({data:[],meta:{pages:2}});await h.settle();assert.match(h.requests.at(-1).url,/page=2/);
    h.requests.at(-1).resolve({data:[{metadata:{returnId:id}}],meta:{pages:2}});await h.settle();
    h.requests.at(-1).resolve({data:row});await h.settle();assert.match(text(h.tree),/RET-NEW/);
  } finally {h.close();}
});
test('open details refresh after a rider accepts and retain only the newest response',async()=>{
  const h=hookHarness(Returns,{},'/seller/item-returns?return='+id,context);
  try {
    h.requests[0].resolve({data:[]});h.requests[1].resolve({data:{...row,status:'APPROVED'}});await h.settle();
    emit('return_pickup_assigned',{returnId:id});const older=h.requests.at(-1);
    emit('return_pickup_stage',{returnId:id});const latest=h.requests.at(-1);
    latest.resolve({data:{...row,pickup:{status:'ASSIGNED',partnerId:{userId:{name:'Assigned rider'}}}}});await h.settle();
    older.resolve({data:row});await h.settle();
    assert.equal(h.find(n=>n.props?.r).props.r.pickup.partnerId.userId.name,'Assigned rider');
    const before=h.requests.length;emit('return_pickup_assigned',{returnId:other});assert.equal(h.requests.length,before);
  } finally {h.close();}
});
test('the returns list loads subsequent pages so older returns remain available',async()=>{
  const h=hookHarness(Returns,{},'/seller/item-returns',context);
  try {
    h.requests[0].resolve({data:[row],meta:{pages:2}});await h.settle();
    assert.match(h.requests.at(-1).url,/page=2/);
    h.requests.at(-1).resolve({data:[{...row,_id:other,returnNumber:'RET-OLDER'}],meta:{pages:2}});await h.settle();
    assert.match(text(h.tree),/RET-NEW/);assert.match(text(h.tree),/RET-OLDER/);
  } finally {h.close();}
});
test('pending-return fallback runs when the notification service is unreachable',async()=>{
  const h=hookHarness(Alerts,{subscribePush:async()=>()=>{}},'/seller/dashboard',context);
  try {
    h.requests[0].reject(new Error('notification service offline'));await h.settle();
    assert.match(h.requests.at(-1).url,/sellers\/returns\?/);
    h.requests.at(-1).resolve({data:[row]});await h.settle();
    h.requests.at(-1).resolve({data:row});await h.settle();assert.match(text(h.tree),/RET-NEW/);
    emit('notification_new',{event:'RETURN_APPROVED',metadata:{returnId:id}});
    h.requests.at(-1).resolve({data:{...row,status:'APPROVED'}});await h.settle();assert.equal(h.tree,null);
  } finally {h.close();}
});
