import { before, beforeEach, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createServer } from 'vite';
import { hookHarness } from './service-hookHarness.mjs';
let vite, Alerts, Drawer, Orders, SellerProvider, socket, push, PushControl, createPushRegistration, PickupCard, portalRequests;
before(async () => {
  vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
  Alerts = (await vite.ssrLoadModule('/src/modules/Seller/components/SellerOrderAlerts.jsx')).default;
  Drawer = (await vite.ssrLoadModule('/src/modules/Seller/components/NotificationDrawer.jsx')).default;
  Orders = (await vite.ssrLoadModule('/src/modules/Seller/components/OrdersTab.jsx')).default;
  SellerProvider = (await vite.ssrLoadModule('/src/modules/Seller/context/SellerContext.jsx')).SellerProvider;
  socket = (await vite.ssrLoadModule('/src/utils/socket.js')).socket;
  socket.connect = () => socket;
  push = await vite.ssrLoadModule('/src/utils/firebaseMessaging.js');
  PushControl = (await vite.ssrLoadModule('/src/modules/Seller/components/SellerPushControl.jsx')).default;
  PickupCard = (await vite.ssrLoadModule('/src/modules/Seller/components/PickupSyncCard.jsx')).default;
  portalRequests = await vite.ssrLoadModule('/src/utils/portalRequests.js');
  ({ createPushRegistration } = await vite.ssrLoadModule('/src/utils/pushRegistration.js'));
});
beforeEach(() => portalRequests.clearPortalRequests('seller'));
after(async () => { await vite.close(); });
const id = '507f1f77bcf86cd799439011', notificationId = '507f1f77bcf86cd799439012';
const row = { _id: id, orderNo: 'ORDER-FIXTURE', status: 'placed', channel: 'grocery', itemCount: 2, subtotal: 100, paymentMethod: 'cod', paymentStatus: 'pending', customer: { name: 'Fixture customer' }, items: [{ name: 'Fixture item', qty: 2, price: 50 }], shippingAddress: { city: 'Fixture city' } };
const storage = () => { const data = {}; return { getItem: key => data[key] ?? null, setItem: (key, value) => { data[key] = value; }, removeItem: key => { delete data[key]; } }; };
const emit = (event, payload) => socket.listeners(event).forEach(listener => listener(payload));
const context = overrides => ({ sellerProfile: { _id: 'seller-fixture', status: 'approved' }, fetchSellerOrder: async () => ({ ok: true, data: row }), openSellerOrder: async () => true, setSelectedOrder: () => {}, ...overrides });
const text = node => node == null ? '' : typeof node !== 'object' ? String(node) : [node.props?.children].flat(Infinity).map(text).join(' ');

test('pickup pending and registered states reflect backend confirmation, approval stays separate and API uses seller credentials', async () => {
  const local = storage(); local.setItem('userToken', 'customer-fixture'); local.setItem('sellerToken', 'seller-fixture');
  const h = hookHarness(PickupCard, { seller: { _id: id, storeDetails: {} } }, '/seller/profile', undefined, { localStorage: local });
  try {
    assert.equal(h.requests[0].options.headers.Authorization, 'Bearer seller-fixture');
    h.requests[0].resolve({ data: { status: 'pending' } }); await h.settle();
    assert.match(text(h.tree), /Pending/); assert.doesNotMatch(text(h.tree), /Registered/);
    assert.equal(h.find(n => n.type === 'button' && n.props.children === 'Retry pickup synchronization').props.disabled, true);
    h.click('Refresh pickup status'); h.requests.at(-1).resolve({ data: { status: 'registered', locationName: 'fixture-provider-name', shippingApproved: false } }); await h.settle();
    assert.match(text(h.tree), /Registered/); assert.match(text(h.tree), /still requires platform approval/);
    assert.equal(h.find(n => n.type === 'button' && n.props.children === 'Retry pickup synchronization'), undefined);
  } finally { h.close(); }
});

