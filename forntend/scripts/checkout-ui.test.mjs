import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { hookHarness } from './service-hookHarness.mjs';
let vite, Checkout, OrdersTab, UserProvider, portalRequests;
before(async () => {
  vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
  Checkout = (await vite.ssrLoadModule('/src/modules/User/pages/CheckoutPage.jsx')).default;
  OrdersTab = (await vite.ssrLoadModule('/src/modules/Seller/components/OrdersTab.jsx')).default;
  UserProvider = (await vite.ssrLoadModule('/src/modules/User/context/UserContext.jsx')).UserProvider;
  portalRequests = await vite.ssrLoadModule('/src/utils/portalRequests.js');
  const { socket } = await vite.ssrLoadModule('/src/utils/socket.js');
  socket.connect = () => socket; // Never connect to a live server in this fixture.
});
after(async () => { await vite.close(); });
const noop = () => {};
function storage(values = {}) {
  const entries = { ...values };
  return { getItem: key => entries[key] ?? null, setItem: (key, value) => { entries[key] = String(value); }, removeItem: key => { delete entries[key]; } };
}

test('provider recovery reuses the stored checkout key without creating or rotating an order attempt', async () => {
  portalRequests.clearPortalRequests('customer');
  const key = 'fixture-checkout-key-unchanged';
  const storageKey = 'bulkimart:checkout:single:fixture-buyer';
  const saved = JSON.stringify({ key, fingerprint: 'original-payload' });
  const profile = { _id: 'fixture-buyer', roles: ['buyer'] };
  const h = hookHarness(UserProvider, {}, '/checkout', { verified: true, profile }, {
    localStorage: storage({ userToken: 'fixture-token', userProfile: JSON.stringify(profile) }),
    sessionStorage: storage({ [storageKey]: saved }),
  });
  try {
    const checking = h.tree.props.value.checkCheckoutStatus('single');
    const request = h.requests.find(request => request.url.endsWith('/api/orders/checkout-status'));
    assert.ok(request); assert.equal(request.options.headers['Idempotency-Key'], key);
    assert.deepEqual(JSON.parse(request.options.body), { operation: 'single' });
    request.resolve({ success: true, data: { state: 'completed', canRetrySameKey: false } });
    assert.equal((await checking).data.state, 'completed');
    assert.equal(sessionStorage.getItem(storageKey), saved);
    assert.equal(h.requests.filter(request => request.options.method === 'POST' && /\/api\/orders$/.test(request.url)).length, 0);
    const before = h.requests.length;
    assert.equal((await h.tree.props.value.checkCheckoutStatus('unified')).ok, false);
    assert.equal(h.requests.length, before);
  } finally { h.close(); }
});

