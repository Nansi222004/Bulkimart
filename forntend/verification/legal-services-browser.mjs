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
const id = '507f1f77bcf86cd799439022', serviceId = '507f1f77bcf86cd799439023';
const s = { _id: serviceId, version: 1, name: 'Fixture Legal Service', description: 'Synthetic service for private intake testing only.', instructions: 'Provide only the information needed.', formVersion: 1, fields: [{ id: 'name', label: 'Required name', type: 'text', required: true }], startingPrice: null };
const q = { version: 1, scope: 'Synthetic confirmed scope', currency: 'INR', servicePaise: 500000, serviceTaxPaise: 0, totalPaise: 500000, terms: 'Synthetic approved cancellation and refund terms', policy: { terms: 'Synthetic approved terms' } };
const a = { _id: id, version: 1, serviceName: s.name, status: 'awaiting_payment', paymentStatus: 'pending', fields: s.fields, answers: { name: 'Private fixture' }, files: [], events: [], quotation: q, canPay: false, createdAt: '2026-10-22T00:00:00Z' };
const adminA = { _id: id, __v: 1, service: serviceId, user: 'fixture-customer', snapshot: { name: s.name, fields: s.fields }, answers: a.answers, files: [], events: [], status: 'awaiting_payment', legal: { quotes: [{ ...q, rate: 10, commissionPaise: 50000, providerPaise: 450000, policyVersion: 'fixture-only' }], paymentStatus: 'pending' }, reconciliation: { balancesPaise: {}, exceptions: ['bank_settlement_unreconciled'], settlementBlockers: ['completion_not_verified'], entries: [], payment: { attempts: [] } }, flags: { refunds: false } };
let writes = 0, customerPhase = 'pending', vendorPhase = 'submitted';
const vendorService = { ...s, __v: 1, pricing: { mode: 'fixed', amount: 100, currency: 'INR' } };
const customerView = () => customerPhase === 'pending' ? a : { ...a, answers: undefined,
  status: customerPhase === 'submitted' ? 'submitted' : customerPhase === 'paid' ? 'payment_verified' : 'awaiting_payment',
  paymentStatus: customerPhase === 'paid' ? 'paid' : 'not_requested', quotation: customerPhase === 'submitted' ? null : q, canPay: customerPhase === 'payable' };
const vendorView = () => ({ _id: id, __v: 1, status: vendorPhase === 'submitted' ? 'submitted' : vendorPhase === 'paid' ? 'payment_verified' : 'awaiting_payment',
  snapshot: { name: s.name, pricing: vendorService.pricing, fields: s.fields }, createdAt: a.createdAt,
  billing: vendorPhase === 'submitted' ? undefined : { version: 1, amountPaise: 10000, status: vendorPhase === 'paid' ? 'paid' : 'unpaid', terms: 'Synthetic service payment terms', paymentId: 'fixture-payment' } });
