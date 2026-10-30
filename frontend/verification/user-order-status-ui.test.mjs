import { before, after, beforeEach, afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { hookHarness } from './componentHarness.mjs';

let vite, Provider, Orders, Checkout, socket, previousDocument, portalRequests;
before(async () => {
  vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' });
  Provider = (await vite.ssrLoadModule('/src/modules/User/context/UserContext.jsx')).UserProvider;
  Orders = (await vite.ssrLoadModule('/src/modules/User/pages/OrdersPage.jsx')).default;
  Checkout = (await vite.ssrLoadModule('/src/modules/User/pages/CheckoutPage.jsx')).default;
  ({ socket } = await vite.ssrLoadModule('/src/utils/socket.js')); socket.connect = () => socket;
  portalRequests = await vite.ssrLoadModule('/src/utils/portalRequests.js');
});
after(async () => { await vite.close(); });
beforeEach(() => { portalRequests.clearPortalRequests('customer'); previousDocument = globalThis.document; globalThis.document = Object.assign(new EventTarget(), { visibilityState: 'visible', querySelector: () => null }); });
afterEach(() => { portalRequests.clearPortalRequests('customer'); if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument; });
const profile = { _id: 'fixture-buyer', name: 'Fixture Buyer', phone: '9876500001', roles: ['buyer'] };
const order = { _id: 'fixture-order', orderNo: 'ORD-FIXTURE', status: 'placed', type: 'grocery', paymentMethod: 'online',
  createdAt: '2026-10-24T10:00:00Z', items: [{ _id: 'item', name: 'Amla', qty: 1, price: 100 }], pricing: { subtotal: 100, totalAmount: 140 },
  timeline: [{ status: 'placed', timestamp: '2026-10-24T10:00:00Z' }] };
const text = node => node == null || typeof node === 'boolean' ? '' : typeof node !== 'object' ? String(node) : [node.props?.children].flat(Infinity).map(text).join(' ');
const storage = initial => {
  const map = new Map(Object.entries(initial || {}));
  return { getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, String(value)), removeItem: key => map.delete(key) };
};
const stores = () => ({ localStorage: storage({ userToken: 'fixture-customer-token', userProfile: JSON.stringify(profile) }), sessionStorage: storage() });
const history = h => h.requests.filter(r => r.url.includes('/api/orders?'));
const emit = (event, payload) => socket.listeners(event).forEach(listener => listener(payload));
function provider(path = '/orders') { return hookHarness(Provider, {}, path, { verified: true, profile }, stores()); }
async function seed(h) { history(h).at(-1).resolve({ data: [order] }); await h.settle(); }

test('status events synchronize My Orders and the open detail, and an older history response cannot roll them back', async () => {
  const h = provider();
  try {
    await seed(h); h.tree.props.value.setSelectedOrder(order); h.flush();
    const earlier = h.tree.props.value.fetchOrders(); const stale = history(h).at(-1);
    const timeline = [...order.timeline, { status: 'confirmed', timestamp: '2026-10-24T10:01:00Z' }];
    emit('order_status_updated', { orderId: order._id, status: 'confirmed', timeline }); h.flush();
    assert.equal(h.tree.props.value.orders[0].status, 'confirmed');
    assert.equal(h.tree.props.value.selectedOrder.status, 'confirmed');
    stale.resolve({ data: [order] }); await earlier; await h.settle();
    assert.equal(h.tree.props.value.selectedOrder.status, 'confirmed');
    history(h).at(-1).resolve({ data: [{ ...order, status: 'confirmed', timeline }] }); await h.settle();
    emit('order_delivered', { orderId: order._id }); h.flush();
    assert.equal(h.tree.props.value.orders[0].status, 'delivered');
    assert.equal(h.tree.props.value.selectedOrder.status, 'delivered');
    assert.deepEqual(h.tree.props.value.selectedOrder.timeline, timeline, 'An event without a timeline retains the recorded history');
    history(h).at(-1).resolve({ data: [{ ...order, status: 'delivered', timeline }] }); await h.settle();
  } finally { h.close(); }
});

test('delivery-stage events use the server stage and refresh canonical order status', async () => {
  const h = provider();
  try {
    await seed(h);
    emit('rider_assigned', { orderId: order._id, riderName: 'Fixture Rider', deliveryId: 'delivery' }); h.flush();
    assert.equal(h.tree.props.value.orders[0].status, 'placed', 'Rider assignment does not invent an order status');
    history(h).at(-1).resolve({ data: [{ ...order, status: 'dispatched' }] }); await h.settle();
    emit('delivery_status_updated', { orderId: order._id, stage: 'picked_up' }); h.flush();
    assert.equal(h.tree.props.value.activeRider.step, 'picked_up');
    history(h).at(-1).resolve({ data: [{ ...order, status: 'out_for_delivery' }] }); await h.settle();
    assert.equal(h.tree.props.value.orders[0].status, 'out_for_delivery');
  } finally { h.close(); }
});

test('focus, reconnect and visible-page polling recover missed statuses without reloading the page', async () => {
  const originalInterval = globalThis.setInterval;
  let poll;
  globalThis.setInterval = (callback, delay, ...args) => {
    if (delay === 15000) { poll = callback; return originalInterval(() => {}, 1000000); }
    return originalInterval(callback, delay, ...args);
  };
  const h = provider();
  try {
    await seed(h); assert.ok(poll);
    window.dispatchEvent(new Event('focus')); history(h).at(-1).resolve({ data: [{ ...order, status: 'confirmed' }] }); await h.settle();
    assert.equal(h.tree.props.value.orders[0].status, 'confirmed');
    emit('connect'); history(h).at(-1).resolve({ data: [{ ...order, status: 'out_for_delivery' }] }); await h.settle();
    const before = history(h).length; document.visibilityState = 'hidden'; poll();
    assert.equal(history(h).length, before, 'Background pages do not poll');
    document.visibilityState = 'visible'; poll(); history(h).at(-1).resolve({ data: [{ ...order, status: 'delivered' }] }); await h.settle();
    assert.equal(h.tree.props.value.orders[0].status, 'delivered');
    assert.equal(window.location.pathname, '/orders');
  } finally { h.close(); globalThis.setInterval = originalInterval; }
});

