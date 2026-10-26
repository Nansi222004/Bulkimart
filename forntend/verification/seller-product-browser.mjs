import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join, resolve, dirname, basename } from 'node:path';
import { tmpdir } from 'node:os';
const exe = process.env.CHROME_BIN || ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
assert.ok(exe);
const temp = await mkdtemp(join(tmpdir(), 'bulkimart-product-browser-')), profile = join(temp, 'profile'); await mkdir(profile);
const category = '507f1f77bcf86cd799439021';
const vite = await createServer({ cacheDir: join(temp, 'vite-cache'), define: { 'import.meta.env.VITE_API_BASE_URL': '""', 'import.meta.env.VITE_API_URL': '""' },
  server: { host: '127.0.0.1', port: 0, hmr: false }, plugins: [{ name: 'product-fixtures', configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      if (req.url.startsWith('/api/')) {
        res.setHeader('Content-Type', 'application/json');
        return res.end(JSON.stringify({ success: true, data: req.url.includes('/categories/tree') ? [{ _id: category, name: 'Fixture category', children: [] }] : { eligible: false } }));
      }
      if (req.url.startsWith('/product-fixture')) {
        res.setHeader('Content-Type', 'text/html');
        return res.end(await server.transformIndexHtml(req.url, '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0"><div id="root"></div><script type="module" src="/verification/seller-product-browser-entry.jsx"></script></body></html>'));
      }
      next();
    });
  } }] });
await vite.listen(); const origin = 'http://127.0.0.1:' + vite.httpServer.address().port;
const browser = spawn(exe, ['--headless=new', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--disable-background-networking', 'about:blank'], { windowsHide: true, stdio: 'ignore' });
let socket, seq = 0; const pending = new Map(), errors = [], views = [], sleep = ms => new Promise(r => setTimeout(r, ms));
function command(method, params = {}) {
  const id = ++seq;
  return new Promise((resolve, reject) => { const timer = setTimeout(() => reject(Error(method + ' timed out')), 15000);
    pending.set(id, { resolve: result => { clearTimeout(timer); resolve(result); }, reject }); socket.send(JSON.stringify({ id, method, params })); });
}
async function evaluate(expression) { const result = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails)); return result.result.value; }
async function wait(expression) { for (let i = 0; i < 150; i++) { if (await evaluate(expression)) return; await sleep(100); } throw Error('Waiting for ' + expression); }
async function click(text) { await evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.includes(${JSON.stringify(text)})); if(!b)throw Error('Button missing');b.click();})()`); await sleep(80); }
try {
  let port; for (let i = 0; i < 100; i++) { try { port = Number((await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); break; } catch { await sleep(100); } }
  assert.ok(port); const target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page');
  socket = new WebSocket(target.webSocketDebuggerUrl); await new Promise(r => socket.addEventListener('open', r, { once: true }));
  socket.addEventListener('message', event => { const message = JSON.parse(event.data); if (message.id) { const entry = pending.get(message.id); pending.delete(message.id); message.error ? entry?.reject(Error(message.error.message)) : entry?.resolve(message.result); } if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text); });
  await command('Runtime.enable'); await command('Page.enable');
  const screenshots = resolve('../test-artifacts/seller-product'); await mkdir(screenshots, { recursive: true });
  for (const width of [320, 375, 412, 768, 1440]) {
    const mobile = width < 768;
    await command('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile });
    await command('Page.navigate', { url: origin + '/product-fixture' }); await wait("!!document.querySelector('.pm-dialog')");
    assert.equal(await evaluate("document.body.innerText.includes('Offer same-day delivery')"), false);
    await click('Item Variants'); await wait("!!document.querySelector('.pm-variant-fields')");
    if (mobile) await command('Emulation.setDeviceMetricsOverride', { width, height: 360, deviceScaleFactor: 1, mobile });
    await evaluate("(()=>{const e=[...document.querySelectorAll('.pm-variant-fields input')].at(-1);e.focus();e.scrollIntoView({block:'nearest'});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'1250');e.dispatchEvent(new Event('input',{bubbles:true}));})()");
    await sleep(180);
    const result = await evaluate("(()=>{const d=document.querySelector('.pm-dialog'),r=d.getBoundingClientRect(),f=document.activeElement,fr=f.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,viewport:visualViewport.height,fieldTop:fr.top,fieldBottom:fr.bottom,font:parseFloat(getComputedStyle(f).fontSize),value:f.value,scale:visualViewport.scale,overflow:document.documentElement.scrollWidth>innerWidth+1,scroll:d.scrollTop};})()");
    assert.ok(!result.overflow && result.left >= 0 && result.right <= width && result.bottom <= result.viewport + 1, JSON.stringify(result));
    assert.ok(result.fieldTop >= result.top && result.fieldBottom <= result.bottom, JSON.stringify(result));
    assert.equal(result.value, '1250'); assert.equal(result.scale, 1);
    if (mobile) { assert.ok(result.font >= 16); assert.ok(result.scroll > 0); }
    await writeFile(join(screenshots, `variants-${width}.png`), Buffer.from((await command('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
    await evaluate("document.activeElement.blur()");
    await command('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile });
    await click('Category & Groups'); await wait("!!document.querySelector('.pm-main select[required] option[value=\"" + category + "\"]')");
    await evaluate(`(()=>{const e=document.querySelector('.pm-main select[required]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(e,${JSON.stringify(category)});e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await click('Photos'); await evaluate("(()=>{const e=document.querySelector('input[type=file]'),files=new DataTransfer();files.items.add(new File(['fixture'],'fixture.jpg',{type:'image/jpeg'}));e.files=files.files;e.dispatchEvent(new Event('change',{bubbles:true}));})()");
    await click('Save & Submit Listing'); await wait("!document.querySelector('.pm-dialog')");
    assert.equal(await evaluate('window.fixtureSaves'), 1); assert.equal(await evaluate("!!document.querySelector('[role=alertdialog]')"), false);
    views.push({ width, reducedViewport: mobile, savedOnce: true });
  }
  assert.deepEqual(errors, []); console.log(JSON.stringify({ passed: true, views }));
} finally {
  socket?.close(); browser.kill(); await vite.close();
  assert.equal(dirname(resolve(temp)), resolve(tmpdir())); assert.ok(basename(temp).startsWith('bulkimart-product-browser-'));
  for (let i = 0; i < 15; i++) { try { await rm(temp, { recursive: true, force: true }); break; } catch { await sleep(200); } }
}
