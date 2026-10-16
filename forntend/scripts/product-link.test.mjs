import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { hookHarness } from './service-hookHarness.mjs';
let vite, Provider, Landing, Detail, Offer;
const id='6ad12379e87a768124c739d0', v1='6ad12379e87a768124c739d1', v2='6ad12379e87a768124c739d2';
const product={_id:id,name:'Beans',variants:[{_id:v1,name:'Bag'},{_id:v2,name:'Box'}]};
const stores=()=>({localStorage:{getItem:()=>null,setItem(){},removeItem(){}}});
before(async()=>{
  vite=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom'});
  Provider=(await vite.ssrLoadModule('/src/modules/User/context/UserContext.jsx')).UserProvider;
  Landing=(await vite.ssrLoadModule('/src/modules/User/pages/LandingPage.jsx')).LandingPageContent;
  Detail=(await vite.ssrLoadModule('/src/modules/User/pages/ProductDetailPage.jsx')).default;
  Offer=(await vite.ssrLoadModule('/src/modules/User/components/ProductWholesaleOffer.jsx')).default;
});
after(async()=>vite.close());

test('an empty product parameter is an invalid link rather than silently opening the storefront',()=>{
  const h=hookHarness(Provider,{},'/grocery--home?product=',{verified:false},stores());
  try {assert.equal(h.tree.props.value.productDetailLoading,false);assert.match(h.tree.props.value.productDetailError,/Invalid product link/);}finally{h.close();}
});

test('URL restoration owns the first render and variant history reuses essential data',async()=>{
  const h=hookHarness(Provider,{},`/grocery--home?product=${id}&variant=${v1}`,{verified:false},stores());
  try {
    assert.equal(h.renders[0].props.value.productDetailLoading,true,'No storefront fallback before restoration effect');
    h.requests.find(r=>r.url.endsWith('/api/products/'+id)).resolve(product);await h.settle();
    assert.equal(h.tree.props.value.productDetailLoading,false);
    const count=h.requests.length;
    window.history.pushState(null,'',`?product=${id}&variant=${v2}`);window.dispatchEvent(new Event('popstate'));h.flush();
    assert.equal(h.tree.props.value.selectedProduct.id,id);
    assert.equal(h.tree.props.value.productDetailLoading,false);
    assert.equal(h.requests.length,count,'No blocking product refetch for a known variant');
    window.history.replaceState(null,'',`?product=${id}&variant=missing`);window.dispatchEvent(new Event('popstate'));h.flush();
    assert.match(h.tree.props.value.productDetailError,/variant/);
    h.tree.props.value.setSelectedProduct(null);h.flush();
    assert.equal(window.location.search,'');assert.equal(h.tree.props.value.productDetailError,'');
  }finally{h.close();}
});

test('same-product variant navigation ignores stale completions and only current request clears loading',async()=>{
  const h=hookHarness(Provider,{},`/grocery--home?product=${id}&variant=${v1}`,{verified:false},stores());
  try {
    const old=h.requests.find(r=>r.url.endsWith('/api/products/'+id));
    window.history.pushState(null,'',`?product=${id}&variant=${v2}`);window.dispatchEvent(new Event('popstate'));h.flush();
    old.resolve({...product,name:'Stale'});await h.settle();
    assert.equal(h.tree.props.value.selectedProduct,null);assert.equal(h.tree.props.value.productDetailLoading,true);
    h.requests.findLast(r=>r.url.endsWith('/api/products/'+id)).resolve(product);await h.settle();
    assert.equal(h.tree.props.value.selectedProduct.name,'Beans');assert.equal(h.tree.props.value.productDetailLoading,false);
  }finally{h.close();}
});

test('push/replace navigation deduplicates the active request and leaving the route clears pending state',async()=>{
  const h=hookHarness(Provider,{},`/grocery--home?product=${id}`,{verified:false},stores());
  try {
    const old=h.requests.find(r=>r.url.endsWith('/api/products/'+id));
    const count=h.requests.length;
    window.dispatchEvent(new Event('app:locationchange'));h.flush();
    assert.equal(h.requests.length,count);assert.equal(old.options.signal.aborted,false);
    window.history.pushState(null,'','/search');window.dispatchEvent(new Event('app:locationchange'));h.flush();
    assert.equal(old.options.signal.aborted,true);assert.equal(h.tree.props.value.productDetailLoading,false);
    old.resolve(product);await h.settle();assert.equal(h.tree.props.value.selectedProduct,null);
    assert.equal(h.tree.props.value.productDetailError,'');
  }finally{h.close();}
});

test('pending/error route content never creates a full-screen overlay or mounts a misleading home feed',()=>{
  for(const state of [{productDetailLoading:true},{productDetailError:'Not found'}]) {
    const h=hookHarness(Landing,{},`/grocery--home?product=${id}`,{activeNav:'home',activeMode:'quick',activeSubNav:'grocery--home',getCartCount:()=>0,getCartSubtotal:()=>0,...state},stores());
    try {
      assert.ok(h.find(n=>n.props?.className==='pd-product-link-state'));
      assert.equal(h.find(n=>n.props?.className?.includes('product-detail-overlay')),undefined);
      assert.equal(h.find(n=>n.props?.className==='home-feed-scrollable'),undefined);
    }finally{h.close();}
  }
  const h=hookHarness(Landing,{},'/',{activeNav:'home',activeMode:'quick',getCartCount:()=>0,getCartSubtotal:()=>0,selectedProduct:{id},productDetailLoading:true},stores());
  try {assert.equal(h.find(n=>n.props?.className==='pd-product-link-state'),undefined);assert.ok(h.find(n=>n.type===Detail));}finally{h.close();}
});

test('a mounted product restores variant and purchase mode on history changes without losing retail controls',()=>{
  const context={selectedProduct:{id,name:'Beans',type:'grocery',price:100,stock:20,variants:product.variants.map(v=>({...v,id:v._id,price:100,stock:20}))},currentUser:null,getItemQty:()=>0,getDeliveryPoint:()=>null,getSelectedAddress:()=>null,getLocationDisplayName:()=>'',isWishlisted:()=>false};
  const h=hookHarness(Detail,{},`/grocery--home?product=${id}&variant=${v1}`,context,stores());
  try {
    assert.equal(h.find(n=>n.type==='select').props.value,v1);
    window.history.pushState(null,'',`?product=${id}&variant=${v2}&purchase=wholesale`);window.dispatchEvent(new Event('popstate'));h.flush();
    assert.equal(h.find(n=>n.type==='select').props.value,v2);
    assert.equal(h.find(n=>n.type===Offer).props.wholesale.mode,'wholesale');
    window.history.replaceState(null,'',`?product=${id}&variant=${v1}`);window.dispatchEvent(new Event('popstate'));h.flush();
    assert.equal(h.find(n=>n.type==='select').props.value,v1);
    assert.equal(h.find(n=>n.type===Offer).props.wholesale.mode,'retail');
    assert.ok(h.find(n=>n.props?.className==='pd-price-row'));
  }finally{h.close();}
});
