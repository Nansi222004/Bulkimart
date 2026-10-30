import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { createServer } from 'vite';

const executable = process.env.CHROME_BIN || ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
assert.ok(executable, 'Installed browser required');
const temp = await mkdtemp(join(tmpdir(), 'bulkimart-parcel-journey-')), profilePath = join(temp, 'profile'), artifacts = resolve('../test-artifacts/parcel-journey');
await mkdir(profilePath); await mkdir(artifacts, { recursive: true });
const allowed = new Set(['systemroot','windir','comspec','path','pathext','temp','tmp','userprofile','localappdata','appdata','homedrive','homepath','lang','number_of_processors','processor_architecture','os']);
const env = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => allowed.has(key.toLowerCase()))), NODE_ENV: 'test' };
const backend = spawn(process.execPath, [fileURLToPath(new URL('../../backend/verification/parcel-journey-server.mjs', import.meta.url))], { env, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
let serverErrors = '', fixture, vite, browser, socket, sequence = 0, origin, dropBookingResponse = false, lastQuoteInput, lastBookingInput;
backend.stderr.on('data', chunk => serverErrors += chunk);
const pending = new Map(), errors = [], checks = [], delay = ms => new Promise(r => setTimeout(r, ms));
function command(method, params = {}) {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(Error('CDP timeout: ' + method)); }, 15000);
    pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) { const r = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; }
