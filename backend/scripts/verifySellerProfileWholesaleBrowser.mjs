// Genuine built storefront -> HTTP backend -> isolated replica-set database.
// No Atlas writes, real customer identities, payment charges or API mocks.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import http from 'node:http';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

const root = resolve(import.meta.dirname, '../..');
const pushSmoke = false;
const pushEvidence = { attempted: pushSmoke, subscriptionRegistered: false, backgroundDelivered: false, nativeClickVerified: false };
const executable = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
assert.ok(executable, 'Chrome/Edge is required for this browser check.');
assert.ok(existsSync(join(root, 'forntend/dist/index.html')), 'Build the frontend first.');
const directory = await mkdtemp(join(tmpdir(), 'bulkimart-seller-wholesale-fixture-'));
const envFile = join(directory, 'empty.env'); await writeFile(envFile, '');
const fixturePng = await (await import('sharp')).default({create:{width:16,height:16,channels:3,background:'#08b9e8'}}).png().toBuffer();
const fixtureImage = 'data:image/png;base64,'+fixturePng.toString('base64');
const cloudinaryFixture = join(directory, 'cloudinary-fixture.mjs');
await writeFile(cloudinaryFixture, `import { createRequire } from 'node:module';import { Writable } from 'node:stream';const require=createRequire(${JSON.stringify(join(root,'backend/package.json'))});const {v2}=require('cloudinary');v2.uploader.upload_stream=(_options,callback)=>new Writable({write(_chunk,_encoding,next){next();},final(done){callback(null,{secure_url:${JSON.stringify(fixtureImage)}});done();}});`);
const fixtureEnv = {
  NODE_ENV: 'test', DOTENV_CONFIG_PATH: envFile, JWT_SECRET: randomUUID() + randomUUID(),
  OTP_MODE: 'mock', SHIPROCKET_MODE: 'mock', FCM_MODE: 'mock', MAPS_MODE: 'mock',
  PAYMENT_GATEWAY: 'razorpay', RAZORPAY_MODE: 'test', RAZORPAY_KEY_ID: 'rzp_test_isolated_browser',
  RAZORPAY_KEY_SECRET: randomUUID(), RAZORPAY_WEBHOOK_SECRET: randomUUID(),
  ADMIN_EMAIL: '', ADMIN_PASSWORD: '', BIND_HOST: '127.0.0.1',
  NODE_OPTIONS: '--import=' + JSON.stringify(pathToFileURL(cloudinaryFixture).href), CLOUDINARY_URL: '', CLOUDINARY_CLOUD_NAME: 'isolated-fixture', CLOUDINARY_API_KEY: 'fixture', CLOUDINARY_API_SECRET: 'fixture',
};
Object.assign(process.env, fixtureEnv);
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
  const flags = await evaluate(`({path:location.pathname,ready:document.readyState,hasWholesale:!!document.querySelector('.seller-wholesale-list'),modeButtons:[...document.querySelectorAll('.seller-listing-modes button')].map(b=>({text:b.textContent,disabled:b.disabled,selected:b.getAttribute('aria-pressed')})),body:document.body.innerText.slice(-1300),hasCheckout:!!document.querySelector('.pd-add-to-cart-btn'),hasAuth:!!document.querySelector('.auth-page-container'),orderActions:[...document.querySelectorAll('[aria-label="Order details"] button')].map(b=>b.textContent),hasOrderPage:!!document.querySelector('.seller-order-page'),verificationFailure:document.body.innerText.includes('Unable to verify'),button:document.querySelector('.pd-add-to-cart-btn')?.textContent,alerts:[...document.querySelectorAll('[role=alert],[role=status]')].map(node=>node.textContent)})`);
  console.error(JSON.stringify({ browserState: flags, apiCalls }));
  throw new Error('Expected browser state did not appear.');
};
try {
  console.log('Seller Wholesale browser: starting isolated replica set');
  replica = await MongoMemoryReplSet.create({ binary: { version: '7.0.14' }, replSet: { count: 1 } });
  process.env.MONGO_URI = replica.getUri('bulkimart_seller_wholesale_browser_fixture');
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
  await Seller.collection.insertOne({ _id: sellerId, userId: sellerUser._id, businessName: 'Isolated Fixture Store', status: 'approved', __v: 0, salesChannels: ['ecommerce','grocery'], wholesaleChannel: {status:'pending'}, storeDetails: { name: 'Isolated Fixture Store', address: 'Isolated fixture store pickup 123', email: 'pickup@example.invalid', phone: sellerUser.phone, state: point.state, pincode: point.pincode, city: point.city, lat: 19.1, lng: 72.9 } });
  await mongoose.connection.collection('categories').insertOne({ _id: categoryId, name: 'Fixture category', slug: 'fixture', type: 'ecommerce', isActive: true });
  await Product.collection.insertOne({ _id: productId, sellerId, category: categoryId, type: 'ecommerce', name: 'Isolated Browser Checkout Item', price: 100, mrp: 100, stock: 100, isActive: true, isDeleted: false, status: 'approved', fulfillmentType: 'physical', images: [], variants: [{ _id: variantId, name: 'One pack', sku: 'BROWSER-FIXTURE', price: 100, mrp: 100, stock: 100, weight: 500, unit: 'piece' }] });
  await Cart.create({ userId: buyer._id, channel: 'ecommerce', items: [{ productId, variantId, sellerId, name: 'Isolated Browser Checkout Item', price: 100, qty: 1 }] });
  const groceryCategory=new mongoose.Types.ObjectId(), groceryId=new mongoose.Types.ObjectId(), digitalId=new mongoose.Types.ObjectId();
  await mongoose.connection.collection('categories').insertOne({_id:groceryCategory,name:'Quick fixture category',slug:'quick-fixture',type:'grocery',isActive:true});
  await Product.collection.insertOne({_id:groceryId,__v:0,sellerId,category:groceryCategory,type:'grocery',name:'Quick physical fixture',status:'approved',isActive:true,isDeleted:false,fulfillmentType:'physical',price:75,mrp:90,stock:100,images:[],variants:[{_id:new mongoose.Types.ObjectId(),name:'Quick pack',sku:'QUICK-FIXTURE',price:75,mrp:90,stock:100,unit:'piece'}]});
  await Product.collection.insertOne({_id:digitalId,sellerId,category:categoryId,type:'ecommerce',name:'Digital fixture ebook',status:'approved',isActive:true,isDeleted:false,fulfillmentType:'digital',price:50,mrp:50,stock:0,images:[],variants:[{_id:new mongoose.Types.ObjectId(),name:'E-book',price:50,mrp:50,stock:0,unit:'piece'}]});
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
  console.log('Seller Wholesale browser: starting normal backend with isolated configuration');
  backend = spawn(process.execPath, ['index.js'], { cwd: join(root, 'backend'), windowsHide: true, env: { ...process.env, ...fixtureEnv, MONGO_URI: process.env.MONGO_URI, PORT: String(port), PUBLIC_API_URL: apiOrigin }, stdio: ['ignore', 'pipe', 'pipe'] });
  // Classify only: raw startup logs can include secrets or test OTPs.
  for (const stream of [backend.stdout, backend.stderr]) stream.on('data', chunk => { if (/E11000|index.*(?:error|fail)|uncaught|unhandled/i.test(String(chunk))) startupErrors.push('Startup/index error detected'); });
  let ready = false;
  for (let i = 0; i < 150; i++) { try { if ((await fetch(apiOrigin + '/api/health')).ok) { ready = true; break; } } catch {} await pause(100); }
  assert.ok(ready, 'Isolated backend did not become healthy.');
  console.log('Seller Wholesale browser: backend healthy; verifying fixture login');
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
  console.log('Seller Wholesale browser: authenticated fixture accounts; opening browser');
  console.log('Seller Wholesale browser: preview ready');
  browser = spawn(executable, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${join(directory, 'chrome')}`, '--no-first-run', ...(!pushSmoke ? ['--disable-background-networking'] : []), '--disable-sync', 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  let debugPort;
  for (let i = 0; i < 100; i++) { try { debugPort = Number((await readFile(join(directory, 'chrome/DevToolsActivePort'), 'utf8')).split('\n')[0]); break; } catch { await pause(100); } }
  assert.ok(debugPort, 'Chrome did not start.');
  console.log('Seller Wholesale browser: Chrome ready');
  const target = await (await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: 'PUT' })).json();
  socket = new WebSocket(target.webSocketDebuggerUrl); await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  console.log('Seller Wholesale browser: debug connection ready');
  const checkouts = [];
  let newOrderSocketObserved = false;
  socket.onmessage = async event => {
    const message = JSON.parse(event.data);
    if (message.id) { const task = pending.get(message.id); pending.delete(message.id); if (message.error) task?.reject(new Error(message.error.message)); else task?.resolve(message.result); return; }
    if (message.method === 'Page.javascriptDialogOpening') { await command('Page.handleJavaScriptDialog',{accept:true}); return; }
    if (message.method === 'Runtime.exceptionThrown') browserErrors.push('Uncaught browser exception');
    if (message.method === 'Network.webSocketFrameReceived' && message.params.response.payloadData.includes('"new_order"')) newOrderSocketObserved = true;
    if (pushSmoke && message.method === 'ServiceWorker.workerErrorReported') {
      pushEvidence.workerError = String(message.params.errorMessage.errorMessage).replace(/https?:\/\/[^\s"']+/g, '[resource URL]');
    }
    if (message.method !== 'Fetch.requestPaused') return;
    const { requestId, request } = message.params;
    try {
      const url = new URL(request.url);
      if (url.origin === apiOrigin && Object.entries(request.headers).some(([key,value])=>key.toLowerCase()==='content-type'&&value.includes('multipart/form-data'))) { await command('Fetch.continueRequest',{requestId}); return; }
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
        const apiStarted = performance.now();
        const response = await fetch(apiOrigin + url.pathname + url.search, { method: request.method, headers, ...(request.postData ? { body: request.postData } : {}) });
        const body = await response.text();
        if (url.pathname === '/api/auth/seller/send-otp') uiSellerOtp = JSON.parse(body).otp;
        if (url.pathname === '/api/auth/send-otp') uiCustomerOtp = JSON.parse(body).otp;
        apiCalls.push({ method: request.method, path: url.pathname, status: response.status, durationMs: Math.round(performance.now() - apiStarted) });
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
  const click = async label => { await waitFor('[...document.querySelectorAll("button")].some(b=>b.textContent.trim().replace(/^\\+\\s*/,"")==='+JSON.stringify(label)+'&&!b.disabled)'); return evaluate('(()=>{const button=[...document.querySelectorAll("button")].find(b=>b.textContent.trim().replace(/^\\+\\s*/,"")==='+JSON.stringify(label)+');if(!button)throw new Error("Missing button "+'+JSON.stringify(label)+');button.click();})()') };
  const input = async (selector,value) => evaluate('(()=>{const el=document.querySelector('+JSON.stringify(selector)+');if(!el)throw new Error("Missing input");Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(el,'+JSON.stringify(String(value))+');el.dispatchEvent(new Event("input",{bubbles:true}));})()');
  await command('Page.navigate',{url:origin+'/seller/profile'});
  await evaluate('localStorage.setItem("sellerToken",'+JSON.stringify(sellerLogin.body.token)+');localStorage.setItem("sellerUserProfile",'+JSON.stringify(JSON.stringify(sellerLogin.body.user))+')');
  await command('Page.reload');
  await waitFor('!!document.querySelector(".seller-profile-page")');
  phase='profile data and edit';
  assert.equal(await evaluate('document.body.innerText.includes("Pan India Reach")'),false);
  assert.equal(await evaluate('document.body.innerText.includes("amitmankar")'),false);
  assert.equal(await evaluate('document.body.innerText.includes('+JSON.stringify(sellerUser.phone)+')'),true);
  await click('Edit Profile');await waitFor('!!document.querySelector(".seller-profile-editor")');
  await input('.seller-profile-editor input[name=name]','Updated fixture store');
  await input('.seller-profile-editor input[name=email]','fixture-new@example.invalid');
  await click('Save Profile');await waitFor('!document.querySelector(".seller-profile-editor") && document.body.innerText.includes("Updated fixture store")');
  await command('Page.reload');await waitFor('document.querySelector(".seller-profile-hero")?.textContent.includes("Updated fixture store")');
  phase='pending approval and direct API denial';
  assert.ok(await evaluate('document.body.innerText.includes("awaiting admin review")'));
  const terms={enabled:true,minimumQuantity:10,quantityIncrement:5,priceTiers:[{minimumQuantity:10,unitPrice:95}]};
  assert.equal((await api('/products/'+productId+'/wholesale-pricing',{token:sellerLogin.body.token,method:'PATCH',body:{variants:[{variantId,wholesalePricing:terms}]}})).status,403);
  const adminLogin=await api('/auth/admin/login',{method:'POST',body:{email:'checkout-fixture@example.invalid',password:adminPassword}});assert.equal(adminLogin.status,200);
  const decide=async status=>{const current=await api('/sellers/me',{token:sellerLogin.body.token});const result=await api('/admin/sellers/'+sellerId+'/wholesale',{token:adminLogin.body.token,method:'PATCH',body:{status,version:current.body.seller.__v??0,suspensionReason:'Isolated browser review'}});assert.equal(result.status,200);};
  await decide('approved');await click('Refresh access');await waitFor('document.body.innerText.includes("Approved seller channel")');
  phase='three selling modes';
  await command('Page.navigate',{url:origin+'/seller/products'});await waitFor('!!document.querySelector(".seller-listing-modes")');
  const shellChecks=[];
  const captureMode=async mode=>{
    for(const width of [390,1280]){
      await command('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<500});
      if(width<500){await evaluate(`document.querySelector('.seller-dashboard-layout:not(.sidebar-collapsed) [aria-label="Close Sidebar"]')?.click()`);await pause(400);}
      const geometry=await evaluate(`(()=>{const shell=document.querySelector('.seller-products-page'),heading=shell.querySelector('h1'),toolbar=shell.querySelector('.seller-products-toolbar'),action=toolbar.querySelector('.seller-products-primary'),tabs=shell.querySelector('.seller-listing-modes');return {width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth,headings:shell.querySelectorAll('h1').length,heading:heading.textContent.trim(),action:action.textContent.trim(),active:[...tabs.querySelectorAll('button')].filter(b=>b.getAttribute('aria-pressed')==='true').map(b=>b.textContent.trim()),headingX:heading.getBoundingClientRect().x,toolbarX:toolbar.getBoundingClientRect().x,actionWidth:action.getBoundingClientRect().width}})()`);
      assert.equal(geometry.headings,1);assert.equal(geometry.heading,'Product List');assert.equal(geometry.active.length,1);assert.equal(geometry.active[0],mode);assert.ok(geometry.scroll<=geometry.width+1);assert.ok(Math.abs(geometry.headingX-geometry.toolbarX)<1);
      assert.equal(geometry.action.includes(mode==='Wholesale (B2B)'?'Add Product':'Add New Product'),true);shellChecks.push({mode,...geometry});
      await mkdir(join(root,'test-artifacts/seller-profile-wholesale'),{recursive:true});
      const screenshot=await command('Page.captureScreenshot',{format:'png'});await writeFile(join(root,'test-artifacts/seller-profile-wholesale/products-'+mode.replace(/[^a-z]/gi,'')+'-'+width+'.png'),Buffer.from(screenshot.data,'base64'));
    }
  };
  await click('E-Commerce');await waitFor('document.body.innerText.includes("Isolated Browser Checkout Item")');await captureMode('E-Commerce');
  await click('Quick Commerce');await waitFor('document.body.innerText.includes("Quick physical fixture")');await captureMode('Quick Commerce');
  await click('Wholesale (B2B)');await waitFor('!!document.querySelector(".seller-wholesale-table")');await captureMode('Wholesale (B2B)');
  assert.equal(await evaluate('!![...document.querySelectorAll(".seller-wholesale-table tr")].find(r=>r.textContent.includes("Digital fixture"))'),false);
  phase='variant Wholesale save';
  await click('Add Wholesale Offer to Existing Product');await waitFor('!!document.querySelector(".seller-offer-selector")');
  const select=async(index,value)=>evaluate('(()=>{const el=document.querySelectorAll(".seller-offer-selector select")['+index+'];Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,"value").set.call(el,'+JSON.stringify(String(value))+');el.dispatchEvent(new Event("change",{bubbles:true}));})()');
  const options=await evaluate('[...document.querySelectorAll(".seller-offer-selector select")[0].options].map(o=>o.textContent)');assert.equal(options.some(o=>o.includes('Digital fixture')),false);
  phase='select existing Wholesale product';await select(0,productId);phase='select existing Wholesale variant';await select(1,variantId);phase='open selected variant editor';await click('Configure Wholesale Terms');
  const section='[aria-label="One pack Wholesale settings"]';
  await waitFor('!!document.querySelector('+JSON.stringify(section)+')');
  phase='toggle Wholesale enabled';await evaluate('document.querySelector('+JSON.stringify(section+' input[type=checkbox]')+').click()');
  const fields=section+' input[type=number]';
  phase='fill Wholesale quantities';await input(fields+':nth-of-type(1)',10);
  // Number inputs are in separate label elements; select by array index.
  const number=async(index,value)=>evaluate('(()=>{const el=document.querySelectorAll('+JSON.stringify(fields)+')['+index+'];Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(el,'+JSON.stringify(String(value))+');el.dispatchEvent(new Event("input",{bubbles:true}));})()');
  await number(0,10);await number(1,5);await number(3,95);
  phase='add second Wholesale tier';await click('Add quantity tier');await number(4,50);await number(5,85);
  for(const width of [390,1280]){
    await command('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<500});
    const geometry=await evaluate(`(()=>{const d=document.querySelector('.seller-wholesale-editor'),r=d.getBoundingClientRect(),b=document.querySelector('.seller-wholesale-editor-body');const reachable=el=>{const rect=el.getBoundingClientRect();return el.contains(document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2))};return {width:innerWidth,scroll:document.documentElement.scrollWidth,left:r.left,right:r.right,top:r.top,bottom:r.bottom,height:innerHeight,scrollable:b.scrollHeight>b.clientHeight,closeReachable:reachable(d.querySelector('header button')),saveReachable:reachable(d.querySelector('footer .seller-products-primary')),retailInputs:[...d.querySelectorAll('input')].filter(i=>!i.closest('.seller-offer-fields')).length}})()`);
    assert.ok(geometry.scroll<=geometry.width+1);assert.ok(geometry.left>=0&&geometry.right<=geometry.width+1&&geometry.top>=0&&geometry.bottom<=geometry.height+1);assert.equal(geometry.retailInputs,0);if(width===390)assert.equal(geometry.scrollable,true);
    assert.equal(geometry.closeReachable,true);assert.equal(geometry.saveReachable,true);
    await evaluate('document.querySelector(".seller-wholesale-editor-body").scrollTop=0');
    const screenshot=await command('Page.captureScreenshot',{format:'png'});await mkdir(join(root,'test-artifacts/seller-profile-wholesale'),{recursive:true});await writeFile(join(root,'test-artifacts/seller-profile-wholesale/wholesale-editor-'+width+'.png'),Buffer.from(screenshot.data,'base64'));
  }
  phase='save two Wholesale tiers';const writes=apiCalls.filter(c=>c.method==='PATCH'&&c.path.endsWith('/wholesale-pricing')).length;
  await evaluate('[...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="Save Wholesale Terms").click()');
  await waitFor(''+JSON.stringify(false)+' || ![...document.querySelectorAll("button")].some(b=>b.textContent.trim()==="Saving…") && !!document.querySelector('+JSON.stringify(section)+')');
  for(let i=0;i<100;i++){if((await Product.findById(productId).select("+variants.wholesalePricing")).variants[0].wholesalePricing?.enabled)break;await pause(100);}
  const saved=await Product.findById(productId).select('+variants.wholesalePricing');
  assert.equal(saved.variants[0].wholesalePricing.minimumQuantity,10);assert.equal(saved.variants[0].wholesalePricing.priceTiers.length,2);assert.equal(saved.variants[0].price,100);assert.equal(saved.variants[0].stock,100);
  const quickAfter=await Product.findById(groceryId);assert.equal(quickAfter.variants[0].price,75);assert.equal(quickAfter.variants[0].stock,100);
  assert.equal(apiCalls.filter(c=>c.method==='PATCH'&&c.path.endsWith('/wholesale-pricing')).length,writes+1);
  await evaluate('document.querySelector("[aria-label=Close]").click()');await waitFor('!document.querySelector('+JSON.stringify(section)+')');
  await command('Page.reload');await waitFor('!!document.querySelector(".seller-listing-modes")');await click('Wholesale (B2B)');await waitFor('document.querySelector(".seller-wholesale-table")?.textContent.includes("10 / 5")');
  phase='edit and disable offer without changing inventory';
  await evaluate('[...document.querySelectorAll(".seller-wholesale-table tbody tr")].find(r=>r.textContent.includes("Isolated Browser Checkout Item")).querySelector("button").click()');
  await waitFor('!!document.querySelector('+JSON.stringify(section)+')');
  assert.equal(await evaluate('document.querySelectorAll('+JSON.stringify(fields)+')[0].value'),'10');
  await evaluate('document.querySelector('+JSON.stringify(section+' input[type=checkbox]')+').click()');await click('Save Wholesale Terms');
  await waitFor('document.querySelector(".seller-products-success")?.textContent.includes("Wholesale terms saved")');
  const disabled=await Product.findById(productId).select('+variants.wholesalePricing');assert.equal(disabled.variants[0].wholesalePricing.enabled,false);assert.equal(disabled.variants[0].price,100);assert.equal(disabled.variants[0].stock,100);assert.equal(disabled.isActive,true);
  await evaluate('document.querySelector("[aria-label=Close]").click()');
  phase='Wholesale-only product creation';
  const createdIds=[];
  const modalTab=async text=>evaluate('(()=>{const b=[...document.querySelectorAll(".pm-tab-nav button")].find(b=>b.textContent.includes('+JSON.stringify(text)+'));if(!b)throw new Error("Missing editor tab");b.click();})()');
  for(const width of [390,1280]){
    await command('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<500});
    await click('Add Product');await waitFor('!!document.querySelector(".pm-dialog[role=dialog]")');
    const title='Wholesale creation fixture '+width;
    await input('.pm-dialog input[placeholder="e.g. Stainless Steel Peeler"]',title);
    await input('.pm-dialog input[placeholder="e.g. Local Make"]','Fixture Brand');
    await modalTab('Category');await waitFor('document.querySelectorAll(".pm-dialog select").length>0');
    await evaluate('(()=>{const el=document.querySelector(".pm-dialog select");Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,"value").set.call(el,'+JSON.stringify(String(categoryId))+');el.dispatchEvent(new Event("change",{bubbles:true}));})()');
    await modalTab('Item Variants');await input('.pm-dialog input[aria-label="Variant 1 stock"]',100);
    await evaluate('(()=>{const els=document.querySelectorAll(".pm-dialog .seller-offer-fields input[type=number]");[10,5,10,95].forEach((value,index)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(els[index],String(value));els[index].dispatchEvent(new Event("input",{bubbles:true}));});})()');
    await click('Add quantity tier');
    await evaluate('(()=>{const els=document.querySelectorAll(".pm-dialog .seller-offer-fields input[type=number]");[50,85].forEach((value,index)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(els[index+4],String(value));els[index+4].dispatchEvent(new Event("input",{bubbles:true}));});})()');
    await modalTab('Photos');
    await evaluate('(()=>{const el=document.querySelector(".pm-dialog input[type=file]");const data=new DataTransfer();data.items.add(new File([Uint8Array.from(atob('+JSON.stringify(fixturePng.toString('base64'))+'),c=>c.charCodeAt(0))],"fixture.png",{type:"image/png"}));el.files=data.files;el.dispatchEvent(new Event("change",{bubbles:true}));})()');
    await waitFor('[...document.querySelectorAll(".pm-dialog button")].some(b=>b.textContent.trim()==="Save Wholesale Product"&&!b.disabled)');
    await waitFor('document.querySelector(".pm-dialog img")?.naturalWidth>0');
    const geometry=await evaluate('(()=>{const d=document.querySelector(".pm-dialog"),r=d.getBoundingClientRect();const save=[...d.querySelectorAll("button")].find(b=>b.textContent.trim()==="Save Wholesale Product"),s=save.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:innerWidth,height:innerHeight,reachable:save.contains(document.elementFromPoint(s.x+s.width/2,s.y+s.height/2))};})()');
    assert.ok(geometry.left>=0&&geometry.right<=geometry.width+1&&geometry.top>=0&&geometry.bottom<=geometry.height+1);assert.equal(geometry.reachable,true);
    const shot=await command('Page.captureScreenshot',{format:'png'});await writeFile(join(root,'test-artifacts/seller-profile-wholesale/wholesale-create-'+width+'.png'),Buffer.from(shot.data,'base64'));
    await click('Save Wholesale Product');await waitFor('!document.querySelector(".pm-dialog")&&document.querySelector(".seller-wholesale-table")?.textContent.includes('+JSON.stringify(title)+')');
    const created=await Product.findOne({name:title}).select('+variants.wholesalePricing');assert.ok(created);createdIds.push(String(created._id));assert.deepEqual([...created.sellingChannels],['wholesale']);assert.equal(created.price,0);assert.equal(created.variants[0].wholesalePricing.priceTiers.length,2);assert.equal(created.stock,100);assert.equal(created.brandName,'Fixture Brand');
    assert.equal((await api('/products/'+created._id)).status,404);
    await command('Page.reload');await waitFor('!!document.querySelector(".seller-listing-modes")');await click('Wholesale (B2B)');await waitFor('document.querySelector(".seller-wholesale-table")?.textContent.includes('+JSON.stringify(title)+')');
    await evaluate('[...document.querySelectorAll(".seller-wholesale-table tr")].find(r=>r.textContent.includes('+JSON.stringify(title)+')).querySelector("button").click()');await waitFor('!!document.querySelector(".pm-dialog")');await modalTab('Item Variants');
    assert.equal(await evaluate('document.querySelectorAll(".pm-dialog .seller-offer-fields input[type=number]")[3].value'),'95');await modalTab('General Info');await input('.pm-dialog input[placeholder="e.g. Local Make"]','Updated Wholesale Brand');await click('Save Wholesale Product');await waitFor('!document.querySelector(".pm-dialog")');const edited=await Product.findById(created._id).select('+variants.wholesalePricing');assert.equal(edited.brandName,'Updated Wholesale Brand');assert.equal(edited.stock,100);assert.equal(edited.variants[0].wholesalePricing.priceTiers.length,2);
    for(const mode of ['E-Commerce','Quick Commerce']){await click(mode);await waitFor('!document.body.innerText.includes("Loading products")');assert.equal(await evaluate('document.body.innerText.includes('+JSON.stringify(title)+')'),false);}
    await click('Wholesale (B2B)');await waitFor('!!document.querySelector(".seller-wholesale-table")');
  }
  phase='digital denial';
  const digital=await Product.findById(digitalId);
  assert.equal((await api('/products/'+digitalId+'/wholesale-pricing',{token:sellerLogin.body.token,method:'PATCH',body:{variants:[{variantId:digital.variants[0]._id,wholesalePricing:terms}]}})).status,400);
  phase='suspension refresh';
  await decide('suspended');await click('Refresh access');await waitFor('document.body.innerText.includes("Wholesale access is suspended")');
  phase='responsive profile';
  await command('Page.navigate',{url:origin+'/seller/profile'});await waitFor('!!document.querySelector(".seller-profile-page")');
  for(const width of [390,1280]){
    await command('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<500});
    if(width<500) { await evaluate(`document.querySelector('.seller-dashboard-layout:not(.sidebar-collapsed) [aria-label="Close Sidebar"]')?.click()`); await waitFor(`!!document.querySelector('.seller-dashboard-layout.sidebar-collapsed')`); await pause(400); }
    const geometry=await evaluate('({width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth})');assert.ok(geometry.scroll<=geometry.width+1);
    await command('Page.captureScreenshot',{format:'png'}).then(async result=>{await mkdir(join(root,'test-artifacts/seller-profile-wholesale'),{recursive:true});await writeFile(join(root,'test-artifacts/seller-profile-wholesale/profile-'+width+'.png'),Buffer.from(result.data,'base64'));});
  }
  phase='notifications retain authorized operations';
  const {default:Notification}=await import('../models/Notification.js');
  const notification=await Notification.create({userId:sellerUser._id,type:'system',title:'Profile fixture notification',message:'Local fixture only'});
  await evaluate('document.querySelector("[aria-label=Notifications]").click()');
  await waitFor('!!document.querySelector("[aria-label=Notifications][role=dialog]") && document.body.innerText.includes("Profile fixture notification")');
  await click('Mark all read');
  for(let i=0;i<100;i++){if((await Notification.findById(notification._id)).isRead)break;await pause(100);}
  assert.equal((await Notification.findById(notification._id)).isRead,true);
  await click('Clear all');await waitFor('document.body.innerText.includes("No notifications found")');
  assert.equal(await Notification.countDocuments({_id:notification._id}),0);
  assert.equal((await Seller.findById(sellerId)).wholesaleChannel.status,'suspended');
  await evaluate(`document.querySelector('[aria-label="Close notifications"]').click()`);
  assert.deepEqual(browserErrors,[]);assert.deepEqual(networkFailures,[]);
  const result={passed:true,database:'disposable-local-replica-set',browser:'headless Chrome',apiMocks:false,externalProviders:'mock mode',realSellerChanges:0,customerOrdersCreated:0,viewports:[390,1280],shellChecks,checks:['Wholesale-only creation with upload at 390px and 1280px','Wholesale-only save/reload/reopen preserves two tiers and stock','Wholesale-only excluded from both retail seller tabs and public direct route','authoritative profile','profile save and refresh','pending-to-approved access refresh','shared Products shell and toolbar in all three modes','Add Wholesale Offer selects an existing product and variant','Wholesale-only terms editor has no retail inputs','existing physical variant offer save/reload','retail and quick prices/stock preserved','unapproved direct API denied','digital direct API denied','suspension refresh','responsive profile and variant editor','notifications open/read/clear/close without approval mutation']};
  await mkdir(join(root,'test-artifacts/seller-profile-wholesale'),{recursive:true});await writeFile(join(root,'test-artifacts/seller-profile-wholesale/browser.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
} catch (error) {
  console.error(JSON.stringify({ passed: false, phase, name: error.name, assertionLocation: error.stack?.split('\n').filter(line=>line.includes('verifySellerProfileWholesaleBrowser.mjs')), actual: typeof error.actual==='boolean'?error.actual:undefined, expected: typeof error.expected==='boolean'?error.expected:undefined, message: error.name === 'AssertionError' ? 'Checkout browser assertion failed' : error.message, startupErrors, browserErrors, networkFailures })); process.exitCode = 1;
} finally {
  socket?.close(); browser?.kill(); backend?.kill();
  if (preview) { preview.httpServer.closeAllConnections?.(); await new Promise(resolve => preview.httpServer.close(resolve)); }
  await mongoose.disconnect(); await replica?.stop();
  assert.equal(dirname(resolve(directory)), resolve(tmpdir())); assert.ok(basename(directory).startsWith('bulkimart-seller-wholesale-fixture-'));
  await pause(300); await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}