test('lost or malformed checkout responses preserve the key for a read-only recovery check', async () => {
  for (const operation of ['single', 'unified']) {
    portalRequests.clearPortalRequests('customer');
    const profile = { _id: 'fixture-buyer', name: 'Fixture', phone: '9876500000', roles: ['buyer'] };
    const h = hookHarness(UserProvider, {}, '/checkout', { verified: true, profile }, {
      localStorage: storage({ userToken: 'fixture-token', userProfile: JSON.stringify(profile) }), sessionStorage: storage(),
    });
    try {
      h.requests.find(request => request.url.endsWith('/api/users/addresses')).resolve({ data: [{ _id: 'fixture-address', name: 'Fixture', phone: '9876500000', line1: 'Fixture', city: 'Mumbai', pincode: '400001' }] });
      h.requests.find(request => request.url.includes('/api/cart?')).resolve({ data: { items: [{ name: 'Fixture', qty: 1, fulfillmentType: 'physical' }], pricing: { totalAmount: 140 } } });
      await h.settle();
      const placing = operation === 'single' ? h.tree.props.value.placeOrder() : h.tree.props.value.placeUnifiedOrder();
      const endpoint = operation === 'single' ? '/api/orders' : '/api/orders/unified';
      const attempt = h.requests.find(request => request.url.endsWith(endpoint) && request.options.method === 'POST');
      assert.ok(attempt);
      const key = attempt.options.headers['Idempotency-Key'];
      if (operation === 'single') attempt.reject(new Error('fixture connection lost'));
      else attempt.resolve({ unexpected: 'truncated response' }, 201);
      assert.equal((await placing).code, 'CHECKOUT_OUTCOME_UNCERTAIN');
      assert.equal(JSON.parse(sessionStorage.getItem(`bulkimart:checkout:${operation}:fixture-buyer`)).key, key);
      const checking = h.tree.props.value.checkCheckoutStatus(operation);
      const recovery = h.requests.find(request => request.url.endsWith('/api/orders/checkout-status'));
      assert.equal(recovery.options.headers['Idempotency-Key'], key);
      recovery.resolve({ data: { state: 'completed', canRetrySameKey: false } }); await checking;
      assert.equal(h.requests.filter(request => request.url.endsWith(endpoint) && request.options.method === 'POST').length, 1);
    } finally { h.close(); }
  }
});
function userFixture(overrides = {}) {
  const calls = [];
  const address = { _id: 'address', name: 'Fixture Buyer', phone: '9876500000', line1: 'Fixture', city: 'Mumbai', pincode: '400001', lat: 19.11, lng: 72.91 };
  const context = { savedAddresses: [address], selectedAddressId: 'address', setSelectedAddressId: noop, addAddress: noop, uploadLandmarkImage: noop,
    currentUser: { _id: 'buyer', name: 'Fixture Buyer', phone: '9876500000' }, getCartTotal: () => 140, getCartItems: () => [{ _id: 'line', productId: 'product', name: 'Fixture', price: 100, qty: 1 }],
    getDeliveryPoint: () => address, serverCart: { items: [{ name: 'Fixture', qty: 1, fulfillmentType: 'physical' }], pricing: { subtotal: 100, deliveryCharge: 40, totalAmount: 140 } },
    cartChannel: 'ecommerce', deliveryMode: null, setDeliveryMode: noop, getCouponDiscount: () => 0, cartLoading: false, appliedCoupon: null, availableCoupons: [],
    fetchAvailableCoupons: noop, removeCoupon: noop, couponCode: '', tipSetting: { options: [] }, fetchTipSetting: noop, useCoinsSelected: false, toggleUseCoins: noop,
    walletBalance: 1000, fetchWalletBalance: noop, setActiveNav: noop, setSelectedOrder: noop,
    placeOrder: async (...args) => { calls.push(['single', ...args]); return { ok: false, message: 'Fixture stop after submission' }; },
    placeUnifiedOrder: async (...args) => { calls.push(['unified', ...args]); return { ok: false, message: 'Fixture stop after submission' }; },
    ...overrides };
  return { context, calls };
}
const group = (key = 'shop', channel = 'ecommerce') => ({ key, channel, seller: { name: 'Fixture Store' }, deliveryMode: channel === 'ecommerce' ? 'scheduled' : null,
  requestedMode: channel === 'ecommerce' ? 'scheduled' : null, modeChosen: true, items: [{ itemId: key, name: 'Fixture', qty: 1, price: 100, lineTotal: 100, image: '' }], deliveryCharge: 40, total: 140 });
const basket = (groups = [group()]) => ({ success: true, data: { groups, needsDeliveryChoice: false, totals: { subtotal: groups.length * 100, deliveryCharge: groups.length * 40, totalAmount: groups.length * 140, itemCount: groups.length } } });
function harness(overrides) { const fixture = userFixture(overrides); return { ...fixture, h: hookHarness(Checkout, {}, '/checkout', fixture.context) }; }
const placeButton = h => h.find(n => n.type === 'button' && n.props.className === 'pd-add-to-cart-btn');
async function load(h, groups) { h.requests.find(req => req.url.includes('/api/cart/unified')).resolve(basket(groups)); await h.settle(); }
function text(node) { if (node == null || typeof node === 'boolean') return ''; if (typeof node !== 'object') return String(node); return [node.props?.children].flat(Infinity).map(text).join(' '); }

