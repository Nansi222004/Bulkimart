import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join, resolve, dirname, basename } from 'node:path';
import { tmpdir } from 'node:os';
const exe = process.env.CHROME_BIN || ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
assert.ok(exe);
const temp = await mkdtemp(join(tmpdir(), 'bulkimart-registration-browser-')), profile = join(temp, 'profile'); await mkdir(profile);
const vite = await createServer({ cacheDir: join(temp, 'vite-cache'), define: { 'import.meta.env.VITE_API_BASE_URL': '""', 'import.meta.env.VITE_API_URL': '""' },
  server: { host: '127.0.0.1', port: 0, hmr: false }, plugins: [{ name: 'registration-fixtures', configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      if (req.url.startsWith('/api/')) {
        res.setHeader('Content-Type', 'application/json');
        const role = req.url.match(/privacy-policy\/(user|seller|delivery)-policy/)?.[1];
        return res.end(JSON.stringify(role ? { success: true, data: { role, roleTitle: `Fixture ${role} policy`, isPublished: true, version: '2.0', sections: Array.from({ length: 20 }, (_, order) => ({ order, title: 'Policy section ' + order, content: 'Existing admin-managed policy content. '.repeat(12) })) } } : { success: true, data: [] }));
      }
      if (req.url.startsWith('/registration-fixture')) {
        res.setHeader('Content-Type', 'text/html');
        return res.end(await server.transformIndexHtml(req.url, '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0"><div id="root"></div><script type="module" src="/verification/registration-browser-entry.jsx"></script></body></html>'));
      }
      next();
    });
  } }] });
await vite.listen(); const origin = 'http://127.0.0.1:' + vite.httpServer.address().port;
const browser = spawn(exe, ['--headless=new', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--disable-background-networking', 'about:blank'], { windowsHide: true, stdio: 'ignore' });
let socket, seq = 0; const pending = new Map(), errors = [], views = [], sleep = ms => new Promise(r => setTimeout(r, ms));
function command(method, params = {}) { const id = ++seq; return new Promise((resolve, reject) => { const timer = setTimeout(() => reject(Error(method + ' timed out')), 15000); pending.set(id, { resolve: result => { clearTimeout(timer); resolve(result); }, reject }); socket.send(JSON.stringify({ id, method, params })); }); }
async function evaluate(expression) { const result = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails)); return result.result.value; }
async function wait(expression) { for (let i = 0; i < 150; i++) { if (await evaluate(expression)) return; await sleep(100); } throw Error('Waiting for ' + expression); }
const click = async text => { await evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)});if(!b)throw Error('Missing button '+${JSON.stringify(text)});b.click();})()`); await sleep(60); };
const fill = async (id, value) => { await evaluate(`(()=>{const e=document.getElementById(${JSON.stringify(id)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`); };
try {
  let port; for (let i = 0; i < 100; i++) { try { port = Number((await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); break; } catch { await sleep(100); } }
  assert.ok(port); const target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page');
  socket = new WebSocket(target.webSocketDebuggerUrl); await new Promise(r => socket.addEventListener('open', r, { once: true }));
  socket.addEventListener('message', event => { const message = JSON.parse(event.data); if (message.id) { const entry = pending.get(message.id); pending.delete(message.id); message.error ? entry?.reject(Error(message.error.message)) : entry?.resolve(message.result); } if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text); });
  await command('Runtime.enable'); await command('Page.enable');
  const screenshots = resolve('../test-artifacts/registration'); await mkdir(screenshots, { recursive: true });
  for (const width of [320, 412, 1440]) for (const portal of ['user', 'seller', 'delivery']) {
    await command('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 768 });
    await command('Page.navigate', { url: origin + '/registration-fixture?portal=' + portal }); await wait("!!document.querySelector('.auth-card-wrapper')");
    if (portal !== 'seller') await click('Register');
    await wait("!!document.querySelector('.registration-terms-link')");
    const phone = portal === 'user' ? 'phone' : portal === 'seller' ? 'seller-phone' : 'rider-phone'; await fill(phone, '9876500000');
    if (portal === 'user') { await fill('name', 'Fixture Customer'); await fill('email', 'fixture@example.test'); }
    const src = await evaluate("document.querySelector('.auth-brand-logo img').src");
    assert.match(decodeURIComponent(src), portal === 'seller' ? /seller logo\.jpeg/ : portal === 'delivery' ? /delievry logo\.jpg/ : /Bulkimart-logo-transparent/);
    await evaluate("document.querySelector('.registration-terms-link').focus()"); await click('Terms & Conditions');
    await wait(`document.body.innerText.includes('Fixture ${portal} policy')`);
    assert.equal(await evaluate('document.getElementById("root").inert'), true);
    assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'), true);
    const rect = await evaluate("(()=>{const d=document.querySelector('.registration-policy-dialog').getBoundingClientRect();const c=document.querySelector('.registration-policy-content');return {left:d.left,right:d.right,top:d.top,bottom:d.bottom,scrollable:c.scrollHeight>c.clientHeight};})()");
    assert.ok(rect.left >= 0 && rect.right <= width && rect.top >= 0 && rect.bottom <= 900 && rect.scrollable, JSON.stringify(rect));
    assert.equal(await evaluate('window.fixturePosts'), 0);
    if (portal === 'user') assert.equal(await evaluate('document.getElementById("customer-registration-terms").checked'), false);
    await writeFile(join(screenshots, `${portal}-policy-${width}.png`), Buffer.from((await command('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
    await command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await wait("!document.querySelector('.registration-policy-dialog')");
    assert.equal(await evaluate('document.activeElement===document.querySelector(".registration-terms-link")'), true);
    assert.equal(await evaluate(`document.getElementById(${JSON.stringify(phone)}).value`), '9876500000');
    await evaluate('window.scrollTo(0,0)'); await writeFile(join(screenshots, `${portal}-registration-${width}.png`), Buffer.from((await command('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
    if (portal === 'user') {
      await evaluate('document.getElementById("customer-registration-terms").click()'); await click('Send OTP Verification');
      await wait("[...document.querySelectorAll('button')].some(b=>/^Resend OTP in [12]?\\d?s$/.test(b.textContent.trim()))");
      assert.equal(await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Resend OTP in')).disabled"), true);
      assert.equal(await evaluate('window.fixturePosts'), 1);
    }
    views.push({ width, portal, popup: true, draftPreserved: true });
  }
  assert.deepEqual(errors, []); console.log(JSON.stringify({ passed: true, views }));
} finally {
  socket?.close(); browser.kill(); await vite.close();
  assert.equal(dirname(resolve(temp)), resolve(tmpdir())); assert.ok(basename(temp).startsWith('bulkimart-registration-browser-'));
  for (let i = 0; i < 15; i++) { try { await rm(temp, { recursive: true, force: true }); break; } catch { await sleep(200); } }
}
