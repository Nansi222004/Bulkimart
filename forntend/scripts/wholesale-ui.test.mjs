import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { hookHarness } from './service-hookHarness.mjs';
let vite, Catalog, Cart, UserProvider, portalRequests, QuickActions, CartUI, BottomNav;
before(async () => {
  vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' });
  Catalog = (await vite.ssrLoadModule('/src/modules/User/pages/WholesalePage.jsx')).default;
  QuickActions = (await vite.ssrLoadModule('/src/modules/User/components/QuickActions.jsx')).default;
  Cart = (await vite.ssrLoadModule('/src/modules/User/pages/WholesaleCartPage.jsx')).default;
  CartUI = await vite.ssrLoadModule('/src/modules/User/components/CartUI.jsx');
  BottomNav = (await vite.ssrLoadModule('/src/modules/User/components/BottomNav.jsx')).default;
  UserProvider = (await vite.ssrLoadModule('/src/modules/User/context/UserContext.jsx')).UserProvider;
  portalRequests = await vite.ssrLoadModule('/src/utils/portalRequests.js');
  (await vite.ssrLoadModule('/src/utils/socket.js')).socket.connect = () => {};
});
after(async () => vite.close());
const storage = values => { const map = new Map(Object.entries(values || {})); return { getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, String(value)), removeItem: key => map.delete(key) }; };
const stores = () => ({ localStorage: storage({ userToken: 'customer-fixture', sellerToken: 'seller-fixture' }), sessionStorage: storage() });
const offer = { _id: 'fixture-product', name: 'Fixture Beans', seller: { name: 'Fixture store' }, category: { name: 'Beans' }, variants: [{ variantId: 'fixture-variant', name: 'Case', available: true, availableStock: 25, minimumQuantity: 5, quantityIncrement: 5, maxQuantity: 25, priceTiers: [{ minimumQuantity: 5, unitPrice: 80 }, { minimumQuantity: 10, unitPrice: 70 }] }] };
const address = { _id: 'fixture-address', line1: 'Fixture', city: 'Mumbai', pincode: '400001', lat: 19.1, lng: 72.9 };
const cart = { valid: true, quoteHash: 'fixture-quote-hash', items: [{ itemId: 'line-fixture', productId: 'fixture-product', variantId: 'fixture-variant', name: 'Fixture Beans', qty: 5, price: 80, lineTotal: 400, stock: 25, wholesaleSnapshot: { minimumQuantity: 5, quantityIncrement: 5 } }], totals: { subtotal: 400, deliveryCharge: 40, totalAmount: 440 } };

test('storefront availability distinguishes no offers from server errors and permits recovery', async () => {
  const h=hookHarness(QuickActions,{},'/grocery--home',{activeMode:'quick',setActiveNav(){}},stores());
  try {
    h.requests[0].resolve({success:true,enabled:false}); await h.settle();
    assert.equal(h.find(n=>n.props?.role==='alert'),undefined);
    assert.equal(h.find(n=>n.props?.children==='Wholesale'),undefined);
  } finally {h.close();}
  const failed=hookHarness(QuickActions,{},'/grocery--home',{activeMode:'quick',setActiveNav(){}},stores());
  try {
    failed.requests[0].resolve({message:'Fixture database failure'},500); await failed.settle();
    assert.ok(failed.find(n=>n.props?.role==='alert'),'server errors must not be silently treated as no offers');
    failed.click('Retry wholesale availability');
    failed.requests.at(-1).resolve({success:true,enabled:true}); await failed.settle();
    assert.equal(failed.find(n=>n.props?.role==='alert'),undefined);
    assert.ok(failed.find(n=>n.props?.children==='Wholesale'));
  } finally {failed.close();}
});

test('storefront wholesale availability times out without blocking retail quick actions',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const h=hookHarness(QuickActions,{},'/grocery--home',{activeMode:'quick',setActiveNav(){}},stores());
  try {
    t.mock.timers.tick(10001); await h.settle();
    assert.ok(h.find(n=>n.props?.role==='alert'));
    assert.ok(h.find(n=>n.props?.className?.includes('quick-action-card')));
  } finally {h.close();t.mock.timers.reset();}
});

test('Wholesale catalog opens the shared product route with its exact variant, mode and catalog filters', async () => {
  const h=hookHarness(Catalog,{},'/wholesale?q=Beans&page=2',{currentUser:{_id:'buyer'}},stores());
  try{
    assert.match(h.requests[0].url,/page=2/);assert.match(h.requests[0].url,/q=Beans/);
    h.requests[0].resolve({data:[offer],meta:{pages:3}});await h.settle();
    h.find(n=>n.props?.className==='wholesale-card').props.onClick();h.flush();
    assert.equal(window.location.pathname,'/wholesale/'+offer._id);const params=new URLSearchParams(window.location.search);assert.equal(params.get('variant'),offer.variants[0].variantId);assert.equal(params.get('purchase'),'wholesale');assert.equal(params.get('q'),'Beans');assert.equal(params.get('page'),'2');assert.equal(h.find(n=>n.props?.className==='wholesale-detail'),undefined);
    assert.equal(h.requests.some(r=>r.url.endsWith('/api/cart/wholesale')),false);
  }finally{h.close();}
});

