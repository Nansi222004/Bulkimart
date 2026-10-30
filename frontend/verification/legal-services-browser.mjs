import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve, dirname, basename } from 'node:path';
import { tmpdir } from 'node:os';
const exe = process.env.CHROME_BIN || ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
assert.ok(exe, 'Chrome or Edge is required');
const temp = await mkdtemp(join(tmpdir(), 'bulkimart-legal-browser-')), profile = join(temp, 'profile'); await mkdir(profile);
const screenshots = resolve('../test-artifacts/services-ui'); await mkdir(screenshots, { recursive: true });
const id = '507f1f77bcf86cd799439022', serviceId = '507f1f77bcf86cd799439023';
const s = { _id: serviceId, version: 1, name: 'Fixture Legal Service', description: 'Synthetic service for private intake testing only.', instructions: 'Provide only the information needed.', formVersion: 1, fields: [{ id: 'name', label: 'Required name', type: 'text', required: true, help: 'Use the name on your document.' }, { id: 'date', label: 'Preferred date', type: 'date', help: 'Choose a date for this request.' }, { id: 'details', label: 'Additional details', type: 'textarea', help: 'Describe the help you need.' }], startingPrice: { amount: 250, currency: 'INR' } };
// Fixed-price services are paid at submission: an application is "Payment pending" until its fee is verified.
const fee = (amountPaise, paid) => ({ version: 1, amountPaise, currency: 'INR', status: paid ? 'paid' : 'unpaid', terms: 'Synthetic fee and wallet refund terms', ...(paid ? { paymentId: true } : {}) });
const adminApp = { _id: id, __v: 1, applicantType: 'customer', service: serviceId, user: '507f1f77bcf86cd799439099', snapshot: { name: s.name, fields: s.fields, pricing: { mode: 'fixed', amount: 250, currency: 'INR' } }, answers: { name: 'Private fixture' }, files: [], events: [], status: 'submitted', createdAt: '2026-10-22T00:00:00Z', billing: fee(25000, true) };
let writes = 0, customerPhase = 'unpaid', vendorPhase = 'unpaid';
const vendorService = { ...s, __v: 1, pricing: { mode: 'fixed', amount: 100, currency: 'INR' } };
const customerView = () => ({ _id: id, version: 1, serviceName: s.name, status: customerPhase === 'paid' ? 'submitted' : 'awaiting_payment', fields: s.fields, answers: { name: 'Private fixture' }, files: [], events: [], createdAt: '2026-10-22T00:00:00Z', billing: fee(25000, customerPhase === 'paid') });
const vendorView = () => ({ _id: id, __v: 1, status: vendorPhase === 'paid' ? 'submitted' : 'awaiting_payment', snapshot: { name: s.name, pricing: vendorService.pricing, fields: s.fields }, createdAt: '2026-10-22T00:00:00Z', files: [], events: [], billing: fee(10000, vendorPhase === 'paid') });
const vite = await createServer({ define: { 'import.meta.env.VITE_API_BASE_URL': '""', 'import.meta.env.VITE_API_URL': '""' }, cacheDir: join(temp, 'vite-cache'), server: { host: '127.0.0.1', port: 0, hmr: false }, plugins: [{ name: 'isolated-legal-fixtures', configureServer(server) {
  server.middlewares.use(async (req, res, next) => {
    if (req.url.startsWith('/api/')) {
      const p = new URL(req.url, 'http://fixture').pathname;
      if (req.method !== 'GET') {
        writes++; req.resume(); let data;
        if (p === `/api/customer-services/catalogue/${serviceId}/applications`) { customerPhase = 'unpaid'; data = customerView(); }
        else if (p === `/api/services/${serviceId}/applications`) { vendorPhase = 'unpaid'; data = vendorView(); }
        else if (p === `/api/customer-services/applications/${id}/payment` || p === `/api/services/applications/${id}/payment`) data = { orderId: id, amountPaise: p.startsWith('/api/services/') ? 10000 : 25000, currency: 'INR', keyId: 'synthetic-key', razorpayOrderId: 'synthetic-order', verificationPath: p.startsWith('/api/services/') ? '/api/services/payments/verify' : '/api/customer-services/payments/verify' };
        else if (p === '/api/customer-services/payments/verify') { customerPhase = 'paid'; data = { status: 'paid' }; }
        else if (p === '/api/services/payments/verify') { vendorPhase = 'paid'; data = { status: 'paid' }; }
        res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify(data ? { success: true, data } : { success: false, message: 'Browser fixture blocks unrecognized writes' }));
      }
      let data = [], meta = { total: 1, page: 1, limit: 20 };
      if (p === '/api/customer-services') {
        // Ensure each typed character spans a real loading state.
        if (new URL(req.url, 'http://fixture').searchParams.get('q')) await new Promise(resolve => setTimeout(resolve, 80));
        data = [s];
      }
      else if (p === `/api/customer-services/catalogue/${serviceId}`) data = s;
      else if (p === '/api/customer-services/applications') data = [customerView()];
      else if (p.startsWith('/api/customer-services/applications/')) data = customerView();
      else if (p === '/api/services') data = [vendorService];
      else if (p === '/api/services/applications') data = [vendorView()];
      else if (p.startsWith('/api/services/applications/')) data = vendorView();
      else if (p === '/api/admin/services') data = [vendorService];
      else if (p === '/api/admin/services/applications') data = [adminApp];
      else if (p.startsWith('/api/admin/services/applications/')) data = adminApp;
      res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ success: true, data, meta }));
    }
    if (/^\/(legal-services|admin\/services|seller\/services)(\/|\?|$)/.test(req.url)) {
      res.setHeader('Content-Type', 'text/html'); return res.end(await server.transformIndexHtml(req.url, '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Isolated legal fixtures</title></head><body style="margin:0"><div id="root"></div><script type="module" src="/verification/legal-browser-entry.jsx"></script></body></html>'));
    }
    next();
  });
} }] });
await vite.listen(); const origin = `http://127.0.0.1:${vite.httpServer.address().port}`;
const browser = spawn(exe, ['--headless=new', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--disable-background-networking', '--disable-sync', '--disable-component-update', 'about:blank'], { windowsHide: true, stdio: 'ignore' });
let socket, seq = 0; const pending = new Map(), errors = [], rows = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));
function command(method, params = {}) { const id = ++seq; return new Promise((resolve, reject) => { const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout ${method}`)); }, 15000); pending.set(id, { resolve: r => { clearTimeout(timeout); resolve(r); }, reject }); socket.send(JSON.stringify({ id, method, params })); }); }
async function evaluate(expression) { const r = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails)); return r.result.value; }
async function waitText(text) { for (let i = 0; i < 100; i++) { if (await evaluate(`document.body?.innerText.includes(${JSON.stringify(text)})`)) return; await sleep(100); } throw new Error(`Missing browser text ${text}: ${await evaluate('document.body?.innerText')}`); }
try {
  let port;
  for (let i = 0; i < 100; i++) { try { port = Number((await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); break; } catch { await sleep(100); } }
  assert.ok(port); let target;
  for (let i = 0; i < 40 && !target; i++) { try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page'); } catch { await sleep(100); } }
  assert.ok(target, `Browser debugging target unavailable; process exit ${browser.exitCode}`);
  socket = new WebSocket(target.webSocketDebuggerUrl); await new Promise(r => socket.addEventListener('open', r, { once: true }));
  socket.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id) { const p = pending.get(m.id); pending.delete(m.id); if (m.error) p?.reject(new Error(m.error.message)); else p?.resolve(m.result); } if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.text);
    if (m.method === 'Fetch.requestPaused') {
      const local = new URL(m.params.request.url).origin === origin;
      command(local ? 'Fetch.continueRequest' : 'Fetch.failRequest', { requestId: m.params.requestId, ...(local ? {} : { errorReason: 'BlockedByClient' }) }).catch(e => errors.push(e.message));
    }
  });
  await command('Page.enable'); await command('Runtime.enable'); await command('Network.enable'); await command('Network.setBlockedURLs', { urls: ['https://*', 'http://api.*'] });
  await command('Emulation.setFocusEmulationEnabled', { enabled: true }); await command('Page.bringToFront');
  await command('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
  for (const width of [320, 375, 430, 768, 1440]) {
    await command('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: width < 768 });
    for (const [url, ready] of [['/legal-services', 'Fixture Legal Service'], [`/legal-services/${serviceId}`, 'Review request'], [`/legal-services/requests/${id}`, 'Payment pending'], ['/admin/services', 'Services and seller applications'], [`/admin/services?legalRequest=${id}`, 'APP-439022']]) {
      await command('Page.navigate', { url: origin + url }); await waitText(ready);
      assert.equal(await evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1'), true, `Horizontal overflow ${width} ${url}`);
      if (url.includes('/requests/')) assert.equal(await evaluate('document.body.innerText.includes("Pay ₹250.00")'), true, 'An unpaid request offers its fee');
      if (url === '/legal-services') {
        assert.equal(await evaluate('!!document.querySelector(".legal-nav-auth")'), false, 'Signed-in catalogue omits Account');
        await evaluate('document.querySelector("#legal-service-search").focus()');
        const search = await evaluate(`(() => { const input=document.querySelector('#legal-service-search'), label=document.querySelector('label[for="legal-service-search"]'), hint=document.querySelector('#legal-service-search-hint'), card=document.querySelector('.legal-grid'); const i=input.getBoundingClientRect(), l=label.getBoundingClientRect(), h=hint.getBoundingClientRect(), c=card.getBoundingClientRect(), style=getComputedStyle(input), ring=parseFloat(style.outlineWidth)+Math.max(0,parseFloat(style.outlineOffset));return {above:i.top-ring-l.bottom,below:h.top-i.bottom-ring,card:c.top-h.bottom,focus:document.activeElement===input}; })()`);
        assert.equal(search.focus, true); assert.ok(search.above >= 4 && search.below >= 4 && search.card >= 12, JSON.stringify({ width, search }));
        await evaluate("void(window.originalLegalSearch=document.querySelector('#legal-service-search'))");
        let typed = '';
        for (const character of 'legal') {
          typed += character;
          await command('Input.insertText', { text: character });
          await sleep(120);
          const focus = await evaluate("(()=>{const input=document.querySelector('#legal-service-search');return {same:input===window.originalLegalSearch,focused:document.activeElement===input,value:input?.value};})()");
          assert.deepEqual(focus, { same: true, focused: true, value: typed }, `Search retains focus after ${typed} at ${width}px`);
        }
        await command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
        await command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
        await sleep(120);
        assert.equal(await evaluate("document.activeElement===window.originalLegalSearch&&window.originalLegalSearch.value==='lega'"), true);
      }
      if (url === `/legal-services/${serviceId}`) {
        for (const field of ['name', 'date', 'details']) {
          await evaluate(`document.querySelector('#service-field-${field}').focus()`);
          const spacing = await evaluate(`(()=>{const input=document.querySelector('#service-field-${field}'),label=document.querySelector('label[for="service-field-${field}"]'),help=document.querySelector('#service-field-${field}-help'),style=getComputedStyle(input),ring=parseFloat(style.outlineWidth)+Math.max(0,parseFloat(style.outlineOffset)),r=input.getBoundingClientRect();return {above:r.top-ring-label.getBoundingClientRect().bottom,below:help.getBoundingClientRect().top-r.bottom-ring,visible:input.matches(':focus-visible')};})()`);
          assert.ok(spacing.visible && spacing.above >= 4 && spacing.below >= 4, JSON.stringify({ width, field, spacing }));
        }
        if (width === 375) await writeFile(join(screenshots, 'legal-form-focus-375.png'), Buffer.from((await command('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
      }
      if (url.startsWith('/legal-services/requests/') || url.includes('legalRequest=')) {
        const reference = await evaluate(`(() => { const r=document.querySelector('.service-reference');return {text:r?.textContent,title:r?.title};})()`);
        assert.deepEqual(reference, { text: url.includes('legalRequest=') ? 'APP-439022' : 'SR-439022', title: id });
      }
      if (url.startsWith('/admin/')) {
        const tabs = await evaluate(`(()=>{const nav=document.querySelector('.admin-services-sections'),selected=nav.querySelector('button[aria-pressed=true]'),style=getComputedStyle(selected);return {count:nav.children.length,radius:parseFloat(style.borderRadius),selected:selected.textContent};})()`);
        assert.equal(tabs.count, 2); assert.ok(tabs.radius >= 8); assert.ok(tabs.selected.includes(url.includes('legalRequest=') ? 'Customer requests' : 'Services and seller applications'));
      }
      if ([375, 1440].includes(width) && ['/legal-services', '/admin/services'].includes(url)) {
        const shot = await command('Page.captureScreenshot', { format: 'png' });
        await writeFile(join(screenshots, `${url.startsWith('/admin') ? 'admin-services' : 'legal-search'}-${width}.png`), Buffer.from(shot.data, 'base64'));
      }
      rows.push({ width, url, passed: true });
    }
  }
  assert.equal(writes, 0);
  const click = label => evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)});if(!b)throw Error('Missing button '+${JSON.stringify(label)});b.click();})()`);
  for (const width of [390, 1440]) {
    await command('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: width < 768 });
    for (const vendor of [false, true]) {
      customerPhase = 'unpaid'; vendorPhase = 'unpaid';
      await command('Page.navigate', { url: origin + (vendor ? '/seller/services' : `/legal-services/${serviceId}`) });
      await waitText(vendor ? 'View requirements and apply' : 'Review request');
      if (vendor) await click('View requirements and apply');
      const payLabel = vendor ? 'Pay ₹100.00 & submit' : 'Pay ₹250.00 & submit';
      await evaluate(`(()=>{const input=document.querySelector('#service-field-name');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'Fixture applicant');input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
      if (!vendor) await click('Review request');
      await waitText(payLabel);
      assert.equal(await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(payLabel)}).disabled`), true, 'Paying needs agreement');
      // Razorpay is stubbed in the page: checkout succeeds and posts to the verification path.
      await evaluate(`window.Razorpay=class{constructor(options){this.options=options;}on(){}close(){}open(){queueMicrotask(()=>this.options.handler({razorpay_order_id:'synthetic-order',razorpay_payment_id:'synthetic-payment',razorpay_signature:'synthetic-signature'}));}};document.querySelector('.sm-agree input').click();`);
      await click(payLabel);
      await waitText('Payment received');
      assert.ok(await evaluate('document.body.innerText.length>100'), 'Submission keeps a rendered page');
      await waitText('Paid');
      assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'), true, `Payment overflow at ${width}`);
      rows.push({ width, flow: vendor ? 'seller pays and submits' : 'customer pays and submits', passed: true });
    }
  }
  assert.equal(writes, 12); assert.deepEqual(errors, []);
  console.log(JSON.stringify({ views: rows.length, passed: rows.length, failed: 0, realBackendOrGatewayCalls: 0, syntheticMutationRequests: writes }));
} finally {
  socket?.close(); browser.kill(); await vite.close();
  // Delete only the exact test-created temporary directory; never the workspace.
  assert.equal(dirname(resolve(temp)), resolve(tmpdir())); assert.ok(basename(temp).startsWith('bulkimart-legal-browser-'));
  for (let i = 0; i < 15; i++) { try { await rm(temp, { recursive: true, force: true }); break; } catch { await sleep(200); } }
}
