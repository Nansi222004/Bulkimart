import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { hookHarness } from './service-hookHarness.mjs';
let vite, Catalog, Cart, UserProvider, portalRequests;
before(async () => {
  vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
  Catalog = (await vite.ssrLoadModule('/src/modules/User/pages/WholesalePage.jsx')).default;
  Cart = (await vite.ssrLoadModule('/src/modules/User/pages/WholesaleCartPage.jsx')).default;
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

test('direct Wholesale product entry preserves variant, enforces quantities and sends only customer intent', async () => {
  const h = hookHarness(Catalog, {}, '/wholesale/fixture-product', { currentUser: { _id: 'buyer' } }, stores());
  try {
    assert.match(h.requests[0].url, /productId=fixture-product/);
    assert.equal(h.requests[0].options.headers.Authorization, 'Bearer customer-fixture');
    h.requests[0].resolve({ success: true, data: [offer], meta: { pages: 1 } }); await h.settle();
    const input = h.find(node => node.props?.id === 'wholesale-quantity');
    input.props.onChange({ target: { value: '6' } }); h.flush();
    assert.equal(h.find(node => node.type === 'button' && node.props.children === 'Add to Wholesale cart').props.disabled, true);
    h.find(node => node.props?.id === 'wholesale-quantity').props.onChange({ target: { value: '10' } }); h.flush();
    const button = h.find(node => node.type === 'button' && node.props.children === 'Add to Wholesale cart');
    const first = button.props.onClick(), duplicate = button.props.onClick();
    const requests = h.requests.filter(item => item.url.endsWith('/api/cart/wholesale'));
    assert.equal(requests.length, 1);
    assert.deepEqual(JSON.parse(requests[0].options.body), { productId: 'fixture-product', variantId: 'fixture-variant', qty: 10 });
    requests[0].resolve({ success: true }); await Promise.all([first, duplicate]); h.flush();
    assert.ok(h.find(node => node.props?.role === 'status'));
  } finally { h.close(); }
});
test('denied Wholesale catalog shows customer sign-in guidance and no price', async () => {
  const h = hookHarness(Catalog, {}, '/wholesale', { currentUser: null }, stores());
  try { h.requests[0].resolve({ message: 'Denied' }, 403); await h.settle(); assert.match(h.find(node => node.props?.role === 'alert').props.children.flat(Infinity).map(item => item?.props?.children || '').join(' '), /sign in/); assert.equal(h.find(node => node.props?.className === 'wholesale-card-price'), undefined); }
  finally { h.close(); }
});
test('Wholesale cart submits the displayed quote once and never calls retail checkout', async () => {
  let calls = []; let resolve;
  const context = { currentUser: { _id: 'buyer' }, savedAddresses: [address], setSelectedAddressId() {}, setActiveNav() {}, placeUnifiedOrder: (...args) => { calls.push(args); return new Promise(done => { resolve = done; }); } };
  const h = hookHarness(Cart, {}, '/wholesale/cart', context, stores());
  try {
    assert.match(h.requests[0].url, /\/api\/cart\/wholesale\?lat=19.1&lng=72.9/);
    h.requests[0].resolve({ data: cart }); await h.settle();
    const place = h.find(node => node.type === 'button' && node.props.children === 'Place Wholesale order');
    assert.equal(place.props.disabled, false);
    const a = place.props.onClick(), b = place.props.onClick();
    assert.equal(calls.length, 1); assert.deepEqual(calls[0], ['cod', 0, { purchaseMode: 'wholesale', quoteHash: cart.quoteHash }]);
    resolve({ ok: true, orders: [{ _id: 'fixture-order', orderNo: 'FIXTURE-001' }] }); await Promise.all([a, b]); h.flush();
    assert.ok(h.find(node => node.type === 'h2' && node.props.children === 'Wholesale order placed'));
  } finally { h.close(); }
});
test('stale offers and failed cart requests block Wholesale order submission', async () => {
  for (const failed of [false, true]) {
    const h = hookHarness(Cart, {}, '/wholesale/cart', { currentUser: { _id: 'buyer' }, savedAddresses: [address] }, stores());
    try {
      h.requests[0].resolve(failed ? { message: 'Unavailable' } : { data: { ...cart, valid: false, warnings: ['Seller suspended'] } }, failed ? 503 : 200); await h.settle();
      const button = h.find(node => node.type === 'button' && node.props.children === 'Place Wholesale order');
      assert.equal(button.props.disabled, true);
    } finally { h.close(); }
  }
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
test('late Wholesale checkout cannot show the previous account order after switching customers', async () => {
  let finish;
  const context = { currentUser: { _id: 'old-buyer' }, savedAddresses: [address], placeUnifiedOrder: () => new Promise(resolve => { finish = resolve; }) };
  const h = hookHarness(Cart, {}, '/wholesale/cart', context, stores());
  try {
    h.requests[0].resolve({ data: cart }); await h.settle();
    const placing = h.find(node => node.type === 'button' && node.props.children === 'Place Wholesale order').props.onClick();
    localStorage.setItem('userToken', 'different-customer-fixture');
    finish({ ok: true, orders: [{ _id: 'old-account-order', orderNo: 'OLD-ACCOUNT' }] });
    await placing; h.flush();
    assert.equal(h.find(node => node.type === 'h2' && node.props.children === 'Wholesale order placed'), undefined);
  } finally { h.close(); }
});