test('pickup retry is deduplicated, handles failures and does not claim registration from a queued acknowledgement', async () => {
  const h = hookHarness(PickupCard, { seller: { _id: id } }, '/seller/profile');
  try {
    h.requests[0].resolve({}, 500); await h.settle(); assert.match(text(h.tree), /status unavailable/);
    const retry = h.find(n => n.type === 'button' && n.props.children === 'Retry pickup synchronization');
    const first = retry.props.onClick(); retry.props.onClick(); assert.equal(h.requests.filter(r => r.options.method === 'POST').length, 1);
    h.requests.at(-1).resolve({ data: { status: 'pending' } }); await h.settle();
    h.requests.at(-1).resolve({ data: { status: 'pending' } }); await first; await h.settle();
    assert.doesNotMatch(text(h.tree), /Registered/); assert.match(text(h.tree), /Pending/);
    h.click('Correct pickup address/contact'); assert.ok(h.find(n => n.type === 'input' && n.props.type === 'email'));
  } finally { h.close(); }
});

test('push control waits for final registration, blocks repeated clicks and replaces button only on verified success', async () => {
  let finish, calls = 0;
  const register = () => { calls++; return new Promise(resolve => { finish = resolve; }); };
  const h = hookHarness(PushControl, { register });
  try {
    assert.equal(h.find(n => n.type === 'button').props.disabled, true);
    h.find(n => n.type === 'button').props.onClick(); assert.equal(calls, 1);
    assert.doesNotMatch(text(h.tree), /Notifications enabled/);
    finish({ status: 'prompt_required' }); await h.settle();
    h.click('Enable order notifications'); assert.equal(calls, 2);
    finish('fixture-confirmed-backend-token'); await h.settle();
    assert.match(text(h.tree), /Notifications enabled/);
    assert.equal(h.find(n => n.type === 'button'), undefined);
  } finally { h.close(); }
});

test('push errors offer actionable recovery and safe retry; unmounted control ignores completion', async () => {
  for (const status of ['denied', 'unconfigured', 'worker_registration_failed', 'registration_failed', 'unavailable', 'timeout']) {
    let calls = 0, finish;
    const h = hookHarness(PushControl, { register: async () => { calls++; if (calls === 1) return { status }; return new Promise(resolve => { finish = resolve; }); } });
    try {
      await h.settle(); assert.equal(h.find(n => n.type === 'button').props.disabled, false);
      assert.doesNotMatch(text(h.tree), /Connecting|Notifications enabled/);
      assert.match(text(h.tree), /settings|configure|retry/i);
      h.click('Enable order notifications'); assert.equal(calls, 2);
      h.unmount(); const updates = h.updates; finish('fixture-token'); await h.settle(); assert.equal(h.updates, updates);
    } finally { h.close(); }
  }
});

test('registration shares an in-flight result, expires stuck work, retries failures and invalidates account changes', async () => {
  let session = 'fixture-a', calls = 0, complete, context;
  const registration = createPushRegistration({ getSession: () => session, timeoutMs: 20,
    perform: (_options, ctx) => { calls++; context = ctx; return new Promise(resolve => { complete = resolve; }); } });
  const first = registration.run({}); const concurrent = registration.run({ requestPermission: true });
  assert.equal(first, concurrent); await Promise.resolve(); assert.equal(calls, 1);
  assert.equal((await first).status, 'timeout'); assert.equal(context.isCurrent(), false);
  complete('too-late');
  const retry = registration.run({}); await Promise.resolve(); complete('confirmed'); assert.equal(await retry, 'confirmed');
  assert.equal(await registration.run({}), 'confirmed'); assert.equal(calls, 2);
  session = 'fixture-b'; const switched = registration.run({}); await Promise.resolve();
  registration.reset(); complete('stale'); assert.equal((await switched).status, 'session_changed');
});

test('failed backend registration cannot enable push; errors allow another registration', async () => {
  let calls = 0;
  const registration = createPushRegistration({ getSession: () => 'fixture', perform: async () => ++calls === 1 ? { status: 'registration_failed' } : 'confirmed' });
  assert.equal((await registration.run({})).status, 'registration_failed');
  assert.equal(await registration.run({}), 'confirmed');
});

