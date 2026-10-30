import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_EFFECT, EFFECT_COLORS } from '../../backend/shared/celebration.mjs';
import { PRESETS, DEFAULT_HEADER, DEFAULT_COUNTDOWN } from '../../backend/shared/storefront.mjs';

// Real customer app at /grocery--home and the real Storefront Studio, against the
// isolated in-memory storefront backend. Nothing is published outside that database.
const executable = process.env.CHROME_BIN || ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
assert.ok(executable, 'Installed Chrome or Edge is required');
const temp = await mkdtemp(join(tmpdir(), 'bulkimart-festive-'));
const artifacts = resolve('../test-artifacts/festive-header'); await mkdir(artifacts, { recursive: true });
const allowed = new Set(['systemroot', 'windir', 'comspec', 'path', 'pathext', 'temp', 'tmp', 'userprofile', 'localappdata', 'appdata', 'homedrive', 'homepath', 'lang', 'number_of_processors', 'processor_architecture', 'os']);
const env = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => allowed.has(key.toLowerCase()))), NODE_ENV: 'test', MONGOMS_VERSION: '7.0.14' };
const backend = spawn(process.execPath, [fileURLToPath(new URL('../../backend/verification/storefront-acceptance-server.mjs', import.meta.url))], { env, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
let serverErrors = ''; backend.stderr.on('data', data => serverErrors += data);
const delay = ms => new Promise(r => setTimeout(r, ms));
const pending = new Map(), exceptions = [], failedRequests = new Set(), checks = [];
let socket, browser, customerVite, adminVite, sequence = 0, fixture, origin, adminOrigin;
function command(method, params = {}) {
  const id = ++sequence;
  return new Promise((ok, fail) => { const timer = setTimeout(() => { pending.delete(id); fail(Error(`CDP timeout: ${method}`)); }, 20000); pending.set(id, { resolve: v => { clearTimeout(timer); ok(v); }, reject: e => { clearTimeout(timer); fail(e); } }); socket.send(JSON.stringify({ id, method, params })); });
}
async function evaluate(expression) { const r = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; }
async function waitFor(expression, label = expression) { for (let i = 0; i < 150; i++) { if (await evaluate(expression)) return; await delay(100); } throw Error(`Timed out: ${label}`); }
async function field(label, value) { await evaluate(`(()=>{const l=[...document.querySelectorAll('label')].find(l=>l.textContent.trim().startsWith(${JSON.stringify(label)}));const e=l?.querySelector('input,select,textarea');if(!e)throw Error('Field unavailable: '+${JSON.stringify(label)});const p=e instanceof HTMLSelectElement?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(p,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event(e.tagName==='SELECT'?'change':'input',{bubbles:true}));})()`); await delay(120); }
async function check(label) { await evaluate(`(()=>{const l=[...document.querySelectorAll('label')].find(l=>l.textContent.trim().startsWith(${JSON.stringify(label)}));l.querySelector('input').click()})()`); await delay(120); }
async function click(text) { await waitFor(`[...document.querySelectorAll('button')].some(b=>b.textContent.trim()===${JSON.stringify(text)}&&!b.disabled)`, `button ${text}`); await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)}&&!b.disabled).click()`); await delay(150); }
async function api(path, method = 'GET', body) {
  const response = await fetch(`http://127.0.0.1:${fixture.port}${path}`, { method, headers: { Authorization: `Bearer ${fixture.adminToken}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const data = await response.json(); assert.ok(response.ok, `${method} ${path}: ${data.message || response.status}`); return data.data ?? data;
}
async function screenshot(name) { const { data } = await command('Page.captureScreenshot', { format: 'png' }); await writeFile(join(artifacts, `${name}.png`), Buffer.from(data, 'base64')); }
async function viewport(width) { const height = width < 600 ? 844 : width < 1000 ? 1024 : 900; await command('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 1000 }); await delay(400); }
const refresh = async () => { await evaluate("window.dispatchEvent(new Event('online'))"); await delay(600); };
// Measures the real layout: the decorative canvas must sit inside the festive header.
const MEASURE = `(() => {
  const f = document.querySelector('.sf-festive'); if (!f) return null;
  // The customer shell scrolls inside its own container, not the window.
  const top = () => { window.scrollTo(0, 0); for (const e of document.querySelectorAll('*')) if (e.scrollTop) e.scrollTop = 0; };
  const c = f.querySelector('canvas.sf-celebration'), r = e => { const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height, right: b.right, bottom: b.bottom }; };
  const at = e => { if (!e) return null; e.scrollIntoView({ block: 'center' }); const b = e.getBoundingClientRect(); return e.contains(document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)); };
  top();
  const search = document.querySelector('.header-search-row--mobile .search-bar-pill, .header-search-row--desktop .search-bar-pill');
  const visibleSearch = [...document.querySelectorAll('.search-bar-pill')].find(e => e.getBoundingClientRect().width > 0);
  const searchHit = visibleSearch ? (() => { const b = visibleSearch.getBoundingClientRect(), hit = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2); window.__searchProbe = { rect: [b.x, b.y, b.width, b.height], hit: hit && (hit.tagName + '.' + hit.className), parent: visibleSearch.parentElement.className }; return visibleSearch.contains(hit); })() : null;
  const out = { festive: r(f), canvas: c ? r(c) : null, canvasCount: document.querySelectorAll('canvas.sf-celebration').length,
    fixedDecor: [...document.querySelectorAll('canvas, .sf-festive *')].filter(e => getComputedStyle(e).position === 'fixed').length,
    position: c && getComputedStyle(c).position, pointer: c && getComputedStyle(c).pointerEvents, overflow: getComputedStyle(f).overflow,
    pixels: c ? (() => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) n++; return n; })() : 0,
    scrollWidth: document.documentElement.scrollWidth, innerWidth, searchHit, countdown: f.querySelector('.sf-festive-countdown')?.textContent || '', title: f.querySelector('h2')?.textContent };
  out.ctaHit = at(f.querySelector('.sf-cta')); out.toggles = document.querySelectorAll('.sf-decoration-toggle').length;
  const below = document.querySelector('.sf-hero, .sf-hero-default, .quick-actions-container, .popular-categories-container');
  out.belowHit = below ? at(below) : null; out.belowHasCanvas = !!below?.querySelector('canvas');
  const nav = [...document.querySelectorAll('.bottom-nav-bar, .bottom-nav')].find(e => e.getBoundingClientRect().height > 0);
  top(); out.searchProbe = window.__searchProbe;
  if (nav) { const b = nav.getBoundingClientRect(); out.navVisible = b.bottom <= innerHeight + 1 && b.top < innerHeight; out.navHit = nav.contains(document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)); }
  return out;
})()`;
function assertBounded(m, label) {
  assert.ok(m, `${label}: festive header renders`);
  assert.ok(m.canvas, `${label}: animation canvas renders`);
  for (const [a, b] of [['x', 'x'], ['y', 'y'], ['right', 'right'], ['bottom', 'bottom']]) assert.ok(Math.abs(m.canvas[a] - m.festive[b]) < 1, `${label}: canvas ${a} equals header ${b} ${JSON.stringify(m)}`);
  assert.equal(m.canvasCount, 1, `${label}: exactly one decorative canvas on the page`);
  assert.equal(m.fixedDecor, 0, `${label}: no viewport-fixed decorative layer`);
  assert.equal(m.position, 'absolute'); assert.equal(m.pointer, 'none'); assert.equal(m.overflow, 'hidden');
  assert.ok(m.scrollWidth <= m.innerWidth, `${label}: no horizontal overflow (${m.scrollWidth} > ${m.innerWidth})`);
  if (m.searchHit !== null) assert.equal(m.searchHit, true, `${label}: search bar receives pointer input ${JSON.stringify(m.searchProbe)}`);
  assert.equal(m.ctaHit, true, `${label}: festive CTA receives pointer input above the animation`);
  assert.equal(m.toggles, 0, `${label}: no customer turn-off button`);
  if (m.belowHit !== null) { assert.equal(m.belowHit, true, `${label}: content below the header is unobstructed`); assert.equal(m.belowHasCanvas, false); }
  if (m.navVisible !== undefined) { assert.equal(m.navVisible, true, `${label}: bottom navigation visible`); assert.equal(m.navHit, true, `${label}: bottom navigation clickable`); }
}
const header = (patch = {}) => ({ ...DEFAULT_HEADER, enabled: true, title: 'Festive Sale', subtitle: 'Lights, gifts and great prices', target: 'categories', cta: 'Shop now', height: 190, background: PRESETS['Diwali Celebration'].header, text: '#FFFFFF', ...patch });
const effect = (preset, patch = {}) => ({ ...DEFAULT_EFFECT, enabled: true, preset, colors: [...EFFECT_COLORS[preset]], scope: 'homepage', duration: 0, intensity: 'high', opacity: 0.8, ...patch });
let themeRow;
async function publishTheme(config, name = 'Festive verification') {
  const payload = { kind: 'theme', name, scope: 'global', config: { preset: 'Diwali Celebration', tokens: PRESETS['Diwali Celebration'], ...config } };
  // Editing a live theme saves its draft; publishing then activates that draft.
  themeRow = themeRow ? await api(`/api/admin/storefront/${themeRow._id}`, 'PATCH', { ...payload, revision: themeRow.revision, draftRevision: themeRow.draft?.revision }) : await api('/api/admin/storefront', 'POST', payload);
  themeRow = await api(`/api/admin/storefront/${themeRow._id}/actions/publish`, 'POST', { revision: themeRow.revision, draftRevision: themeRow.draft?.revision });
}
const LIVE_NAME = 'Draft workflow theme';
async function cardClick(name, label) {
  await waitFor(`[...document.querySelectorAll('.studio-record')].some(c=>c.querySelector('h2')?.textContent===${JSON.stringify(name)}&&[...c.querySelectorAll('button')].some(b=>b.textContent.trim()===${JSON.stringify(label)}&&!b.disabled))`, `${label} on ${name}`);
  await evaluate(`[...[...document.querySelectorAll('.studio-record')].find(c=>c.querySelector('h2')?.textContent===${JSON.stringify(name)}).querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)}).click()`); await delay(200);
}
async function customerTitle(expected) {
  await command('Page.navigate', { url: `${origin}/grocery--home` });
  await waitFor(`document.querySelector(".sf-festive h2")?.textContent===${JSON.stringify(expected)}`, `customer storefront shows "${expected}"`);
  return evaluate('document.querySelectorAll(".sf-festive canvas.sf-celebration").length');
}
async function openStudio() { await command('Page.navigate', { url: `${adminOrigin}/acceptance/admin` }); await waitFor(`[...document.querySelectorAll('.studio-record h2')].some(h=>h.textContent===${JSON.stringify(LIVE_NAME)})`, 'Studio list'); }
const liveRow = async () => (await api('/api/admin/storefront?kind=theme&limit=50')).find(r => r.name === LIVE_NAME && ['published', 'paused'].includes(r.status));
async function pixelsDrawn() { for (let i = 0; i < 40; i++) { const n = await evaluate(`(()=>{const c=document.querySelector('.sf-festive canvas.sf-celebration');if(!c)return 0;const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let n=0;for(let i=3;i<d.length;i+=4)if(d[i])n++;return n})()`); if (n > 0) return n; await delay(100); } return 0; }
try {
  fixture = await new Promise((ok, fail) => { const t = setTimeout(() => fail(Error('Backend startup timed out')), 60000); backend.once('message', m => { clearTimeout(t); ok(m); }); backend.once('exit', () => { clearTimeout(t); fail(Error(`Backend exited: ${serverErrors.slice(0, 400)}`)); }); });
  const proxy = { '/api': `http://127.0.0.1:${fixture.port}`, '/uploads': `http://127.0.0.1:${fixture.port}` };
  const define = { 'import.meta.env.VITE_API_BASE_URL': '""', 'import.meta.env.VITE_API_URL': '""' };
  customerVite = await createServer({ envDir: false, define, cacheDir: join(temp, 'vite-customer'), server: { host: '127.0.0.1', port: 0, hmr: false, proxy } });
  await customerVite.listen(); origin = `http://127.0.0.1:${customerVite.httpServer.address().port}`;
  // Studio runs with the existing acceptance entry (isolated Admin/User contexts).
  adminVite = await createServer({ envDir: false, define, cacheDir: join(temp, 'vite-admin'), server: { host: '127.0.0.1', port: 0, hmr: false, proxy }, plugins: [{ name: 'isolated-admin', enforce: 'pre',
    transform(_code, id) { const path = id.replaceAll('\\', '/');
      if (path.endsWith('/modules/User/context/UserContext.jsx')) return "import React from 'react'; export const AcceptanceUserContext=React.createContext({});export const useUser=()=>React.useContext(AcceptanceUserContext);";
      if (path.endsWith('/modules/Admin/context/AdminContext.jsx')) return "export const useAdmin=()=>({triggerToast:message=>window.__toast=message,setActiveTab:()=>{}});"; },
    configureServer(server) { server.middlewares.use(async (req, res, next) => { if (!req.url.startsWith('/acceptance/')) return next(); res.setHeader('Content-Type', 'text/html');
      res.end(await server.transformIndexHtml(req.url, `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0"><div id="root"></div><script>localStorage.setItem('adminToken',${JSON.stringify(fixture.adminToken)})</script><script type="module" src="/verification/storefront-acceptance-entry.jsx"></script></body></html>`)); }); } }] });
  await adminVite.listen(); adminOrigin = `http://127.0.0.1:${adminVite.httpServer.address().port}`;
  browser = spawn(executable, ['--headless=new', '--disable-gpu', '--remote-debugging-port=0', `--user-data-dir=${join(temp, 'profile')}`, '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-sync', '--disable-component-update', 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  let port; for (let i = 0; i < 100 && !port; i++) { try { port = Number((await readFile(join(temp, 'profile', 'DevToolsActivePort'), 'utf8')).split('\n')[0]); } catch { await delay(100); } }
  const target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page');
  socket = new WebSocket(target.webSocketDebuggerUrl); await new Promise((ok, fail) => { socket.onopen = ok; socket.onerror = fail; });
  socket.onmessage = event => {
    const m = JSON.parse(event.data);
    if (m.id) { const task = pending.get(m.id); pending.delete(m.id); m.error ? task?.reject(Error(m.error.message)) : task?.resolve(m.result); }
    if (m.method === 'Runtime.exceptionThrown') exceptions.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    if (m.method === 'Network.responseReceived' && m.params.response.status >= 400) failedRequests.add(`${m.params.response.status} ${new URL(m.params.response.url).pathname}`);
    if (m.method === 'Fetch.requestPaused') { const url = new URL(m.params.request.url), ok = url.origin === origin || url.origin === adminOrigin; command(ok ? 'Fetch.continueRequest' : 'Fetch.failRequest', { requestId: m.params.requestId, ...(ok ? {} : { errorReason: 'BlockedByClient' }) }).catch(() => {}); }
  };
  await command('Page.enable'); await command('Runtime.enable'); await command('Network.enable'); await command('Fetch.enable', { patterns: [{ urlPattern: '*' }] });

  // 1. Publish a Diwali theme with a festive header, a sale countdown and Festive Lights.
  const saleStart = new Date(Date.now() + 2 * 3600000 + 5 * 60000).toISOString(), saleEnd = new Date(Date.now() + 26 * 3600000).toISOString();
  await publishTheme({ header: header({ countdown: { ...DEFAULT_COUNTDOWN, enabled: true, title: 'Diwali Sale', startAt: saleStart, endAt: saleEnd } }), animation: effect('lights') });
  await viewport(390); await command('Page.navigate', { url: `${origin}/grocery--home` });
  await waitFor('!!document.querySelector(".sf-festive canvas.sf-celebration")', 'published festive header and canvas mount');
  await delay(1500);
  for (const width of [360, 390, 430, 768, 1024, 1440]) {
    await viewport(width); await waitFor('!!document.querySelector(".sf-festive canvas.sf-celebration")', `festive canvas at ${width}`); await delay(500);
    const m = await evaluate(MEASURE); assertBounded(m, `lights@${width}`);
    assert.ok(await pixelsDrawn() > 0, `lights@${width}: canvas draws pixels`);
    assert.match(m.countdown, /Diwali Sale · Starts in.*0?2:0\d:\d\d/, `before-sale countdown at ${width}: ${m.countdown}`);
    await screenshot(`lights-${width}`); checks.push(`lights ${width}px: canvas == header box, 1 canvas, no fixed layer, no h-overflow, search/CTA/below/bottom-nav clickable, countdown "Starts in"`);
  }
  // 2. Each preset, switched from Admin, renders only inside the header.
  await viewport(390);
  for (const preset of ['snowfall', 'petals', 'fireworks']) {
    await publishTheme({ header: header(), animation: effect(preset, preset === 'petals' ? { direction: 'right' } : {}) }); await refresh();
    await waitFor(`document.querySelector(".sf-festive canvas.sf-celebration")?.dataset.preset===${JSON.stringify(preset)}`, `${preset} canvas`);
    await delay(800); assertBounded(await evaluate(MEASURE), `${preset}@390`); assert.ok(await pixelsDrawn() > 0, `${preset} draws pixels`);
    await screenshot(`${preset}-390`); await viewport(1440); await delay(600); assertBounded(await evaluate(MEASURE), `${preset}@1440`); await screenshot(`${preset}-1440`); await viewport(390);
    checks.push(`${preset}: switched via Admin API, bounded at 390px and 1440px`);
  }
  // 3. Countdown during and after the sale, from persisted dates.
  await publishTheme({ header: header({ countdown: { ...DEFAULT_COUNTDOWN, enabled: true, title: 'Diwali Sale', startAt: new Date(Date.now() - 60000).toISOString(), endAt: new Date(Date.now() + 3600000).toISOString() } }), animation: effect('lights') }); await refresh();
  await waitFor('/Ends in/.test(document.querySelector(".sf-festive-countdown")?.textContent||"")', 'during-sale countdown');
  await publishTheme({ header: header({ countdown: { ...DEFAULT_COUNTDOWN, enabled: true, startAt: new Date(Date.now() - 7200000).toISOString(), endAt: new Date(Date.now() + 4000).toISOString(), expiredText: 'Sale ended — see you soon' } }), animation: effect('lights') }); await refresh();
  await waitFor('/Ends in/.test(document.querySelector(".sf-festive-countdown")?.textContent||"")', 'short sale running'); await delay(4500);
  await waitFor('/Sale ended/.test(document.querySelector(".sf-festive-countdown")?.textContent||"")', 'expired countdown shows fallback text');
  checks.push('countdown: "Starts in" before, "Ends in" during, configured fallback after expiry (live clock, no negative values)');
  // 4. Reduced motion, disabling the animation, draft isolation, pause.
  await command('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }); await waitFor('!document.querySelector("canvas.sf-celebration")', 'reduced motion hides animation');
  await publishTheme({ header: header(), animation: effect('fireworks', { reducedMotion: 'static' }) }); await refresh();
  await waitFor('!!document.querySelector(".sf-festive canvas.sf-celebration")', 'static fallback renders'); assert.ok(await pixelsDrawn() > 0, 'static frame drawn');
  await command('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
  checks.push('no customer opt-out button, reduced motion hides by default and shows a still frame when configured');
  await publishTheme({ header: header(), animation: effect('lights', { enabled: false }) }); await refresh();
  await waitFor('!!document.querySelector(".sf-festive")&&!document.querySelector("canvas.sf-celebration")', 'disabled animation keeps header without canvas');
  checks.push('disabling the animation removes all decorative canvases and keeps the header');
  await publishTheme({ header: header({ title: 'Published title' }), animation: effect('lights') }); await refresh(); await waitFor('document.querySelector(".sf-festive h2")?.textContent==="Published title"');
  await api('/api/admin/storefront', 'POST', { kind: 'theme', name: 'Unpublished draft', scope: 'global', priority: 900, config: { preset: 'Winter Snowfall', tokens: PRESETS['Winter Snowfall'], header: header({ title: 'Draft only title' }), animation: effect('snowfall') } });
  await refresh(); await delay(500); assert.equal(await evaluate('document.querySelector(".sf-festive h2")?.textContent'), 'Published title');
  checks.push('a separate draft theme does not reach the storefront');
  themeRow = await api(`/api/admin/storefront/${themeRow._id}/actions/pause`, 'POST', { revision: themeRow.revision }); await refresh();
  await waitFor('!document.querySelector(".sf-festive")&&!document.querySelector("canvas.sf-celebration")&&!!document.querySelector(".sf-hero, .sf-hero-default")', 'pause restores the default storefront');
  checks.push('pausing the theme removes header and animation; default storefront remains');
  // 5. Without a festive header, a homepage effect is hosted by the hero banner, still clipped.
  themeRow = null; await publishTheme({ header: { ...DEFAULT_HEADER }, animation: effect('snowfall') }); await refresh();
  await waitFor('!!document.querySelector(".sf-hero canvas.sf-celebration")', 'hero hosts the page effect');
  const hero = await evaluate(`(()=>{const h=document.querySelector('.sf-hero'),c=h.querySelector('canvas'),a=h.getBoundingClientRect(),b=c.getBoundingClientRect();return {inside:b.x>=a.x-1&&b.y>=a.y-1&&b.right<=a.right+1&&b.bottom<=a.bottom+1,count:document.querySelectorAll('canvas.sf-celebration').length,overflow:getComputedStyle(h).overflow,fixed:getComputedStyle(c).position}})()`);
  assert.deepEqual(hero, { inside: true, count: 1, overflow: 'hidden', fixed: 'absolute' }); await screenshot('hero-fallback-390');
  checks.push('legacy/no-header themes: effect is clipped inside the hero banner');
  // 6. Admin Studio: live preview renders the real festive header; saving keeps it a draft.
  await viewport(1440); await command('Page.navigate', { url: `${adminOrigin}/acceptance/admin` }); await waitFor('!!document.querySelector(".studio-workspace")');
  await click('+ Create theme'); await field('Name', 'Studio preview check'); await field('Theme preset', 'New Year Celebration');
  await check('Show festive header'); await field('Header title', 'New Year Countdown'); await check('Show sale countdown'); await field('Sale end · IST', '2031-01-01T00:00');
  await waitFor('!!document.querySelector(".studio-preview .sf-festive canvas.sf-celebration")', 'preview festive header with animation');
  const preview = await evaluate(`(()=>{const p=document.querySelector('.studio-preview'),f=p.querySelector('.sf-festive'),c=f.querySelector('canvas'),a=f.getBoundingClientRect(),b=c.getBoundingClientRect();return {preset:c.dataset.preset,count:p.querySelectorAll('canvas').length,match:Math.abs(a.x-b.x)<1&&Math.abs(a.y-b.y)<1&&Math.abs(a.right-b.right)<1&&Math.abs(a.bottom-b.bottom)<1,countdown:f.querySelector('.sf-festive-countdown')?.textContent||''}})()`);
  assert.equal(preview.preset, 'fireworks'); assert.equal(preview.count, 1); assert.equal(preview.match, true); assert.match(preview.countdown, /Ends in/);
  await screenshot('studio-preview-1440');
  await click('Save draft'); await waitFor('window.__toast==="Draft saved. Publish when ready."', 'draft saved');
  const publicData = await fetch(`http://127.0.0.1:${fixture.port}/api/storefront/experience?scope=quick&device=mobile`).then(r => r.json());
  assert.notEqual(publicData.data.theme.header?.title, 'New Year Countdown', 'Studio draft is not public');
  checks.push('Studio: preset suggests Fireworks, preview shows the real festive header with one bounded canvas and a live countdown; Save draft does not publish');
  // 7. Safe draft editing of a live theme through the real Studio and the real storefront.
  themeRow = await api(`/api/admin/storefront/${themeRow._id}/actions/pause`, 'POST', { revision: themeRow.revision }); themeRow = null;
  await publishTheme({ header: header({ title: 'Live title' }), animation: effect('lights') }, LIVE_NAME);
  const liveVersion = (await fetch(`http://127.0.0.1:${fixture.port}/api/storefront/experience?scope=quick&device=mobile`).then(r => r.json())).data.version;
  assert.equal(await customerTitle('Live title'), 1);
  await openStudio(); await cardClick(LIVE_NAME, 'Edit & preview');
  await field('Header title', 'Draft title'); await field('Preset (animation type)', 'snowfall');
  await waitFor('document.querySelector(".studio-preview .sf-festive h2")?.textContent==="Draft title"&&document.querySelector(".studio-preview .sf-festive canvas")?.dataset.preset==="snowfall"', 'draft previews in the real festive header');
  await screenshot('studio-live-draft-1440');
  await click('Save draft'); await waitFor('window.__toast==="Draft saved. The live version is unchanged until you publish this draft."', 'live-draft toast');
  assert.equal((await fetch(`http://127.0.0.1:${fixture.port}/api/storefront/experience?scope=quick&device=mobile`).then(r => r.json())).data.version, liveVersion, 'public payload unchanged by draft save');
  assert.equal(await customerTitle('Live title'), 1); assert.equal(await evaluate('document.querySelector(".sf-festive canvas").dataset.preset'), 'lights');
  checks.push('editing a live theme in Studio saves a draft; the public payload version and the rendered storefront (title, lights preset) stay unchanged');
  await openStudio(); await waitFor('/Unpublished draft saved/.test(document.body.textContent)', 'pending draft shown on card');
  await cardClick(LIVE_NAME, 'Edit draft & preview');
  assert.equal(await evaluate(`[...document.querySelectorAll('label')].find(l=>l.textContent.trim().startsWith('Header title')).querySelector('input').value`), 'Draft title');
  await waitFor('document.querySelector(".studio-preview .sf-festive h2")?.textContent==="Draft title"');
  checks.push('reloading Studio reopens the saved draft (fields and festive preview)');
  // Cancel with unsaved edits abandons them; the saved draft and the live version remain.
  await field('Header title', 'Abandoned edit'); await click('Cancel'); await click('Discard changes');
  await waitFor('!document.querySelector(".studio-editor")', 'editor closed');
  assert.equal((await liveRow()).draft.values.config.header.title, 'Draft title'); assert.equal(await customerTitle('Live title'), 1);
  checks.push('cancelling an edit abandons unsaved changes without touching the saved draft or the live version');
  // Concurrent edit: another admin saves the draft while this editor is open.
  await openStudio(); await cardClick(LIVE_NAME, 'Edit draft & preview'); await field('Header title', 'Stale editor');
  const other = await liveRow();
  await api(`/api/admin/storefront/${other._id}`, 'PATCH', { ...other, ...other.draft.values, revision: other.revision, draftRevision: other.draft.revision, config: { ...other.draft.values.config, header: header({ title: 'Other admin draft' }) } });
  await click('Save draft'); await waitFor('/This draft changed\\. Reload/.test(document.querySelector(".studio-error")?.textContent||"")', 'stale editor gets 409');
  assert.equal((await liveRow()).draft.values.config.header.title, 'Other admin draft'); assert.equal(await customerTitle('Live title'), 1);
  checks.push('a stale editor cannot overwrite a newer draft (409 shown in Studio); live unchanged');
  // Publish the draft from the list, then roll back with the existing mechanism.
  await openStudio(); await cardClick(LIVE_NAME, 'Publish draft');
  await waitFor('window.__toast==="Configuration updated."', 'draft published');
  assert.equal(await customerTitle('Other admin draft'), 1); assert.equal(await evaluate('document.querySelector(".sf-festive canvas").dataset.preset'), 'snowfall'); // the draft's animation went live too
  await screenshot('published-draft-1440');
  checks.push('publishing the draft updates the storefront in one step');
  await openStudio(); await cardClick(LIVE_NAME, 'Rollback'); await click('Continue'); await waitFor('window.__toast==="Configuration updated."');
  assert.equal(await customerTitle('Live title'), 1);
  checks.push('rollback restores the previous published version');
  // Discard: a new draft can be thrown away from the list without affecting live.
  const rolled = await liveRow();
  await api(`/api/admin/storefront/${rolled._id}`, 'PATCH', { ...rolled, revision: rolled.revision, draftRevision: 0, config: { ...rolled.config, header: header({ title: 'To discard' }) } });
  await openStudio(); await cardClick(LIVE_NAME, 'Discard draft'); await click('Discard changes');
  await waitFor('window.__toast==="Draft discarded. The live version is unchanged."');
  assert.equal((await liveRow()).draft, null); assert.equal(await customerTitle('Live title'), 1);
  checks.push('discarding a draft from the list removes it and keeps the live version');
  assert.deepEqual(exceptions, [], 'No uncaught page exceptions');
  console.log(JSON.stringify({ passed: true, checks, failedRequests: [...failedRequests], screenshots: artifacts }, null, 2));
} finally {
  await writeFile(join(artifacts, 'results.json'), JSON.stringify({ checks, exceptions, failedRequests: [...failedRequests] }, null, 2));
  socket?.close(); browser?.kill(); await customerVite?.close(); await adminVite?.close();
  if (backend.connected) { const exited = new Promise(r => backend.once('exit', r)); backend.send({ action: 'stop' }); await Promise.race([exited, delay(10000)]); } if (backend.exitCode === null) backend.kill();
  await delay(300); await rm(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}
