import assert from 'node:assert/strict';
import { preview } from 'vite';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { existsSync } from 'node:fs';

const locationOnly = process.argv.includes('--location');
const allPortals = process.argv.includes('--portals');
const audit = process.argv.includes('--audit');
const dialogsOnly = process.argv.includes('--dialogs');
const sellerOnly = process.argv.includes('--seller');
const startupOnly = process.argv.includes('--startup');
const livePublic = process.argv.includes('--live-public');
let startupScenario = '', authRequests = 0, authSettled = false;
const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const viewport = html.match(/<meta\s+name="viewport"\s+content="([^"]+)"/i)?.[1];
assert.match(viewport || '', /width=device-width/);
assert.match(viewport, /initial-scale=1(?:\.0)?(?:,|$)/);
assert.doesNotMatch(viewport, /maximum-scale|user-scalable\s*=\s*no/i, 'Pinch zoom must remain available');
const executable = process.env.CHROME_BIN || ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(existsSync);
assert.ok(executable, 'Set CHROME_BIN to an installed Chrome/Chromium executable.');
assert.equal(typeof WebSocket, 'function', 'Browser checks require Node with built-in WebSocket support.');
const profileDir = await mkdtemp(join(tmpdir(), 'bulkimart-mobile-browser-'));
assert.ok(existsSync(resolve('dist/index.html')), 'Run npm run build before browser regressions.');
// Exercise the production artifact. Development module interception can stall
// across many reloads and does not represent the deployed asset pipeline.
const vite = await preview({ preview: { host: '127.0.0.1', port: 0, strictPort: false } });
const origin = livePublic ? 'https://bulkimart.in' : `http://127.0.0.1:${vite.httpServer.address().port}`;
const browser = spawn(executable, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profileDir}`, '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-sync', '--disable-component-update', 'about:blank'], { windowsHide: true, stdio: 'ignore' });
let socket, sequence = 0;
const pending = new Map(), errors = [], rows = [];
const browserDiagnostics = [];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const address = { _id: '507f1f77bcf86cd799439019', name: 'Fixture Customer', phone: '9876500000', line1: 'Fixture street', city: 'Mumbai', state: 'Maharashtra', pincode: '400001', lat: 19.11, lng: 72.91, isDefault: true };
const customer = { _id: '507f1f77bcf86cd799439011', name: 'Fixture Customer', phone: '9876500000', roles: ['buyer'], isActive: true, addresses: [address] };
const product = { _id: '507f1f77bcf86cd799439015', name: 'Mobile layout fixture product', price: 100, mrp: 120, stock: 10, type: 'ecommerce', images: ['/vite.svg'], sellerId: '507f1f77bcf86cd799439016', variants: [] };
const line = { ...product, _id: '507f1f77bcf86cd799439017', productId: product._id, qty: 1, lineTotal: 100, fulfillmentType: 'physical' };
const seller = { _id: product.sellerId, name: 'Fixture Store', city: 'Mumbai' };
const pricing = { subtotal: 100, deliveryCharge: 40, totalAmount: 140, standardFee: 40 };
function fixture(raw) {
  const path = new URL(raw).pathname;
  if (path === '/api/delivery/orders/active') return { success:true,data:null };
  if (path === '/api/delivery/return-pickups') return { success:true,data:{pending:[],active:[]} };
  if (path === '/api/delivery/me') return { success:true,data:{ _id:'507f1f77bcf86cd799439027',name:'Fixture Rider',phone:'9876500002',status:'approved',onboardingStep:4,isAvailable:false } };
  if (path === '/api/admin/products') return { success:true,data:[{...product,sellerId:{storeDetails:{name:'Fixture Store'}},category:{name:'Fixture Category'},status:'approved',isActive:true,sku:'FIXTURE-SKU'}] };
  if (path === '/api/admin/products/' + product._id) return { success:true,data:{...product,sellerId:{storeDetails:{name:'Fixture Store'}},category:{name:'Fixture Category'},status:'approved',isActive:true,sku:'FIXTURE-SKU',description:'Fixture listing description'} };
  if (path.startsWith('/api/sellers/orders/')) return { success:true,data:{ _id:'507f1f77bcf86cd799439022',orderNo:'ORD-FIXTURE',channel:'ecommerce',status:'placed',pricing,items:[line],shippingAddress:address,permittedActions:[] } };
  if (path === '/api/sellers/me') return { success: true, seller: { ...seller, status: 'approved', salesChannels: ['ecommerce', 'grocery'], storeDetails: { name: 'Fixture Store' } } };
  if (path === '/api/sellers/dashboard') return { success: true, kpis: { totalRevenue: 100, totalOrders: 1, lowStockCount: 1 } };
  if (path === '/api/sellers/orders') return { success: true, data: [{ _id: '507f1f77bcf86cd799439022', orderNo: 'ORD-FIXTURE', channel: 'ecommerce', status: 'placed', pricing, items: [line], createdAt: new Date().toISOString(), shippingAddress: address }] };
  if (path === '/api/auth/me') return { success: true, userType: 'user', sessionRole: 'buyer', profile: customer };
  if (path === '/api/auth/send-otp') return { success: true, message: 'Fixture OTP sent' };
  if (path === '/api/auth/verify-otp') return { success: true, user: customer, token: 'browser-fixture-token', sessionRole: 'buyer' };
  if (path === '/api/users/profile') return { success: true, user: customer };
  if (path === '/api/users/addresses') return { success: true, data: [address] };
  if (path === '/api/cart/unified') return { success: true, data: { groups: [{ key: 'fixture', channel: 'ecommerce', seller, items: [{ ...line, itemId: line._id }], modeChosen: true, deliveryMode: 'scheduled', requestedMode: 'scheduled', total: 140, deliveryCharge: 40 }], totals: { ...pricing, itemCount: 1 }, needsDeliveryChoice: false } };
  if (path === '/api/cart') return { success: true, data: { channel: 'ecommerce', seller, items: [line], pricing, warnings: [] } };
  if (path === '/api/cart/summary') return { success: true, data: { ecommerce: { count: 1, subtotal: 100 } } };
  if (path === '/api/wallet' || path.endsWith('/wallet')) return { success: true, data: { balance: 1000 } };
  if (path === '/api/categories/tree' || path === '/api/banners') return [];
  if (path === '/api/products/featured' || path === '/api/products/search') return [product];
  if (path.startsWith('/api/products')) return { success: true, data: path === `/api/products/${product._id}` ? product : [product], meta: { page: 1, pages: 1, total: 1 } };
  if (path.includes('tip')) return { success: true, data: { enabled: true, options: [10, 30, 40], customMin: 1, customMax: 1000 } };
  return { success: true, data: [], meta: { unreadCount: 0, page: 1, pages: 1 } };
}
function command(method, params = {}) {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Browser command timed out: ${method}`)); }, 20000);
    pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}
