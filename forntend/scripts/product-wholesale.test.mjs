import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { hookHarness } from './service-hookHarness.mjs';
let vite, Detail, Offer, Provider;
before(async () => {
  vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' });
  Detail = (await vite.ssrLoadModule('/src/modules/User/pages/ProductDetailPage.jsx')).default;
  Offer = (await vite.ssrLoadModule('/src/modules/User/components/ProductWholesaleOffer.jsx')).default;
  Provider = (await vite.ssrLoadModule('/src/modules/User/context/UserContext.jsx')).UserProvider;
  (await vite.ssrLoadModule('/src/utils/socket.js')).socket.connect = () => {};
});
after(async () => vite.close());

test('refresh product request has a deadline, supports retry and ignores the late timed-out result', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = hookHarness(Provider, {}, '/grocery--home?product='+id, { verified:false }, stores());
  try {
    const old = h.requests.find(r => r.url.endsWith('/api/products/'+id));
    assert.equal(h.tree.props.value.productDetailLoading, true);
    t.mock.timers.tick(10001); await h.settle();
    assert.equal(h.tree.props.value.productDetailLoading, false);
    assert.match(h.tree.props.value.productDetailError, /timed out/i);
    h.tree.props.value.retryProductDetail(); h.flush();
    const fresh = h.requests.findLast(r => r.url.endsWith('/api/products/'+id));
    assert.notEqual(fresh, old);
    fresh.resolve({ _id:id, name:'Retry beans', variants:[] }); await h.settle();
    old.resolve({ _id:id, name:'Stale beans', variants:[] }); await h.settle();
    assert.equal(h.tree.props.value.selectedProduct.name, 'Retry beans');
    assert.equal(h.tree.props.value.productDetailError, '');
  } finally { h.close(); t.mock.timers.reset(); }
});

test('refresh validates product response and variant association and terminates on API errors', async () => {
  for (const scenario of [
    { body:{_id:id,name:'Beans',variants:[{_id:v1}]}, query:'&variant='+v1, ok:true },
    { body:{message:'Product not found'}, status:404, error:/not found/i },
    { body:{message:'Please sign in'}, status:401, error:/sign in/i },
    { body:{message:'Service unavailable'}, status:503, error:/unavailable/i },
    { body:{success:true,data:null}, error:/not found|invalid/i },
    { body:{_id:id,name:'Beans',variants:[{_id:v1}]}, query:'&variant='+v2, error:/variant/i },
    { body:{_id:id,name:'Beans',variants:[]}, query:'&variant=bad', error:/variant/i },
    { network:true, error:/network/i },
  ]) {
    const h = hookHarness(Provider, {}, '/grocery--home?product='+id+(scenario.query||''), {verified:false}, stores());
    try {
      const req=h.requests.find(r=>r.url.endsWith('/api/products/'+id));
      if(scenario.network) req.reject(new Error('Network unavailable')); else req.resolve(scenario.body,scenario.status||200);
      await h.settle();
      assert.equal(h.tree.props.value.productDetailLoading,false);
      if(scenario.ok) { assert.equal(h.tree.props.value.selectedProduct.id,id); assert.match(window.location.search,/variant=/); }
      else { assert.equal(h.tree.props.value.selectedProduct,null); assert.match(h.tree.props.value.productDetailError,scenario.error); }
    } finally { h.close(); }
  }
});

test('product switching discards stale success and failure without clearing the newer loading state', async () => {
  const other='507f1f77bcf86cd799439016';
  const h=hookHarness(Provider,{},'/grocery--home?product='+id,{verified:false},stores());
  try {
    const old=h.requests.find(r=>r.url.endsWith('/api/products/'+id));
    window.history.pushState(null,'','/grocery--home?product='+other); window.dispatchEvent(new Event('popstate')); h.flush();
    old.reject(new Error('Old failure')); await h.settle();
    assert.equal(h.tree.props.value.productDetailLoading,true); assert.equal(h.tree.props.value.productDetailError,'');
    h.requests.find(r=>r.url.endsWith('/api/products/'+other)).resolve({_id:other,name:'New beans',variants:[]}); await h.settle();
    assert.equal(h.tree.props.value.selectedProduct.id,other);
    h.tree.props.value.setSelectedProduct(null); h.flush();
    assert.equal(h.tree.props.value.productDetailLoading,false);
  } finally {h.close();}
});

