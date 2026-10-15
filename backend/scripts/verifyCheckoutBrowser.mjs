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

const root = resolve(import.meta.dirname, '../..');
const executable = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
assert.ok(executable, 'Chrome/Edge is required for this browser check.');
assert.ok(existsSync(join(root, 'forntend/dist/index.html')), 'Build the frontend first.');
const directory = await mkdtemp(join(tmpdir(), 'bulkimart-checkout-fixture-'));
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
let replica, backend, browser, preview, socket;
let sequence = 0, phase = 'setup';
const pending = new Map(), browserErrors = [], networkFailures = [], startupErrors = [], apiCalls = [];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const command = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++sequence;
  const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Browser operation timed out: ${method}`)); }, 15000);
  pending.set(id, { resolve: result => { clearTimeout(timer); resolve(result); }, reject: error => { clearTimeout(timer); reject(error); } });
  socket.send(JSON.stringify({ id, method, params }));
});
const evaluate = async expression => {
  const result = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  assert.ok(!result.exceptionDetails, 'Browser evaluation failed.'); return result.result.value;
};
const waitFor = async expression => {
  for (let i = 0; i < 200; i++) { if (await evaluate(expression)) return; await pause(100); }
  const flags = await evaluate(`({path:location.pathname,ready:document.readyState,hasCheckout:!!document.querySelector('.pd-add-to-cart-btn'),hasAuth:!!document.querySelector('.auth-page-container'),verificationFailure:document.body.innerText.includes('Unable to verify'),button:document.querySelector('.pd-add-to-cart-btn')?.textContent,alerts:[...document.querySelectorAll('[role=alert],[role=status]')].map(node=>node.textContent)})`);
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
  const sellerId = new mongoose.Types.ObjectId(), categoryId = new mongoose.Types.ObjectId(), productId = new mongoose.Types.ObjectId(), variantId = new mongoose.Types.ObjectId();
  await Seller.collection.insertOne({ _id: sellerId, userId: sellerUser._id, businessName: 'Isolated Fixture Store', status: 'approved', salesChannels: ['ecommerce'], storeDetails: { name: 'Isolated Fixture Store', pincode: point.pincode, city: point.city, lat: 19.1, lng: 72.9 } });
  await mongoose.connection.collection('categories').insertOne({ _id: categoryId, name: 'Fixture category', slug: 'fixture', type: 'ecommerce', isActive: true });
  await Product.collection.insertOne({ _id: productId, sellerId, category: categoryId, type: 'ecommerce', name: 'Isolated Browser Checkout Item', price: 100, mrp: 100, stock: 10, isActive: true, isDeleted: false, status: 'approved', fulfillmentType: 'physical', images: [], variants: [{ _id: variantId, name: 'One pack', sku: 'BROWSER-FIXTURE', price: 100, mrp: 100, stock: 10, weight: 500, unit: 'piece' }] });
  await Cart.create({ userId: buyer._id, channel: 'ecommerce', items: [{ productId, variantId, sellerId, name: 'Isolated Browser Checkout Item', price: 100, qty: 1 }] });
  const reservation = http.createServer(); await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve));
  const apiOrigin = `http://127.0.0.1:${port}`;
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
  const { preview: createPreview } = await import('../../forntend/node_modules/vite/dist/node/index.js');
  preview = await createPreview({ root: join(root, 'forntend'), preview: { host: '127.0.0.1', port: 0, strictPort: false } });
  console.log('Checkout browser: preview ready');
  const origin = `http://127.0.0.1:${preview.httpServer.address().port}`;
  browser = spawn(executable, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${join(directory, 'chrome')}`, '--no-first-run', '--disable-background-networking', '--disable-sync', 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  let debugPort;
  for (let i = 0; i < 100; i++) { try { debugPort = Number((await readFile(join(directory, 'chrome/DevToolsActivePort'), 'utf8')).split('\n')[0]); break; } catch { await pause(100); } }
  assert.ok(debugPort, 'Chrome did not start.');
  console.log('Checkout browser: Chrome ready');
  const target = await (await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: 'PUT' })).json();
  socket = new WebSocket(target.webSocketDebuggerUrl); await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  console.log('Checkout browser: debug connection ready');
  const checkouts = [];
  socket.onmessage = async event => {
    const message = JSON.parse(event.data);
    if (message.id) { const task = pending.get(message.id); pending.delete(message.id); if (message.error) task?.reject(new Error(message.error.message)); else task?.resolve(message.result); return; }
    if (message.method === 'Runtime.exceptionThrown') browserErrors.push('Uncaught browser exception');
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
        apiCalls.push({ method: request.method, path: url.pathname, status: response.status });
        if (request.method === 'POST' && ['/api/orders', '/api/orders/unified'].includes(url.pathname)) checkouts.push({ path: url.pathname.slice(4), headers, payload: request.postData, status: response.status, result: JSON.parse(body) });
        await command('Fetch.fulfillRequest', { requestId, responseCode: response.status, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }, { name: 'Access-Control-Allow-Origin', value: origin }, { name: 'Access-Control-Allow-Headers', value: 'authorization,content-type,idempotency-key' }], body: Buffer.from(body).toString('base64') });
      } else if (request.url.startsWith(origin) || request.url.startsWith('data:')) await command('Fetch.continueRequest', { requestId });
      else await command('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' });
    } catch (error) { if (!/Invalid InterceptionId|Invalid interceptionId|Invalid parameters.*interception/i.test(error.message)) networkFailures.push(error.message); }
  };
  await command('Page.enable'); await command('Runtime.enable'); await command('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
  await command('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  const rememberedShopAll = process.argv.includes('--remembered-shop-all');
  await command('Page.addScriptToEvaluateOnNewDocument', { source: `localStorage.setItem('userToken',${JSON.stringify(login.body.token)}); localStorage.setItem('userProfile',${JSON.stringify(JSON.stringify(login.body.user))}); localStorage.setItem('locationAsked','true'); ${rememberedShopAll ? "localStorage.setItem('nh_storefront','shop-all');" : ''}` });
  await command('Page.navigate', { url: origin + '/checkout' });
  console.log('Checkout browser: waiting for checkout UI');
  await waitFor(`!!document.querySelector('.pd-add-to-cart-btn:not(:disabled)')`);
  assert.match(await evaluate('document.body.innerText'), /Delivery arranged after store acceptance/);
  console.log('Checkout browser: submitting COD');
  await evaluate(`document.querySelector('.pd-add-to-cart-btn:not(:disabled)').click()`);
  await waitFor(`document.body.innerText.includes('Track Active Orders Page')`);
  assert.equal(checkouts.length, 1); assert.equal(checkouts[0].status, 201);
  console.log('Checkout browser: order committed; checking replay and history');
  const savedOrder = checkouts[0].result.data.order || checkouts[0].result.data.orders[0];
  phase = 'persistence and replay';
  phase = 'persisted payment method';
  assert.equal(savedOrder.paymentMethod, 'cod');
  phase = 'persisted order/payment counts';
  assert.equal(await Order.countDocuments({ userId: buyer._id }), 1); assert.equal(await Payment.countDocuments({ userId: buyer._id }), 1);
  const storedPayment = await Payment.findOne({ userId: buyer._id });
  phase = 'payment back-reference';
  assert.equal(String(storedPayment.orderId), savedOrder._id);
  phase = 'order payment reference';
  assert.equal(await Order.countDocuments({ paymentId: storedPayment._id }), 1);
  phase = 'inventory deducted once';
  assert.equal((await Product.findById(productId)).variants[0].stock, 9);
  phase = 'committed cart cleared';
  assert.equal((await Cart.findOne({ userId: buyer._id })).items.length, 0);
  phase = 'same-key replay';
  const replay = await api(checkouts[0].path, { method: 'POST', token: login.body.token, body: JSON.parse(checkouts[0].payload), key: checkouts[0].headers['Idempotency-Key'] || checkouts[0].headers['idempotency-key'] });
  assert.equal(replay.status, 201); assert.equal((replay.body.data.order || replay.body.data.orders[0])._id, savedOrder._id);
  await evaluate(`[...document.querySelectorAll('button')].find(button => button.textContent.includes('Track Active Orders Page')).click()`);
  await waitFor(`document.body.innerText.includes(${JSON.stringify(savedOrder.orderNo)})`);
  await command('Page.reload'); await waitFor(`document.body.innerText.includes(${JSON.stringify(savedOrder.orderNo)})`);
  phase = 'seller visibility';
  const sellerOrders = await api('/sellers/orders?type=ecommerce', { token: sellerLogin.body.token });
  assert.equal(sellerOrders.status, 200); assert.ok(JSON.stringify(sellerOrders.body).includes(savedOrder._id));
  const adminLogin = await api('/auth/admin/login', { method: 'POST', body: { email: 'checkout-fixture@example.invalid', password: adminPassword } });
  phase = 'admin login';
  assert.equal(adminLogin.status, 200); assert.ok(adminLogin.body.token);
  const adminOrders = await api('/admin/vendor-orders', { token: adminLogin.body.token });
  phase = 'admin visibility';
  assert.equal(adminOrders.status, 200); assert.ok(JSON.stringify(adminOrders.body).includes(savedOrder._id));
  phase = 'seller processing';
  for (const status of ['confirmed', 'preparing']) assert.equal((await api(`/sellers/orders/${savedOrder._id}/status`, { method: 'PATCH', token: sellerLogin.body.token, body: { status } })).status, 200);
  assert.equal((await api(`/sellers/orders/${savedOrder._id}/fulfillment/manual`, { method: 'POST', token: sellerLogin.body.token })).status, 200);
  assert.equal((await api(`/sellers/orders/${savedOrder._id}/status`, { method: 'PATCH', token: sellerLogin.body.token, body: { status: 'dispatched' } })).status, 200);
  assert.equal((await Order.findById(savedOrder._id)).status, 'dispatched');
  phase = 'final invariants';
  assert.equal(await Order.countDocuments({ userId: buyer._id }), 1); assert.equal(await Payment.countDocuments({ userId: buyer._id }), 1);
  assert.equal((await Product.findById(productId)).variants[0].stock, 9);
  assert.deepEqual(startupErrors, []); assert.deepEqual(browserErrors, []); assert.deepEqual(networkFailures, []);
  const result = { passed: true, database: 'isolated-local-replica-set', viewport: '390x844', rememberedShopAll, checkoutEndpoint: checkouts[0].path, backend: 'normal node index.js startup', browser: 'headless Chrome', apiResponsesMocked: false,
    checks: ['OTP login', 'COD checkout 201', 'confirmation screen', 'history navigation and refresh', 'same-key replay', 'one linked order and payment', 'one stock deduction', 'cart cleared', 'seller and admin order visibility', 'seller acceptance/preparation', 'internal delivery assignment and dispatch', 'no startup/index errors'], atlasDocumentsChanged: 0, realPaymentCharges: 0 };
  await mkdir(join(root, 'test-artifacts/checkout'), { recursive: true });
  await writeFile(join(root, `test-artifacts/checkout/browser-${rememberedShopAll ? 'single' : 'neutral'}.json`), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} catch (error) {
  console.error(JSON.stringify({ passed: false, phase, name: error.name, message: error.name === 'AssertionError' ? 'Checkout browser assertion failed' : error.message, startupErrors, browserErrors, networkFailures })); process.exitCode = 1;
} finally {
  socket?.close(); browser?.kill(); backend?.kill();
  if (preview) { preview.httpServer.closeAllConnections?.(); await new Promise(resolve => preview.httpServer.close(resolve)); }
  await mongoose.disconnect(); await replica?.stop();
  assert.equal(dirname(resolve(directory)), resolve(tmpdir())); assert.ok(basename(directory).startsWith('bulkimart-checkout-fixture-'));
  await pause(300); await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}