async function waitFor(expression) {
  for (let i = 0; i < 200; i++) { if (await evaluate(expression)) return; await pause(100); }
  throw new Error('Page not ready: ' + expression + '\n' + JSON.stringify(errors.slice(-3)) + '\n' + JSON.stringify(browserDiagnostics.slice(-8)) + '\n' + await evaluate('JSON.stringify({ready:document.readyState,title:document.title,html:document.body.innerHTML.slice(0,1500)})'));
}
try {
  let port;
  for (let i = 0; i < 100; i++) {
    try { port = Number((await readFile(join(profileDir, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); break; } catch { await pause(100); }
  }
  assert.ok(port, 'Headless browser did not start');
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  socket.onmessage = async event => {
    const message = JSON.parse(event.data);
    if (message.id) { const task = pending.get(message.id); pending.delete(message.id); if (message.error) task?.reject(new Error(message.error.message)); else task?.resolve(message.result); return; }
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
    if (!livePublic && message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') browserDiagnostics.push(message.params.args.map(arg => arg.value || arg.description || '').join(' ').slice(0, 1000));
    if (message.method === 'Fetch.requestPaused') {
      const { requestId, request } = message.params;
      try {
        if (livePublic) {
          // A fresh guest profile, public reads only. Block every mutation,
          // including any unexpected analytics/auth/payment POST.
          await command(['GET', 'HEAD', 'OPTIONS'].includes(request.method) ? 'Fetch.continueRequest' : 'Fetch.failRequest',
            ['GET', 'HEAD', 'OPTIONS'].includes(request.method) ? { requestId } : { requestId, errorReason: 'BlockedByClient' });
          return;
        }
        // Intercept every API origin before any request is sent. Test tokens,
        // checkout actions and payment requests never reach a real backend.
        if (new URL(request.url).pathname.startsWith('/api/')) {
          if (request.method === 'OPTIONS') {
            await command('Fetch.fulfillRequest', { requestId, responseCode: 204, responseHeaders: [{ name: 'Access-Control-Allow-Origin', value: origin }, { name: 'Access-Control-Allow-Headers', value: 'authorization,content-type' }, { name: 'Access-Control-Allow-Methods', value: 'GET,POST,PUT,PATCH,DELETE,OPTIONS' }] });
            return;
          }
          let body = fixture(request.url), status = 200;
          if (new URL(request.url).pathname === '/api/auth/me' && Object.values(request.headers).includes('Bearer seller-browser-fixture-token')) body = { success: true, userType: 'user', sessionRole: 'seller', profile: { _id: 'seller-account-fixture', roles: ['buyer', 'seller'] } };
          if (new URL(request.url).pathname === '/api/auth/me' && Object.values(request.headers).includes('Bearer admin-browser-fixture-token')) body = { success:true,userType:'admin',profile:{_id:'507f1f77bcf86cd799439028',role:'superAdmin'} };
          if (new URL(request.url).pathname === '/api/auth/me' && Object.values(request.headers).includes('Bearer rider-browser-fixture-token')) body = { success:true,userType:'user',sessionRole:'delivery',profile:{...customer,roles:['delivery']} };
          if (new URL(request.url).pathname === '/api/auth/me' && startupOnly) {
            authRequests++;
            await pause(1800);
            if (startupScenario === 'expired') { status = 401; body = { success: false }; }
            if (startupScenario === 'failed') { status = 500; body = { success: false }; }
            authSettled = true;
          }
          await command('Fetch.fulfillRequest', { requestId, responseCode: status, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }, { name: 'Access-Control-Allow-Origin', value: origin }, { name: 'Access-Control-Allow-Headers', value: 'authorization,content-type' }], body: Buffer.from(JSON.stringify(body)).toString('base64') });
        }
        else if (request.url.startsWith(origin) || request.url.startsWith('data:')) await command('Fetch.continueRequest', { requestId });
        else await command('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' });
      } catch (error) { if (!error.message.includes('Invalid InterceptionId')) errors.push(error.message); }
    }
  };
  await command('Page.enable'); await command('Runtime.enable'); await command('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
  await command('Page.addScriptToEvaluateOnNewDocument', { source: locationOnly ? `if(!sessionStorage.getItem('location-fixture')) {localStorage.clear();sessionStorage.clear();sessionStorage.setItem('location-fixture','1');} window.fixtureGpsCalls=0;const originalGps=navigator.geolocation.getCurrentPosition.bind(navigator.geolocation);navigator.geolocation.getCurrentPosition=(...args)=>{window.fixtureGpsCalls++;return originalGps(...args);};` : livePublic ? `localStorage.setItem('locationAsked','true');` : `if(location.search.includes('guest')) {localStorage.removeItem('userToken');localStorage.removeItem('userProfile');localStorage.removeItem('sellerToken');localStorage.removeItem('sellerUserProfile');} else {localStorage.setItem('sellerToken','seller-browser-fixture-token');localStorage.setItem('adminToken','admin-browser-fixture-token');localStorage.setItem('userToken',location.pathname.startsWith('/delivery')?'rider-browser-fixture-token':'browser-fixture-token'); localStorage.setItem('userProfile',${JSON.stringify(JSON.stringify(customer))});} localStorage.setItem('locationAsked','true');` });
  const selectedWidth = Number(process.argv.find(arg => arg.startsWith('--width='))?.split('=')[1]);
  const widths = selectedWidth ? [selectedWidth] : allPortals ? [320,360,390,430,768,1280] : livePublic ? [360, 440, 1280] : startupOnly ? [390] : dialogsOnly ? [320, 390] : audit ? [320, 440, 1280] : [320, 360, 375, 390, 412, 440, 768, 1280, 1440];
  if (locationOnly) {
    await command('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
    await command('Page.navigate',{url:origin+'/'});
    await waitFor(`!!document.querySelector('[aria-label="Choose your location"]')`);
    assert.equal(await evaluate('window.fixtureGpsCalls'),0);
    await evaluate(`document.querySelector('[aria-label="Dismiss location selection"]').click()`);
    await command('Page.reload'); await waitFor(`!!document.querySelector('.header-address-block')`); await pause(250);
    assert.equal(await evaluate(`!!document.querySelector('[aria-label="Choose your location"]')`),false);
    await command('Browser.setPermission',{permission:{name:'geolocation'},setting:'denied',origin});
    await evaluate(`document.querySelector('.header-address-block').click()`);
    await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Allow Location Access')).click()`);
    await waitFor(`!!document.querySelector('input[placeholder="Search for area, street name.."]')`);
    assert.equal(await evaluate(`sessionStorage.getItem('bulkimart:browsing-location')`),null);
    await evaluate(`document.querySelector('input[placeholder="Search for area, street name.."]').focus()`);
    await command('Input.insertText',{text:'Fixture manual area'});
    await evaluate(`document.querySelector('[aria-label="Choose your location"] form').requestSubmit()`);
    await waitFor(`!document.querySelector('[aria-label="Choose your location"]')`);
    await command('Page.reload'); await waitFor(`document.querySelector('.header-address-block')?.textContent.includes('Fixture manual area')`);
    await command('Browser.setPermission',{permission:{name:'geolocation'},setting:'granted',origin});
    await command('Emulation.setGeolocationOverride',{latitude:19.1,longitude:72.9,accuracy:10});
    await evaluate(`document.querySelector('.header-address-block').click()`);
    await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Allow Location Access')).click()`);
    await waitFor(`!document.querySelector('[aria-label="Choose your location"]')`);
    assert.equal(await evaluate(`JSON.parse(sessionStorage.getItem('bulkimart:browsing-location')).coords.lat`),19.1);
    await command('Page.reload');await waitFor(`!!document.querySelector('.header-address-block')`);await pause(250);
    assert.equal(await evaluate(`!!document.querySelector('[aria-label="Choose your location"]')`),false);
    assert.equal(await evaluate('window.fixtureGpsCalls'),0);
    await command('Browser.setPermission',{permission:{name:'geolocation'},setting:'denied',origin});
    await waitFor(`!sessionStorage.getItem('bulkimart:browsing-location')`);
    rows.push({scenario:'location-dismiss-deny-manual-grant-refresh-revoke',viewport:390,passed:true,realGps:false});
  }
  for (const width of locationOnly ? [] : widths) {
    await command('Emulation.setDeviceMetricsOverride', { width, height: 956, deviceScaleFactor: 1, mobile: width <= 440 });
    const paths = allPortals ? ['/', '/account?guest=1', '/cart', '/checkout', '/seller', '/seller/orders', '/seller/orders/507f1f77bcf86cd799439022', '/admin/products', '/admin/products/'+product._id, '/delivery/dashboard', '/delivery/profile'] : livePublic ? ['/', '/seller', '/checkout'] : startupOnly ? ['/?guest=startup', '/?startup=slow', '/?startup=expired', '/?startup=failed'] : sellerOnly ? ['/seller?guest=1', '/seller', '/seller/orders', '/seller/products'] : dialogsOnly ? ['/cart?layout=message', '/search?layout=image'] : ['/', '/search', '/cart', '/checkout', '/checkout?layout=address', '/account', '/account?guest=1', '/account?guest=register', '/account?guest=otp'];
    for (const path of paths) {
      console.log(`Checking ${width}px ${path}`);
      startupScenario = new URL(path, origin).searchParams.get('startup') || 'guest'; authRequests = 0; authSettled = false;
      await command('Page.navigate', { url: origin + path });
      await waitFor(`!!document.querySelector('.user-landing-page-container,.auth-page-container,.seller-auth-page,.seller-dashboard-layout,.sa-layout-container,.delivery-app-container') && !document.querySelector('.customer-splash')`);
      if (startupOnly) {
        const publicMs = await evaluate('Math.round(performance.now())');
        if (startupScenario !== 'guest') assert.equal(authSettled, false, 'Public shell renders before slow verification finishes');
        rows.push({ path, viewport: width, publicMs, verificationDelayMs: startupScenario === 'guest' ? 0 : 1800 });
        if (startupScenario !== 'guest') await waitFor(`!!localStorage.getItem('userProfile') && ${startupScenario === 'slow' ? "!document.body.innerText.includes('Unable to verify')" : 'true'}`);
        await pause(1900);
        assert.equal(authRequests, startupScenario === 'guest' ? 0 : 1, 'One startup verification per session');
        continue;
      }
      await pause(250);
      if (path.includes('layout=message')) {
        await waitFor(`!![...document.querySelectorAll('button')].find(b => b.textContent.includes('Add message'))`);
        await evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('Add message')).click()`);
        await waitFor(`!!document.querySelector('textarea')`);
      }
      if (path.includes('layout=image')) {
        await evaluate(`document.querySelector('[aria-label="Search by image"]').click()`);
        await waitFor(`!!document.querySelector('.image-search-sheet')`);
      }
      if (path.includes('layout=address')) {
        await waitFor(`!![...document.querySelectorAll('button')].find(b => b.textContent.includes('+ Add New'))`);
        await evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('+ Add New')).click()`);
        await waitFor(`!!document.querySelector('#checkout-house')`);
      }
      if (path.includes('guest=register')) {
        await evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Register').click()`);
        await waitFor(`!!document.querySelector('#name')`);
      }
      if (path.includes('guest=otp')) {
        await evaluate(`document.querySelector('#phone').focus()`);
        await command('Input.insertText', { text: '9876500000' });
        await pause(50);
        await evaluate(`document.querySelector('.auth-submit-btn').click()`);
        await waitFor(`!!document.querySelector('.auth-otp-input')`);
      }
      await pause(100);
      if (sellerOnly && !path.includes('guest')) {
        await waitFor(`!!document.querySelector('.seller-main-content .seller-push-control button')`);
        const pushLayout = await evaluate(`(() => {
          const control = document.querySelector('.seller-push-control');
          const button = control.querySelector('button');
          const rect = button.getBoundingClientRect();
          const main = document.querySelector('.seller-main-content').getBoundingClientRect();
          return { height: rect.height, width: rect.width, left: rect.left, right: rect.right, mainLeft: main.left, mainRight: main.right, flex: getComputedStyle(button).flexGrow };
        })()`);
        assert.ok(pushLayout.height >= 36 && pushLayout.height <= 48, `Compact push button height: ${JSON.stringify(pushLayout)}`);
        assert.ok(pushLayout.width <= 270, 'Push button must not expand to fill the main area');
        assert.ok(pushLayout.left >= pushLayout.mainLeft && pushLayout.right <= Math.min(width, pushLayout.mainRight), 'Push control stays inside main content, beside no sidebar');
        assert.equal(pushLayout.flex, '0');
      }
      const measure = await evaluate(`(() => {
        const visible = el => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
        const controls = [...document.querySelectorAll('input,select,textarea')].filter(el => visible(el) && !['radio','checkbox','hidden','range','button','submit','reset','color'].includes(el.type));
        return { width: innerWidth, root: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth, scale: visualViewport?.scale,
          shellHeight: document.querySelector('.user-landing-page-container,.auth-page-container,.seller-app-container,.sa-layout-container,.delivery-app-container').getBoundingClientRect().height,
          controls: controls.map(el => ({ name: el.placeholder || el.name || el.type, size: parseFloat(getComputedStyle(el).fontSize), width: el.getBoundingClientRect().width })),
          wide: [...document.querySelectorAll('main,section,form,.profile-menu-card,.checkout-content,.unified-header-container,.product-grid,.seller-header-row,.seller-tab-content-container,.seller-kpi-grid')].filter(visible).filter(el => el.getBoundingClientRect().right > innerWidth+1 || el.getBoundingClientRect().left < -1).map(el => el.className),
          drawerOpen: !!document.querySelector('.seller-sidebar-backdrop') && getComputedStyle(document.querySelector('.seller-sidebar-backdrop')).display !== 'none',
          ${livePublic ? '' : 'body: document.body.innerText.slice(0,120)'} };
      })()`);
      rows.push({ viewport: width, path, ...measure });
      if (!audit) {
        assert.ok(measure.scroll <= width + 1, `${width} ${path}: page overflow ${JSON.stringify(measure)}`);
        assert.deepEqual(measure.wide, [], `${width} ${path}: overflowing layout`);
        assert.equal(measure.scale, 1, `${width} ${path}: initial scale`);
        if (width <= 440) for (const control of measure.controls) assert.ok(control.size >= 16, `${width} ${path}: undersized control ${JSON.stringify(control)}`);
        if (sellerOnly && !path.includes('guest') && width < 768) assert.equal(measure.drawerOpen, false, 'Mobile navigation starts closed');
        if (path.includes('guest=otp') && width <= 768) assert.equal(measure.controls[0].size, 28, 'OTP keeps its large type');
        // A shortened viewport approximates available keyboard space; it does
        // not emulate an actual mobile keyboard or Safari focus zoom.
        if (width <= 430 && (path.includes('layout=address') || path.includes('guest=register'))) {
          await command('Emulation.setDeviceMetricsOverride', { width, height: 420, deviceScaleFactor: 1, mobile: true });
          const resized = await evaluate(`(() => {
            const shell=document.querySelector('.auth-page-container,.user-landing-page-container');
            const input=document.querySelector('#checkout-pincode,#email');input.focus();input.scrollIntoView({block:'center'});
            return {height:shell.getBoundingClientRect().height, width:document.documentElement.scrollWidth, scale:visualViewport.scale};
          })()`);
          assert.equal(resized.height, 420, 'Mobile shell follows resized viewport');
          assert.ok(resized.width <= width + 1, 'Focused form fits narrow viewport');
          assert.equal(resized.scale, 1);
          await command('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: true });
        }
        if (path.includes('layout=message') || path.includes('layout=image')) {
          await command('Emulation.setDeviceMetricsOverride', { width, height: 320, deviceScaleFactor: 1, mobile: true });
          const dialog = await evaluate(`(() => {const el=document.querySelector('.image-search-sheet') || document.querySelector('textarea').parentElement; const r=el.getBoundingClientRect();return {top:r.top,bottom:r.bottom};})()`);
          assert.ok(dialog.top >= 0 && dialog.bottom <= 321, `Dialog must fit shortened viewport: ${JSON.stringify(dialog)}`);
          await command('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: true });
        }
      }
    }
  }
  const artifacts = resolve('../test-artifacts/mobile-layout'); await mkdir(artifacts, { recursive: true });
  await writeFile(join(artifacts, locationOnly ? 'location.json' : allPortals ? 'portals.json' : livePublic ? 'live-public.json' : startupOnly ? 'startup.json' : sellerOnly ? (audit ? 'seller-baseline.json' : 'seller-results.json') : audit ? 'baseline.json' : dialogsOnly ? 'dialogs.json' : 'results.json'), JSON.stringify({ rows, errors }, null, 2));
  console.log(JSON.stringify({ audit, checks: rows.length, rows: audit ? rows : undefined, errors }, null, 2));
  if (!audit) assert.deepEqual(errors, [], 'Unexpected application errors in browser fixtures');
} finally {
  socket?.close(); browser.kill();
  vite.httpServer.closeAllConnections?.();
  await new Promise(resolve => vite.httpServer.close(resolve));
  for (const task of pending.values()) task.reject(new Error('Browser closed')); pending.clear();
  // Only remove this test's generated profile, never an existing user profile.
  assert.equal(dirname(resolve(profileDir)), resolve(tmpdir())); assert.ok(basename(profileDir).startsWith('bulkimart-mobile-browser-'));
  await pause(300); await rm(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}