async function waitFor(expression) { for (let i = 0; i < 150; i++) { if (await evaluate(expression)) return; await delay(100); } throw Error('Condition timed out: ' + expression + '\n' + await evaluate('document.body?.innerText||""')); }
const waitText = text => waitFor('document.body?.innerText.includes(' + JSON.stringify(text) + ')');
async function click(text) { await waitFor('[...document.querySelectorAll("button")].some(b=>b.textContent.trim()===' + JSON.stringify(text) + '&&!b.disabled)'); await evaluate('[...document.querySelectorAll("button")].find(b=>b.textContent.trim()===' + JSON.stringify(text) + '&&!b.disabled).click()'); await delay(100); }
async function field(selector, value) {
  await evaluate('(()=>{const e=document.querySelector(' + JSON.stringify(selector) + ');if(!e)throw Error("Missing field");const p=e instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:e instanceof HTMLSelectElement?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(p,"value").set.call(e,' + JSON.stringify(value) + ');e.dispatchEvent(new Event(e instanceof HTMLSelectElement?"change":"input",{bubbles:true}));})()'); await delay(50);
}
const named = (name, value) => field('[name="' + name + '"]', value);
const stats = async () => (await fetch('http://127.0.0.1:' + fixture.port + '/__fixture/stats')).json();
const routeFailure = fail => fetch('http://127.0.0.1:' + fixture.port + '/__fixture/route-failure', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fail }) });
const screenshot = async name => writeFile(join(artifacts, name + '.png'), Buffer.from((await command('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
const checked = label => { checks.push(label); console.log('Passed: ' + label); };
try {
  fixture = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Isolated backend startup timeout')), 60000);
    backend.once('message', m => { clearTimeout(timer); resolve(m); }); backend.once('exit', () => { clearTimeout(timer); reject(Error('Isolated backend exited: ' + serverErrors.slice(-1200))); });
  });
  assert.equal(fixture.ready, true);
  vite = await createServer({ envDir: false, define: { 'import.meta.env.VITE_API_URL': '""', 'import.meta.env.VITE_API_BASE_URL': '""', 'import.meta.env.VITE_GOOGLE_MAPS_API_KEY': '"synthetic-browser-key"' }, cacheDir: join(temp, 'vite-cache'), server: { host: '127.0.0.1', port: 0, hmr: false }, plugins: [{
    name: 'isolated-parcel-journey',
    configureServer(server) { server.middlewares.use(async (req, res, next) => {
      if (req.url === '/__fixture/session') { res.setHeader('Content-Type','application/json'); return res.end(JSON.stringify({ token: fixture.token, profile: fixture.profile })); }
      if (req.url.startsWith('/api/')) {
        let raw = ''; for await (const chunk of req) raw += chunk;
        if (req.url.endsWith('/quotes') && raw) lastQuoteInput = JSON.parse(raw);
        if (req.url === '/api/parcel-delivery/bookings' && raw) lastBookingInput = JSON.parse(raw);
        const result = await fetch('http://127.0.0.1:' + fixture.port + req.url, { method: req.method, headers: { ...(req.headers.authorization ? { Authorization: req.headers.authorization } : {}), ...(req.headers['idempotency-key'] ? { 'Idempotency-Key': req.headers['idempotency-key'] } : {}), ...(raw ? { 'Content-Type': 'application/json' } : {}) }, ...(raw ? { body: raw } : {}) });
        const body = await result.text();
        // Simulate an intermediary losing a successful confirmation response.
        // A raw socket close is retried automatically by Chrome before fetch sees it.
        if (dropBookingResponse && req.method === 'POST' && req.url === '/api/parcel-delivery/bookings' && result.status === 201) { dropBookingResponse = false; res.statusCode = 503; res.setHeader('Content-Type','application/json'); return res.end(JSON.stringify({success:false,message:'Synthetic confirmation response interrupted after local creation'})); }
        res.statusCode = result.status; res.setHeader('Content-Type', 'application/json'); return res.end(body);
      }
      if (req.url === '/' || req.url.startsWith('/parcel-delivery')) {
        res.setHeader('Content-Type', 'text/html');
        return res.end(await server.transformIndexHtml(req.url, '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0"><div id="root"></div><script type="module" src="/verification/parcel-journey-entry.jsx"></script></body></html>'));
      }
      next();
    }); },
  }] });
  await vite.listen(); origin = 'http://127.0.0.1:' + vite.httpServer.address().port;
  browser = spawn(executable, ['--headless=new', '--disable-gpu', '--remote-debugging-port=0', '--user-data-dir=' + profilePath, '--no-first-run', '--disable-background-networking', '--disable-sync', 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  let port; for (let i = 0; i < 100; i++) { try { port = Number((await readFile(join(profilePath,'DevToolsActivePort'),'utf8')).split('\n')[0]); break; } catch { await delay(100); } }
  assert.ok(port);
  const target = (await (await fetch('http://127.0.0.1:' + port + '/json/list')).json()).find(t => t.type === 'page');
  socket = new WebSocket(target.webSocketDebuggerUrl); await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }));
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.id) { const p = pending.get(message.id); pending.delete(message.id); message.error ? p?.reject(Error(message.error.message)) : p?.resolve(message.result); }
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
    if (message.method === 'Fetch.requestPaused') { const local = new URL(message.params.request.url).origin === origin; void command(local ? 'Fetch.continueRequest' : 'Fetch.failRequest', { requestId: message.params.requestId, ...(local ? {} : { errorReason: 'BlockedByClient' }) }).catch(e => errors.push(e.message)); }
  });
  socket.addEventListener('close', () => { for (const p of pending.values()) p.reject(Error('Browser connection closed')); pending.clear(); });
  await command('Page.enable'); await command('Runtime.enable'); await command('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
  await command('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await command('Browser.grantPermissions', { origin, permissions: ['geolocation'] });
  await command('Emulation.setGeolocationOverride', { latitude: 12.97, longitude: 77.59, accuracy: 20 });
  await command('Page.navigate', { url: origin + '/parcel-delivery/book?guest=1' }); await waitText('Sign in to Bulkimart');
  assert.equal(await evaluate('document.querySelectorAll("form").length'), 0); checked('Guest cannot open booking form');
  await command('Page.navigate', { url: origin + '/' }); await waitFor('!!document.querySelector(".customer-parcel-card a.service-book")');
  await evaluate('document.querySelector(".customer-parcel-card a.service-book").click()'); await waitText('Confirm locations'); checked('Existing home service card opens the real booking component');
  assert.equal(await evaluate('[...document.querySelectorAll("button")].find(b=>b.textContent==="Confirm locations").disabled'), true);
  await field('input[role="combobox"]', 'Synthetic drop');
  await waitText('Synthetic drop, Bengaluru 560001'); await click('Synthetic drop, Bengaluru 560001'); await click('Use this location');
  checked('Debounced Places selection resolves destination and requires confirmation');
  await click('Choose location');
  const lookupsBefore = await stats();
  await field('input[role="combobox"]', 'Synthetic postcode preservation'); await click('Find address'); await waitText('Use this location');
  assert.ok(await evaluate('document.querySelector(".parcel-location-result").textContent.includes("Pincode: 452015")'));
  await click('Use this location');
  assert.ok(await evaluate('document.querySelector(".pickup").textContent.includes("Pincode: 452015")'));
  const lookupsAfter = await stats(); assert.equal(lookupsAfter.forwardLookups, lookupsBefore.forwardLookups + 1); assert.equal(lookupsAfter.reverseLookups, lookupsBefore.reverseLookups);
  checked('Forward address postcode survives confirmation without a conflicting reverse lookup');
  await evaluate('document.querySelector(".pickup button").click()');
  await click('Use current location'); await waitText('Use this location'); await click('Use this location');
  checked('Browser geolocation override passes through the real reverse-geocoding endpoint');
  await evaluate('document.querySelector("[aria-label=\\"Switch pickup and drop locations\\"]").click()'); await delay(100);
  assert.ok(await evaluate('document.querySelector(".pickup").textContent.includes("Synthetic drop")'));
  await evaluate('document.querySelector("[aria-label=\\"Switch pickup and drop locations\\"]").click()'); checked('Switch exchanges locations and associated details');
  await evaluate('document.querySelector(".pickup button").click()'); await waitText('Choose pickup location');
  await waitFor('window.__mapFixture.maps.at(-1)?.events.click!==undefined');
  await evaluate('window.__mapFixture.maps.at(-1).events.click({latLng:{lat:()=>12.971,lng:()=>77.591}})'); await waitText('Use this location'); await click('Use this location');
  checked('Map pin adjustment reverse geocodes and requires confirmation');
  await screenshot('locations-390'); await click('Confirm locations');
  assert.equal(await evaluate('document.querySelector("[name=\\"pickup.name\\"]").value'), 'Synthetic Sender');
  await named('pickup.building', 'Flat 12'); await named('dropoff.name', 'Synthetic Recipient'); await named('dropoff.phone', '9876500022');
  await named('description', 'Synthetic documents'); await named('weightKg', '1'); await named('length', '10'); await named('width', '12'); await named('height', '2');
  await evaluate('document.querySelector(".parcel-check input[type=checkbox]").click()');
  await click('Save pickup to my addresses'); await waitText('Pickup location saved');
  assert.equal((await stats()).addresses, 2); checked('Pickup contact prefill, independent recipient details and existing saved-address persistence');
  await named('dropoff.pincode', '999999'); await click('Confirm drop details'); await waitText('outside approved service areas');
  assert.equal((await stats()).routeCalls, 0); checked('Real server coverage validation rejects addresses before any Google route request');
  await named('dropoff.pincode', '560001'); await routeFailure(true); await click('Confirm drop details'); await waitText('Verified route provider unavailable');
  assert.equal((await stats()).quotes, 0); checked('Route failure produces a recoverable error without a fabricated fare');
  await routeFailure(false); await click('Confirm drop details'); await waitText('Review fare');
  assert.equal(lastQuoteInput.pickup.lat, 12.971); assert.equal(lastQuoteInput.dropoff.phone, '9876500022');
  assert.ok(await evaluate('document.body.innerText.includes("₹24.63") && document.body.innerText.includes("7.32 km") && document.body.innerText.includes("18 min")'));
  assert.equal(await evaluate('window.__mapFixture.routes>0'), true);
  assert.equal((await stats()).bookings, 0); checked('Server-calculated price, duration, route geometry and supported service displayed before booking');
  for (const width of [320, 390, 768, 1440]) {
    await command('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: width < 768 });
    assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'), true, 'Route overflow ' + width);
    const geometry = await evaluate('(()=>{const e=document.querySelector(".parcel-primary"),r=e.getBoundingClientRect();return {height:r.height,width:r.width}})()');
    assert.ok(geometry.height >= 44 && geometry.width > 200); await screenshot('delivery-' + width);
  }
  checked('Route/service screen fits 320/390/768/1440px with touch-sized booking actions');
  await command('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await click('Review fare · ₹24.63'); await waitText('Review your booking');
  // The action bar sits in the page flow after the form: it never floats over the fields above it.
  assert.equal(await evaluate('(()=>{const bar=document.querySelector(".parcel-sticky-action"),form=document.querySelector("#parcel-booking-review");bar.scrollIntoView({block:"end"});const b=bar.getBoundingClientRect(),f=form.getBoundingClientRect();return getComputedStyle(bar).position==="static"&&b.top>=f.bottom-1&&b.bottom<=innerHeight+1})()'), true, 'Booking action is part of the page and does not cover the review form');
  await evaluate('document.querySelector("input[value=pay_driver]").click()');
  await waitFor('!!document.querySelector("input[name=cashCollectionPoint][value=pickup]")');
  for (const width of [320,390,768,1440]) {
    await command('Emulation.setDeviceMetricsOverride', { width, height:844, deviceScaleFactor:1, mobile:width<768 });
    const geometry=await evaluate('(()=>{const labels=[...document.querySelectorAll(".parcel-payment-options .parcel-check")];return {overflow:document.documentElement.scrollWidth>innerWidth+1,rows:labels.map(e=>{const r=e.getBoundingClientRect(),input=e.querySelector("input").getBoundingClientRect(),text=e.querySelector("span").getBoundingClientRect();return {height:r.height,radioWidth:input.width,radioHeight:input.height,textWidth:text.width};})}})()');
    assert.equal(geometry.overflow,false);assert.equal(geometry.rows.length,4);
    for(const row of geometry.rows){assert.ok(row.radioWidth>=16&&row.radioWidth<=24);assert.ok(row.radioHeight>=16&&row.radioHeight<=24);assert.ok(row.textWidth>100);assert.ok(row.height<150,'Payment text must remain readable instead of wrapping letter by letter');}
  }
  checked('Payment and pickup/drop options stay readable at 320/390/768/1440px with compact radio controls');
  await command('Emulation.setDeviceMetricsOverride', {width:390,height:844,deviceScaleFactor:1,mobile:true});
  await evaluate('document.querySelector("input[name=cashCollectionPoint][value=pickup]").click()');
  await waitText('sender pays before handover');
  await evaluate('document.querySelector(".parcel-payment-options").scrollIntoView({block:"start"})');
  await screenshot('payment-pickup-390');
  await evaluate('document.querySelector("input[type=checkbox]").click()');
  await waitFor('[...document.querySelectorAll("button")].some(b=>b.textContent.startsWith("Book Parcel")&&!b.disabled)');
  await screenshot('fare-review-390'); dropBookingResponse = true;
  assert.deepEqual(await evaluate('[...document.querySelectorAll("form input")].filter(e=>!e.validity.valid).map(e=>({name:e.name,type:e.type,message:e.validationMessage}))'), [], 'Reviewed booking form must be valid');
  await evaluate('(()=>{const b=[...document.querySelectorAll("button")].find(b=>b.textContent.startsWith("Book Parcel"));b.click();b.click()})()');
  await waitText('Retry booking safely'); assert.equal((await stats()).bookings, 1);
  assert.equal(lastBookingInput.cashCollectionPoint,'pickup');
  await command('Page.reload'); await waitText('Retry booking safely'); await click('Retry booking safely');
  await waitText('Booking received'); await waitText('We’re arranging your pickup');
  await waitText('Cash at pickup');assert.equal(lastBookingInput.cashCollectionPoint,'pickup');
  checked('Pickup payer choice is persisted by the real booking API and retained through timeout/reload recovery');
  assert.equal((await stats()).bookings, 1); checked('Lost response, double tap and browser reload recover the same real local booking');
  assert.ok(await evaluate('document.body.innerText.includes("Cash at pickup") && document.body.innerText.includes("₹24.63")'));
  await screenshot('success-390'); checked('Success shows server reference, cash status and truthful pending assignment');
  await click('Delivery history'); await waitText('PD-'); assert.equal(await evaluate('document.querySelectorAll(".parcel-row").length'), 1);
  checked('Real owned delivery history includes exactly one booking');
  assert.equal(await evaluate('window.__mapFixture.maps.every(m=>Object.keys(m.events).length===0)&&window.__mapFixture.markers.every(m=>m.options.map===null)'), true);
  checked('Leaving the map cleans up all markers and listeners');
  const finalStats = await stats(); assert.equal(finalStats.blockedNetworkCalls, 0); assert.deepEqual(errors, []);
  const result = { checksPassed: checks.length, checks, stats: finalStats, browserErrors: errors, externalMaps: 'mocked Google boundaries', browserSandbox: 'normal', realCustomerBookings: 0, liveProviderCalls: 0 };
  await writeFile(join(artifacts,'results.json'), JSON.stringify(result,null,2)); console.log(JSON.stringify({ checksPassed: checks.length, failures: 0, stats: finalStats }));
} finally {
  socket?.close(); browser?.kill(); await vite?.close();
  if (backend.connected) { backend.send({ action: 'stop' }); await Promise.race([new Promise(resolve => backend.once('exit', resolve)), delay(15000)]); }
  if (backend.exitCode === null) backend.kill();
  assert.equal(dirname(resolve(temp)), resolve(tmpdir())); assert.ok(basename(temp).startsWith('bulkimart-parcel-journey-'));
  for (let i = 0; i < 15; i++) { try { await rm(temp, { recursive: true, force: true }); break; } catch { await delay(200); } }
}