test('regular checkout can submit without provider choice after authoritative pricing loads', async () => {
  const { h, calls } = harness(); try {
    assert.equal(placeButton(h).props.disabled, true); await load(h); assert.equal(placeButton(h).props.disabled, false);
    assert.match(text(h.tree), /Delivery arranged after store acceptance/); assert.match(text(h.tree), /will not add a customer charge/);
    await placeButton(h).props.onClick(); h.flush(); assert.deepEqual(calls, [['single', 'Cash on Delivery', 0]]);
  } finally { h.close(); }
});
test('a rapid double tap starts only one checkout request', async () => {
  let finish;
  const pending = new Promise(resolve => { finish = resolve; });
  const { h, calls } = harness({ placeOrder: async (...args) => { calls.push(['single', ...args]); return pending; } });
  try {
    await load(h);
    const button = placeButton(h);
    const first = button.props.onClick();
    const second = button.props.onClick();
    assert.equal(calls.length, 1);
    finish({ ok: false, message: 'Fixture completed' });
    await Promise.all([first, second]);
  } finally { h.close(); }
});
test('a genuine conflict offers order review and basket refresh without repeating checkout', async () => {
  let writes = 0; const navigations = [];
  const { h } = harness({ placeOrder: async () => { writes++; return { ok: false, status: 409, code: 'STOCK_CHANGED', requestId: 'fixture-reference', message: 'Stock changed. Review your basket.' }; }, setActiveNav: next => navigations.push(next) });
  try {
    await load(h); await placeButton(h).props.onClick(); h.flush();
    assert.equal(writes, 1); assert.match(text(h.tree), /fixture-reference/);
    h.click('Check My Orders'); assert.deepEqual(navigations, ['orders']);
    h.click('Refresh basket'); assert.equal(writes, 1); assert.equal(h.requests.length, 2);
  } finally { h.close(); }
});
test('uncertain idempotency conflict requests order review rather than automatic resubmission', async () => {
  const { h } = harness({ placeOrder: async () => ({ ok: false, status: 409, code: 'CHECKOUT_IN_PROGRESS', message: 'Order still processing' }) });
  try {
    await load(h); await placeButton(h).props.onClick(); h.flush();
    assert.ok(h.find(n => n.type === 'button' && n.props.children === 'Check My Orders'));
    assert.equal(h.find(n => n.type === 'button' && n.props.children === 'Refresh basket'), undefined);
  } finally { h.close(); }
});

test('data conflict requires a read-only status check before a manual same-session retry', async () => {
  let writes = 0, checks = 0;
  const { h } = harness({
    placeOrder: async () => { writes++; return { ok: false, status: 409, operation: 'single', code: 'CHECKOUT_DATA_CONFLICT', message: 'Checkout data conflict' }; },
    checkCheckoutStatus: async operation => { checks++; assert.equal(operation, 'single'); return { ok: true, data: { state: 'not_found', canRetrySameKey: true } }; },
  });
  try {
    await load(h); await placeButton(h).props.onClick(); h.flush();
    assert.equal(placeButton(h).props.disabled, true);
    await placeButton(h).props.onClick(); assert.equal(writes, 1);
    await h.click('Check checkout status'); h.flush();
    assert.equal(checks, 1); assert.equal(writes, 1); assert.equal(placeButton(h).props.disabled, false);
    assert.match(text(h.tree), /same checkout session/);
    await placeButton(h).props.onClick(); assert.equal(writes, 2);
  } finally { h.close(); }
});

test('committed, pending and failed recovery checks never automatically submit another order', async () => {
  for (const result of [
    { ok: true, data: { state: 'completed', canRetrySameKey: false }, message: 'Your order already exists. Open My Orders.' },
    { ok: true, data: { state: 'processing', canRetrySameKey: false }, message: 'Checkout is processing.' },
    { ok: false, message: 'Status check is unavailable.' },
  ]) {
    let writes = 0;
    const { h } = harness({
      placeOrder: async () => { writes++; return { ok: false, operation: 'single', code: 'CHECKOUT_OUTCOME_UNCERTAIN', message: 'Check checkout status' }; },
      checkCheckoutStatus: async () => result,
    });
    try {
      await load(h); await placeButton(h).props.onClick(); h.flush();
      await h.click('Check checkout status'); h.flush();
      assert.equal(writes, 1); assert.equal(placeButton(h).props.disabled, true);
      assert.match(text(h.tree), new RegExp(result.message.replace(/[.]/g, '\\.')));
      await placeButton(h).props.onClick(); assert.equal(writes, 1);
    } finally { h.close(); }
  }
});
test('multi-store basket submits grouped checkout without customer-selected carriers', async () => {
  const { h, calls } = harness(); try { await load(h, [group('first'), group('second')]); await placeButton(h).props.onClick(); assert.deepEqual(calls, [['unified', 'Cash on Delivery', 0]]); } finally { h.close(); }
});

