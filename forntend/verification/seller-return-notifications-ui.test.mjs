import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createServer } from 'vite';
import { hookHarness } from '../tests/service-hookHarness.mjs';

let vite, Popup, Dashboard, Drawer, Returns, socket;
before(async () => {
  vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' });
  Popup = (await vite.ssrLoadModule('/src/components/NotificationPopup.jsx')).default;
  Dashboard = (await vite.ssrLoadModule('/src/modules/Seller/pages/DashboardPage.jsx')).default;
  Drawer = (await vite.ssrLoadModule('/src/modules/Seller/components/NotificationDrawer.jsx')).default;
  Returns = (await vite.ssrLoadModule('/src/modules/Seller/components/SellerReturnsTab.jsx')).default;
  socket = (await vite.ssrLoadModule('/src/utils/socket.js')).socket; socket.connect = () => socket;
});
after(async () => { await vite.close(); });
const id = '507f1f77bcf86cd799439011', notificationId = '507f1f77bcf86cd799439012', orderId = '507f1f77bcf86cd799439013';
const notice = { _id: notificationId, event: 'RETURN_REQUESTED', type: 'system', title: 'New return request', message: 'RET-FIXTURE — Amla × 1',
  metadata: { returnId: id, orderId }, route: `/seller/item-returns?return=${id}`, createdAt: '2026-10-27T10:00:00Z' };
const text = node => node == null || typeof node === 'boolean' ? '' : typeof node !== 'object' ? String(node) : [node.props?.children].flat(Infinity).map(text).join(' ');
const emit = (event, payload) => socket.listeners(event).forEach(listener => listener(payload));
const context = overrides => ({ sellerProfile: { _id: 'fixture-seller', status: 'approved' }, selectedTypes: ['quick'], activeMode: 'quick', activeTab: 'dashboard', ...overrides });
const resolveReads = h => h.requests.filter(req => !req.options.method).forEach(req => req.resolve(req.url.includes('unread-count') ? { data: { count: 1 } } : { data: [notice] }));

test('socket and foreground push show one return popup, and opening it retains the return destination', async () => {
  let foreground, stopped = false; const opened = [];
  const h = hookHarness(Popup, { excludeSellerOrders: true, onNavigate: (...args) => opened.push(args),
    subscribePush: async callback => { foreground = callback; return () => { stopped = true; }; } }, '/seller/orders');
  try {
    await h.settle(); emit('notification_new', notice); h.flush();
    foreground({ notification: { title: notice.title, body: notice.message }, data: { event: notice.event, audience: 'seller', notificationId, returnId: id, orderId, route: notice.route } }); h.flush();
    assert.equal((text(h.tree).match(/New return request/g) || []).length, 1);
    await h.find(node => node.props?.className === 'nh-popup-card').props.onClick(); h.flush();
    assert.equal(opened[0][0], notice.route); assert.equal(opened[0][1].metadata.returnId, id);
    assert.equal(h.tree, null); h.requests.find(req => req.options.method === 'PATCH').resolve({ success: true });
    emit('notification_new', notice); h.flush(); assert.equal(h.tree, null, 'Duplicate delivery cannot reopen the dismissed alert');
  } finally { h.close(); }
  assert.equal(stopped, true);
});

test('foreground FCM works without a socket and ignores other audiences', async () => {
  let foreground;
  const h = hookHarness(Popup, { excludeSellerOrders: true, subscribePush: async callback => { foreground = callback; return () => {}; } }, '/seller/orders');
  try {
    await h.settle();
    foreground({ data: { audience: 'user', event: 'RETURN_REQUESTED', notificationId } }); h.flush(); assert.equal(h.tree, null);
    foreground({ data: { audience: 'seller', event: 'RETURN_REQUESTED', notificationId, returnId: id, route: notice.route, title: notice.title, body: notice.message } }); h.flush();
    assert.match(text(h.tree), /New return request/); assert.match(text(h.tree), /RET-FIXTURE/);
    emit('notification_new', notice); h.flush(); assert.equal((text(h.tree).match(/New return request/g) || []).length, 1);
  } finally { h.close(); }
});

test('the dashboard opens Return Requests for a return even when it also carries an order ID', async () => {
  const tabs = [], orders = [];
  const h = hookHarness(Dashboard, {}, '/seller/dashboard', context({ setActiveTab: tab => tabs.push(tab), openSellerOrder: value => orders.push(value) }));
  try {
    resolveReads(h); await h.settle();
    const popup = h.find(node => node.type === Popup); assert.ok(popup);
    popup.props.onNavigate(notice.route, notice);
    assert.deepEqual(tabs, ['item-returns']); assert.deepEqual(orders, []);
    popup.props.onNavigate(`/seller/orders/${orderId}`, { metadata: { orderId } }); assert.deepEqual(orders, [orderId]);
  } finally { h.close(); }
});

