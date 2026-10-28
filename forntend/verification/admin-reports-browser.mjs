import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// The real Reports screen against the real admin API on an isolated in-memory
// database (backend/verification/admin-reports-browser-server.mjs).
const executable = process.env.CHROME_BIN || ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
assert.ok(executable, 'Installed Chrome or Edge is required');
const temp = await mkdtemp(join(tmpdir(), 'bulkimart-reports-')), downloads = join(temp, 'downloads');
await mkdir(downloads, { recursive: true });
const artifacts = resolve('../test-artifacts/admin-reports'); await mkdir(artifacts, { recursive: true });
const allowed = new Set(['systemroot', 'windir', 'comspec', 'path', 'pathext', 'temp', 'tmp', 'userprofile', 'localappdata', 'appdata', 'homedrive', 'homepath', 'lang', 'number_of_processors', 'processor_architecture', 'os']);
const env = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => allowed.has(key.toLowerCase()))), NODE_ENV: 'test', MONGOMS_VERSION: '7.0.14' };
const backend = spawn(process.execPath, [fileURLToPath(new URL('../../backend/verification/admin-reports-browser-server.mjs', import.meta.url))], { env, cwd: fileURLToPath(new URL('../../backend/', import.meta.url)), windowsHide: true, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
let serverErrors = ''; backend.stderr.on('data', data => serverErrors += data);
const delay = ms => new Promise(r => setTimeout(r, ms));
const pending = new Map(), exceptions = [], checks = [];
let socket, browser, vite, sequence = 0, fixture, origin;
function command(method, params = {}) {
  const id = ++sequence;
  return new Promise((ok, fail) => { const timer = setTimeout(() => { pending.delete(id); fail(Error(`CDP timeout: ${method}`)); }, 20000); pending.set(id, { resolve: v => { clearTimeout(timer); ok(v); }, reject: e => { clearTimeout(timer); fail(e); } }); socket.send(JSON.stringify({ id, method, params })); });
}
async function evaluate(expression) { const r = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; }
async function waitFor(expression, label = expression) { for (let i = 0; i < 150; i++) { if (await evaluate(expression)) return; await delay(100); } throw Error(`Timed out: ${label}`); }
async function click(label, selector = 'button') { await waitFor(`[...document.querySelectorAll(${JSON.stringify(selector)})].some(b=>b.textContent.trim().includes(${JSON.stringify(label)})&&!b.disabled)`, `button ${label}`); await evaluate(`[...document.querySelectorAll(${JSON.stringify(selector)})].find(b=>b.textContent.trim().includes(${JSON.stringify(label)})&&!b.disabled).click()`); await delay(150); }
async function setInput(selector, value) { await evaluate(`(()=>{const e=document.querySelectorAll('input[type=date]')[${selector}];Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}))})()`); await delay(100); }
const kpi = label => evaluate(`[...document.querySelectorAll('.sa-report-kpi')].find(c=>c.querySelector('span')?.textContent.trim()===${JSON.stringify(label)})?.querySelector('strong')?.textContent.trim()`);
async function screenshot(name) { const { data } = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); await writeFile(join(artifacts, `${name}.png`), Buffer.from(data, 'base64')); }
async function viewport(width) { await command('Emulation.setDeviceMetricsOverride', { width, height: width < 600 ? 900 : 1000, deviceScaleFactor: 1, mobile: width < 600 }); await delay(300); }
// Inside the admin frame only the workspace scrolls; the page itself must never
// grow past the viewport (hidden helper content once stretched it to ~2,700px).
const frameFits = () => evaluate('(()=>{const s=document.querySelector("[data-report-scroller]");return {page:document.documentElement.scrollHeight,view:innerHeight,inner:s.scrollHeight,box:s.clientHeight,report:document.querySelector(".sa-reports").offsetHeight}})()');
// The page never outgrows the admin frame, and the workspace scrolls exactly to
// the end of the report: hidden screen-reader tables once added ~800px of blank space.
async function assertFrame(label) { const f = await frameFits(); assert.ok(f.page <= f.view + 1, `${label}: page height ${f.page}px exceeds the ${f.view}px viewport`); assert.ok(f.inner <= Math.max(f.report, f.box) + 1, `${label}: workspace scrolls ${f.inner - Math.max(f.report, f.box)}px past the end of the report`); }
async function downloaded(name) { for (let i = 0; i < 100; i++) { const files = await readdir(downloads); if (files.includes(name)) return readFile(join(downloads, name), 'utf8'); await delay(100); } throw Error(`Download did not arrive: ${name}`); }
try {
  fixture = await new Promise((ok, fail) => { const t = setTimeout(() => fail(Error('Backend startup timed out')), 90000); backend.once('message', m => { clearTimeout(t); ok(m); }); backend.once('exit', () => { clearTimeout(t); fail(Error(`Backend exited: ${serverErrors.slice(0, 600)}`)); }); });
  vite = await createServer({ envDir: false, define: { 'import.meta.env.VITE_API_BASE_URL': '""', 'import.meta.env.VITE_API_URL': '""' }, cacheDir: join(temp, 'vite'),
    server: { host: '127.0.0.1', port: 0, hmr: false, proxy: { '/api': `http://127.0.0.1:${fixture.port}` } },
    plugins: [{ name: 'reports-page', configureServer(server) { server.middlewares.use(async (req, res, next) => { if (!req.url.startsWith('/reports-check')) return next(); res.setHeader('Content-Type', 'text/html');
      res.end(await server.transformIndexHtml(req.url, `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0"><div id="root"></div><script>localStorage.setItem('adminToken',${JSON.stringify(fixture.token)})</script><script type="module" src="/verification/admin-reports-entry.jsx"></script></body></html>`)); }); } }] });
  await vite.listen(); origin = `http://127.0.0.1:${vite.httpServer.address().port}`;
  browser = spawn(executable, ['--headless=new', '--disable-gpu', '--remote-debugging-port=0', `--user-data-dir=${join(temp, 'profile')}`, '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-sync', 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  let port; for (let i = 0; i < 100 && !port; i++) { try { port = Number((await readFile(join(temp, 'profile', 'DevToolsActivePort'), 'utf8')).split('\n')[0]); } catch { await delay(100); } }
  const target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page');
  socket = new WebSocket(target.webSocketDebuggerUrl); await new Promise((ok, fail) => { socket.onopen = ok; socket.onerror = fail; });
  socket.onmessage = event => {
    const m = JSON.parse(event.data);
    if (m.id) { const task = pending.get(m.id); pending.delete(m.id); m.error ? task?.reject(Error(m.error.message)) : task?.resolve(m.result); }
    if (m.method === 'Runtime.exceptionThrown') exceptions.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  };
  await command('Page.enable'); await command('Runtime.enable');
  await command('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads });
  await viewport(1440); await command('Page.navigate', { url: `${origin}/reports-check` });
  await waitFor('!!document.querySelector(".sa-report-kpi strong") && !document.querySelector(".sa-report-kpi.is-skeleton")', 'default report loads');
  checks.push('default Last 30 days overview loads from the real API');
  // --simulate-old-css re-creates the pre-fix stylesheet in this page only, to
  // prove assertFrame catches the page-stretch regression (this run must fail).
  if (process.argv.includes('--simulate-old-css')) await evaluate("document.head.insertAdjacentHTML('beforeend','<style>.sa-reports{position:static!important}.sa-report-sr-only{margin:0!important;clip-path:none!important}</style>')");

  // September 2026: the fixture's reconciled figures (see backend admin-reports.test.js).
  await click('Custom range'); await setInput(0, '2026-09-01'); await setInput(1, '2026-09-30'); await click('Apply range');
  await waitFor('/1 Sept 2026\\s+–\\s+30 Sept 2026/.test(document.querySelector(".sa-report-period")?.textContent||"")', 'custom range applied');
  const expected = { 'Gross order value': '₹2,000.00', 'Net sales': '₹1,100.00', 'Completed orders': '2', 'Average order value': '₹750.00', 'Platform commission': '₹85.00', 'Refunds completed': '₹400.00',
    'Active customers': '2', 'Active sellers': '2', 'Deliveries completed': '1', 'Seller earnings': '₹585.00', 'Online payments captured': '₹1,000.00', 'COD cash verified': '₹500.00', 'Refunds awaiting payout': '₹50.00' };
  for (const [label, value] of Object.entries(expected)) assert.equal(await kpi(label), value, label);
  assert.equal(await evaluate('document.querySelectorAll(".sa-report-columns").length'), 3);
  assert.equal(await evaluate('[...document.querySelectorAll(".sa-dashboard-bars li")].map(li=>li.textContent).join("|").includes("Alpha Store")'), true);
  assert.equal(await evaluate('[...document.querySelectorAll("button")].some(b=>/Add New Entry/.test(b.textContent))'), false);
  await assertFrame('overview 1440px');
  await screenshot('overview-1440'); checks.push('overview KPIs match the reconciled fixture (13 figures), 3 daily charts + 2 breakdowns, no manual-entry action');

  await click('Consumer Users', '[role=tab]');
  await waitFor('[...document.querySelectorAll(".sa-report-table tbody tr")].some(r=>r.textContent.includes("Asha Buyer"))', 'customer rows');
  assert.equal(await kpi('Repeat customers'), '2'); assert.equal(await kpi('New registrations'), '1');
  assert.equal(await evaluate('document.body.textContent.includes("9876501111")'), false, 'raw phone never rendered');
  await evaluate(`(()=>{const e=document.querySelector('input[type=search]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'asha');e.dispatchEvent(new Event('input',{bubbles:true}))})()`);
  await waitFor('document.querySelectorAll(".sa-report-table tbody tr").length===1&&document.querySelector(".sa-report-table tbody").textContent.includes("Asha Buyer")', 'search narrows rows');
  await assertFrame('customers 1440px');
  await screenshot('customers-1440'); checks.push('customers: totals, masked phones, debounced server search');

  await click('General Vendors', '[role=tab]');
  await waitFor('[...document.querySelectorAll(".sa-report-table tbody tr")].some(r=>r.textContent.includes("Alpha Store")&&r.textContent.includes("₹1,100.00"))', 'vendor rows');
  assert.equal(await kpi('Settlements pending'), '₹100.00'); assert.equal(await kpi('Platform commission'), '₹85.00');
  await click('Commission', '.sa-report-table th button');
  await waitFor('document.querySelector(".sa-report-table th[aria-sort]")?.textContent.includes("Commission")', 'sorted by commission');
  await screenshot('vendors-1440'); checks.push('vendors: item-split sales, ledger commission/earnings, payouts, header sorting');

  await click('Delivery Fleet', '[role=tab]');
  await waitFor('[...document.querySelectorAll(".sa-report-table tbody tr")].some(r=>r.textContent.includes("Ravi Rider")&&r.textContent.includes("₹700.00"))', 'rider row');
  assert.equal(await kpi('Success rate'), '50.0%'); assert.equal(await kpi('Cash held by riders now'), '₹700.00'); assert.equal(await kpi('Average delivery time'), '30 min');
  await screenshot('delivery-1440'); checks.push('delivery: outcomes, success rate, duration, COD collected/verified/held');

  await click('Export CSV');
  const csv = await downloaded('bulkimart-delivery-report-2026-09-01-to-2026-09-30.csv');
  await waitFor('/Downloaded bulkimart-delivery-report/.test(document.body.textContent)', 'export confirmation');
  const lines = csv.replace(/^\uFEFF/, '').trim().split('\r\n');
  assert.match(lines[0], /^"Delivery partner","Phone \(masked\)"/); assert.ok(lines.some(line => line.startsWith('"Ravi Rider"') && line.endsWith(',40,500,700')), lines.join('\n'));
  await click('Platform Overview', '[role=tab]'); await waitFor('!!document.querySelector(".sa-report-columns")');
  await click('Export CSV');
  const overviewCsv = await downloaded('bulkimart-platform-report-2026-09-01-to-2026-09-30.csv');
  assert.equal(overviewCsv.trim().split('\r\n').at(-1), '"Total",4,2000,2,1500,2,400');
  checks.push('Export CSV downloads real files for the selected tab and range (delivery and platform verified)');
  await click('Order Payments', '[role=tab]');
  await waitFor('[...document.querySelectorAll(".sa-order-card")].some(r=>r.textContent.includes("ORD-O1"))', 'order row');
  await evaluate('document.querySelector(".sa-report-expand").click()');
  await waitFor('!!document.querySelector(".sa-order-breakdown")', 'order breakdown');
  assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'), true, 'Order payments table does not overflow the page');
  await screenshot('orders-1440');
  await viewport(1280); await screenshot('orders-1280');
  assert.equal(await evaluate('[...document.querySelectorAll(".sa-report-tabs button")].every(b=>{const r=b.getBoundingClientRect(),p=b.parentElement.getBoundingClientRect();return r.left>=p.left-1&&r.right<=p.right+1})'), true, 'Report tabs wrap instead of scrolling');
  await viewport(1440);
  checks.push('order payments: one card per order with seller/delivery/commission/tax/admin split and an expandable breakdown; tabs wrap without sideways scrolling');

  for (const width of [390, 768]) {
    await viewport(width); await delay(300);
    assert.ok(await evaluate('document.documentElement.scrollWidth <= innerWidth'), `no page-level horizontal overflow at ${width}px`);
    await assertFrame(`overview ${width}px`);
    await screenshot(`overview-${width}`);
  }
  checks.push('inside the real admin frame: page never taller than the viewport (1440/390/768px); 390px and 768px have no horizontal overflow');
  assert.deepEqual(exceptions, [], 'No uncaught page exceptions');
  console.log(JSON.stringify({ passed: true, checks, artifacts }, null, 2));
} finally {
  socket?.close(); browser?.kill(); await vite?.close();
  if (backend.connected) { const exited = new Promise(r => backend.once('exit', r)); backend.send({ action: 'stop' }); await Promise.race([exited, delay(10000)]); } if (backend.exitCode === null) backend.kill();
  await delay(300); await rm(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}