test('failed refresh keeps the last orders and reports the failure; stale customer sessions cannot restore data', async () => {
  const h = provider();
  try {
    await seed(h);
    const failure = h.tree.props.value.fetchOrders(); history(h).at(-1).resolve({ message: 'Fixture offline' }, 503); await failure; await h.settle();
    assert.equal(h.tree.props.value.orders[0]._id, order._id); assert.equal(h.tree.props.value.ordersError, 'Fixture offline');
    const stale = h.tree.props.value.fetchOrders(); const request = history(h).at(-1);
    localStorage.setItem('userToken', 'different-customer-token');
    request.resolve({ data: [{ ...order, orderNo: 'OLD-SESSION-RESPONSE' }] }); await stale; await h.settle();
    assert.equal(h.tree.props.value.orders[0].orderNo, order.orderNo);
  } finally { h.close(); }
});

test('provider cleanup leaves tracking screen socket listeners intact', () => {
  const trackingListener = () => {}; socket.on('order_status_updated', trackingListener);
  const h = provider(); h.close();
  try { assert.ok(socket.listeners('order_status_updated').includes(trackingListener)); }
  finally { socket.off('order_status_updated', trackingListener); }
});

test('refund notifications refresh the checkout wallet balance from the server', async () => {
  const h = provider('/account');
  try {
    h.requests.findLast(r => r.url.endsWith('/api/wallet')).resolve({ success: true, data: { balance: 0 } }); await h.settle();
    assert.equal(h.tree.props.value.walletBalance, 0);
    emit('notification_new', { event: 'REFUND_COMPLETED' });
    h.requests.findLast(r => r.url.endsWith('/api/wallet')).resolve({ success: true, data: { balance: 20.4 } }); await h.settle();
    assert.equal(h.tree.props.value.walletBalance, 20.4);
    const count = h.requests.length;
    emit('notification_new', { event: 'UNRELATED_EVENT' }); assert.equal(h.requests.length, count);
  } finally { h.close(); }
});

test('a wallet response from an earlier customer session cannot restore the checkout balance', async () => {
  const h = provider('/checkout');
  try {
    const pending = h.requests.findLast(r => r.url.endsWith('/api/wallet'));
    localStorage.setItem('userToken', 'different-customer-token');
    pending.resolve({ success: true, data: { balance: 999 } }); await h.settle();
    assert.equal(h.tree.props.value.walletBalance, 0);
  } finally { h.close(); }
});

test('My Orders labels the existing detail action Order Details and retains the same order target', () => {
  const opened = [], h = hookHarness(Orders, {}, '/orders', { orders: [order], setSelectedOrder: value => opened.push(value), fetchOrders() {} }, stores());
  try {
    assert.match(text(h.tree), /Order Details/); assert.doesNotMatch(text(h.tree), /Payment details/);
    h.find(n => n.type === 'button' && n.props.children === 'Order Details').props.onClick({ stopPropagation() {} });
    assert.deepEqual(opened, [order]);
  } finally { h.close(); }
});

for (const multiple of [false, true]) test(`success-page Track Order opens the placed order directly (${multiple ? 'split basket' : 'single order'})`, async () => {
  const selected = [], navigations = [];
  const address = { _id: 'address', name: profile.name, phone: profile.phone, line1: 'Fixture Road', city: 'Indore', pincode: '452001', lat: 22.7, lng: 75.8 };
  const created = { ...order, paymentMethod: 'cod', shippingAddress: address };
  const groups = [1, ...(multiple ? [2] : [])].map(index => ({ key: 'store-' + index, channel: 'grocery', seller: { name: 'Fixture Store' }, items: order.items, total: 140 }));
  const result = { ok: true, order: created, orders: [created, ...(multiple ? [{ ...created, _id: 'second-order' }] : [])] };
  const noop = () => {};
  const h = hookHarness(Checkout, {}, '/checkout', { currentUser: profile, savedAddresses: [address], selectedAddressId: address._id,
    getDeliveryPoint: () => address, getCartTotal: () => 140, getCartItems: () => order.items,
    serverCart: { items: order.items, pricing: order.pricing }, cartChannel: 'grocery', getCouponDiscount: () => 0,
    availableCoupons: [], fetchAvailableCoupons: noop, fetchWalletBalance: noop, tipSetting: { options: [] }, walletBalance: 0,
    setSelectedOrder: value => selected.push(value), setActiveNav: value => navigations.push(value),
    placeOrder: async () => result, placeUnifiedOrder: async () => result,
  }, stores());
  try {
    h.requests.find(r => r.url.includes('/api/cart/unified')).resolve({ data: { groups, totals: { subtotal: 100, deliveryCharge: 40, totalAmount: 140 } } }); await h.settle();
    await h.find(n => n.type === 'button' && n.props.className === 'pd-add-to-cart-btn').props.onClick(); h.flush();
    h.click('Track Order'); assert.deepEqual(selected, [created]); assert.deepEqual(navigations, []);
    if (multiple) {
      h.find(n => n.type === 'button' && n.key === 'second-order').props.onClick();
      assert.equal(selected.at(-1)._id, 'second-order');
    }
  } finally { h.close(); }
});