test('missing and malformed product parameters terminate without requesting a product', () => {
  for (const query of ['', '?product=invalid']) {
    const h=hookHarness(Provider,{},'/grocery--home'+query,{verified:false},stores());
    try {
      assert.equal(h.tree.props.value.productDetailLoading,false);
      assert.equal(h.tree.props.value.selectedProduct,null);
      assert.equal(h.requests.some(r=>/\/api\/products\//.test(r.url)),false);
      if(query) assert.match(h.tree.props.value.productDetailError,/invalid product link/i);
    } finally {h.close();}
  }
});
const id = '507f1f77bcf86cd799439015', v1 = '507f1f77bcf86cd799439033', v2 = '507f1f77bcf86cd799439034';
const storage = initial => { const map = new Map(Object.entries(initial || {})); return { getItem: k => map.get(k) ?? null, setItem: (k,v) => map.set(k,String(v)), removeItem: k => map.delete(k) }; };
const stores = () => ({ localStorage: storage({ userToken: 'customer-fixture', sellerToken: 'seller-fixture' }), sessionStorage: storage() });
const variant = { variantId: v1, name: 'Case', available: true, availableStock: 25, minimumQuantity: 5, quantityIncrement: 5, maxQuantity: 25, priceTiers: [{ minimumQuantity: 5, unitPrice: 80 }, { minimumQuantity: 10, unitPrice: 70 }] };
const second = { ...variant, variantId: v2, minimumQuantity: 3, quantityIncrement: 3, maxQuantity: 24, priceTiers: [{ minimumQuantity: 3, unitPrice: 60 }, { minimumQuantity: 12, unitPrice: 50 }] };
const retailProduct = { id, name: 'Fixture beans', type: 'ecommerce', price: 100, stock: 25, rating: 0, variants: [{ id: v1, name: 'Case', price: 100, stock: 25 }, { id: v2, name: 'Box', price: 90, stock: 25 }] };
const make = (overrides = {}, path = '/grocery--home?product=' + id) => {
  const calls = [], nav = [];
  const context = { currentUser: { _id: 'buyer' }, selectedProduct: retailProduct, getItemQty: () => 0, getDeliveryPoint: () => null, getSelectedAddress: () => null, getLocationDisplayName: () => 'Choose location', isWishlisted: () => false, toggleWishlist() {}, setSelectedProduct: product => calls.push(['select',product]), setActiveNav: route => nav.push(route), addToCart: async (...args) => { calls.push(args); return { ok: true }; }, ...overrides };
  const h = hookHarness(Detail, {}, path, context, stores());
  return { h, context, calls, nav };
};
const w = h => h.find(n => n.type === Offer).props.wholesale;
const text = node => node == null ? '' : typeof node !== 'object' ? String(node) : [node.props?.children].flat(Infinity).map(text).join(' ');
const rendered = h => text(Offer({ wholesale: w(h) })).replace(/\s+/g, ' ');
const done = new WeakSet();
async function catalog(h, variants = [variant, second]) {
  const req = h.requests.findLast(r => r.url.includes('/wholesale/catalog?productId=') && !done.has(r));
  assert.ok(req, 'catalog request'); done.add(req);
  req.resolve({ data: variants.length ? [{ _id: id, variants }] : [] }); await h.settle(); return req;
}
async function preview(h, quantity = 5, terms = variant, values = {}) {
  const req = h.requests.findLast(r => r.url.endsWith('/wholesale/quote') && !done.has(r));
  assert.ok(req, 'server preview request'); done.add(req);
  const unitPrice = quantity >= 10 ? 70 : 80;
  req.resolve({ data: { ...terms, quantity, unitPrice, subtotal: quantity * unitPrice, tierMinimumQuantity: quantity >= 10 ? 10 : 5, savings: 100, retailUnitPrice: 100, ...values } }); await h.settle(); return req;
}
async function wholesale(h) {
  await catalog(h); w(h).chooseMode('wholesale'); h.flush(); await catalog(h); await preview(h);
}

test('existing detail defaults to Retail and exposes only authorized wholesale availability', async () => {
  const { h } = make();
  try {
    assert.equal(w(h).mode, 'retail'); assert.equal(w(h).available, false);
    const req = await catalog(h);
    assert.equal(req.options.headers.Authorization, 'Bearer customer-fixture');
    assert.match(rendered(h), /Wholesale available/);
    assert.ok(h.find(n => n.props?.className === 'pd-price-row'));
    assert.equal(h.requests.some(r => r.url.endsWith('/wholesale/quote')), false);
    await wholesaleAfterCatalog(h);
    assert.equal(h.find(n => n.props?.className === 'pd-price-row'), undefined);
    assert.match(rendered(h), /5 units × ₹80 = ₹400/);
    assert.match(rendered(h), /Minimum order: 5/);
    assert.match(rendered(h), /Save ₹100/);
    assert.ok(h.find(n => n.props?.children === 'Add to Wholesale Cart'));
    w(h).chooseMode('retail'); h.flush();
    assert.ok(h.find(n => n.props?.className === 'pd-price-row'));
    assert.ok(h.find(n => n.props?.className === 'pd-offer-headline'));
  } finally { h.close(); }
});
async function wholesaleAfterCatalog(h) { w(h).chooseMode('wholesale'); h.flush(); await catalog(h); await preview(h); }

test('no offer, disabled/suspended empty catalogs, failures and anonymous views show no indicator or price book', async () => {
  for (const scenario of ['none','suspended','failed','anonymous']) {
    const { h } = make(scenario === 'anonymous' ? { currentUser: null } : {});
    try {
      if (scenario === 'failed') { h.requests.find(r => r.url.includes('/wholesale/catalog?productId=')).resolve({ message: 'Fixture unavailable' },503); await h.settle(); }
      else if (scenario !== 'anonymous') await catalog(h, []);
      assert.equal(w(h).available, false); assert.doesNotMatch(rendered(h), /Wholesale available|₹/);
      if (scenario === 'anonymous') assert.equal(h.requests.some(r => r.url.includes('/wholesale/')), false);
      if (scenario === 'failed') assert.match(rendered(h), /Retry/);
    } finally { h.close(); }
  }
});

test('catalog failures preserve retail controls and never claim a failed check means no wholesale offer',async()=>{
  for(const status of [401,403,500,503]) {
    const {h}=make();
    try {
      w(h).chooseMode('wholesale');h.flush();
      h.requests.findLast(r=>r.url.includes('/wholesale/catalog?productId=')).resolve({message:'Fixture failure'},status);await h.settle();
      assert.doesNotMatch(rendered(h),/Wholesale is currently unavailable/);
      assert.match(rendered(h),status<500 ? /customer account/i : /could not be checked/i);
      assert.equal(w(h).canPurchase,false);
      w(h).chooseMode('retail');h.flush();
      assert.ok(h.find(n=>n.props?.className==='pd-price-row'));
      assert.ok(h.find(n=>n.type==='button'&&n.props.className==='pd-flipkart-btn add-cart'));
    }finally{h.close();}
  }
});

test('a stalled catalog check reaches an error while retail purchasing remains available',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const {h}=make();
  try {
    assert.equal(w(h).loading,true);
    t.mock.timers.tick(10001);await h.settle();
    assert.equal(w(h).loading,false);assert.match(w(h).catalogError,/timed out/i);
    assert.ok(h.find(n=>n.props?.className==='pd-price-row'));
    assert.ok(h.find(n=>n.type==='button'&&n.props.className==='pd-flipkart-btn add-cart'));
    assert.doesNotMatch(rendered(h),/Wholesale available|₹/);
  }finally{h.close();t.mock.timers.reset();}
});

test('MOQ, increments and stock bounds block purchase; each valid boundary uses a new server preview', async () => {
  const { h } = make();
  try {
    await wholesale(h);
    for (const qty of [0, -1, 4, 6, 5.5, 30]) {
      w(h).setQuantity(qty); h.flush(); assert.equal(w(h).canPurchase, false); assert.equal(w(h).quote, null);
    }
    for (const qty of [5, 10, 15, 25]) {
      w(h).setQuantity(qty); h.flush(); assert.equal(w(h).canPurchase, false);
      const req = await preview(h, qty); assert.equal(JSON.parse(req.options.body).quantity, qty);
      assert.equal(w(h).canPurchase, true); assert.equal(w(h).quote.tierMinimumQuantity, qty < 10 ? 5 : 10);
      assert.match(rendered(h), new RegExp(`${qty} units`));
    }
  } finally { h.close(); }
});

test('variant changes discard old slabs and responses before fetching the matching variant quote', async () => {
  const { h } = make();
  try {
    await wholesale(h);
    w(h).setQuantity(10); h.flush(); const old = h.requests.at(-1);
    h.find(n => n.type === 'select').props.onChange({ target: { value: v2 } }); h.flush();
    assert.equal(w(h).quote, null); await catalog(h);
    assert.equal(w(h).quantity, 3); assert.equal(w(h).offer.variantId, v2);
    old.resolve({ data: { quantity: 10, subtotal: 1 } }); await h.settle(); assert.equal(w(h).quote, null);
    const req = await preview(h, 3, second, { unitPrice: 60, subtotal: 180, tierMinimumQuantity: 3 });
    assert.equal(JSON.parse(req.options.body).variantId, v2);
    assert.match(rendered(h), /3 units × ₹60 = ₹180/);
  } finally { h.close(); }
});

test('Wholesale Add submits only product, variant and quantity once; Buy Now reviews existing Wholesale cart', async () => {
  for (const buyNow of [false,true]) {
    const { h, calls, nav } = make();
    try {
      await wholesale(h);
      const a = w(h).add(buyNow), b = w(h).add(buyNow); h.flush();
      const writes = h.requests.filter(r => r.url.endsWith('/api/cart/wholesale'));
      assert.equal(writes.length,1); assert.deepEqual(JSON.parse(writes[0].options.body), { productId:id,variantId:v1,qty:5 });
      assert.equal(writes[0].options.headers.Authorization,'Bearer customer-fixture');
      writes[0].resolve({ data: { valid:true } }); await Promise.all([a,b]); h.flush();
      assert.equal(calls.filter(args => args[0] === id).length,0);
      assert.deepEqual(nav,buyNow ? ['cart'] : []);
      assert.match(w(h).message,/Added to your cart/);
      assert.equal(h.requests.some(r => r.url.includes('/orders')),false);
    } finally { h.close(); }
  }
});

test('retail Add to Cart and Buy Now preserve their original context operations', async () => {
  for (const buyNow of [false,true]) {
    const { h,calls,nav } = make();
    try {
      const button = h.find(n => n.type === 'button' && n.props.className === `pd-flipkart-btn ${buyNow ? 'buy-now' : 'add-cart'}`);
      await button.props.onClick(); h.flush();
      assert.deepEqual(calls[0],[id,1,v1]); assert.deepEqual(nav,buyNow ? ['checkout'] : []);
      assert.equal(h.requests.some(r => r.url.endsWith('/api/cart/wholesale')),false);
    } finally { h.close(); }
  }
});

test('stock/preview failures and stale cart errors block buying with useful retry feedback', async () => {
  const { h } = make();
  try {
    await catalog(h); w(h).chooseMode('wholesale'); h.flush(); await catalog(h);
    h.requests.findLast(r => r.url.endsWith('/wholesale/quote')).resolve({ message:'Stock changed' },409); await h.settle();
    assert.equal(w(h).canPurchase,false); assert.match(rendered(h),/Stock changed/);
    w(h).refresh(); h.flush(); await catalog(h); await preview(h);
    const adding = w(h).add();
    h.requests.findLast(r => r.url.endsWith('/api/cart/wholesale')).resolve({ message:'Offer changed. Review again.' },409);
    await adding; h.flush(); assert.equal(w(h).canPurchase,false); assert.match(w(h).message,/Offer changed/);
    await catalog(h,[]); assert.equal(w(h).available,false); assert.equal(w(h).canPurchase,false);
  } finally { h.close(); }
});

test('late cart and quote responses cannot navigate or reveal the previous account', async () => {
  const { h,nav } = make();
  try {
    await wholesale(h); const adding = w(h).add(true);
    localStorage.setItem('userToken','different-customer');
    h.requests.findLast(r => r.url.endsWith('/api/cart/wholesale')).resolve({ data:{} }); await adding; h.flush();
    assert.deepEqual(nav,[]); assert.equal(w(h).available,false); assert.equal(w(h).quote,null);
  } finally { h.close(); }
});

test('changing products resets Retail and immediately discards the prior wholesale book', async () => {
  const { h, context } = make();
  try {
    await wholesale(h); context.selectedProduct = { ...retailProduct,id:'507f1f77bcf86cd799439016' };
    w(h).setQuantity(10); h.flush();
    assert.equal(w(h).mode,'retail'); assert.equal(w(h).available,false); assert.equal(w(h).quote,null);
  } finally { h.close(); }
});

test('direct product and variant links restore intended Wholesale mode while ordinary links remain Retail', () => {
  for (const suffix of ['', '&purchase=wholesale&variant='+v2]) {
    const { h } = make({}, '/grocery--home?product='+id+suffix);
    try { assert.equal(w(h).mode,suffix ? 'wholesale' : 'retail'); if (suffix) assert.equal(h.find(n => n.type === 'select').props.value,v2); }
    finally { h.close(); }
  }
});

test('provider restores public product links on initial load and browser history, and closes without stale responses', async () => {
  const profile = { _id:'buyer', roles:['buyer'] };
  const h = hookHarness(Provider,{},'/grocery--home?product='+id,{verified:true,profile},stores());
  try {
    const req = h.requests.find(r => r.url.endsWith('/api/products/'+id));
    assert.ok(req); assert.equal(req.options.headers,undefined);
    req.resolve({ _id:id,name:'Fixture beans',variants:[] }); await h.settle();
    assert.equal(h.tree.props.value.selectedProduct.id,id);
    h.tree.props.value.setSelectedProduct(null); h.flush(); assert.equal(window.location.search,'');
    window.history.pushState(null,'','/grocery--home?product='+id); window.dispatchEvent(new Event('popstate')); h.flush();
    assert.equal(h.tree.props.value.productDetailLoading,true);
    h.tree.props.value.setSelectedProduct(null); h.flush();
    h.requests.findLast(r => r.url.endsWith('/api/products/'+id)).resolve({ _id:id,name:'Late product' }); await h.settle();
    assert.equal(h.tree.props.value.selectedProduct,null);
    window.history.pushState(null,'','/grocery--home?product='+id); window.dispatchEvent(new Event('popstate')); h.flush();
    h.tree.props.value.setSelectedProduct(null); h.flush();
    h.requests.findLast(r => r.url.endsWith('/api/products/'+id)).reject(new Error('Late failure')); await h.settle();
    assert.equal(h.tree.props.value.productDetailError,'');
  } finally { h.close(); }
});

test('server preview changes replace stale slabs and stock before enabling purchase', async () => {
  const { h } = make();
  try {
    await catalog(h); w(h).chooseMode('wholesale'); h.flush(); await catalog(h);
    const updated = { ...variant, availableStock:20, maxQuantity:20, priceTiers:[{minimumQuantity:5,unitPrice:75},{minimumQuantity:10,unitPrice:65}] };
    await preview(h,5,updated,{unitPrice:75,subtotal:375});
    assert.equal(w(h).canPurchase,false);
    await preview(h,5,updated,{unitPrice:75,subtotal:375});
    assert.equal(w(h).canPurchase,true); assert.equal(w(h).offer.maxQuantity,20);
    assert.match(rendered(h),/₹75/); assert.doesNotMatch(rendered(h),/₹80/);
  } finally { h.close(); }
});

test('a variant without an offer cannot reuse another variant price or submit to either cart', async () => {
  const { h } = make();
  try {
    await catalog(h,[variant]); w(h).chooseMode('wholesale'); h.flush(); await catalog(h,[variant]); await preview(h);
    h.find(n=>n.type==='select').props.onChange({target:{value:v2}}); h.flush(); await catalog(h,[variant]);
    assert.equal(w(h).offer,undefined); assert.equal(w(h).quote,null); assert.equal(w(h).canPurchase,false);
    assert.match(rendered(h),/This variant has no available wholesale offer/);
    await w(h).add(); assert.equal(h.requests.some(r=>r.url.endsWith('/api/cart/wholesale')),false);
  } finally { h.close(); }
});

test('guest sign-in intent returns to the same product, variant and Wholesale mode using the existing OTP flow', async () => {
  const { h } = make({currentUser:null});
  let intent;
  try {
    h.find(n=>n.props?.className==='pd-wholesale-signin').props.onClick();
    intent=sessionStorage.getItem('bulkimart:product-return');
    assert.equal(JSON.parse(intent).productId,id);
  } finally { h.close(); }
  const s=stores(); s.sessionStorage.setItem('bulkimart:product-return',intent);
  const profile={_id:'fixture-buyer',name:'Fixture',roles:['buyer']};
  const provider=hookHarness(Provider,{},'/account',{verified:true,profile},s);
  try {
    const loggingIn=provider.tree.props.value.verifyOtp('9800000001','1234',true);
    provider.requests.find(r=>r.url.endsWith('/api/auth/verify-otp')).resolve({success:true,sessionRole:'buyer',token:'new-buyer-fixture',user:profile});
    assert.equal((await loggingIn).success,true); provider.flush();
    assert.equal(window.location.pathname,'/grocery--home');
    const params=new URLSearchParams(window.location.search);
    assert.equal(params.get('product'),id); assert.equal(params.get('variant'),v1); assert.equal(params.get('purchase'),'wholesale');
    assert.equal(sessionStorage.getItem('bulkimart:product-return'),null);
    assert.ok(provider.requests.find(r=>r.url.includes('/wholesale/catalog?productId='+id)));
  } finally { provider.close(); }
});

const wholesaleProduct = (productId=id) => ({_id:productId,name:'Wholesale-only beans',description:'Saved description',brandName:'Saved brand',retailAvailable:false,seller:{name:'Saved seller'},category:{name:'Beans'},images:['one.png','two.png'],type:'ecommerce',variants:[variant,second]});
test('legacy Wholesale path and storefront query links restore authenticated data into the shared detail context',async()=>{
  for(const path of [`/wholesale/${id}?variant=${v2}&q=beans`,`/ecommerce--smart-buy?product=${id}&variant=${v2}&purchase=wholesale`]){
    const h=hookHarness(Provider,{},path,{verified:true,profile:{_id:'buyer'}},stores());
    try{
      const request=h.requests.find(r=>r.url.includes('/wholesale/catalog?productId='+id));assert.ok(request);assert.equal(request.options.headers.Authorization,'Bearer customer-fixture');assert.equal(h.requests.some(r=>r.url.endsWith('/api/products/'+id)),false);
      request.resolve({data:[wholesaleProduct()]});await h.settle();const product=h.tree.props.value.selectedProduct;assert.equal(product.id,id);assert.equal(product.detailSource,'wholesale');assert.equal(product.retailAvailable,false);assert.equal(product.description,'Saved description');assert.equal(product.shg,'Saved seller');assert.equal(product.variants[1].id,v2);assert.equal(product.price,undefined);
      h.tree.props.value.setSelectedProduct(null);h.flush();assert.equal(h.tree.props.value.selectedProduct,null);assert.equal(new URLSearchParams(window.location.search).has('variant'),false);if(path.startsWith('/wholesale/')){assert.equal(window.location.pathname,'/wholesale');assert.equal(new URLSearchParams(window.location.search).get('q'),'beans');}
    }finally{h.close();}
  }
});
test('Wholesale-only detail uses the shared gallery/sections with Wholesale actions and no retail purchase path',async()=>{
  const selected={...retailProduct,detailSource:'wholesale',retailAvailable:false,price:undefined,description:'Saved description',brandName:'Saved brand',images:['one.png','two.png'],raw:{reviewData:{reviews:[],summary:{average:0,count:0,breakdown:[]}},faqs:[]}};
  const {h,calls}=make({selectedProduct:selected},`/wholesale/${id}?variant=${v1}&purchase=wholesale`);
  try{
    await catalog(h);await preview(h);assert.equal(h.tree.props.className,'product-detail-page');assert.equal(h.tree.props['data-purchase-mode'],'wholesale');assert.ok(h.find(n=>n.props?.className==='pd-image-hero'));assert.ok(h.find(n=>n.props?.className==='pd-tabs-row'));assert.ok(h.find(n=>n.props?.className==='pd-seller-info'));assert.ok(h.find(n=>n.props?.className==='pd-sticky-cta'));assert.equal(h.find(n=>n.props?.children==='ADD TO CART'),undefined);assert.equal(h.find(n=>n.props?.children==='BUY NOW'),undefined);assert.equal(h.requests.some(r=>r.url.endsWith('/api/products/'+id)||r.url.endsWith('/reviews')||r.url.endsWith('/faqs')),false);
    assert.equal(w(h).retailAvailable,false);w(h).chooseMode('retail');h.flush();assert.equal(w(h).mode,'wholesale');assert.doesNotMatch(rendered(h),/Return to Retail/);assert.equal(calls.length,0);
  }finally{h.close();}
});
test('timed-out quotes clear purchase eligibility, ignore late prices and preserve retail recovery',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});const {h}=make();
  try{
    await wholesale(h);w(h).setQuantity(10);h.flush();const old=h.requests.findLast(r=>r.url.endsWith('/wholesale/quote'));assert.equal(w(h).canPurchase,false);
    t.mock.timers.tick(10001);await h.settle();assert.match(w(h).error,/timed out/i);assert.equal(w(h).quoteLoading,false);assert.equal(w(h).quote,null);assert.equal(w(h).canPurchase,false);
    old.resolve({data:{...variant,quantity:10,unitPrice:1,subtotal:10}});await h.settle();assert.equal(w(h).quote,null);w(h).chooseMode('retail');h.flush();assert.ok(h.find(n=>n.props?.className==='pd-flipkart-btn add-cart'));
  }finally{h.close();t.mock.timers.reset();}
});
test('wrong-product and wrong-quantity quotes are rejected rather than enabling purchase',async()=>{
  for(const values of [{productId:'507f1f77bcf86cd799439099'},{variantId:v2},{quantity:999},{subtotal:0}]){
    const {h}=make();try{await catalog(h);w(h).chooseMode('wholesale');h.flush();await catalog(h);await preview(h,5,variant,values);assert.equal(w(h).canPurchase,false);assert.equal(w(h).quote,null);assert.match(w(h).error,/did not match/);}finally{h.close();}
  }
});
test('changing route mode during a pending Wholesale add cannot navigate using its stale response',async()=>{
  const {h,nav}=make();try{
    await wholesale(h);const pending=w(h).add(true);const request=h.requests.findLast(r=>r.url.endsWith('/api/cart/wholesale'));
    window.history.pushState(null,'',`/grocery--home?product=${id}&variant=${v1}`);window.dispatchEvent(new Event('popstate'));h.flush();request.resolve({data:{}});await pending;h.flush();assert.equal(w(h).mode,'retail');assert.deepEqual(nav,[]);
  }finally{h.close();}
});
test('Wholesale route product switches and invalid variants cannot reuse older authenticated product data',async()=>{
  const other='507f1f77bcf86cd799439099',h=hookHarness(Provider,{},`/wholesale/${id}?variant=${v1}`,{verified:true,profile:{_id:'buyer'}},stores());
  try{
    const old=h.requests.find(r=>r.url.includes('/wholesale/catalog?productId='+id));window.history.pushState(null,'',`/wholesale/${other}?variant=${v2}`);window.dispatchEvent(new Event('app:locationchange'));h.flush();old.resolve({data:[wholesaleProduct()]});await h.settle();assert.equal(h.tree.props.value.selectedProduct,null);
    h.requests.findLast(r=>r.url.includes('/wholesale/catalog?productId='+other)).resolve({data:[wholesaleProduct(other)]});await h.settle();assert.equal(h.tree.props.value.selectedProduct.id,other);
    window.history.pushState(null,'',`/wholesale/${other}?variant=invalid`);window.dispatchEvent(new Event('popstate'));h.flush();assert.equal(h.tree.props.value.selectedProduct,null);assert.match(h.tree.props.value.productDetailError,/variant/);
  }finally{h.close();}
});
test('digital retail details retain metadata and never load Wholesale pricing',()=>{
  const {h}=make({selectedProduct:{...retailProduct,fulfillmentType:'digital',digital:{author:'Actual author',language:'English',format:'pdf',licenseTerms:'Personal licence'}}});
  try{assert.equal(h.tree.props['data-purchase-mode'],'retail');assert.equal(h.find(n=>n.type===Offer),undefined);assert.match(text(h.tree),/Actual author/);assert.match(text(h.tree),/English/);assert.match(text(h.tree),/PDF/);assert.ok(h.find(n=>n.props?.children==='BUY NOW'||n.props?.className==='pd-flipkart-btn buy-now'));assert.equal(h.requests.some(r=>r.url.includes('/wholesale/')),false);}finally{h.close();}
});
test('shared gallery has an accessible missing-image state rather than requesting an empty image URL',()=>{
  const {h}=make();try{assert.ok(h.find(n=>n.props?.className==='pd-image-unavailable'));assert.equal(h.find(n=>n.type==='img'&&n.props.src===''),undefined);}finally{h.close();}
});
test('expired Wholesale authentication preserves the legacy product/variant return link through customer sign-in',async()=>{
  let logouts=0,intent;const {h,nav}=make({logoutUser(){logouts++;}},`/wholesale/${id}?variant=${v2}&purchase=wholesale`);
  try{
    h.requests.find(r=>r.url.includes('/wholesale/catalog?productId=')).resolve({message:'Expired'},401);await h.settle();assert.equal(w(h).canPurchase,false);h.find(n=>n.props?.className==='pd-wholesale-signin').props.onClick();assert.equal(logouts,1);assert.deepEqual(nav,['account']);intent=sessionStorage.getItem('bulkimart:product-return');assert.equal(JSON.parse(intent).path,'/wholesale/'+id);assert.equal(JSON.parse(intent).variantId,v2);
  }finally{h.close();}
  const values=stores();values.sessionStorage.setItem('bulkimart:product-return',intent);const profile={_id:'renewed-buyer',roles:['buyer']};const provider=hookHarness(Provider,{},'/account',{verified:true,profile},values);
  try{
    const login=provider.tree.props.value.verifyOtp('9800000001','1234',true);provider.requests.find(r=>r.url.endsWith('/api/auth/verify-otp')).resolve({success:true,sessionRole:'buyer',token:'renewed-customer-fixture',user:profile});assert.equal((await login).success,true);provider.flush();assert.equal(window.location.pathname,'/wholesale/'+id);assert.equal(new URLSearchParams(window.location.search).get('variant'),v2);assert.equal(new URLSearchParams(window.location.search).get('purchase'),'wholesale');assert.ok(provider.requests.find(r=>r.url.includes('/wholesale/catalog?productId='+id)));
  }finally{provider.close();}
});