test('actual token registration requires backend success and rejects stale account acknowledgements', async () => {
  const local = storage(); local.setItem('sellerToken', 'fixture-session');
  const h = hookHarness(() => null, {}, '/seller/orders', undefined, { localStorage: local });
  try {
    const rejected = push.registerTokenWithBackend('fixture-device-token');
    h.requests.at(-1).resolve({ success: false }, 500);
    assert.equal(await rejected, undefined); assert.equal(local.getItem('bulkimart_seller_fcm_token'), null);
    const registered = push.registerTokenWithBackend('fixture-device-token');
    h.requests.at(-1).resolve({ success: true }); assert.equal(await registered, true);
    assert.equal(local.getItem('bulkimart_seller_fcm_token'), 'fixture-device-token');
    local.removeItem('bulkimart_seller_fcm_token');
    const stale = push.registerTokenWithBackend('fixture-device-token'); local.setItem('sellerToken', 'another-session');
    h.requests.at(-1).resolve({ success: true }); await h.settle();
    assert.equal(h.requests.at(-1).options.method, 'DELETE'); h.requests.at(-1).resolve({ success: true });
    assert.equal(await stale, false); assert.equal(local.getItem('bulkimart_seller_fcm_token'), null);
  } finally { h.close(); }
});

test('new order appears on Products, duplicates/reconnects do not repeat it, and listeners clean up', async () => {
  let fetches = 0, opened;
  const beforeCount = socket.listeners('new_order').length;
  const h = hookHarness(Alerts, {}, '/seller/products', context({ fetchSellerOrder: async () => { fetches++; return { ok: true, data: row }; }, openSellerOrder: async (...args) => { opened = args; return true; } }), { sessionStorage: storage() });
  try {
    h.requests[0].resolve({ data: [] }); await h.settle();
    h.requests.at(-1).resolve({ data: [] }); await h.settle();
    emit('new_order', { orderId: id }); emit('notification_new', { event: 'ORDER_CREATED', metadata: { orderId: id }, _id: notificationId }); await h.settle();
    assert.match(text(h.tree), /New order received/); assert.equal(fetches, 1);
    // Notification ID may arrive after the reference-only socket hint.
    emit('notification_new', { event: 'ORDER_CREATED', metadata: { orderId: id }, _id: notificationId }); await h.settle();
    await h.click('View order'); h.flush(); assert.equal(opened[0], id); assert.equal(opened[1], notificationId);
    emit('connect'); h.requests.at(-1).resolve({ data: [{ event: 'ORDER_CREATED', metadata: { orderId: id }, _id: notificationId }] }); await h.settle();
    h.requests.at(-1).resolve({ data: [] }); await h.settle();
    assert.equal(h.tree, null);
    h.unmount(); assert.equal(socket.listeners('new_order').length, beforeCount);
  } finally { h.close(); }
});

test('unauthorized/malformed/status-update events never render protected order details', async () => {
  let fetches = 0;
  const h = hookHarness(Alerts, {}, '/seller', context({ fetchSellerOrder: async () => { fetches++; return { ok: false }; } }), { sessionStorage: storage() });
  try {
    h.requests[0].resolve({ data: [] }); await h.settle();
    emit('notification_new', { event: 'ORDER_STATUS_UPDATED', metadata: { orderId: id } }); emit('new_order', { orderId: '../../private' }); await h.settle(); assert.equal(fetches, 0);
    emit('new_order', { orderId: id }); await h.settle(); assert.equal(fetches, 1); assert.equal(h.tree, null);
  } finally { h.close(); }
});

test('already open order is refreshed from authorized data without another popup', async () => {
  let updated;
  const h = hookHarness(Alerts, {}, '/seller/orders', context({ selectedOrder: row, setSelectedOrder: value => { updated = value; }, fetchSellerOrder: async () => ({ ok: true, data: { ...row, status: 'preparing', paymentStatus: 'paid' } }) }), { sessionStorage: storage() });
  try { h.requests[0].resolve({ data: [] }); await h.settle(); emit('new_order', { orderId: id }); await h.settle(); assert.equal(updated.status, 'preparing'); assert.equal(updated.paymentStatus, 'paid'); assert.equal(h.tree, null); }
  finally { h.close(); }
});

