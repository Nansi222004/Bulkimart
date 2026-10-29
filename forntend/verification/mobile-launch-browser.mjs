import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
import { spawn } from 'node:child_process';

// Isolated browser + synthetic APIs only. No production requests or account data.
const root = resolve('dist');
const profile = resolve('.mobile-launch-browser-profile');
assert.equal(profile.startsWith(resolve('.') + sep), true);
assert.equal(existsSync(profile), false, 'Do not reuse an existing browser profile');
await mkdir(profile);
const executable = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
assert.ok(executable, 'Chrome or Edge must be installed');
let bootOnly = true, apiDelay = 0, apiFailure = false;
const art = '/fixture-splash.svg';
const experience = () => ({ version: 'launch-test', banners: [], sections: [], headerCategories: [],
  serverTime: new Date().toISOString(), validUntil: new Date(Date.now() + 60000).toISOString(),
  splash: { id: 'browser-splash', revision: 1, banner: { id: 'poster', image: art, mobileImage: art, title: 'Launch artwork', mediaType: 'image' }, config: { frequency: 'launch', duration: 15 }, endAt: new Date(Date.now() + 60000).toISOString() } });
const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, 'http://localhost').pathname;
    if (path === art) { res.setHeader('Content-Type', 'image/svg+xml'); res.end('<svg xmlns="http://www.w3.org/2000/svg" width="390" height="844"><rect width="390" height="844" fill="#146b52"/><text x="60" y="400" fill="white">Launch artwork</text></svg>'); return; }
    const asset = resolve(root, '.' + path);
    assert.ok(asset.startsWith(root + sep) || asset === root);
    if (path.startsWith('/assets/')) {
      res.setHeader('Content-Type', ({ '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml' })[extname(asset)] || 'application/octet-stream');
      res.end(await readFile(asset)); return;
    }
    let html = await readFile(resolve(root, 'index.html'), 'utf8');
    if (bootOnly) html = html.replace(/<script type="module"[^>]*><\/script>/g, '');
    res.setHeader('Content-Type', 'text/html'); res.end(html);
  } catch { res.statusCode = 404; res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = spawn(executable, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', 'about:blank'], { windowsHide: true, stdio: 'ignore' });
let socket, sequence = 0;
const pending = new Map(), checks = [];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(predicate, message) {
  for (let i = 0; i < 150; i++) { if (await predicate()) return; await pause(100); }
  throw new Error(message || 'Browser condition timed out');
}
function command(method, params = {}) {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 10000);
    pending.set(id, { resolve: result => { clearTimeout(timer); resolve(result); }, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await command('Runtime.evaluate', { expression, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
}
try {
  await waitFor(() => existsSync(resolve(profile, 'DevToolsActivePort')), 'Browser did not start');
  const port = (await readFile(resolve(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0];
  const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  socket = new WebSocket(pages.find(page => page.type === 'page').webSocketDebuggerUrl);
  await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }));
  socket.addEventListener('message', async event => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const task = pending.get(message.id); if (!task) return; pending.delete(message.id);
      if (message.error) task.reject(new Error(message.error.message)); else task.resolve(message.result);
    } else if (message.method === 'Fetch.requestPaused') {
      const { requestId, request } = message.params, url = new URL(request.url);
      try {
        if (url.pathname.startsWith('/api/')) {
          if (url.pathname === '/api/storefront/experience') await pause(apiDelay);
          const config = url.pathname === '/api/storefront/experience';
          const body = config ? { success: true, data: experience() } : { success: true, data: [], products: [], categories: [], banners: [], total: 0 };
          await command('Fetch.fulfillRequest', { requestId, responseCode: config && apiFailure ? 503 : 200, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }, { name: 'Access-Control-Allow-Origin', value: '*' }], body: Buffer.from(JSON.stringify(body)).toString('base64') });
        } else if (url.origin !== origin) await command('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' });
        else await command('Fetch.continueRequest', { requestId });
      } catch { /* request may be cancelled during navigation */ }
    }
  });
  await command('Page.enable'); await command('Runtime.enable');
  await command('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
  const seed = experience(); seed.splash.banner.image = seed.splash.banner.mobileImage = origin + art;
  const seedScript = await command('Page.addScriptToEvaluateOnNewDocument', { source: `if(location.origin===${JSON.stringify(origin)}) { const seed=${JSON.stringify(seed)}; localStorage.setItem('bulkimart:experience:quick:mobile:',JSON.stringify(seed)); }` });
  async function navigate(width) {
    await evaluate('window.__previousLaunchDocument=true');
    await command('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: width <= 768 });
    await command('Page.navigate', { url: origin + '/grocery--home' });
    await waitFor(() => evaluate("!window.__previousLaunchDocument && document.readyState==='complete'"), 'New document did not finish loading');
  }
  apiDelay = 1000;
  for (const width of [390, 768]) {
    await navigate(width);
    await waitFor(() => evaluate("!!document.querySelector('.boot-promotion')"));
    assert.equal(await evaluate("getComputedStyle(document.querySelector('.boot-home')).display"), 'none');
    assert.equal(await evaluate("document.querySelector('.boot-promotion').naturalWidth>0"), true);
    checks.push(`cached artwork is the first mobile screen at ${width}px`);
  }
  await navigate(1024);
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.boot-home')).display"), 'flex');
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.boot-spinner')).display"), 'block');
  checks.push('desktop retains logo and spinner');
  bootOnly = false; apiDelay = 0;
  await navigate(390);
  await waitFor(() => evaluate("!!document.querySelector('.sf-splash-card')"));
  assert.equal(await evaluate("!!document.querySelector('.boot-home')"), false);
  assert.equal(await evaluate("!!document.querySelector('.sf-launch-content[inert][aria-hidden=true] main')"), true);
  assert.equal(await evaluate("!!document.querySelector('.sf-launch-content [role=dialog]')"), false);
  assert.equal(await evaluate("document.querySelector('.sf-splash').contains(document.activeElement)"), true);
  await evaluate("window.__homeBeforeSplashClose=document.querySelector('.sf-launch-content main');true");
  await command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await waitFor(() => evaluate("!document.querySelector('.sf-splash')"));
  assert.equal(await evaluate("window.__homeBeforeSplashClose===document.querySelector('.sf-launch-content main')"), true);
  assert.equal(await evaluate("document.querySelector('.sf-launch-content').hasAttribute('inert')"), false);
  checks.push('React handoff, background home, focus and dismissal preserve the mounted homepage');
  await evaluate("localStorage.clear();sessionStorage.clear()");
  // A first visit must still show the live splash without ever inserting StoreLoading.
  await command('Page.removeScriptToEvaluateOnNewDocument', { identifier: seedScript.identifier });
  await navigate(390);
  await waitFor(() => evaluate("!!document.querySelector('.sf-splash-card')"));
  assert.equal(await evaluate("!!document.querySelector('.boot-home')"), false);
  checks.push('uncached first visit shows the live splash');
  await evaluate("localStorage.clear();sessionStorage.clear()");
  apiFailure = true;
  await navigate(390);
  await waitFor(() => evaluate("!!document.querySelector('.sf-launch-content main')"), 'Failed configuration must release the homepage');
  assert.equal(await evaluate("!!document.querySelector('.boot-home,.sf-splash')"), false);
  checks.push('configuration failure releases mobile home without the logo loader');
  console.log(JSON.stringify({ passed: true, checks }, null, 2));
} finally {
  socket?.close(); browser.kill(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  await pause(500);
  // The literal profile path was checked against this checkout before creation.
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}