test('denied Wholesale catalog shows customer sign-in guidance and no price', async () => {
  const h = hookHarness(Catalog, {}, '/wholesale', { currentUser: null }, stores());
  try { h.requests[0].resolve({ message: 'Denied' }, 403); await h.settle(); assert.match(h.find(node => node.props?.role === 'alert').props.children.flat(Infinity).map(item => item?.props?.children || '').join(' '), /sign in/); assert.equal(h.find(node => node.props?.className === 'wholesale-card-price'), undefined); }
  finally { h.close(); }
});
test('programmatic navigation from shared detail mounts the existing Wholesale cart and restores the catalog on Back',()=>{
  const h=hookHarness(Catalog,{},'/wholesale',{currentUser:{_id:'buyer'}},stores());
  try{
    window.history.pushState(null,'','/wholesale/cart');window.dispatchEvent(new Event('app:locationchange'));h.flush();assert.equal(h.tree.type,Cart);
    window.history.pushState(null,'','/wholesale?q=Beans');window.dispatchEvent(new Event('popstate'));h.flush();assert.equal(h.tree.type,'section');assert.equal(h.find(n=>n.props?.id==='wholesale-search').props.value,'Beans');
  }finally{h.close();}
});
test('shared provider keeps Wholesale idempotency and recovery separate from retail', async () => {
  portalRequests.clearPortalRequests('customer');
  const profile = { _id: 'fixture-buyer', name: 'Fixture', phone: '9800000001', roles: ['buyer'] };
  const h = hookHarness(UserProvider, {}, '/wholesale/cart', { verified: true, profile }, stores());
  try {
    h.requests.find(item => item.url.endsWith('/api/users/addresses')).resolve({ data: [address] }); await h.settle();
    const placing = h.tree.props.value.placeUnifiedOrder('cod', 0, { purchaseMode: 'wholesale', quoteHash: 'fixture-hash' });
    const attempt = h.requests.find(item => item.url.endsWith('/api/orders/unified'));
    assert.ok(attempt); assert.equal(JSON.parse(attempt.options.body).purchaseMode, 'wholesale');
    assert.equal(JSON.parse(attempt.options.body).quoteHash, 'fixture-hash');
    attempt.reject(new Error('Fixture connection lost')); assert.equal((await placing).code, 'CHECKOUT_OUTCOME_UNCERTAIN');
    const saved = JSON.parse(sessionStorage.getItem('bulkimart:checkout:wholesale:fixture-buyer'));
    const checking = h.tree.props.value.checkCheckoutStatus('wholesale');
    const recovery = h.requests.find(item => item.url.endsWith('/api/orders/checkout-status'));
    assert.equal(recovery.options.headers['Idempotency-Key'], saved.key);
    assert.deepEqual(JSON.parse(recovery.options.body), { operation: 'unified' });
    recovery.resolve({ data: { state: 'not_found' } }); await checking;
  } finally { h.close(); }
});
test('Wholesale header removes customer identity while keeping seller identity and cart access', async () => {
  // Test with logged-in user
  const h = hookHarness(Catalog, {}, '/wholesale', { currentUser: { _id: 'buyer-fixture', name: 'Nansi Tiwari' } }, stores());
  try {
    h.requests[0].resolve({ data: [offer], meta: { page: 1, pages: 1 } }); await h.settle();
    // Header title and description
    assert.equal(h.find(n => n.props?.id === 'wholesale-title').props.children, 'Wholesale / Bulk Buying');
    assert.ok(h.find(n => n.props?.className === 'wholesale-subtitle'));
    assert.equal(h.find(n => n.props?.className?.includes('wholesale-cart-btn')), undefined);
    // Customer identity is absent; seller identity remains on its product card.
    assert.equal(h.find(n => n.props?.className === 'wholesale-account-name'), undefined);
    assert.equal(h.find(n => n.props?.className === 'wholesale-account-avatar'), undefined);
    assert.ok(h.find(n => n.props?.children === 'Fixture store'));
    // Card information hierarchy
    const card = h.find(n => n.props?.className === 'wholesale-card');
    assert.ok(card);
    assert.equal(h.find(n => n.props?.className === 'wholesale-card-title').props.children, 'Fixture Beans');
    assert.match(h.find(n => n.props?.className === 'wholesale-card-price').props.children.flat(Infinity).join(' '), /₹70/);
    assert.match(h.find(n => n.props?.className === 'wholesale-card-moq').props.children.flat(Infinity).join(' '), /MOQ:\s*5/);
    assert.equal(h.find(n => n.props?.className === 'wholesale-card-variants').props.children, '1 variant');
    assert.ok(h.find(n => n.props?.className === 'wholesale-card-cta'));
  } finally { h.close(); }

  // Guest authentication is handled by the existing storefront controls.
  const guest = hookHarness(Catalog, {}, '/wholesale', { currentUser: null }, stores());
  try {
    guest.requests[0].resolve({ data: [], meta: { pages: 1 } }); await guest.settle();
    assert.equal(guest.find(n => n.props?.className?.includes('wholesale-cart-btn')), undefined);
    assert.equal(guest.find(n => n.props?.className === 'wholesale-account-name'), undefined);
    assert.equal(guest.find(n => n.props?.className === 'wholesale-access-label'), undefined, 'Vague static customer account badge must be replaced');
  } finally { guest.close(); }
});