test('pending-order reconciliation recovers a missed notification and dismissal survives portal remount', async () => {
  const session = storage();
  const h = hookHarness(Alerts, {}, '/seller/stock', context({}), { sessionStorage: session });
  try {
    h.requests[0].resolve({ data: [] }); await h.settle();
    const orders = h.requests.find(request => request.url.includes('/api/sellers/orders?status=placed'));
    assert.ok(orders); orders.resolve({ data: [{ _id: id }] }); await h.settle();
    assert.match(text(h.tree), /New order received/);
    h.find(n => n.type === 'button' && n.props['aria-label'] === 'Dismiss new order').props.onClick(); h.flush();
    assert.equal(h.tree, null);
  } finally { h.close(); }
  let fetches = 0;
  const remount = hookHarness(Alerts, {}, '/seller/products', context({ fetchSellerOrder: async () => { fetches++; return { ok: true, data: row }; } }), { sessionStorage: session });
  try {
    remount.requests[0].resolve({ data: [{ event: 'ORDER_CREATED', metadata: { orderId: id } }] }); await remount.settle();
    remount.requests.at(-1).resolve({ data: [{ _id: id }] }); await remount.settle();
    emit('new_order', { orderId: id }); await remount.settle();
    assert.equal(remount.tree, null); assert.equal(fetches, 0);
  } finally { remount.close(); }
});

test('drawer uses keyboard-native action, closes and opens the referenced order instead of list-only navigation', async () => {
  let closed = 0, opened;
  const h = hookHarness(Drawer, { isOpen: true, onClose: () => { closed++; } }, '/seller/orders', context({ openSellerOrder: async (...args) => { opened = args; } }));
  try {
    for (const request of h.requests) request.resolve(request.url.includes('unread-count') ? { data: { count: 1 } } : { data: [{ _id: notificationId, event: 'ORDER_CREATED', type: 'order', title: 'New order received', message: 'Fixture', metadata: { orderId: id }, createdAt: new Date().toISOString() }] });
    await h.settle(); const action = h.find(n => n.type === 'button' && n.props.className === 'seller-notification-open');
    assert.ok(action); await action.props.onClick(); assert.equal(closed, 1); assert.deepEqual(opened, [id, notificationId]);
    assert.equal(h.find(n => n.type === 'button' && n.props['aria-label'] === 'Dismiss notification').props.children, '✕');
  } finally { h.close(); }
});

test('dedicated details page exposes fresh status, payment, items and order actions even without a list row', () => {
  const h = hookHarness(Orders, { detailPage: true }, '/seller/orders/'+id, context({ orders: [], selectedOrder: { ...row, status: 'confirmed', paymentStatus: 'paid', permittedActions: [{ to: 'preparing', label: 'Start preparing' }] }, selectedTypes: ['quick'], activeMode: 'quick', setActiveMode: () => {}, closeSellerOrder: () => {} }));
  try { assert.ok(h.find(n => n.props?.['aria-label'] === 'Order details')); assert.match(text(h.tree), /paid/); assert.match(text(h.tree), /Fixture item/); assert.match(text(h.tree), /Start preparing/); }
  finally { h.close(); }
});

test('cards and details use server actions; preparation shows readiness/cancellation rather than rejection and terminals fail closed', () => {
  for (const [status, permittedActions] of [
    ['placed', [{ to: 'confirmed', label: 'Accept order' }, { to: 'cancelled', label: 'Reject', reject: true }]],
    ['preparing', [{ to: 'ready_for_pickup', label: 'Ready for pickup' }, { to: 'cancelled', label: 'Cancel order', reject: true }]],
    ['dispatched', []], ['delivered', []], ['cancelled', []],
  ]) {
    const order = { ...row, status, permittedActions };
    const h = hookHarness(Orders, {}, '/seller/orders', context({ orders: [order], selectedOrder: order, selectedTypes: ['quick'], activeMode: 'quick' }));
    try {
      for (const action of permittedActions) assert.ok(h.find(n => n.type === 'button' && n.props.children === action.label));
      if (status !== 'placed') assert.equal(h.find(n => n.type === 'button' && n.props.children === 'Reject'), undefined);
      if (!permittedActions.length) assert.equal(h.find(n => n.type === 'button' && n.props.children === 'Mark delivered'), undefined);
    } finally { h.close(); }
  }
});