const vite = await createServer({ define: { 'import.meta.env.VITE_API_BASE_URL': '""', 'import.meta.env.VITE_API_URL': '""' }, cacheDir: join(temp, 'vite-cache'), server: { host: '127.0.0.1', port: 0, hmr: false }, plugins: [{ name: 'isolated-legal-fixtures', configureServer(server) {
  server.middlewares.use(async (req, res, next) => {
    if (req.url.startsWith('/api/')) {
      const p = new URL(req.url, 'http://fixture').pathname;
      if (req.method !== 'GET') {
        writes++; req.resume(); let data;
        if (p === `/api/customer-services/catalogue/${serviceId}/applications`) { customerPhase = 'submitted'; data = { _id: id }; }
        else if (p === `/api/services/${serviceId}/applications`) { vendorPhase = 'submitted'; data = vendorView(); }
        else if (p === `/api/customer-services/applications/${id}/payment` || p === `/api/services/applications/${id}/payment`) data = { orderId: id, amountPaise: p.startsWith('/api/services/') ? 10000 : q.totalPaise, currency: 'INR', keyId: 'synthetic-key', razorpayOrderId: 'synthetic-order', verificationPath: p.startsWith('/api/services/') ? '/api/services/payments/verify' : '/api/customer-services/payments/verify' };
        else if (p === '/api/customer-services/payments/verify') { customerPhase = 'paid'; data = { status: 'paid' }; }
        else if (p === '/api/services/payments/verify') { vendorPhase = 'paid'; data = { status: 'paid' }; }
        res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify(data ? { success: true, data } : { success: false, message: 'Browser fixture blocks unrecognized writes' }));
      }
      let data = [], meta = { total: 1, page: 1, limit: 20 };
      if (p === '/api/customer-services') data = [s];
      else if (p === `/api/customer-services/catalogue/${serviceId}`) data = s;
      else if (p === '/api/customer-services/applications' || p === '/api/legal-provider') data = [a];
      else if (p.startsWith('/api/customer-services/applications/')) data = customerView();
      else if (p.startsWith('/api/legal-provider/')) data = a;
      else if (p === '/api/services') data = [vendorService];
      else if (p === '/api/services/applications') data = [vendorView()];
      else if (p.startsWith('/api/services/applications/')) data = vendorView();
      else if (p === '/api/admin/services/legal/requests') data = [a];
      else if (p.startsWith('/api/admin/services/legal/requests/')) data = adminA;
      res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ success: true, data, meta }));
    }
    if (/^\/(legal-services|legal-provider|admin\/services|seller\/services)(\/|\?|$)/.test(req.url)) {
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
  await command('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
  for (const width of [320, 375, 430, 768, 1440]) {
    await command('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: width < 768 });
    for (const [url, ready] of [['/legal-services', 'Fixture Legal Service'], [`/legal-services/${serviceId}`, 'Review request'], [`/legal-services/requests/${id}`, 'Check payment status'], ['/legal-provider', 'Open assignment'], [`/admin/services?legalRequest=${id}`, 'Apply authorized action']]) {
      await command('Page.navigate', { url: origin + url }); await waitText(ready);
      assert.equal(await evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1'), true, `Horizontal overflow ${width} ${url}`);
      if (url.includes('/requests/')) assert.equal(await evaluate('document.body.innerText.includes("Pay confirmed amount")'), false, 'Pending request cannot claim eligible payment');
      rows.push({ width, url, passed: true });
    }
  }
  assert.equal(writes, 0);
  const click = label => evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)});if(!b)throw Error('Missing button '+${JSON.stringify(label)});b.click();})()`);
  for (const width of [390, 1440]) {
    await command('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: width < 768 });
    for (const vendor of [false, true]) {
      customerPhase = 'pending'; vendorPhase = 'submitted';
      await command('Page.navigate', { url: origin + (vendor ? '/seller/services' : `/legal-services/${serviceId}`) });
      await waitText(vendor ? 'View requirements and apply' : 'Review request');
      if (vendor) { await click('View requirements and apply'); await waitText('Submit application'); }
      await evaluate(`(()=>{const input=document.querySelector('#service-field-name');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'Fixture applicant');input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
      if (!vendor) { await click('Review request'); await waitText('Submit Service Request'); }
      await click(vendor ? 'Submit application' : 'Submit Service Request');
      await waitText(vendor ? 'submitted successfully' : 'Reference:');
      assert.ok(await evaluate('document.body.innerText.length>100'), 'Submission keeps a rendered page');
      if (vendor) vendorPhase = 'payable'; else customerPhase = 'payable';
      await click(vendor ? 'Refresh' : 'Refresh request');
      await waitText(vendor ? 'Pay ₹100.00 to Bulkimart' : 'Pay confirmed amount');
      await evaluate(`window.Razorpay=class{constructor(options){this.options=options;}on(){}close(){}open(){queueMicrotask(()=>this.options.handler({razorpay_order_id:'synthetic-order',razorpay_payment_id:'synthetic-payment',razorpay_signature:'synthetic-signature'}));}};document.querySelector('input[type=checkbox]').click();`);
      await click(vendor ? 'Pay ₹100.00 to Bulkimart' : 'Pay confirmed amount');
      await waitText(vendor ? 'Payment status: paid' : 'Payment: paid');
      assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'), true, `Payment overflow at ${width}`);
      rows.push({ width, flow: vendor ? 'vendor submit and pay' : 'customer submit and pay', passed: true });
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
