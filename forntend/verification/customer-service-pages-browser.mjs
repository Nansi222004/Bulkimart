import assert from 'node:assert/strict';
import { preview } from 'vite';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

// Test the production application, including routing, session gate and storefront shell.
// All API origins are intercepted; no fixture credentials or writes reach a backend.
const exe = process.env.CHROME_BIN || ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
assert.ok(exe, 'Chrome or Edge required');
const profile = await mkdtemp(join(tmpdir(), 'bulkimart-service-layout-'));
const output = resolve('../test-artifacts/customer-service-pages');
await mkdir(output, { recursive: true });
const server = await preview({ preview: { host: '127.0.0.1', port: 0 } });
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
const browser = spawn(exe, ['--headless=new', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--disable-background-networking', 'about:blank'], { windowsHide: true, stdio: 'ignore' });
const pause = ms => new Promise(r => setTimeout(r, ms));
let socket, seq = 0, scenario = 'empty';
const pending = new Map(), errors = [], views = [], writes = [];
const id = '507f1f77bcf86cd799439022';
const customer = { _id: id, name: 'Fixture customer', phone: '9876500011', roles: ['buyer'], addresses: [] };
const policy = { version: 1, areas: [{ name: 'Test area' }], categories: ['Documents'], prohibitedItems: ['Restricted goods'], maxWeightKg: 5, maxDimensionCm: 50, ready: true };
const booking = { _id: id, reference: 'PD-LAYOUT-TEST', status: 'delivered', feePaise: 100, paymentMethod: 'online', paymentStatus: 'paid', cash: { status: 'none' }, refund: { status: 'none' }, details: { pickup: { address: 'Test pickup' }, dropoff: { address: 'Test destination' } }, history: [] };
function command(method, params = {}) {
  const n = ++seq;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(n); reject(Error('CDP timeout: ' + method)); }, 15000);
    pending.set(n, { resolve: r => { clearTimeout(timer); resolve(r); }, reject: e => { clearTimeout(timer); reject(e); } });
    socket.send(JSON.stringify({ id: n, method, params }));
  });
}
async function evaluate(expression) {
  const r = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails));
  return r.result.value;
}
async function wait(expression) {
  for (let i = 0; i < 150; i++) { if (await evaluate(expression)) return; await pause(100); }
  throw Error('Page did not settle: ' + expression + '\n' + await evaluate('document.body.innerText'));
}
const waitText = value => wait(`document.body?.innerText.includes(${JSON.stringify(value)})`);
async function navigate(path, ready) { await command('Page.navigate', { url: origin + path }); await waitText(ready); }
function fixture(path) {
  if (path === '/api/auth/me') return { success: true, userType: 'user', sessionRole: 'buyer', profile: customer };
  if (path === '/api/users/profile') return { success: true, user: customer };
  if (path === '/api/customer-services/capabilities') return { success: true, data: { catalogue: scenario !== 'disabled', submissions: false } };
  if (path === '/api/customer-services') return { success: true, data: scenario === 'available' ? [{ _id: id, name: 'Legal consultation', description: 'Review the requirements and submit a private request.' }] : [], meta: { total: scenario === 'available' ? 1 : 0 } };
  if (path === '/api/customer-services/catalogue/' + id) return { success: true, data: { _id: id, name: 'Legal consultation', description: 'Review the requirements and submit a private request.', instructions: 'Provide applicant name.', startingPrice: { amount: 100, currency: 'INR' }, formVersion: 1, version: 1, fields: [{ id: 'name', label: 'Applicant name', type: 'text', required: true }] } };
  if (path === '/api/parcel-delivery/capabilities') return { success: true, data: { booking: true, catalogue: true } };
  if (path === '/api/parcel-delivery/catalogue') return { success: true, data: policy };
  if (path === '/api/parcel-delivery/bookings') return { success: true, data: [booking], meta: { pages: 1 } };
  if (path === '/api/parcel-delivery/bookings/' + id) return { success: true, data: booking };
  if (path === '/api/cart/summary') return { success: true, data: {} };
  if (path === '/api/cart/unified') return { success: true, data: { groups: [], totals: { itemCount: 0 } } };
  return { success: true, data: [], meta: { total: 0, pages: 1, unreadCount: 0 } };
}
async function check(width, path, state, ready) {
  scenario = state;
  await navigate(path, ready);
  const geometry = await evaluate(`(() => {
    const page=document.querySelector('.customer-service-page'), main=document.querySelector('.user-main-content'), header=document.querySelector('.unified-header-container'), nav=document.querySelector('.bottom-nav-bar');
    const p=page.getBoundingClientRect(), h=header.getBoundingClientRect();
    return { overflow:document.documentElement.scrollWidth>innerWidth+1 || main.scrollWidth>main.clientWidth+1, gap:p.top-h.bottom, height:p.height, headers:document.querySelectorAll('.unified-header-container').length, navs:document.querySelectorAll('.bottom-nav-bar').length, background:getComputedStyle(page).backgroundColor, minHeight:getComputedStyle(page).minHeight, marginTop:getComputedStyle(page).marginTop, paddingBottom:parseFloat(getComputedStyle(main).paddingBottom), navHeight:nav.getBoundingClientRect().height, headings:page.querySelectorAll('h1').length };
  })()`);
  assert.equal(geometry.overflow, false, `${width} ${path} overflow`);
  assert.equal(geometry.headers, 1); assert.equal(geometry.navs, 1); assert.equal(geometry.headings, 1);
  assert.ok(Math.abs(geometry.gap) < 2, JSON.stringify(geometry));
  assert.equal(geometry.background, 'rgba(0, 0, 0, 0)');
  assert.equal(geometry.minHeight, '0px'); assert.equal(geometry.marginTop, '0px');
  assert.ok(geometry.paddingBottom >= geometry.navHeight, JSON.stringify(geometry));
  if (state !== 'booking') assert.ok(geometry.height < 650, `Unexpected empty page height: ${JSON.stringify(geometry)}`);
  // Scroll the actual app container so the final action is reachable above navigation.
  await evaluate(`document.querySelector('.user-main-content').scrollTo({top:100000,behavior:'instant'})`);
  const scroll = await evaluate(`(() => { const main=document.querySelector('.user-main-content'), page=document.querySelector('.customer-service-page'), nav=document.querySelector('.bottom-nav-bar'); return {bottom:page.getBoundingClientRect().bottom, navTop:nav.getBoundingClientRect().top, scrollHeight:main.scrollHeight, clientHeight:main.clientHeight, top:main.scrollTop}; })()`);
  assert.ok(geometry.navHeight === 0 || scroll.bottom <= scroll.navTop+1 || scroll.scrollHeight<=scroll.clientHeight, `Content hidden behind navigation: ${width} ${state} ${JSON.stringify(scroll)}`);
  await evaluate(`document.querySelector('.user-main-content').scrollTo({top:0,behavior:'instant'})`);
  views.push({ width, path, state, ...geometry });
  if ([320, 390, 768].includes(width)) {
    const shot = await command('Page.captureScreenshot', { format: 'png' });
    await writeFile(join(output, `${state}-${width}.png`), Buffer.from(shot.data, 'base64'));
  }
}
try {
  let port;
  for (let i = 0; i < 100; i++) { try { port = Number((await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); break; } catch { await pause(100); } }
  assert.ok(port, 'Browser failed to start');
  const target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page');
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => { socket.onopen = r; socket.onerror = j; });
  socket.onmessage = async e => {
    const m = JSON.parse(e.data);
    if (m.id) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p?.reject(Error(m.error.message)) : p?.resolve(m.result); return; }
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    if (m.method !== 'Fetch.requestPaused') return;
    const { requestId, request } = m.params, path = new URL(request.url).pathname;
    try {
      if (path.startsWith('/api/')) {
        if (request.method === 'OPTIONS') {
          await command('Fetch.fulfillRequest', { requestId, responseCode: 204, responseHeaders: [{ name: 'Access-Control-Allow-Origin', value: origin }, { name: 'Access-Control-Allow-Headers', value: 'authorization,content-type' }, { name: 'Access-Control-Allow-Methods', value: 'GET,POST,PUT,PATCH,DELETE,OPTIONS' }] });
          return;
        }
        if (!['GET', 'OPTIONS'].includes(request.method)) writes.push(path);
        if (path === '/api/customer-services' && scenario === 'loading') await pause(2000);
        const failed = path === '/api/customer-services' && scenario === 'error';
        const body = failed ? { success: false, message: 'Legal services are currently unavailable. Please try again later.' } : fixture(path);
        await command('Fetch.fulfillRequest', { requestId, responseCode: failed ? 503 : 200, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }, { name: 'Access-Control-Allow-Origin', value: origin }, { name: 'Access-Control-Allow-Headers', value: '*' }], body: Buffer.from(JSON.stringify(body)).toString('base64') });
      } else if (request.url.startsWith(origin)) await command('Fetch.continueRequest', { requestId });
      else await command('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' });
    } catch (e) {
      // Navigating away cancels pending reads (including delayed loading fixtures).
      // CDP then invalidates their interception IDs; this is expected cancellation.
      if (!e.message.includes('Invalid InterceptionId')) errors.push(e.message);
    }
  };
  await command('Page.enable'); await command('Runtime.enable'); await command('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
  await command('Page.addScriptToEvaluateOnNewDocument', { source: `localStorage.clear();sessionStorage.clear();localStorage.setItem('locationAsked','true');if(!location.search.includes('guest') && location.pathname!=='/account')localStorage.setItem('userToken','fixture-only');` });
  for (const width of (process.env.SERVICE_WIDTH ? [Number(process.env.SERVICE_WIDTH)] : [320, 360, 375, 390, 430, 768, 1024])) {
    await command('Emulation.setDeviceMetricsOverride', { width, height: 850, deviceScaleFactor: 1, mobile: width < 768 });
    await check(width, '/legal-services?guest=1', 'empty', 'No eligible services available');
    await check(width, '/legal-services?guest=1', 'available', 'Legal consultation');
    await check(width, '/legal-services?guest=1', 'error', 'Reload latest');
    await waitText('Legal services are currently unavailable. Please try again later.');
    assert.equal(await evaluate(`document.body.innerText.includes('No eligible services available')`), false);
    // Exercise error recovery through the existing reload action.
    scenario = 'available'; await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent==='Reload latest').click()`); await waitText('Legal consultation');
    await check(width, '/legal-services?guest=1', 'loading', 'Loading Legal Services');
    await waitText('No eligible services available');
    await check(width, '/parcel-delivery/book?guest=1', 'guest', 'Sign in to Bulkimart');
    assert.equal(await evaluate(`document.querySelector('.customer-service-action').getAttribute('href')`), '/account');
    await evaluate(`document.querySelector('.customer-service-action').click()`);
    await wait(`location.pathname==='/account'`);
    await check(width, '/parcel-delivery/book', 'booking', 'Calculate delivery fee');
    assert.equal(await evaluate(`document.body.innerText.includes('Sign in to Bulkimart')`), false);
    await check(width, '/parcel-delivery/history', 'history', 'PD-LAYOUT-TEST');
    await evaluate(`document.querySelector('.parcel-row').click()`); await waitText('Test pickup');
    assert.equal(await evaluate('location.pathname'), '/parcel-delivery/track/' + id);
    await check(width, '/parcel-delivery/track/' + id, 'tracking', 'Test pickup');
  }
  await command('Emulation.setDeviceMetricsOverride', { width: 390, height: 850, deviceScaleFactor: 1, mobile: true });
  for (const [state, ready] of [['disabled', 'No customer legal services are currently available'], ['empty', 'No customer legal services are currently available'], ['error', 'Legal services availability could not be checked'], ['available', 'Browse Legal Services']]) {
    scenario = state;
    await navigate('/grocery--home?guest=1', ready);
    assert.equal(await evaluate(`!!document.querySelector('a.service-book[href="/legal-services"]')`), state === 'available');
    views.push({ width: 390, path: '/grocery--home?guest=1', state: 'discovery-' + state });
  }
  await evaluate(`document.querySelector('a.service-book[href="/legal-services"]').click()`);
  await waitText('Legal consultation');
  await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent==='View service').click()`);
  await waitText('Review request'); await waitText('Starting price: INR 100.00');
  assert.equal(await evaluate('location.pathname'), '/legal-services/' + id);
  assert.ok(await evaluate(`!!document.querySelector('#service-field-name[required]')`));
  views.push({ width: 390, path: '/legal-services/' + id, state: 'requirements' });
  assert.deepEqual(errors, []);
  await writeFile(join(output, 'results.json'), JSON.stringify({ passed: true, views, errors, interceptedNonGetRequests: writes }, null, 2));
  console.log(JSON.stringify({ passed: true, responsiveViews: views.length, widths: [...new Set(views.map(v => v.width))], errors }));
} finally { socket?.close(); browser.kill(); await server.close(); }
