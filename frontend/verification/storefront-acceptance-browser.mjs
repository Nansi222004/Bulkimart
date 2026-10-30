import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from '../../backend/node_modules/dotenv/lib/main.js';
import { getCloudinaryConfig, CLOUDINARY_ENV_KEYS } from '../../backend/config/cloudinary.js';
import { v2 as cloudinary } from '../../backend/node_modules/cloudinary/cloudinary.js';
import { DEFAULT_EFFECT } from '../../backend/shared/celebration.mjs';

// Actual React components + actual authenticated Express/Mongoose marketing APIs.
// Synthetic local navigation context; full portal/cart/checkout remain covered by
// the existing storefront matrix. Real provider writes require explicit opt-in.
const mediaReportPath = process.argv.find(arg => arg.startsWith('--media-report='))?.slice('--media-report='.length);
const reusedMedia = mediaReportPath ? JSON.parse(await readFile(resolve(mediaReportPath), 'utf8')) : null;
if (reusedMedia) assert.ok(reusedMedia.completed && reusedMedia.liveMedia && /^bulkimart\/storefront-verification\/run-[a-f0-9-]+$/.test(reusedMedia.folder), 'Only completed synthetic verification uploads may be reused');
const liveMedia = process.argv.includes('--cloudinary') || !!reusedMedia;
const executable = process.env.CHROME_BIN || ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
assert.ok(executable, 'Installed Chrome or Edge is required');
const temp = await mkdtemp(join(tmpdir(), 'bulkimart-storefront-acceptance-'));
const artifacts = resolve('../test-artifacts'); await mkdir(artifacts, { recursive: true });
const allowed = new Set(['systemroot', 'windir', 'comspec', 'path', 'pathext', 'temp', 'tmp', 'userprofile', 'localappdata', 'appdata', 'homedrive', 'homepath', 'lang', 'number_of_processors', 'processor_architecture', 'os']);
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => allowed.has(key.toLowerCase())));
Object.assign(env, { NODE_ENV: 'test', MONGOMS_VERSION: '7.0.14' });
let folder = '', account = '';
if (reusedMedia) { folder = reusedMedia.folder; account = reusedMedia.account; }
else if (liveMedia) {
  const values = { ...dotenv.parse(await readFile(new URL('../../backend/.env', import.meta.url), 'utf8')), ...process.env };
  for (const key of CLOUDINARY_ENV_KEYS) if (values[key]) env[key] = values[key];
  const config = getCloudinaryConfig(env); account = config.cloud_name;
  cloudinary.config({ ...config, timeout: 15000 });
  await cloudinary.api.ping();
  folder = `bulkimart/storefront-verification/run-${crypto.randomUUID()}`;
  for (const type of ['image', 'video']) assert.equal((await cloudinary.api.resources({ resource_type: type, type: 'upload', prefix: folder + '/', max_results: 1 })).resources.length, 0, 'Fresh verification prefix must be empty');
  env.STOREFRONT_VERIFY_FOLDER = folder;
}
const backend = spawn(process.execPath, [fileURLToPath(new URL('../../backend/verification/storefront-acceptance-server.mjs', import.meta.url))], { env, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
let serverErrors = ''; backend.stderr.on('data', data => serverErrors += data);
let vite, browser, socket, sequence = 0, fixture, mediaOrigin = '';
const pending = new Map(), errors = [], checks = [], uploads = [];
backend.on('message', message => { if (message.uploaded) uploads.push(message.uploaded); });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function command(method, params = {}) {
  const id = ++sequence;
  return new Promise((resolve, reject) => { const timer = setTimeout(() => { pending.delete(id); reject(Error(`CDP timeout: ${method}`)); }, 15000); pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } }); socket.send(JSON.stringify({ id, method, params })); });
}
async function evaluate(expression) { const r = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; }
async function waitFor(expression, label = expression) { for (let i = 0; i < 150; i++) { if (await evaluate(expression)) return; await delay(100); } throw Error(`Acceptance condition timed out: ${label}`); }
async function click(text) { await waitFor(`[...document.querySelectorAll('button')].some(b=>b.textContent.trim()===${JSON.stringify(text)}&&!b.disabled)`, `enabled ${text} button`); await evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)}&&!b.disabled);b.click()})()`); await delay(100); }
async function field(label, value) { await evaluate(`(()=>{const l=[...document.querySelectorAll('label')].find(l=>l.textContent.trim().startsWith(${JSON.stringify(label)}));const e=l?.querySelector('input,select,textarea');if(!e)throw Error('Field unavailable: '+${JSON.stringify(label)});const p=e instanceof HTMLSelectElement?HTMLSelectElement.prototype:e instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(p,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event(e.tagName==='SELECT'?'change':'input',{bubbles:true}));})()`); await delay(100); }
async function uploadInput(label, file) { const doc = await command('DOM.getDocument'); const node = await command('DOM.querySelector', { nodeId: doc.root.nodeId, selector: `input[aria-label="${label}"]` }); assert.ok(node.nodeId, label); await command('DOM.setFileInputFiles', { nodeId: node.nodeId, files: [file] }); }
let origin;
async function api(path, method = 'GET', body, auth = false) {
  const response = await fetch(`${origin}${path}`, { method, headers: { ...(auth ? { Authorization: `Bearer ${fixture.adminToken}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const data = await response.json(); assert.ok(response.ok, `${method} ${path}: ${data.message || response.status}`); return data.data ?? data;
}
const publicExperience = () => api('/api/storefront/experience?scope=quick&device=mobile');
async function refresh() { await evaluate("window.dispatchEvent(new Event('online'))"); await delay(250); }
async function navigate(path) { await command('Page.navigate', { url: origin + path }); await waitFor('!!document.querySelector("#experience-state,.studio-workspace")'); }
try {
  fixture = await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(Error('Isolated storefront backend startup timed out')), 45000); backend.once('message', message => { clearTimeout(timer); resolve(message); }); backend.once('exit', () => { clearTimeout(timer); reject(Error(`Isolated backend exited: ${serverErrors.slice(0, 300)}`)); }); });
  assert.equal(fixture.ready, true);
  vite = await createServer({ envDir: false, define: { 'import.meta.env.VITE_API_BASE_URL': '""', 'import.meta.env.VITE_API_URL': '""' }, cacheDir: join(temp, 'vite-cache'), server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false, proxy: { '/api': `http://127.0.0.1:${fixture.port}`, '/uploads': `http://127.0.0.1:${fixture.port}` } }, plugins: [{
    name: 'isolated-storefront-context', enforce: 'pre',
    transform(_code, id) {
      const path = id.replaceAll('\\', '/');
      if (path.endsWith('/modules/User/context/UserContext.jsx')) return "import React from 'react'; export const AcceptanceUserContext=React.createContext({});export const useUser=()=>React.useContext(AcceptanceUserContext);";
      if (path.endsWith('/modules/Admin/context/AdminContext.jsx')) return "export const useAdmin=()=>({triggerToast:message=>window.__acceptanceToast=message,setActiveTab:()=>{}});";
    },
    configureServer(server) { server.middlewares.use(async (req, res, next) => {
      if (!req.url.startsWith('/acceptance/')) return next();
      res.setHeader('Content-Type', 'text/html');
      res.end(await server.transformIndexHtml(req.url, `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0"><div id="root"></div><script>localStorage.setItem('adminToken',${JSON.stringify(fixture.adminToken)});window.__rafPending=new Set();window.__rafScheduled=0;const request=window.requestAnimationFrame.bind(window),cancel=window.cancelAnimationFrame.bind(window);window.requestAnimationFrame=fn=>{let id=request(t=>{window.__rafPending.delete(id);fn(t)});window.__rafScheduled++;window.__rafPending.add(id);return id};window.cancelAnimationFrame=id=>{window.__rafPending.delete(id);cancel(id)};</script><script type="module" src="/verification/storefront-acceptance-entry.jsx"></script></body></html>`));
    }); },
  }] });
  await vite.listen(); origin = `http://127.0.0.1:${vite.httpServer.address().port}`;
  browser = spawn(executable, ['--headless=new', '--disable-gpu', '--remote-debugging-port=0', `--user-data-dir=${join(temp, 'profile')}`, '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-sync', '--disable-component-update', 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  let port; for (let i = 0; i < 100; i++) { try { port = Number((await readFile(join(temp, 'profile', 'DevToolsActivePort'), 'utf8')).split('\n')[0]); break; } catch { await delay(100); } }
  assert.ok(port, 'Browser debugging port');
  const target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page');
  socket = new WebSocket(target.webSocketDebuggerUrl); await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.id) { const task = pending.get(message.id); pending.delete(message.id); message.error ? task?.reject(Error(message.error.message)) : task?.resolve(message.result); }
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
    if (message.method === 'Fetch.requestPaused') { const url = new URL(message.params.request.url); const permitted = url.origin === origin || (liveMedia && url.hostname === 'res.cloudinary.com' && url.pathname.includes(`/${folder}/`)); command(permitted ? 'Fetch.continueRequest' : 'Fetch.failRequest', { requestId: message.params.requestId, ...(permitted ? {} : { errorReason: 'BlockedByClient' }) }).catch(() => {}); }
  };
  socket.onclose = () => { for (const task of pending.values()) task.reject(Error('Browser debugging connection closed')); pending.clear(); };
  await command('Page.enable'); await command('Runtime.enable'); await command('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
  await command('Emulation.setFocusEmulationEnabled', { enabled: true }); await command('Page.bringToFront');
  await command('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await navigate('/acceptance/admin');
  // Generate real decodable synthetic bytes using the installed browser's codec.
  const base64 = await evaluate(`(async()=>{const c=document.createElement('canvas');c.width=640;c.height=240;const ctx=c.getContext('2d'),stream=c.captureStream(20),r=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp8'}),chunks=[];let n=0;return await new Promise(resolve=>{r.ondataavailable=e=>chunks.push(e.data);r.onstop=async()=>{stream.getTracks().forEach(t=>t.stop());const b=new Uint8Array(await new Blob(chunks).arrayBuffer());let s='';for(const x of b)s+=String.fromCharCode(x);resolve(btoa(s))};r.start();const timer=setInterval(()=>{ctx.fillStyle=n%2?'#79000B':'#116B52';ctx.fillRect(0,0,640,240);ctx.fillStyle='#fff';ctx.font='30px sans-serif';ctx.fillText('Synthetic Bulkimart verification '+n,20,120);if(++n===24){clearInterval(timer);r.stop()}},50)})})()`);
  const videoFile = join(temp, 'synthetic.webm'); await writeFile(videoFile, Buffer.from(base64, 'base64'));
  const mediaReady = new Promise(resolve => { const handler = message => { if (message.mediaReady) { backend.off('message', handler); resolve(); } }; backend.on('message', handler); }); backend.send({ action: 'media', data: base64 }); await mediaReady;
  const posterFile = join(temp, 'poster.webp'); await writeFile(posterFile, Buffer.from(await (await fetch(`${origin}/uploads/storefront-acceptance/poster.webp`)).arrayBuffer()));
  await click('Promotional campaigns'); await click('+ Create campaign'); await field('Name', 'Synthetic video acceptance'); await click('+ Upload New Banner');
  await field('Media type', 'video');
  if (liveMedia && !reusedMedia) {
    await uploadInput('Upload Poster / image fallback (required)', posterFile); await waitFor('document.querySelector("input[aria-label=\\"Poster / image fallback (required)\\"]").value.startsWith("https://res.cloudinary.com/")', 'actual poster upload completes');
    await uploadInput('Upload Desktop video (required)', videoFile); await waitFor('document.querySelector("input[aria-label=\\"Desktop video (required)\\"]").value.startsWith("https://res.cloudinary.com/")', 'actual video upload completes');
    assert.equal(uploads.length, 2); assert.equal(uploads.find(u => u.type === 'video').format, 'mp4'); assert.ok(uploads.find(u => u.type === 'video').duration > 0); assert.ok(uploads.every(u => u.publicId.startsWith(folder + '/')));
    checks.push('real protected poster/video uploads and Cloudinary H264 MP4 processing');
  } else {
    await field('Poster / image fallback (required)', reusedMedia ? reusedMedia.uploads.find(u => u.type === 'image').url : '/uploads/storefront-acceptance/poster.webp');
    await field('Desktop video (required)', reusedMedia ? reusedMedia.uploads.find(u => u.type === 'video').url : '/uploads/storefront-acceptance/video.webm');
  }
  await field('Mobile image / poster', '/uploads/storefront-acceptance/mobile.webp'); await field('Mobile video', '/uploads/storefront-acceptance/video.webm');
  await waitFor('!!document.querySelector(".studio-preview video")&&!document.querySelector(".studio-preview video").paused&&document.querySelector(".studio-preview video").readyState>=2', 'desktop preview video decodes and plays');
  await click('Desktop'); await waitFor('!!document.querySelector(".studio-preview--desktop video")'); await click('Mobile'); await waitFor('!!document.querySelector(".studio-preview--mobile video")');
  checks.push('unsaved desktop/mobile preview uses actual video');
  await evaluate('document.querySelector(".studio-effect-fields input[type=checkbox]").click()'); await field('Preset', 'snowfall'); await field('Duration (seconds per viewing)', '120');
  await waitFor('!!document.querySelector(".studio-preview canvas.sf-celebration")');
  await click('Save draft'); await waitFor('!document.querySelector(".studio-editor")');
  let rows = await api('/api/admin/storefront?kind=campaign', 'GET', null, true), campaign = rows[0]; assert.equal(campaign.status, 'draft'); assert.equal((await publicExperience()).banners.length, 0); checks.push('draft saved through Studio and absent from public API');
  assert.equal(campaign.config.animation.enabled, true); assert.equal(campaign.config.animation.preset, 'snowfall'); assert.equal(campaign.config.animation.duration, 120); checks.push('animation controls preview and persist through the actual Studio form');
  await click('Publish'); await waitFor('document.querySelector(".studio-status")?.textContent==="active"');
  rows = await api('/api/admin/storefront?kind=campaign', 'GET', null, true); campaign = rows[0];
  const experience = await publicExperience(); assert.equal(experience.banners.length, 1); assert.equal(experience.banners[0].mediaType, 'video'); checks.push('publication through Studio resolves real public API configuration');
  await navigate('/acceptance/customer'); await command('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await waitFor('!!document.querySelector(".sf-hero video")&&!document.querySelector(".sf-hero video").paused&&document.querySelector(".sf-hero video").currentTime>0', 'public desktop video plays');
  assert.equal(await evaluate('(()=>{const v=document.querySelector(".sf-hero video");return v.muted&&v.playsInline&&v.autoplay&&v.loop})()'), true);
  if (liveMedia) assert.ok(await evaluate(`document.querySelector('.sf-hero video').currentSrc.includes(${JSON.stringify(folder)})`));
  checks.push(liveMedia ? 'real Cloudinary processed video decoded and muted inline autoplay confirmed' : 'local real WebM decoded and muted inline autoplay confirmed');
  const originalVideo = experience.banners[0].video, bannerId = experience.banners[0].id;
  await api(`/api/banners/${bannerId}`, 'PUT', { video: '/uploads/storefront-acceptance/missing.webm' }, true); await refresh();
  await waitFor('!!document.querySelector(".sf-hero-art img")&&document.querySelector(".sf-hero-art img").naturalWidth>0', 'genuine media 404 falls back to decoded poster');
  if (liveMedia) assert.ok(await evaluate(`document.querySelector('.sf-hero-art img').currentSrc.includes(${JSON.stringify(folder)})`));
  checks.push('genuine video HTTP failure displays decoded desktop poster');
  await api(`/api/banners/${bannerId}`, 'PUT', { video: originalVideo }, true); await refresh(); await waitFor('!!document.querySelector(".sf-hero video")&&!document.querySelector(".sf-hero video").paused');
  await evaluate('window.__nativePlay=HTMLMediaElement.prototype.play;HTMLMediaElement.prototype.play=function(){return Promise.reject(new DOMException("Synthetic autoplay rejection","NotAllowedError"))};void 0');
  await api(`/api/banners/${bannerId}`, 'PUT', { video: originalVideo + '?verify=autoplay-rejection' }, true); await refresh(); await waitFor('!!document.querySelector(".sf-hero-art img")');
  checks.push('injected browser autoplay rejection restores poster');
  await evaluate('HTMLMediaElement.prototype.play=window.__nativePlay;void 0'); await api(`/api/banners/${bannerId}`, 'PUT', { video: originalVideo }, true); await refresh();
  await command('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }); await waitFor('document.querySelector(".sf-hero video")?.currentSrc.includes("/uploads/storefront-acceptance/video.webm")'); checks.push('responsive mobile media selection');
  await evaluate('document.querySelector(".sf-hero video").dispatchEvent(new Event("error"))'); await waitFor('!!document.querySelector(".sf-hero-art img")'); assert.ok(await evaluate('document.querySelector(".sf-hero-art img").src.includes("mobile.webp")')); checks.push('video error returns to responsive poster');
  await command('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }); await refresh(); assert.equal(await evaluate('!!document.querySelector(".sf-hero video")'), false); checks.push('reduced motion suppresses video');
  await command('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
  async function setEffect(preset, extra = {}) { campaign = await api(`/api/admin/storefront/${campaign._id}`, 'PATCH', { ...campaign, config: { ...campaign.config, animation: { ...DEFAULT_EFFECT, enabled: true, preset, scope: 'homepage', duration: 120, ...extra } } }, true); campaign = await api(`/api/admin/storefront/${campaign._id}/actions/publish`, 'POST', { revision: campaign.revision }, true); await refresh(); }
  for (const preset of ['snowfall', 'confetti', 'petals', 'sparkles']) {
    await setEffect(preset); await waitFor('!!document.querySelector("canvas.sf-celebration")'); await delay(200);
    assert.ok(await evaluate('(()=>{const c=document.querySelector("canvas.sf-celebration"),d=c.getContext("2d").getImageData(0,0,c.width,c.height).data;return d.some((x,i)=>i%4===3&&x>0)})()'), `${preset} draws actual canvas pixels`);
    checks.push(`${preset} live configuration draws canvas pixels`);
  }
  await evaluate('window.__canvasBefore=document.querySelector("canvas.sf-celebration");void 0'); await refresh(); await refresh();
  assert.equal(await evaluate('window.__canvasBefore===document.querySelector("canvas.sf-celebration")&&document.querySelectorAll("canvas.sf-celebration").length===1&&window.__rafPending.size===1'), true); checks.push('configuration refresh retains one canvas and animation loop');
  await command('Emulation.setFocusEmulationEnabled', { enabled: false });
  const background = await command('Target.createTarget', { url: 'about:blank' }); await command('Target.activateTarget', { targetId: background.targetId });
  await waitFor('document.hidden'); await waitFor('window.__rafPending.size===0'); await command('Target.activateTarget', { targetId: target.id }); await command('Page.bringToFront'); await waitFor('!document.hidden&&window.__rafPending.size===1'); await command('Target.closeTarget', { targetId: background.targetId }); checks.push('real hidden-tab transition cancels and resumes one renderer loop');
  await click('Turn off celebrations'); await waitFor('!document.querySelector("canvas.sf-celebration")'); assert.equal(await evaluate('window.__rafPending.size'), 0); await click('Enable celebrations'); await waitFor('!!document.querySelector("canvas.sf-celebration")'); checks.push('customer opt-out cancels renderer and can be reversed');
  await command('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }); await waitFor('!document.querySelector("canvas.sf-celebration")'); assert.equal(await evaluate('window.__rafPending.size'), 0); await command('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] }); checks.push('live reduced-motion preference stops renderer');
  await evaluate('window.__acceptanceNavigate({activeNav:"checkout"})'); await waitFor('!document.querySelector("canvas.sf-celebration")'); assert.equal(await evaluate('window.__rafPending.size'), 0); await evaluate('window.__acceptanceNavigate({activeNav:"home"})'); await waitFor('!!document.querySelector("canvas.sf-celebration")'); checks.push('route changes remove inapplicable effects without duplicate loops');
  await setEffect('confetti', { scope: 'campaign', campaignId: fixture.dealId }); await waitFor('!document.querySelector("canvas.sf-celebration")'); await evaluate(`window.__acceptanceNavigate({selectedCampaignId:${JSON.stringify(fixture.dealId)}})`); await waitFor('!!document.querySelector("canvas.sf-celebration")'); await evaluate('window.__acceptanceNavigate({selectedCampaignId:"other"})'); await waitFor('!document.querySelector("canvas.sf-celebration")'); checks.push('campaign-page targeting');
  await evaluate('window.__acceptanceNavigate({activeNav:"home"})'); await setEffect('sparkles', { endAt: new Date(Date.now() + 2500).toISOString() }); await waitFor('!!document.querySelector("canvas.sf-celebration")'); await waitFor('!document.querySelector("canvas.sf-celebration")'); assert.equal((await publicExperience()).animations.length, 0); checks.push('effect expiry stops canvas and public configuration');
  campaign = await api(`/api/admin/storefront/${campaign._id}/actions/pause`, 'POST', { revision: campaign.revision }, true); await refresh(); await waitFor('!document.querySelector(".sf-hero video")&&!document.querySelector("canvas.sf-celebration")'); assert.equal((await publicExperience()).banners.length, 0); checks.push('pause removes public banner and effect');
  assert.deepEqual(errors, []); console.log(JSON.stringify({ passed: true, checks, widths: [390, 1280], provider: liveMedia ? 'real Cloudinary' : 'local synthetic media', folder, uploads, isolatedDatabase: true, syntheticNavigationContext: true }));
} finally {
  const report = JSON.stringify({ checks, errors, account, folder, uploads: reusedMedia ? reusedMedia.uploads : uploads, providerWrites: uploads.length, liveMedia, completed: checks.includes('pause removes public banner and effect') }, null, 2);
  await writeFile(join(artifacts, 'storefront-acceptance-results.json'), report);
  await writeFile(join(artifacts, `storefront-acceptance-${reusedMedia ? 'read-only-' + Date.now() : folder.split('/').at(-1) || 'local-' + Date.now()}.json`), report);
  socket?.close(); browser?.kill(); await vite?.close();
  if (backend.connected) { const exited = new Promise(resolve => backend.once('exit', resolve)); backend.send({ action: 'stop' }); await Promise.race([exited, delay(10000)]); } if (backend.exitCode === null) backend.kill();
  assert.equal(dirname(resolve(temp)), resolve(tmpdir())); assert.ok(basename(temp).startsWith('bulkimart-storefront-acceptance-')); await delay(300); await rm(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}
