// Genuine built storefront -> HTTP backend -> isolated replica-set database.
// No Atlas writes, real customer identities, payment charges or API mocks.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import dotenv from 'dotenv';

const root = resolve(import.meta.dirname, '../..');
const pushSmoke = process.argv.includes('--push-smoke');
const pushEvidence = { attempted: pushSmoke, subscriptionRegistered: false, backgroundDelivered: false, nativeClickVerified: false };
const executable = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
assert.ok(executable, 'Chrome/Edge is required for this browser check.');
assert.ok(existsSync(join(root, 'forntend/dist/index.html')), 'Build the frontend first.');
const directory = await mkdtemp(join(tmpdir(), 'bulkimart-seller-notifications-fixture-'));
const envFile = join(directory, 'empty.env'); await writeFile(envFile, '');
const fixtureEnv = {
  NODE_ENV: 'test', DOTENV_CONFIG_PATH: envFile, JWT_SECRET: randomUUID() + randomUUID(),
  OTP_MODE: 'mock', SHIPROCKET_MODE: 'mock', FCM_MODE: 'mock', MAPS_MODE: 'mock',
  PAYMENT_GATEWAY: 'razorpay', RAZORPAY_MODE: 'test', RAZORPAY_KEY_ID: 'rzp_test_isolated_browser',
  RAZORPAY_KEY_SECRET: randomUUID(), RAZORPAY_WEBHOOK_SECRET: randomUUID(),
  ADMIN_EMAIL: '', ADMIN_PASSWORD: '', BIND_HOST: '127.0.0.1',
  CLOUDINARY_URL: '', CLOUDINARY_CLOUD_NAME: '', CLOUDINARY_API_KEY: '', CLOUDINARY_API_SECRET: '',
};
Object.assign(process.env, fixtureEnv);
if (pushSmoke) {
  // Explicitly opt in to one push to this disposable browser installation.
  // Only Firebase config is inherited; Atlas/JWT/payment config never is.
  const config = dotenv.parse(await readFile(join(root, 'backend/.env'), 'utf8'));
  for (const key of ['FIREBASE_SERVICE_ACCOUNT_JSON', 'FIREBASE_SERVICE_ACCOUNT', 'FIREBASE_PROJECT_ID']) if (config[key]) fixtureEnv[key] = config[key];
  fixtureEnv.FCM_MODE = 'live';
}
let replica, backend, browser, preview, socket;
let sequence = 0, phase = 'setup';
const pending = new Map(), browserErrors = [], networkFailures = [], startupErrors = [], apiCalls = [];
let uiSellerOtp, uiCustomerOtp;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const command = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
  const id = ++sequence;
  const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Browser operation timed out: ${method}`)); }, 15000);
  pending.set(id, { resolve: result => { clearTimeout(timer); resolve(result); }, reject: error => { clearTimeout(timer); reject(error); } });
  socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
});
const evaluate = async (expression, sessionId) => {
  const result = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
  assert.ok(!result.exceptionDetails, 'Browser evaluation failed.'); return result.result.value;
};
const waitFor = async expression => {
  for (let i = 0; i < 200; i++) { if (await evaluate(expression)) return; await pause(100); }
  const flags = await evaluate(`({path:location.pathname,ready:document.readyState,hasCheckout:!!document.querySelector('.pd-add-to-cart-btn'),hasAuth:!!document.querySelector('.auth-page-container'),orderActions:[...document.querySelectorAll('[aria-label="Order details"] button')].map(b=>b.textContent),hasOrderPage:!!document.querySelector('.seller-order-page'),verificationFailure:document.body.innerText.includes('Unable to verify'),button:document.querySelector('.pd-add-to-cart-btn')?.textContent,alerts:[...document.querySelectorAll('[role=alert],[role=status]')].map(node=>node.textContent)})`);
  console.error(JSON.stringify({ browserState: flags, apiCalls }));
  throw new Error('Expected browser state did not appear.');
};
try {
  console.log('Checkout browser: starting isolated replica set');
  replica = await MongoMemoryReplSet.create({ binary: { version: '7.0.14' }, replSet: { count: 1 } });
  process.env.MONGO_URI = replica.getUri('bulkimart_checkout_browser_fixture');
  await mongoose.connect(process.env.MONGO_URI);
  const [{ default: User }, { default: Seller }, { default: Product }, { default: Cart }, { default: Order }, { default: Payment }, { default: CheckoutAttempt }] = await Promise.all([
    import('../models/User.js'), import('../models/Seller.js'), import('../models/Product.js'), import('../models/Cart.js'), import('../models/Order.js'), import('../models/Payment.js'), import('../models/CheckoutAttempt.js'),
  ]);
  await Promise.all(Object.values(mongoose.models).map(model => model.init())); await CheckoutAttempt.createIndexes();
  const point = { name: 'Isolated Fixture Buyer', phone: '9876500000', line1: 'Fixture street', city: 'Mumbai', state: 'Maharashtra', pincode: '400001', lat: 19.11, lng: 72.91, isDefault: true };
  const buyer = await User.create({ name: point.name, phone: point.phone, roles: ['buyer'], isActive: true, addresses: [point] });
  const { default: Admin } = await import('../models/Admin.js');
  const adminPassword = randomUUID() + randomUUID();
  await Admin.create({ name: 'Isolated Checkout Admin', email: 'checkout-fixture@example.invalid', password: adminPassword, role: 'superAdmin', isActive: true });
  const sellerUser = await User.create({ name: 'Isolated Fixture Seller', phone: '9876500001', roles: ['buyer', 'seller'], isActive: true });
  const { default: DeliveryPartner } = await import('../models/DeliveryPartner.js');
  const riderUser = await User.create({ name: 'Isolated Fixture Rider', phone: '9876500002', roles: ['buyer', 'delivery'], isActive: true });
  await DeliveryPartner.create({ userId: riderUser._id, status: 'approved', isAvailable: true, onboardingStep: 4,
    baseLocation: { lat: 19.1, lng: 72.9, pincode: point.pincode, point: { type: 'Point', coordinates: [72.9, 19.1] } } });
  const sellerId = new mongoose.Types.ObjectId(), categoryId = new mongoose.Types.ObjectId(), productId = new mongoose.Types.ObjectId(), variantId = new mongoose.Types.ObjectId();
  await Seller.collection.insertOne({ _id: sellerId, userId: sellerUser._id, businessName: 'Isolated Fixture Store', status: 'approved', salesChannels: ['ecommerce'], storeDetails: { name: 'Isolated Fixture Store', address: 'Isolated fixture store pickup 123', email: 'pickup@example.invalid', phone: sellerUser.phone, state: point.state, pincode: point.pincode, city: point.city, lat: 19.1, lng: 72.9 } });
  await mongoose.connection.collection('categories').insertOne({ _id: categoryId, name: 'Fixture category', slug: 'fixture', type: 'ecommerce', isActive: true });
  await Product.collection.insertOne({ _id: productId, sellerId, category: categoryId, type: 'ecommerce', name: 'Isolated Browser Checkout Item', price: 100, mrp: 100, stock: 10, isActive: true, isDeleted: false, status: 'approved', fulfillmentType: 'physical', images: [], variants: [{ _id: variantId, name: 'One pack', sku: 'BROWSER-FIXTURE', price: 100, mrp: 100, stock: 10, weight: 500, unit: 'piece' }] });
  await Cart.create({ userId: buyer._id, channel: 'ecommerce', items: [{ productId, variantId, sellerId, name: 'Isolated Browser Checkout Item', price: 100, qty: 1 }] });
  const reservation = http.createServer(); await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve));
  const apiOrigin = `http://127.0.0.1:${port}`;
  // Compile a disposable build whose HTTP AND Socket.IO origins point at
  // this fixture, never at the developer's running localhost:5050 server.
  process.env.VITE_API_BASE_URL = apiOrigin; process.env.VITE_API_URL = apiOrigin;
  const { build, preview: createPreview } = await import('../../forntend/node_modules/vite/dist/node/index.js');
  const output = join(directory, 'frontend-dist');
  await build({ root: join(root, 'forntend'), logLevel: 'silent', build: { outDir: output, emptyOutDir: true } });
  preview = await createPreview({ root: join(root, 'forntend'), build: { outDir: output }, preview: { host: '127.0.0.1', port: 0, strictPort: false } });
  const origin = `http://127.0.0.1:${preview.httpServer.address().port}`;
  fixtureEnv.CORS_ORIGINS = origin;
  console.log('Checkout browser: starting normal backend with isolated configuration');
  backend = spawn(process.execPath, ['index.js'], { cwd: join(root, 'backend'), windowsHide: true, env: { ...process.env, ...fixtureEnv, MONGO_URI: process.env.MONGO_URI, PORT: String(port), PUBLIC_API_URL: apiOrigin }, stdio: ['ignore', 'pipe', 'pipe'] });
  // Classify only: raw startup logs can include secrets or test OTPs.
  for (const stream of [backend.stdout, backend.stderr]) stream.on('data', chunk => { if (/E11000|index.*(?:error|fail)|uncaught|unhandled/i.test(String(chunk))) startupErrors.push('Startup/index error detected'); });
  let ready = false;
  for (let i = 0; i < 150; i++) { try { if ((await fetch(apiOrigin + '/api/health')).ok) { ready = true; break; } } catch {} await pause(100); }
  assert.ok(ready, 'Isolated backend did not become healthy.');
  console.log('Checkout browser: backend healthy; verifying fixture login');
  const api = async (path, { token, method = 'GET', body, key } = {}) => {
    const response = await fetch(apiOrigin + '/api' + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(key ? { 'Idempotency-Key': key } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() };
  };
  // Exercise established OTP authentication only against mock-mode local fixtures.
  const otp = await api('/auth/send-otp', { method: 'POST', body: { phone: buyer.phone, isLogin: true } });
  const login = await api('/auth/verify-otp', { method: 'POST', body: { phone: buyer.phone, isLogin: true, otp: otp.body.otp } });
  assert.equal(login.status, 200); assert.ok(login.body.token);
  const sellerOtp = await api('/auth/seller/send-otp', { method: 'POST', body: { phone: sellerUser.phone, isLogin: true } });
  const sellerLogin = await api('/auth/seller/verify-otp', { method: 'POST', body: { phone: sellerUser.phone, isLogin: true, otp: sellerOtp.body.otp } });
  assert.equal(sellerLogin.status, 200); assert.ok(sellerLogin.body.token);
  console.log('Checkout browser: authenticated fixture accounts; opening browser');
  console.log('Checkout browser: preview ready');
  browser = spawn(executable, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${join(directory, 'chrome')}`, '--no-first-run', ...(!pushSmoke ? ['--disable-background-networking'] : []), '--disable-sync', 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  let debugPort;
  for (let i = 0; i < 100; i++) { try { debugPort = Number((await readFile(join(directory, 'chrome/DevToolsActivePort'), 'utf8')).split('\n')[0]); break; } catch { await pause(100); } }
  assert.ok(debugPort, 'Chrome did not start.');
  console.log('Checkout browser: Chrome ready');
  const target = await (await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: 'PUT' })).json();
  socket = new WebSocket(target.webSocketDebuggerUrl); await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  console.log('Checkout browser: debug connection ready');
  const checkouts = [];
  let newOrderSocketObserved = false;
  socket.onmessage = async event => {
    const message = JSON.parse(event.data);
    if (message.id) { const task = pending.get(message.id); pending.delete(message.id); if (message.error) task?.reject(new Error(message.error.message)); else task?.resolve(message.result); return; }
    if (message.method === 'Runtime.exceptionThrown') browserErrors.push('Uncaught browser exception');
    if (message.method === 'Network.webSocketFrameReceived' && message.params.response.payloadData.includes('"new_order"')) newOrderSocketObserved = true;
    if (pushSmoke && message.method === 'ServiceWorker.workerErrorReported') {
      pushEvidence.workerError = String(message.params.errorMessage.errorMessage).replace(/https?:\/\/[^\s"']+/g, '[resource URL]');
    }
    if (message.method !== 'Fetch.requestPaused') return;
    const { requestId, request } = message.params;
    try {
      const url = new URL(request.url);
      if (url.pathname.startsWith('/api/')) {
        if (request.method === 'OPTIONS') {
          await command('Fetch.fulfillRequest', { requestId, responseCode: 204, responseHeaders: [
            { name: 'Access-Control-Allow-Origin', value: origin },
            { name: 'Access-Control-Allow-Headers', value: 'authorization,content-type,idempotency-key' },
            { name: 'Access-Control-Allow-Methods', value: 'GET,POST,PUT,PATCH,DELETE,OPTIONS' },
          ] }); return;
        }
        const headers = Object.fromEntries(Object.entries(request.headers).filter(([key]) => ['authorization', 'content-type', 'idempotency-key'].includes(key.toLowerCase())));
        // Transport proxy only; every API response is produced by the running
        // application's real router/controllers/models, never by UI fixtures.
        const response = await fetch(apiOrigin + url.pathname + url.search, { method: request.method, headers, ...(request.postData ? { body: request.postData } : {}) });
        const body = await response.text();
        if (url.pathname === '/api/auth/seller/send-otp') uiSellerOtp = JSON.parse(body).otp;
        if (url.pathname === '/api/auth/send-otp') uiCustomerOtp = JSON.parse(body).otp;
        apiCalls.push({ method: request.method, path: url.pathname, status: response.status });
        if (request.method === 'POST' && ['/api/orders', '/api/orders/unified'].includes(url.pathname)) checkouts.push({ path: url.pathname.slice(4), headers, payload: request.postData, status: response.status, result: JSON.parse(body) });
        await command('Fetch.fulfillRequest', { requestId, responseCode: response.status, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }, { name: 'Access-Control-Allow-Origin', value: origin }, { name: 'Access-Control-Allow-Headers', value: 'authorization,content-type,idempotency-key' }], body: Buffer.from(body).toString('base64') });
      } else if (request.url.startsWith(origin) || url.origin === apiOrigin || request.url.startsWith('data:')) await command('Fetch.continueRequest', { requestId });
      else if (pushSmoke && url.protocol === 'https:' && (url.hostname.endsWith('.googleapis.com') || url.hostname === 'www.gstatic.com')) await command('Fetch.continueRequest', { requestId });
      else await command('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' });
    } catch (error) { if (!/Invalid InterceptionId|Invalid interceptionId|Invalid parameters.*interception/i.test(error.message)) networkFailures.push(error.message); }
  };
  await command('Page.enable'); await command('Runtime.enable'); await command('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
  await command('Network.enable');
  if (pushSmoke) await command('ServiceWorker.enable');
  await command('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  phase = 'seller dashboard before order';
  await command('Page.addScriptToEvaluateOnNewDocument', { source: `if(!sessionStorage.getItem('fixture-seeded')) { for(const key of ['userToken','userProfile','sellerToken','sellerUserProfile']) localStorage.removeItem(key); sessionStorage.setItem('fixture-seeded','1'); } localStorage.setItem('locationAsked','true');` });
  phase = 'customer OTP UI login';
  await command('Page.navigate', { url: origin + '/account' });
  await waitFor(`!!document.querySelector('#phone')`);
  await evaluate(`document.querySelector('#phone').focus()`);
  await command('Input.insertText', { text: buyer.phone });
  await evaluate(`document.querySelector('.auth-submit-btn').click()`);
  await waitFor(`!!document.querySelector('.auth-otp-input')`);
  assert.ok(uiCustomerOtp);
  await evaluate(`document.querySelector('.auth-otp-input').focus()`);
  await command('Input.insertText', { text: uiCustomerOtp });
  await evaluate(`document.querySelector('.auth-submit-btn').click()`);
  await waitFor(`document.querySelector('.user-profile-phone')?.textContent.includes(${JSON.stringify(buyer.phone)})`);
  phase = 'seller OTP UI login with existing customer session';
  await command('Page.navigate', { url: origin + '/seller' });
  await waitFor(`!!document.querySelector('input[placeholder="Enter 10-digit number"]')`);
  await evaluate(`document.querySelector('input[placeholder="Enter 10-digit number"]').focus()`);
  await command('Input.insertText', { text: sellerUser.phone });
  await evaluate(`document.querySelector('.seller-auth-page form').requestSubmit()`);
  await waitFor(`!!document.querySelector('input[placeholder="Enter 4-digit code"]')`);
  assert.ok(uiSellerOtp, 'Mock local OTP was returned only to the fixture');
  await evaluate(`document.querySelector('input[placeholder="Enter 4-digit code"]').focus()`);
  await command('Input.insertText', { text: uiSellerOtp });
  await evaluate(`document.querySelector('.seller-auth-page form').requestSubmit()`);
  await waitFor(`!!document.querySelector('.seller-dashboard-layout')`);
  assert.equal(await evaluate(`JSON.parse(localStorage.getItem('userProfile'))._id`), String(buyer._id));
  assert.equal(await evaluate(`JSON.parse(localStorage.getItem('sellerUserProfile'))._id`), String(sellerUser._id));
  assert.equal(await evaluate('location.pathname'), '/seller');
  assert.equal(await evaluate(`!!document.querySelector('.seller-order-alert')`), false);
  if (pushSmoke) {
    phase = 'browser push subscription';
    await command('Browser.setPermission', { permission: { name: 'notifications' }, setting: 'granted', origin });
    await evaluate(`[...document.querySelectorAll('button')].find(button => button.textContent === 'Enable order notifications').click()`);
    for (let i = 0; i < 80; i++) {
      pushEvidence.subscriptionRegistered = await evaluate(`!!localStorage.getItem('nhcone_fcm_token')`);
      if (pushEvidence.subscriptionRegistered || await evaluate(`document.querySelector('.seller-push-control [role=status]')?.textContent?.includes('unavailable')`)) break;
      await pause(250);
    }
    pushEvidence.permission = await evaluate('Notification.permission');
    pushEvidence.serviceWorkerActive = await evaluate(`navigator.serviceWorker.getRegistration().then(registration => !!registration?.active)`);
    pushEvidence.subscriptionState = await evaluate(`document.querySelector('.seller-push-control [role=status]')?.textContent || 'Subscription did not complete within 20 seconds'`);
    pushEvidence.errorCode = await evaluate(`document.querySelector('.seller-push-control [role=status]')?.dataset.pushError || null`);
    if (pushEvidence.subscriptionRegistered) {
      const backgroundTab = await (await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: 'PUT' })).json();
      await command('Target.activateTarget', { targetId: backgroundTab.id });
      await pause(300);
    }
  }
  await pause(500);
  phase = 'create order while seller on dashboard';
  const key = randomUUID();
  const payload = { channel: 'ecommerce', paymentMethod: 'cod', addressId: String(buyer.addresses[0]._id), shippingAddress: point };
  const placed = await api('/orders', { method: 'POST', token: login.body.token, body: payload, key });
  assert.equal(placed.status, 201);
  const order = placed.body.data.order;
  if (pushSmoke && pushEvidence.subscriptionRegistered) {
    phase = 'actual FCM background delivery';
    for (let i = 0; i < 80; i++) {
      pushEvidence.backgroundDelivered = await evaluate(`navigator.serviceWorker.getRegistration().then(registration => registration?.getNotifications()).then(notifications => !!notifications?.some(notification => notification.tag === 'seller-order-${order._id}'))`);
      if (pushEvidence.backgroundDelivered) break;
      await pause(250);
    }
    await command('Target.activateTarget', { targetId: target.id });
  }
  await waitFor(`!!document.querySelector('[aria-label="New order received"]')`);
  assert.equal(newOrderSocketObserved, true, 'Actual Socket.IO new_order delivery must reach the browser.');
  assert.equal(await evaluate('location.pathname'), '/seller');
  assert.ok((await evaluate('document.body.innerText')).includes(order.orderNo));
  phase = 'popup view order';
  await evaluate(`[...document.querySelectorAll('button')].find(button => button.textContent === 'View order').click()`);
  await waitFor(`!!document.querySelector('[aria-label="Order details"]')`);
  assert.equal(await evaluate('location.pathname'), '/seller/orders/' + order._id);
  assert.equal(await evaluate(`new URLSearchParams(location.search).get('order')`), null);
  assert.match(await evaluate(`document.querySelector('[aria-label="Order details"]').innerText`), /Isolated Browser Checkout Item/);
  phase = 'drawer click after current status changes';
  assert.equal((await api(`/sellers/orders/${order._id}/status`, { method: 'PATCH', token: sellerLogin.body.token, body: { status: 'confirmed' } })).status, 200);
  await evaluate(`document.querySelector('[aria-label="Close order details"]').click()`);
  await evaluate(`document.querySelector('[aria-label="Notifications"]').click()`);
  await waitFor(`!!document.querySelector('.seller-notification-open')`);
  await evaluate(`document.querySelector('.seller-notification-open').click()`);
  await waitFor(`!!document.querySelector('[aria-label="Order details"]')`);
  assert.equal(await evaluate(`!!document.querySelector('[aria-label="Notifications"][role="dialog"]')`), false);
  assert.match(await evaluate(`document.querySelector('[aria-label="Order details"]').innerText`), /Confirmed/);
  const { default: Notification } = await import('../models/Notification.js');
  for (let i=0;i<50;i++) { if (await Notification.exists({ userId: sellerUser._id, event: 'ORDER_CREATED', isRead: true })) break; await pause(50); }
  assert.equal(await Notification.countDocuments({ userId: sellerUser._id, event: 'ORDER_CREATED', isRead: true }), 1);
  const replay = await api('/orders', { method: 'POST', token: login.body.token, body: payload, key });
  assert.equal(replay.status, 201);
  await pause(200);
  assert.equal(await Notification.countDocuments({ userId: sellerUser._id, event: 'ORDER_CREATED' }), 1);
  assert.equal(await evaluate(`!!document.querySelector('.seller-order-alert')`), false);
  phase = 'deep-link refresh';
  await command('Page.reload'); await waitFor(`!!document.querySelector('[aria-label="Order details"]')`);
  assert.match(await evaluate(`document.querySelector('[aria-label="Order details"]').innerText`), /Confirmed/);
  assert.equal(await evaluate('location.pathname'), '/seller/orders/' + order._id);
  phase = 'dedicated order page in new tab';
  const orderTab = await command('Target.createTarget', { url: origin + '/seller/orders/' + order._id });
  const attachedOrder = await command('Target.attachToTarget', { targetId: orderTab.targetId, flatten: true });
  for (let i=0;i<100;i++) { if (await evaluate(`!!document.querySelector('[aria-label="Order details"]')`, attachedOrder.sessionId)) break; await pause(100); }
  assert.match(await evaluate(`document.querySelector('[aria-label="Order details"]').innerText`, attachedOrder.sessionId), /Confirmed/);
  await command('Target.closeTarget', { targetId: orderTab.targetId });
  phase = 'seller isolation';
  assert.equal((await api(`/sellers/orders/${order._id}`, { token: login.body.token })).status, 403);
  assert.equal(await Order.countDocuments(), 1); assert.equal(await Payment.countDocuments(), 1);
  phase = 'seller preparation readiness and manual rider fulfillment';
  for (const label of ['Start preparing', 'Ready for pickup']) {
    await waitFor(`!![...document.querySelectorAll('[aria-label="Order details"] button')].find(button => button.textContent === ${JSON.stringify(label)} && !button.disabled)`);
    await evaluate(`[...document.querySelectorAll('[aria-label="Order details"] button')].find(button => button.textContent === ${JSON.stringify(label)}).click()`);
  }
  await waitFor(`!![...document.querySelectorAll('button')].find(button => button.textContent.includes('Manual Bulkimart delivery') && !button.disabled)`);
  assert.match(await evaluate('document.body.innerText'), /Isolated Fixture Rider/);
  await evaluate(`[...document.querySelectorAll('button')].find(button => button.textContent.includes('Manual Bulkimart delivery')).click()`);
  phase = 'manual method selected and offer action refreshed';
  await waitFor(`!![...document.querySelectorAll('[aria-label="Order details"] button')].find(button => button.textContent === 'Offer to Bulkimart riders' && !button.disabled)`);
  await evaluate(`[...document.querySelectorAll('[aria-label="Order details"] button')].find(button => button.textContent === 'Offer to Bulkimart riders').click()`);
  await waitFor(`document.querySelector('[aria-label="Order details"]')?.innerText.includes('Awaiting rider acceptance')`);
  // A seller method choice is not an assignment. Dispatch must create a real
  // offer for this eligible rider, even with the store's legacy lat/lng profile.
  let offerRecorded = false;
  for (let i=0;i<50;i++) {
    if (await Order.exists({ _id: order._id, 'offerAttempts.status': 'OFFERED', deliveryPartnerId: null })) { offerRecorded = true; break; }
    await pause(100);
  }
  assert.ok(offerRecorded, 'Dispatch records a real rider offer before acceptance');
  const riderOtp = await api('/auth/delivery/send-otp', { method: 'POST', body: { phone: riderUser.phone, intent: 'login' } });
  const riderLogin = await api('/auth/delivery/verify-otp', { method: 'POST', body: { phone: riderUser.phone, intent: 'login', otp: riderOtp.body.otp } });
  assert.equal(riderLogin.status, 200);
  assert.equal((await api(`/delivery/orders/${order._id}/accept`, { method: 'POST', token: login.body.token })).status, 403);
  assert.equal((await api(`/delivery/orders/${order._id}/accept`, { method: 'POST', token: riderLogin.body.token })).status, 200);
  assert.equal((await api(`/delivery/orders/${order._id}/accept`, { method: 'POST', token: riderLogin.body.token })).status, 409);
  await evaluate(`[...document.querySelectorAll('[aria-label="Order details"] button')].find(button => button.textContent === 'Refresh details').click()`);
  await waitFor(`document.querySelector('[aria-label="Order details"]')?.innerText.includes('Isolated Fixture Rider')`);
  assert.match(await evaluate(`document.querySelector('[aria-label="Order details"]').innerText`), /Delivery assigned/);
  for (const width of [390, 1280]) {
    await command('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: width === 390 });
    const geometry = await evaluate(`(() => { const el = document.querySelector('.seller-order-page'); const r = el.getBoundingClientRect(); return { left:r.left,right:r.right,width:innerWidth, overflow:el.scrollWidth-el.clientWidth }; })()`);
    assert.ok(geometry.left >= 0 && geometry.right <= geometry.width + 1 && geometry.overflow <= 1, 'Order details fit the viewport');
  }
  await command('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  const { default: Delivery } = await import('../models/Delivery.js');
  assert.equal(await Delivery.countDocuments({ orderId: order._id }), 1);
  phase = 'existing seller pickup registration through profile and durable sweeper';
  await command('Page.navigate', { url: origin + '/seller/profile' });
  await waitFor(`!!document.querySelector('[aria-label="Shiprocket pickup registration"]')`);
  await waitFor(`document.querySelector('[aria-label="Shiprocket pickup registration"]')?.innerText.includes('Needs attention')`);
  await evaluate(`[...document.querySelectorAll('button')].find(button => button.textContent === 'Retry pickup synchronization').click()`);
  let pickupRegistered = false;
  for (let i = 0; i < 40; i++) {
    await pause(1000);
    await evaluate(`[...document.querySelectorAll('button')].find(button => button.textContent === 'Refresh pickup status').click()`);
    if (await evaluate(`document.querySelector('[aria-label="Shiprocket pickup registration"] [role=status]')?.textContent === 'Registered'`)) { pickupRegistered = true; break; }
  }
  assert.ok(pickupRegistered, 'Durable worker registered and verified the mock provider pickup');
  const pickupResult = await api('/sellers/pickup-sync', { token: sellerLogin.body.token });
  assert.equal(pickupResult.body.data.status, 'registered');
  assert.equal(pickupResult.body.data.verificationMode, 'mock');
  assert.equal(pickupResult.body.data.shippingApproved, false);
  await evaluate(`[...document.querySelectorAll('button')].find(button => button.textContent === 'Correct pickup address/contact').click()`);
  const pickupGeometry = await evaluate(`(() => { const el = document.querySelector('.seller-pickup-sync'); const r = el.getBoundingClientRect(); return { left:r.left,right:r.right,width:innerWidth,overflow:el.scrollWidth-el.clientWidth }; })()`);
  assert.ok(pickupGeometry.left >= 0 && pickupGeometry.right <= pickupGeometry.width + 1 && pickupGeometry.overflow <= 1);
  phase = 'separate customer tab while seller remains signed in';
  const customerTab = await command('Target.createTarget', { url: origin + '/account' });
  const { sessionId: customerSessionId } = await command('Target.attachToTarget', { targetId: customerTab.targetId, flatten: true });
  let customerTabReady = false;
  for (let i = 0; i < 150; i++) {
    if (await evaluate(`document.querySelector('.user-profile-phone')?.textContent.includes(${JSON.stringify(buyer.phone)})`, customerSessionId)) { customerTabReady = true; break; }
    await pause(100);
  }
  assert.ok(customerTabReady, 'Customer account remains correct in a separate tab');
  phase = 'customer and seller session isolation across navigation, refresh and logout';
  await command('Page.navigate', { url: origin + '/account' });
  await waitFor(`document.querySelector('.user-profile-phone')?.textContent.includes(${JSON.stringify(buyer.phone)})`);
  phase = 'customer page does not render seller identity';
  assert.equal(await evaluate(`document.body.innerText.includes(${JSON.stringify(sellerUser.phone)})`), false);
  await command('Page.reload');
  await waitFor(`document.querySelector('.user-profile-phone')?.textContent.includes(${JSON.stringify(buyer.phone)})`);
  phase = 'customer refresh preserves principal';
  assert.equal(await evaluate(`JSON.parse(localStorage.getItem('userProfile'))._id`), String(buyer._id));
  for (const path of ['/users/profile', '/users/addresses', '/wallet', '/orders']) {
    phase = `seller token rejected at ${path}`;
    assert.equal((await api(path, { token: sellerLogin.body.token })).status, 403);
    phase = `customer token accepted at ${path}`;
    assert.equal((await api(path, { token: login.body.token })).status, 200);
  }
  phase = 'seller logout preserves customer session';
  await command('Page.navigate', { url: origin + '/seller/logout' });
  await waitFor(`!localStorage.getItem('sellerToken') && !!document.querySelector('.seller-auth-page')`);
  assert.equal(await evaluate(`!!localStorage.getItem('userToken')`), true);
  assert.ok(await evaluate(`document.querySelector('.user-profile-phone')?.textContent.includes(${JSON.stringify(buyer.phone)})`, customerSessionId));
  await command('Target.closeTarget', { targetId: customerTab.targetId });
  await command('Page.navigate', { url: origin + '/account' });
  await waitFor(`document.body.innerText.includes(${JSON.stringify(buyer.phone)})`);
  const result = { passed: true, database: 'isolated-local-replica-set', browser: 'headless Chrome', viewport: '390x844',
    checks: ['seller OTP UI login preserves customer credentials', 'new order while seller on dashboard', 'actual Socket.IO new_order frame received', 'automatic in-app popup', 'view opens correct dedicated order page', 'drawer closes and opens latest detail', 'notification persisted/read', 'same-key replay has one notification', 'deep-link refresh', 'buyer denied seller details', 'separate customer tab retains customer identity', 'customer navigation and refresh retain identity', 'customer API role isolation', 'seller logout preserves customer session and other tab'],
    fulfillmentChecks: ['preparation', 'ready before delivery selection', 'eligible rider display', 'manual offer', 'authorized rider acceptance', 'duplicate acceptance denied', 'assigned rider details refreshed', 'details geometry at 390 and 1280px'],
    pickupChecks: ['profile pending/attention state', 'owner retry', 'durable sweeper registration', 'mock provider confirmed reference', 'shipping approval unchanged', 'responsive pickup correction form'],
    push: pushSmoke ? pushEvidence : 'FCM mock mode; actual push delivery not tested', atlasWrites: 0 };
  await mkdir(join(root, 'test-artifacts/seller-notifications'), { recursive: true });
  await writeFile(join(root, `test-artifacts/seller-notifications/browser${pushSmoke ? '-push-smoke' : ''}.json`), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} catch (error) {
  console.error(JSON.stringify({ passed: false, phase, name: error.name, message: error.name === 'AssertionError' ? 'Checkout browser assertion failed' : error.message, startupErrors, browserErrors, networkFailures })); process.exitCode = 1;
} finally {
  socket?.close(); browser?.kill(); backend?.kill();
  if (preview) { preview.httpServer.closeAllConnections?.(); await new Promise(resolve => preview.httpServer.close(resolve)); }
  await mongoose.disconnect(); await replica?.stop();
  assert.equal(dirname(resolve(directory)), resolve(tmpdir())); assert.ok(basename(directory).startsWith('bulkimart-seller-notifications-fixture-'));
  await pause(300); await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}