test('the notification drawer marks a return read and opens Return Requests instead of order details', async () => {
  const tabs = [], orders = []; let closed = 0;
  const h = hookHarness(Drawer, { isOpen: true, onClose: () => { closed++; } }, '/seller/orders', context({ setActiveTab: tab => tabs.push(tab), openSellerOrder: value => orders.push(value) }));
  try {
    resolveReads(h); await h.settle();
    const pending = h.find(node => node.props?.className === 'seller-notification-open').props.onClick();
    const read = h.requests.find(req => req.options.method === 'PATCH'); assert.ok(read); assert.match(read.url, new RegExp(`${notificationId}/read$`));
    read.resolve({ success: true }); await pending; await h.settle();
    assert.equal(closed, 1); assert.deepEqual(tabs, ['item-returns']); assert.deepEqual(orders, []);
    resolveReads(h); await h.settle();
  } finally { h.close(); }
});

test('an open returns page refreshes on alerts and reconnect, retaining the newest response', async () => {
  const h = hookHarness(Returns, {}, '/seller/item-returns', context());
  try {
    h.requests[0].resolve({ data: [] }); await h.settle();
    emit('notification_new', notice); const older = h.requests.at(-1); assert.equal(h.requests.length, 2);
    emit('connect'); const latest = h.requests.at(-1);
    latest.resolve({ data: [{ _id: id, status: 'RETURN_REQUESTED', productName: 'Amla', returnNumber: 'RET-NEWEST', quantity: 1, pickup: { status: 'NOT_ASSIGNED' } }] }); await h.settle();
    older.resolve({ data: [] }); await h.settle(); assert.match(text(h.tree), /RET-NEWEST/);
    const before = h.requests.length; emit('notification_new', { event: 'ORDER_CREATED' }); assert.equal(h.requests.length, before);
    window.dispatchEvent(new CustomEvent('seller_return_notification')); h.requests.at(-1).resolve({ data: [] }); await h.settle();
    assert.doesNotMatch(text(h.tree), /RET-NEWEST/);
  } finally { h.close(); }
});

test('background return push displays once and its click opens Return Requests, while order pushes retain their route', async () => {
  const routing = await readFile(new URL('../public/notification-routing.js', import.meta.url), 'utf8');
  const worker = await readFile(new URL('../public/firebase-messaging-sw.js', import.meta.url), 'utf8');
  const handlers = {}, shown = [], opened = []; let background;
  const self = { location: new URL('https://fixture.invalid/firebase-messaging-sw.js'), addEventListener: (name, fn) => { handlers[name] = fn; },
    registration: { showNotification: async (title, options) => { shown.push({ title, options }); } }, clients: { matchAll: async () => [], openWindow: async route => { opened.push(route); } } };
  const sandbox = vm.createContext({ self, URL, URLSearchParams, firebase: { initializeApp() {}, messaging: () => ({ onBackgroundMessage: fn => { background = fn; } }) },
    importScripts: path => { if (path.startsWith('/')) vm.runInContext(routing, sandbox); } });
  vm.runInContext(worker, sandbox);
  const data = { audience: 'seller', event: 'RETURN_REQUESTED', returnId: id, orderId, notificationId, route: notice.route, title: notice.title, body: notice.message };
  await background({ data }); await background({ data, notification: { title: 'Automatic SDK notification' } }); assert.equal(shown.length, 1);
  let click;
  handlers.notificationclick({ notification: { data, close() {} }, stopImmediatePropagation() {}, waitUntil: promise => { click = promise; } }); await click;
  assert.equal(opened[0], `/seller/item-returns?return=${id}&notification=${notificationId}`);
  assert.equal(self.notificationTarget({ audience: 'seller', event: 'ORDER_CREATED', orderId }), `/seller/orders/${orderId}`);
  assert.equal(self.notificationTarget({ audience: 'seller', event: 'RETURN_REQUESTED', returnId: '../private', route: 'https://attacker.invalid' }), '/seller/item-returns');
  assert.equal(self.notificationTarget({ audience: 'user', event: 'RETURN_REQUESTED', route: `/orders/${orderId}` }), `/orders/${orderId}`);
});
