import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { existsSync } from 'node:fs';

const audit = process.argv.includes('--audit');
const dialogsOnly = process.argv.includes('--dialogs');
const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const viewport = html.match(/<meta\s+name="viewport"\s+content="([^"]+)"/i)?.[1];
assert.match(viewport || '', /width=device-width/);
assert.match(viewport, /initial-scale=1(?:\.0)?(?:,|$)/);
assert.doesNotMatch(viewport, /maximum-scale|user-scalable\s*=\s*no/i, 'Pinch zoom must remain available');
const executable = process.env.CHROME_BIN || ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(existsSync);
assert.ok(executable, 'Set CHROME_BIN to an installed Chrome/Chromium executable.');
assert.equal(typeof WebSocket, 'function', 'Browser checks require Node with built-in WebSocket support.');
const profileDir = await mkdtemp(join(tmpdir(), 'bulkimart-mobile-browser-'));
const vite = await createServer({ server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false } });
await vite.listen();
const origin = `http://127.0.0.1:${vite.httpServer.address().port}`;
const browser = spawn(executable, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profileDir}`, '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-sync', '--disable-component-update', 'about:blank'], { windowsHide: true, stdio: 'ignore' });
let socket, sequence = 0;
const pending = new Map(), errors = [], rows = [];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const address = { _id: '507f1f77bcf86cd799439019', name: 'Fixture Customer', phone: '9876500000', line1: 'Fixture street', city: 'Mumbai', state: 'Maharashtra', pincode: '400001', lat: 19.11, lng: 72.91, isDefault: true };
const customer = { _id: '507f1f77bcf86cd799439011', name: 'Fixture Customer', phone: '9876500000', roles: ['buyer'], isActive: true, addresses: [address] };
const product = { _id: '507f1f77bcf86cd799439015', name: 'Mobile layout fixture product', price: 100, mrp: 120, stock: 10, type: 'ecommerce', images: ['/vite.svg'], sellerId: '507f1f77bcf86cd799439016', variants: [] };
const line = { ...product, _id: '507f1f77bcf86cd799439017', productId: product._id, qty: 1, lineTotal: 100, fulfillmentType: 'physical' };
const seller = { _id: product.sellerId, name: 'Fixture Store', city: 'Mumbai' };
const pricing = { subtotal: 100, deliveryCharge: 40, totalAmount: 140, standardFee: 40 };
function fixture(raw) {
  const path = new URL(raw).pathname;
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
  for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; await pause(100); }
  throw new Error('Page not ready: ' + expression + '\n' + JSON.stringify(errors.slice(-3)) + '\n' + await evaluate('document.body.innerText'));
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
    if (message.method === 'Fetch.requestPaused') {
      const { requestId, request } = message.params;
      try {
        // Intercept every API origin before any request is sent. Test tokens,
        // checkout actions and payment requests never reach a real backend.
        if (new URL(request.url).pathname.startsWith('/api/')) await command('Fetch.fulfillRequest', { requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }, { name: 'Access-Control-Allow-Origin', value: origin }, { name: 'Access-Control-Allow-Headers', value: 'authorization,content-type' }], body: Buffer.from(JSON.stringify(fixture(request.url))).toString('base64') });
        else if (request.url.startsWith(origin) || request.url.startsWith('data:')) await command('Fetch.continueRequest', { requestId });
        else await command('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' });
      } catch (error) { if (!error.message.includes('Invalid InterceptionId')) errors.push(error.message); }
    }
  };
  await command('Page.enable'); await command('Runtime.enable'); await command('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
  await command('Page.addScriptToEvaluateOnNewDocument', { source: `if(location.search.includes('guest')) {localStorage.removeItem('userToken');localStorage.removeItem('userProfile');} else {localStorage.setItem('userToken','browser-fixture-token'); localStorage.setItem('userProfile',${JSON.stringify(JSON.stringify(customer))});} localStorage.setItem('locationAsked','true');` });
  const widths = dialogsOnly ? [320, 390] : audit ? [320, 390, 430, 1280] : [320, 360, 375, 390, 412, 430, 768, 1280, 1440];
  for (const width of widths) {
    await command('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: width <= 430 });
    const paths = dialogsOnly ? ['/cart?layout=message', '/search?layout=image'] : ['/', '/search', '/cart', '/checkout', '/checkout?layout=address', '/account', '/account?guest=1', '/account?guest=register', '/account?guest=otp'];
    for (const path of paths) {
      console.log(`Checking ${width}px ${path}`);
      await command('Page.navigate', { url: origin + path });
      await waitFor(`!!document.querySelector('.user-landing-page-container,.auth-page-container') && !document.querySelector('.customer-splash')`);
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
      const measure = await evaluate(`(() => {
        const visible = el => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
        const controls = [...document.querySelectorAll('input,select,textarea')].filter(el => visible(el) && !['radio','checkbox','hidden','range','button','submit','reset','color'].includes(el.type));
        return { width: innerWidth, root: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth, scale: visualViewport?.scale,
          shellHeight: document.querySelector('.user-landing-page-container,.auth-page-container').getBoundingClientRect().height,
          controls: controls.map(el => ({ name: el.placeholder || el.name || el.type, size: parseFloat(getComputedStyle(el).fontSize), width: el.getBoundingClientRect().width })),
          wide: [...document.querySelectorAll('main,section,form,.profile-menu-card,.checkout-content,.unified-header-container,.product-grid')].filter(visible).filter(el => el.getBoundingClientRect().right > innerWidth+1 || el.getBoundingClientRect().left < -1).map(el => el.className),
          body: document.body.innerText.slice(0,120) };
      })()`);
      rows.push({ viewport: width, path, ...measure });
      if (!audit) {
        assert.ok(measure.scroll <= width + 1, `${width} ${path}: page overflow ${JSON.stringify(measure)}`);
        assert.deepEqual(measure.wide, [], `${width} ${path}: overflowing layout`);
        assert.equal(measure.scale, 1, `${width} ${path}: initial scale`);
        if (width <= 430) for (const control of measure.controls) assert.ok(control.size >= 16, `${width} ${path}: undersized control ${JSON.stringify(control)}`);
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
  await writeFile(join(artifacts, audit ? 'baseline.json' : dialogsOnly ? 'dialogs.json' : 'results.json'), JSON.stringify({ rows, errors }, null, 2));
  console.log(JSON.stringify({ audit, checks: rows.length, rows: audit ? rows : undefined, errors }, null, 2));
  if (!audit) assert.deepEqual(errors, [], 'Unexpected application errors in browser fixtures');
} finally {
  socket?.close(); browser.kill(); await vite.close();
  for (const task of pending.values()) task.reject(new Error('Browser closed')); pending.clear();
  // Only remove this test's generated profile, never an existing user profile.
  assert.equal(dirname(resolve(profileDir)), resolve(tmpdir())); assert.ok(basename(profileDir).startsWith('bulkimart-mobile-browser-'));
  await pause(300); await rm(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}