test('details show authoritative customer/store/item/payment/rider/shipment sections without rendering unsafe links', () => {
  const order = { ...row, permittedActions: [], shippingAddress: { name: 'Fixture Customer', line1: 'Fixture customer destination', city: 'Fixture City', pincode: '400001' },
    pricing: { subtotal: 100, deliveryCharge: 20, totalAmount: 120 }, store: { name: 'Fixture Store', pickupAddress: { address: 'Fixture store pickup', city: 'Store City' }, pickupLocation: 'registered-store' },
    deliveryAssignment: { status: 'assigned', rider: { name: 'Fixture Rider', phone: 'masked fixture contact' }, assignedAt: '2026-10-15T00:00:00Z' },
    shiprocket: { awb: 'FIXTURE-AWB', shipmentId: 'FIXTURE-SHIPMENT', trackingUrl: 'javascript:alert(1)', labelUrl: 'https://provider.invalid/label', pickupLocation: 'registered-store', status: 'awb_assigned' } };
  const h = hookHarness(Orders, { detailPage: true }, '/seller/orders/'+id, context({ orders: [], selectedOrder: order }));
  try {
    for (const label of ['Order summary','Customer and delivery address','Your items in this order','Store and pickup location','Bulkimart delivery','Courier shipment','Status timeline','Fixture customer destination','Fixture store pickup','Fixture Rider','FIXTURE-AWB']) assert.ok(text(h.tree).includes(label), label);
    assert.equal(h.find(n => n.type === 'a' && n.props.href?.startsWith('javascript:')), undefined);
    assert.ok(h.find(n => n.type === 'a' && n.props.children === 'Download label'));
  } finally { h.close(); }
});

test('fulfillment view distinguishes pickup/destination and explains rider acceptance before manual delivery', async () => {
  let reopened;
  const order = { ...row, status: 'preparing', permittedActions: [{ setup: true, label: 'Choose delivery' }] };
  const h = hookHarness(Orders, { detailPage: true }, '/seller/orders/'+id, context({ orders: [], selectedOrder: order,
    getFulfillmentOptions: async () => ({ ok: true, data: { pickup: { address: 'Store pickup fixture' }, destination: { line1: 'Customer destination fixture' }, manual: { available: false, eligibleRiderCount: 0, riders: [], reason: 'No eligible on-duty riders' }, shiprocket: { available: false, reason: 'Pickup is not registered' } } }), closeSellerOrder: () => {}, openSellerOrder: async id => { reopened = id; } }));
  try {
    await h.settle();
    assert.match(text(h.tree), /Store pickup fixture/); assert.match(text(h.tree), /Customer destination fixture/);
    assert.match(text(h.tree), /riders accept offers/i); assert.match(text(h.tree), /No eligible on-duty riders/);
    assert.ok(h.find(n => n.type === 'button' && n.props.children?.includes?.('Create Shiprocket shipment')).props.disabled);
  } finally { h.close(); }
});

test('push denial and default permission never trigger an automatic browser prompt', async () => {
  const previous = { window: globalThis.window, navigator: globalThis.navigator, Notification: globalThis.Notification, localStorage: globalThis.localStorage };
  let prompts = 0;
  try {
    const notification = { permission: 'denied', requestPermission: async () => { prompts++; return 'denied'; } };
    globalThis.window = { Notification: notification };
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { serviceWorker: {} } });
    globalThis.Notification = notification; globalThis.localStorage = { getItem: () => 'fixture-token' };
    assert.equal((await push.initPushNotifications({ requestPermission: true })).status, 'denied');
    notification.permission = 'default'; await push.initPushNotifications(); assert.equal(prompts, 0);
  } finally { for (const [key, value] of Object.entries(previous)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value }); }
});

