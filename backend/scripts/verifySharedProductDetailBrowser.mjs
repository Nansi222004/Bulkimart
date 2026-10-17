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
let uiSellerOtp, uiCustomerOtp;let quoteFault='';const quoteEvidence=[];const expectedFaults=[];const consoleErrors=[],failedRequests=[];const intentionallyBlockedRequests=new Set(),blockedExternalHosts=new Set();
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
  console.log('Shared detail browser: starting isolated replica set');
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
  await Seller.collection.insertOne({ _id: sellerId, userId: sellerUser._id, businessName: 'Isolated Fixture Store', status: 'approved', __v: 0, salesChannels: ['ecommerce','grocery','wholesale'], wholesaleChannel: {status:'approved'}, storeDetails: { name: 'Isolated Fixture Store', address: 'Isolated fixture store pickup 123', email: 'pickup@example.invalid', phone: sellerUser.phone, state: point.state, pincode: point.pincode, city: point.city, lat: 19.1, lng: 72.9 } });
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
  console.log('Shared detail browser: starting normal backend with isolated configuration');
  backend = spawn(process.execPath, ['index.js'], { cwd: join(root, 'backend'), windowsHide: true, env: { ...process.env, ...fixtureEnv, MONGO_URI: process.env.MONGO_URI, PORT: String(port), PUBLIC_API_URL: apiOrigin }, stdio: ['ignore', 'pipe', 'pipe'] });
  // Classify only: raw startup logs can include secrets or test OTPs.
  for (const stream of [backend.stdout, backend.stderr]) stream.on('data', chunk => { if (/E11000|index.*(?:error|fail)|uncaught|unhandled/i.test(String(chunk))) startupErrors.push('Startup/index error detected'); });
  let ready = false;
  for (let i = 0; i < 600; i++) { try { if ((await fetch(apiOrigin + '/api/health', { signal: AbortSignal.timeout(1000) })).ok) { ready = true; break; } } catch {} await pause(100); }
  assert.ok(ready, 'Isolated backend did not become healthy.');
  console.log('Shared detail browser: backend healthy; verifying fixture login');
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
  console.log('Shared detail browser: authenticated fixture accounts; opening browser');
  console.log('Shared detail browser: preview ready');
  browser = spawn(executable, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${join(directory, 'chrome')}`, '--no-first-run', ...(!pushSmoke ? ['--disable-background-networking'] : []), '--disable-sync', 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  let debugPort;
  for (let i = 0; i < 100; i++) { try { debugPort = Number((await readFile(join(directory, 'chrome/DevToolsActivePort'), 'utf8')).split('\n')[0]); break; } catch { await pause(100); } }
  assert.ok(debugPort, 'Chrome did not start.');
  console.log('Shared detail browser: Chrome ready');
  const target = await (await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: 'PUT' })).json();
  socket = new WebSocket(target.webSocketDebuggerUrl); await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  console.log('Shared detail browser: debug connection ready');
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
    if(message.method==='Runtime.consoleAPICalled'&&message.params.type==='error')consoleErrors.push(String(message.params.args?.[0]?.value || 'Browser console error').slice(0,180));
    if(message.method==='Network.loadingFailed'&&!intentionallyBlockedRequests.has(message.params.requestId)&&!message.params.canceled&&message.params.errorText!=='net::ERR_ABORTED')failedRequests.push(message.params.errorText);
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
        if(url.pathname==='/api/products/wholesale/quote'){
          const fault=quoteFault;if(fault){expectedFaults.push(fault);if(fault==='slow')await pause(700);if(fault==='timeout')await pause(11500);if(fault==='failed'){await command('Fetch.fulfillRequest',{requestId,responseCode:503,responseHeaders:[{name:'Content-Type',value:'application/json'},{name:'Access-Control-Allow-Origin',value:origin}],body:Buffer.from(JSON.stringify({message:'Isolated quote failure'})).toString('base64')});return;}}
        }
        const apiStarted = performance.now();
        const response = await fetch(apiOrigin + url.pathname + url.search, { method: request.method, headers, ...(request.postData ? { body: request.postData } : {}) });
        const body = await response.text();
        if(url.pathname==='/api/products/wholesale/quote'&&response.ok)quoteEvidence.push({request:JSON.parse(request.postData),response:JSON.parse(body).data});
        if (url.pathname === '/api/auth/seller/send-otp') uiSellerOtp = JSON.parse(body).otp;
        if (url.pathname === '/api/auth/send-otp') uiCustomerOtp = JSON.parse(body).otp;
        apiCalls.push({ method: request.method, path: url.pathname, status: response.status, durationMs: Math.round(performance.now() - apiStarted) });
        if (request.method === 'POST' && ['/api/orders', '/api/orders/unified'].includes(url.pathname)) checkouts.push({ path: url.pathname.slice(4), headers, payload: request.postData, status: response.status, result: JSON.parse(body) });
        await command('Fetch.fulfillRequest', { requestId, responseCode: response.status, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }, { name: 'Access-Control-Allow-Origin', value: origin }, { name: 'Access-Control-Allow-Headers', value: 'authorization,content-type,idempotency-key' }], body: Buffer.from(body).toString('base64') });
      } else if (request.url.startsWith(origin) || url.origin === apiOrigin || request.url.startsWith('data:')) await command('Fetch.continueRequest', { requestId });
      else if (pushSmoke && url.protocol === 'https:' && (url.hostname.endsWith('.googleapis.com') || url.hostname === 'www.gstatic.com')) await command('Fetch.continueRequest', { requestId });
      else {intentionallyBlockedRequests.add(message.params.networkId);blockedExternalHosts.add(url.hostname);await command('Fetch.failRequest',{requestId,errorReason:'BlockedByClient'});}
    } catch (error) { if (!/Invalid InterceptionId|Invalid interceptionId|Invalid parameters.*interception/i.test(error.message)) networkFailures.push(error.message); }
  };
  await command('Page.enable'); await command('Runtime.enable'); await command('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
  await command('Network.enable');
  if (pushSmoke) await command('ServiceWorker.enable');

  phase='fixture product details';
  await Cart.deleteMany({userId:buyer._id});
  const secondVariantId=new mongoose.Types.ObjectId(),onlyId=new mongoose.Types.ObjectId(),onlyVariantId=new mongoose.Types.ObjectId();
  const terms={enabled:true,minimumQuantity:10,quantityIncrement:5,priceTiers:[{minimumQuantity:10,unitPrice:95},{minimumQuantity:50,unitPrice:85}]};
  await Product.updateOne({_id:productId},{$set:{description:'A physical fixture description for the shared product page.',brandName:'Fixture Brand',sellingChannels:['ecommerce','wholesale'],images:[fixtureImage,fixtureImage],variants:[{_id:variantId,name:'One pack',sku:'BROWSER-FIXTURE',price:100,mrp:120,stock:100,weight:500,unit:'piece',attributes:[{name:'Colour',value:'Blue'}],wholesalePricing:terms},{_id:secondVariantId,name:'Large pack',sku:'BROWSER-LARGE',price:200,mrp:220,stock:100,weight:1000,unit:'pack',wholesalePricing:{enabled:true,minimumQuantity:5,quantityIncrement:5,priceTiers:[{minimumQuantity:5,unitPrice:190},{minimumQuantity:20,unitPrice:180}]}}]}});
  await Product.create({_id:onlyId,name:'Wholesale-only shared fixture',type:'ecommerce',sellingChannels:['wholesale'],sellerId,category:categoryId,description:'Wholesale-only product description and specifications.',brandName:'Bulk Fixture',images:[fixtureImage,fixtureImage],status:'approved',isActive:true,variants:[{_id:onlyVariantId,name:'Wholesale case',price:0,mrp:0,stock:100,unit:'pack',attributes:[{name:'Size',value:'Large'}],wholesalePricing:terms}]});
  await Product.updateOne({_id:groceryId},{$set:{images:[fixtureImage]}});
  await Product.updateOne({_id:digitalId},{$set:{images:[fixtureImage],description:'Digital fixture description',digital:{author:'Fixture Author',language:'English',format:'pdf',licenseTerms:'Fixture personal licence'}}});
  await mkdir(join(root,'test-artifacts/shared-product-detail'),{recursive:true});
  const checks=[];
  const click=async label=>{await waitFor('[...document.querySelectorAll("button")].some(b=>b.textContent.trim()==='+JSON.stringify(label)+'&&!b.disabled)');await evaluate('[...document.querySelectorAll("button")].find(b=>b.textContent.trim()==='+JSON.stringify(label)+').click()');};
  const input=async(selector,value)=>evaluate('(()=>{const el=document.querySelector('+JSON.stringify(selector)+');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(el,'+JSON.stringify(String(value))+');el.dispatchEvent(new Event("input",{bubbles:true}));})()');
  const variantSelector='select[aria-label="Choose pack / variant"]';
  const changeVariant=async id=>evaluate('(()=>{const el=document.querySelector('+JSON.stringify(variantSelector)+');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,"value").set.call(el,'+JSON.stringify(String(id))+');el.dispatchEvent(new Event("change",{bubbles:true}));})()');
  const navigate=async path=>{await command('Page.navigate',{url:origin+path});await waitFor('!!document.querySelector(".product-detail-page")');};
  const quoteReady=()=>waitFor('!!document.querySelector(".pd-wholesale-total")&&![...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="Add to Wholesale Cart")?.disabled');
  const shot=async name=>{const r=await command('Page.captureScreenshot',{format:'png'});await writeFile(join(root,'test-artifacts/shared-product-detail/'+name+'.png'),Buffer.from(r.data,'base64'));};
  await command('Page.navigate',{url:origin+'/'});await evaluate('localStorage.setItem("userToken",'+JSON.stringify(login.body.token)+');localStorage.setItem("userProfile",'+JSON.stringify(JSON.stringify(login.body.user))+');localStorage.setItem("locationAsked","true")');
  for(const width of [1280,390]){
    phase='retail physical detail '+width;
    await command('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<500});
    await navigate('/ecommerce--smart-buy?product='+productId+'&variant='+variantId);
    await waitFor('document.querySelector(".pd-price-row")?.textContent.includes("100")');
    assert.equal(await evaluate('document.querySelector(".product-detail-page").dataset.purchaseMode'),'retail');
    assert.equal(await evaluate('document.querySelectorAll(".pd-thumbnail-btn").length'),2);
    assert.ok(await evaluate('document.querySelector(".pd-description-text")?.textContent.includes("physical fixture description")'));
    assert.ok(await evaluate('document.querySelector(".pd-sticky-cta").textContent.includes("ADD TO CART")'));
    await shot('retail-'+width);
    phase='Wholesale catalog opens shared detail '+width;
    await command('Page.navigate',{url:origin+'/wholesale?q=Wholesale-only'});await waitFor('!!document.querySelector(".wholesale-card")');
    await evaluate('document.querySelector(".wholesale-card").click()');await waitFor('!!document.querySelector(".product-detail-page")');await quoteReady();
    assert.ok(await evaluate('document.querySelector(".pd-product-name").textContent.includes("Wholesale-only shared fixture")'));
    assert.equal(await evaluate('!!document.querySelector(".wholesale-detail")'),false);
    assert.equal(await evaluate('[...document.querySelectorAll(".pd-channel-selector button")].some(b=>b.textContent==="Retail")'),false);
    assert.ok(await evaluate('document.querySelector(".pd-wholesale-total").textContent.includes("950")'));
    assert.ok(await evaluate('document.querySelector(".pd-seller-info").textContent.includes("Isolated Fixture Store")'));
    await click('Product Info');assert.ok(await evaluate('document.querySelector(".pd-tab-content").textContent.includes("Bulk Fixture")'));assert.ok(await evaluate('document.querySelector(".pd-tab-content").textContent.includes("Large")'));
    await click('Description');
    const geometry=await evaluate('(()=>{const page=document.querySelector(".product-detail-page"),cta=page.querySelector(".pd-sticky-cta"),r=cta.getBoundingClientRect();return {viewport:innerWidth,scroll:document.documentElement.scrollWidth,pageWidth:page.clientWidth,pageScroll:page.scrollWidth,top:r.top,bottom:r.bottom,height:innerHeight,hit:cta.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))};})()');
    assert.ok(geometry.scroll<=geometry.viewport+1);assert.ok(geometry.pageScroll<=geometry.pageWidth+1);assert.ok(geometry.top>=0&&geometry.bottom<=geometry.height+1);assert.equal(geometry.hit,true);
    await shot('wholesale-only-'+width);await evaluate('document.querySelector('+JSON.stringify('[aria-label="Go back"]')+').click()');await waitFor('!document.querySelector(".product-detail-page")&&location.pathname==="/wholesale"');await evaluate('history.forward()');await quoteReady();await input('#pd-wholesale-quantity',50);await quoteReady();assert.ok(await evaluate('document.querySelector(".pd-wholesale-total").textContent.includes("4,250")'));
    const evidence=quoteEvidence.at(-1);assert.equal(evidence.request.productId,String(onlyId));assert.equal(evidence.request.variantId,String(onlyVariantId));assert.equal(evidence.response.unitPrice,85);assert.equal(evidence.response.subtotal,4250);
    await command('Page.reload');await quoteReady();assert.equal(await evaluate('new URLSearchParams(location.search).get("variant")'),String(onlyVariantId));
    phase='multi-channel mode, variant and history '+width;
    await navigate('/wholesale/'+productId+'?variant='+variantId+'&purchase=wholesale');await quoteReady();
    await changeVariant(secondVariantId);await quoteReady();assert.ok(await evaluate('document.querySelector(".pd-wholesale-total").textContent.includes("190")'));
    await evaluate('history.back()');await quoteReady();await waitFor('document.querySelector('+JSON.stringify(variantSelector)+')?.value==='+JSON.stringify(String(variantId)));
    await evaluate('history.forward()');await quoteReady();await waitFor('document.querySelector('+JSON.stringify(variantSelector)+')?.value==='+JSON.stringify(String(secondVariantId)));
    await click('Retail');await waitFor('document.querySelector(".product-detail-page")?.dataset.purchaseMode==="retail"&&document.querySelector(".pd-price-row")?.textContent.includes("200")');
    await click('Wholesale');await quoteReady();assert.equal(await evaluate('document.querySelector(".product-detail-page").dataset.purchaseMode'),'wholesale');
    phase='quantity validation '+width;
    await input('#pd-wholesale-quantity',6);await waitFor('[...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="Add to Wholesale Cart")?.disabled');assert.equal(await evaluate('document.querySelector(".pd-wholesale-total")===null'),true);
    await input('#pd-wholesale-quantity',105);assert.equal(await evaluate('[...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="Add to Wholesale Cart").disabled'),true);await input('#pd-wholesale-quantity',10);await quoteReady();
    phase='quote failure and timeout '+width;
    quoteFault='slow';await input('#pd-wholesale-quantity',20);await waitFor('[...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="Add to Wholesale Cart")?.disabled');await quoteReady();quoteFault='';
    quoteFault='failed';await input('#pd-wholesale-quantity',25);await waitFor('document.body.innerText.includes("Isolated quote failure")');assert.equal(await evaluate('document.querySelector(".pd-wholesale-total")===null'),true);
    quoteFault='';await click('Refresh offer');await quoteReady();
    if(width===390){quoteFault='timeout';await input('#pd-wholesale-quantity',30);await waitFor('document.body.innerText.includes("timed out")');assert.equal(await evaluate('[...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="Add to Wholesale Cart").disabled'),true);quoteFault='';await click('Refresh offer');await quoteReady();}
    phase='Wholesale cart navigation '+width;
    await click('Buy Wholesale Now');await waitFor('location.pathname==="/wholesale/cart"&&[...document.querySelectorAll("section")].some(el=>el.getAttribute("aria-label")==="Wholesale cart")');assert.equal(await Order.countDocuments(),0);assert.equal(await Payment.countDocuments(),0);
    phase='digital and Quick details '+width;
    await navigate('/ecommerce--smart-buy?product='+digitalId);assert.ok(await evaluate('document.body.innerText.includes("Fixture Author")&&document.body.innerText.includes("English")&&document.body.innerText.includes("PDF")'));assert.equal(await evaluate('document.querySelector(".product-detail-page").dataset.purchaseMode'),'retail');
    await shot('digital-'+width);
    await navigate('/grocery--home?product='+groceryId);await waitFor('document.querySelector(".pd-price-row")?.textContent.includes("75")');assert.equal(await evaluate('document.querySelector(".product-detail-page").dataset.purchaseMode'),'retail');
    checks.push({width,retail:true,wholesaleOnly:true,multiChannel:true,digital:true,quick:true,history:true,quoteRecovery:true,cartNavigation:true,geometry});
  }
  assert.equal((await api('/products/'+onlyId)).status,404);assert.deepEqual(browserErrors,[]);assert.deepEqual(networkFailures,[]);assert.deepEqual(consoleErrors,[]);assert.deepEqual(failedRequests,[]);
  const result={passed:true,browser:'headless Chrome',database:'disposable local replica set',apiMocks:false,externalProviders:'mock mode',intentionalNetworkFaults:expectedFaults,consoleErrors,failedRequests,blockedExternalHosts:[...blockedExternalHosts],checks,quoteResponsesChecked:quoteEvidence.length,customerOrdersCreated:0,realDataChanges:0};
  await writeFile(join(root,'test-artifacts/shared-product-detail/browser.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
} catch (error) {
  try{const screenshot=await command('Page.captureScreenshot',{format:'png'});await mkdir(join(root,'test-artifacts/shared-product-detail'),{recursive:true});await writeFile(join(root,'test-artifacts/shared-product-detail/failure.png'),Buffer.from(screenshot.data,'base64'));}catch{}
  console.error(JSON.stringify({ passed: false, phase, name: error.name, assertionLocation: error.stack?.split('\n').filter(line=>line.includes('verifySharedProductDetailBrowser.mjs')), actual: typeof error.actual==='boolean'?error.actual:undefined, expected: typeof error.expected==='boolean'?error.expected:undefined, message: error.name === 'AssertionError' ? 'Shared product detail browser assertion failed' : error.message, startupErrors, browserErrors, networkFailures,consoleErrors,failedRequests })); process.exitCode = 1;
} finally {
  socket?.close(); browser?.kill(); backend?.kill();
  if (preview) { preview.httpServer.closeAllConnections?.(); await new Promise(resolve => preview.httpServer.close(resolve)); }
  await mongoose.disconnect(); await replica?.stop();
  assert.equal(dirname(resolve(directory)), resolve(tmpdir())); assert.ok(basename(directory).startsWith('bulkimart-seller-wholesale-fixture-'));
  await pause(300); await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}
