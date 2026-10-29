import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { hookHarness } from '../tests/service-hookHarness.mjs';
let vite, Block, Card, unique;
before(async () => {
  vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' });
  const module = await vite.ssrLoadModule('/src/components/advertising/SponsoredCategoryBlock.jsx');
  Block = module.default; unique = module.uniqueSponsoredProducts;
  Card = (await vite.ssrLoadModule('/src/modules/User/components/CategoryProductCard.jsx')).default;
});
after(async () => vite.close());
const text = node => node == null ? '' : typeof node !== 'object' ? String(node) : [node.props?.children].flat(Infinity).map(text).join(' ');
const props = () => ({ channel:'ecommerce', categoryId:'507f1f77bcf86cd799439011', organicProducts:[{_id:'507f1f77bcf86cd799439012'}] });
const row = (id = '507f1f77bcf86cd799439013') => ({ product:{_id:id,name:'Synthetic sponsored product',images:['/test.png'],price:22,stock:3,type:'ecommerce',variants:[{_id:'v1',name:'First',price:11,stock:1},{_id:'v2',name:'Promoted',price:22,stock:3}]}, variantId:'v2',disclosure:'Sponsored',mode:'NON_BILLABLE_PILOT',expiresAt:new Date(Date.now()+3600000).toISOString() });
const response = rows => ({success:true,data:rows,meta:{mode:'NON_BILLABLE_PILOT',billable:false}});
const context = extra => ({getDeliveryPoint:()=>({lat:12,lng:77}),setSelectedProduct:()=>{},addToCart:()=>{},...extra});
test('optional placement fetch includes context but sends no user token or identity, and never leaves out the page\'s own products', async () => {
  const h=hookHarness(Block,props(),'/categories',context());
  try {
    const req=h.requests[0];assert.match(req.url,/advertising\/placements/);assert.doesNotMatch(req.url,/exclude=/);assert.match(req.url,/lat=12/);
    assert.equal(req.options.headers,undefined);assert.equal(h.tree,null);
    req.resolve(response([row()]));await h.settle();assert.match(text(h.tree),/Sponsored/);assert.match(text(h.tree),/Non-billable pilot/);
  } finally {h.close();}
});
test('an advertised product that is also in the page list is still sponsored; the block reports it so the page lists it once', async () => {
  const shown=[],p={...props(),onShown:ids=>shown.push(ids)},listed=p.organicProducts[0]._id,h=hookHarness(Block,p,'/categories',context());
  try {
    assert.deepEqual(shown,[[]],'Nothing is reported before the placements arrive');
    h.requests[0].resolve(response([row(listed),row(),row()]));await h.settle();
    const items=[];const walk=n=>{if(!n||typeof n!=='object')return;if(n.props?.className==='sponsored-category-item')items.push(n);[n.props?.children].flat(Infinity).forEach(walk);};walk(h.tree);
    assert.equal(items.length,2,'The listed product is shown as Sponsored too');
    assert.deepEqual(shown.at(-1),[listed,'507f1f77bcf86cd799439013'],'Both sponsored products, repeated ones once');
    assert.equal(unique([row(listed),row(),row()]).length,2);
    p.categoryId='507f1f77bcf86cd799439014';h.rerender();assert.deepEqual(shown.at(-1),[],'A new page starts with nothing hidden');
  } finally {h.close();}
});
test('network failure, disabled flags and server errors leave the optional block absent', async () => {
  for(const mode of ['network','disabled','error']){
    const h=hookHarness(Block,props(),'/categories',context());
    try {if(mode==='network')h.requests[0].reject(Error('offline'));else h.requests[0].resolve(response([]),mode==='error'?503:200);await h.settle();assert.equal(h.tree,null);}finally{h.close();}
  }
});
test('late category responses cannot replace a newer context even when fetch ignores abort', async () => {
  const p=props(),h=hookHarness(Block,p,'/categories',context());
  try {
    p.categoryId='507f1f77bcf86cd799439014';h.rerender();assert.equal(h.requests.length,2);
    h.requests[1].resolve(response([row()]));await h.settle();assert.match(text(h.tree),/Sponsored/);
    h.requests[0].resolve(response([]));await h.settle();assert.match(text(h.tree),/Sponsored/);
  } finally {h.close();}
});
test('organic loading and unsupported channels do not trigger sponsored requests', () => {
  for(const p of [{...props(),ready:false},{...props(),channel:'wholesale'}]){
    const h=hookHarness(Block,p,'/categories',context());try{assert.equal(h.requests.length,0);assert.equal(h.tree,null);}finally{h.close();}
  }
});
test('shared card navigation and add-to-cart preserve real product and variant identity', async () => {
  const opened=[],added=[],h=hookHarness(Block,props(),'/categories',context({setSelectedProduct:p=>opened.push(p),addToCart:(...args)=>added.push(args)}));
  try {
    h.requests[0].resolve(response([row()]));await h.settle();
    h.find(n=>n.type==='button' && n.props.className==='sponsored-product-link').props.onClick();assert.equal(opened[0].id,row().product._id);assert.equal(opened[0].variants[0].id,'v2');
    const card=h.find(n=>n.type===Card);assert.ok(card);card.props.onAdd();
    assert.equal(added[0][1],1);assert.equal(added[0][2],'v2');
    assert.equal(h.requests.length,1,'No event, payment or attribution request is emitted');
  } finally {h.close();}
});
test('visible pilot clears at schedule expiry', async () => {
  const h=hookHarness(Block,props(),'/categories',context());
  try {
    h.requests[0].resolve(response([{...row(),expiresAt:new Date(Date.now()+40).toISOString()}]));await h.settle();assert.ok(h.tree);
    await new Promise(resolve=>setTimeout(resolve,60));h.flush();assert.equal(h.tree,null);
  } finally {h.close();}
});
test('unlabelled or nonpilot responses are never presented as sponsored', () => {
  assert.deepEqual(unique([{...row(),mode:'PAID'},{...row(),disclosure:''}],[]),[]);
});