test('direct seller deep link fetches fresh authorized detail, selects its channel and marks the notification read', async () => {
  const local = storage(); local.setItem('sellerToken', 'fixture-token'); local.setItem('sellerUserProfile', JSON.stringify({ _id: id }));
  const h = hookHarness(SellerProvider, {}, `/seller/orders?order=${id}&notification=${notificationId}`, undefined, { localStorage: local });
  try {
    h.requests.find(request => request.url.endsWith('/api/sellers/me')).resolve({ seller: { _id: 'seller-fixture', status: 'approved', salesChannels: ['grocery'] } });
    await h.settle();
    const detail = h.requests.find(request => request.url.endsWith(`/api/sellers/orders/${id}`)); assert.ok(detail);
    detail.resolve({ data: { ...row, status: 'preparing', paymentStatus: 'paid' } }); await h.settle();
    assert.equal(h.tree.props.value.selectedOrder.status, 'preparing'); assert.equal(h.tree.props.value.activeMode, 'quick');
    const read = h.requests.find(request => request.url.endsWith(`/api/notifications/${notificationId}/read`)); assert.ok(read);
    read.resolve({ success: true }); await h.settle();
    assert.equal(window.location.pathname, '/seller/orders/' + id); assert.equal(h.tree.props.value.orderDetailId, id);
  } finally { h.close(); }
});

test('late detail cannot replace identity after account switching and denied detail leaves no selected order', async () => {
  const local = storage(); local.setItem('sellerToken', 'fixture-token'); local.setItem('sellerUserProfile', JSON.stringify({ _id: id }));
  const h = hookHarness(SellerProvider, {}, '/seller', undefined, { localStorage: local });
  try {
    const opening = h.tree.props.value.openSellerOrder(id);
    h.requests.find(request => request.url.endsWith(`/api/sellers/orders/${id}`)).resolve({}, 404);
    assert.equal(await opening, false); h.flush(); assert.equal(h.tree.props.value.selectedOrder, null);
    const late = h.tree.props.value.openSellerOrder(notificationId);
    local.setItem('sellerToken', 'different-fixture-token');
    h.requests.find(request => request.url.endsWith(`/api/sellers/orders/${notificationId}`)).resolve({ data: row });
    assert.equal(await late, false); h.flush(); assert.equal(h.tree.props.value.selectedOrder, null);
  } finally { h.close(); }
});

test('cross-tab account changes clear open details and invalidate pending requests', async () => {
  const local = storage(); local.setItem('sellerToken', 'fixture-token'); local.setItem('sellerUserProfile', JSON.stringify({ _id: id }));
  const h = hookHarness(SellerProvider, {}, '/seller', undefined, { localStorage: local });
  try {
    const opening = h.tree.props.value.openSellerOrder(id);
    const pendingDetail = h.requests.find(request => request.url.endsWith(`/api/sellers/orders/${id}`));
    local.setItem('sellerToken', 'another-account-token'); local.setItem('sellerUserProfile', JSON.stringify({ _id: notificationId }));
    window.dispatchEvent(new Event('storage')); h.flush();
    assert.equal(h.tree.props.value.selectedOrder, null); assert.equal(h.tree.props.value.sellerProfile, null);
    pendingDetail.resolve({ data: row }); assert.equal(await opening, false); h.flush();
    assert.equal(h.tree.props.value.selectedOrder, null);
  } finally { h.close(); }
});

test('service-worker data-only display and existing/new-tab clicks retain a safe order reference', async () => {
  const routing = await readFile(new URL('../public/notification-routing.js', import.meta.url), 'utf8');
  const worker = await readFile(new URL('../public/firebase-messaging-sw.js', import.meta.url), 'utf8');
  const handlers = {}, shown = [], navigated = [], opened = []; let background;
  const self = { location: new URL('https://fixture.invalid/firebase-messaging-sw.js'), addEventListener: (name, fn) => { handlers[name] = fn; }, registration: { showNotification: async (title, options) => { shown.push({ title, options }); } }, clients: { matchAll: async () => [], openWindow: async route => { opened.push(route); } } };
  const sandbox = vm.createContext({ self, URL, URLSearchParams, firebase: { initializeApp() {}, messaging: () => ({ onBackgroundMessage: fn => { background = fn; } }) }, importScripts: path => { if (path.startsWith('/')) vm.runInContext(routing, sandbox); } });
  vm.runInContext(worker, sandbox);
  const data = { audience: 'seller', event: 'ORDER_CREATED', orderId: id, notificationId, title: 'New Bulkimart Order', body: 'Fixture' };
  await background({ data }); assert.equal(shown[0].options.tag, `seller-order-${id}`);
  await background({ data, notification: { title: 'SDK automatic' } }); assert.equal(shown.length, 1);
  async function click() { let done; handlers.notificationclick({ notification: { data, close() {} }, stopImmediatePropagation() {}, waitUntil: promise => { done = promise; } }); await done; }
  await click(); assert.match(opened[0], new RegExp(`/seller/orders/${id}`));
  self.clients.matchAll = async () => [{ url: 'https://fixture.invalid/seller/products', navigate: async route => { navigated.push(route); }, focus: async () => {} }];
  await click(); assert.equal(navigated[0], opened[0]);
  assert.equal(self.notificationTarget({ route: 'https://attacker.invalid' }), '/');
  assert.equal(self.notificationTarget({ audience: 'seller', orderId: '../private' }), '/seller/orders');
});