test('neutral checkout submits the displayed e-commerce basket when the remembered channel is Quick', async () => {
  const { h, calls } = harness({ cartChannel: 'grocery', serverCart: { items: [], pricing: { totalAmount: 0 } } });
  try {
    await load(h, [group('ecommerce-only', 'ecommerce')]);
    assert.equal(placeButton(h).props.disabled, false);
    await placeButton(h).props.onClick();
    assert.deepEqual(calls, [['unified', 'Cash on Delivery', 0]]);
  } finally { h.close(); }
});
test('wallet and online payment stay independent of carrier assignment', async () => {
  for (const [value, label] of [['Bulkimart Wallet', 'wallet'], ['Razorpay Online Payment', 'Online Payment']]) {
    const { h, calls } = harness(); try {
      await load(h); const option = h.find(n => n.type === 'div' && typeof n.props.onClick === 'function' && text(n).includes(value));
      assert.ok(option); option.props.onClick(); h.flush(); await placeButton(h).props.onClick(); assert.equal(calls[0][1], label);
    } finally { h.close(); }
  }
});
test('failed basket fetch blocks ordering and exposes retry', async () => {
  const { h, calls } = harness(); try {
    h.requests[0].resolve({ message: 'Fixture unavailable' }, 503); await h.settle(); assert.equal(placeButton(h).props.disabled, true); assert.match(text(h.tree), /Fixture unavailable/);
    await placeButton(h).props.onClick(); assert.equal(calls.length, 0); h.click('Retry basket check'); h.requests[1].resolve(basket()); await h.settle(); assert.equal(placeButton(h).props.disabled, false);
  } finally { h.close(); }
});
test('Quick Commerce is shown separately and still submits without a customer carrier choice', async () => {
  const { h, calls } = harness({ cartChannel: 'grocery' }); try { await load(h, [group('quick', 'grocery')]); assert.match(text(h.tree), /Quick Commerce delivery/); await placeButton(h).props.onClick(); assert.equal(calls.length, 1); } finally { h.close(); }
});
test('seller acceptance and delivery setup remain separate actions', () => {
  const context = { orders: [{ _id: 'order', orderNo: 'ORD-FIXTURE', channel: 'ecommerce', status: 'placed', permittedActions: [{ to: 'confirmed', label: 'Accept order' }], pricing: { totalAmount: 140 }, items: [{ name: 'Fixture', qty: 1 }], createdAt: new Date().toISOString() }], ordersLoading: false, fetchSellerOrders: noop, selectedTypes: ['ecommerce'], activeMode: 'ecommerce', setActiveMode: noop };
  const h = hookHarness(OrdersTab, {}, '/seller', context); try { assert.match(text(h.tree), /Accept order/); assert.doesNotMatch(text(h.tree), /Create Shiprocket shipment/); } finally { h.close(); }
});
test('an obsolete basket quote cannot replace pricing for a newer address', async () => {
  const { h, context } = harness();
  try {
    context.getDeliveryPoint = () => ({ lat: 20, lng: 73 });
    h.find(n => n.type === 'input' && n.props.placeholder === 'Enter coupon code').props.onChange({ target: { value: 'fixture' } }); h.flush();
    h.requests[1].resolve(basket([group('first'), group('second')])); await h.settle();
    h.requests[0].resolve(basket()); await h.settle();
    assert.equal(placeButton(h).props.disabled, false); assert.match(text(h.tree), /280/);
  } finally { h.close(); }
});
test('seller reviews the courier estimate and sends its confirmed limit with shipment creation', async () => {
  const calls = [];
  const context = { orders: [{ _id: 'order', orderNo: 'ORD-FIXTURE', channel: 'ecommerce', status: 'preparing', permittedActions: [{ setup: true, label: 'Choose delivery' }], fulfillment: { assignmentPolicy: 'seller_after_acceptance', readyAt: new Date().toISOString() }, pricing: { totalAmount: 140 }, items: [{ name: 'Fixture', qty: 1 }], createdAt: new Date().toISOString() }],
    ordersLoading: false, fetchSellerOrders: noop, selectedTypes: ['ecommerce'], activeMode: 'ecommerce', setActiveMode: noop,
    getFulfillmentOptions: async () => ({ ok: true, data: { manual: { available: false }, shiprocket: { available: true, quote: { courierCharge: 65.25 } } } }),
    openSellerOrder: noop, createShiprocketShipment: async (...args) => { calls.push(args); return { ok: true, message: 'Fixture shipment created' }; } };
  context.selectedOrder = context.orders[0];
  const h = hookHarness(OrdersTab, { detailPage: true }, '/seller/orders/order', context);
  try {
    await h.settle(); assert.match(text(h.tree), /customer's checkout delivery charge stays unchanged/);
    for (const field of ['Length', 'Breadth', 'Height']) { h.find(n => n.type === 'input' && n.props.placeholder === `${field} (cm)`).props.onChange({ target: { value: '10' } }); h.flush(); }
    let confirmation = ''; window.confirm = message => { confirmation = message; return true; };
    await h.click('Create Shiprocket shipment');
    assert.match(confirmation, /65.25/); assert.deepEqual(calls, [['order', { length: '10', breadth: '10', height: '10' }, 65.25]]);
  } finally { h.close(); }
});