test('dedicated route restores from the authorized API without list memory and shows safe unavailable recovery', async () => {
  const local = storage(); local.setItem('sellerToken', 'fixture-token');
  const h = hookHarness(SellerProvider, {}, '/seller/orders/' + id, undefined, { localStorage: local });
  try {
    assert.equal(h.tree.props.value.orderDetailId, id);
    h.requests.find(r => r.url.endsWith('/api/sellers/me')).resolve({ seller: { _id: 'seller-fixture', status: 'approved', salesChannels: ['ecommerce'] } });
    await h.settle();
    assert.equal(h.tree.props.value.orderDetailLoading, true);
    h.requests.find(r => r.url.endsWith('/api/sellers/orders/' + id)).resolve({}, 404); await h.settle();
    assert.equal(h.tree.props.value.orderDetailLoading, false);
    assert.equal(h.tree.props.value.selectedOrder, null);
    assert.match(h.tree.props.value.orderDetailError, /unavailable|denied/i);
    const retry = h.tree.props.value.openSellerOrder(id);
    h.requests.at(-1).resolve({ data: { ...row, channel: 'ecommerce' } }); await retry; h.flush();
    assert.equal(h.tree.props.value.selectedOrder._id, id);
    assert.equal(window.location.pathname, '/seller/orders/' + id);
    h.tree.props.value.closeSellerOrder(); h.flush();
    assert.equal(window.location.pathname, '/seller/orders');
    assert.equal(h.tree.props.value.orderDetailId, null);
  } finally { h.close(); }
});

test('order list opens details through navigation and never renders a primary detail modal', async () => {
  let opened;
  const h = hookHarness(Orders, {}, '/seller/orders', context({ orders: [row], activeMode: 'quick', selectedTypes: ['quick'], selectedOrder: row, openSellerOrder: async value => { opened = value; } }));
  try {
    const button = h.find(n => n.type === 'button' && n.props.className === 'order-action-btn-sm details');
    await button.props.onClick(); assert.equal(opened, id);
    assert.equal(h.find(n => n.props?.role === 'dialog' && n.props['aria-label'] === 'Order details'), undefined);
    assert.equal(h.find(n => n.props?.['aria-label'] === 'Order details'), undefined);
  } finally { h.close(); }
});

test('dedicated page automatically exposes real riders and both method explanations after readiness', async () => {
  let calls = 0;
  const order = { ...row, version: 3, status: 'preparing', permittedActions: [{ setup: true, label: 'Choose delivery' }] };
  const h = hookHarness(Orders, { detailPage: true }, '/seller/orders/' + id, context({ selectedOrder: order,
    getFulfillmentOptions: async () => { calls++; return { ok: true, data: { manual: { available: true, eligibleRiderCount: 1, riders: [{ name: 'Server fixture rider', online: true, contact: 'masked contact', availability: 'Capacity available' }] }, shiprocket: { available: false, reason: 'Shipping approval is required', pickupLinked: false } } }; } }));
  try {
    await h.settle(); assert.equal(calls, 1);
    assert.ok(h.find(n => n.props?.['aria-label'] === 'Choose delivery method'));
    assert.match(text(h.tree), /Server fixture rider/); assert.match(text(h.tree), /On duty/);
    assert.match(text(h.tree), /Shipping approval is required/);
    assert.ok(h.find(n => n.type === 'a' && n.props.href === '/seller/profile'));
    assert.equal(h.find(n => n.type === 'button' && n.props.children === 'Create Shiprocket shipment').props.disabled, true);
  } finally { h.close(); }
});
