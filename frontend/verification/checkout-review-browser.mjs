import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join, resolve, dirname, basename } from 'node:path';
import { tmpdir } from 'node:os';

const executable = process.env.CHROME_BIN || ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium'].find(existsSync);
assert.ok(executable, 'Chrome/Chromium is required');
const temp = await mkdtemp(join(tmpdir(), 'bulkimart-checkout-review-'));
const vite = await createServer({ define: { 'import.meta.env.VITE_API_BASE_URL': '""', 'import.meta.env.VITE_API_URL': '""' },
  server: { host: '127.0.0.1', port: 0, hmr: false }, plugins: [{ name: 'checkout-review-fixture', configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      if (!req.url.startsWith('/checkout-review-fixture')) return next();
      res.setHeader('Content-Type', 'text/html');
      res.end(await server.transformIndexHtml(req.url, '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body style="margin:0"><div id="root"></div><script type="module" src="/verification/checkout-review-browser-entry.jsx"></script></body></html>'));
    });
  } }] });
await vite.listen();
const origin = 'http://127.0.0.1:' + vite.httpServer.address().port;
const browser = spawn(executable, ['--headless=new', '--disable-gpu', '--remote-debugging-port=0', `--user-data-dir=${temp}`, '--no-first-run', '--disable-background-networking', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', 'about:blank'], { windowsHide: true, stdio: 'ignore' });
let socket, sequence = 0;
const pending = new Map(), errors = [], choosers = [];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function command(method, params = {}) {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(Error(method + ' timed out')); }, 15000);
    pending.set(id, { resolve: result => { clearTimeout(timer); resolve(result); }, reject: error => { clearTimeout(timer); reject(error); } });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
async function wait(expression) {
  for (let i = 0; i < 150; i++) { if (await evaluate(expression)) return; await pause(100); }
  throw Error('Waiting for ' + expression + '\n' + JSON.stringify(errors));
}
async function click(selector) {
  const { x, y } = await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  await command('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await command('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
}
try {
  let port;
  for (let i = 0; i < 100; i++) {
    try { port = Number((await readFile(join(temp, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); break; } catch { await pause(100); }
  }
  assert.ok(port, 'Browser starts');
  console.log('Browser started; connecting to local debugging session.');
  const target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(target => target.type === 'page');
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Browser debugging connection timed out')), 15000);
    socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
    socket.addEventListener('error', () => { clearTimeout(timer); reject(Error('Browser debugging connection failed')); }, { once: true });
  });
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.id) { const task = pending.get(message.id); pending.delete(message.id); message.error ? task?.reject(Error(message.error.message)) : task?.resolve(message.result); }
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
    if (message.method === 'Page.fileChooserOpened') choosers.push(message.params);
  });
  await command('Runtime.enable'); await command('Page.enable');
  await command('Page.setInterceptFileChooserDialog', { enabled: true });
  await command('Emulation.setDeviceMetricsOverride', { width: 390, height: 740, deviceScaleFactor: 1, mobile: true });
  await command('Page.navigate', { url: origin + '/checkout-review-fixture' });
  await wait("!!document.querySelector('.landmark-upload-trigger-btn')");
  console.log('Checking live camera capture, cancellation, permissions, and gallery.');
  assert.equal(await evaluate("document.querySelector('.basket-item').textContent.includes('Stock:')"), false);
  await click('.landmark-upload-trigger-btn');
  await wait("document.getElementById('root').inert");
  await pause(350);
  await evaluate(`window.fixture.streams=[];window.fixture.getUserMedia=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia=async options=>{window.fixture.cameraOptions=options;const stream=await window.fixture.getUserMedia(options);window.fixture.streams.push(stream);return stream;}`);
  await click('.landmark-option-btn.camera');
  await wait("!!document.querySelector('.landmark-capture-btn:not(:disabled)')");
  assert.equal(choosers.length, 0, 'Camera opens a live preview, never a gallery picker');
  assert.deepEqual(await evaluate('window.fixture.cameraOptions'), { video: { facingMode: { ideal: 'environment' } }, audio: false });
  await click('.landmark-capture-btn');
  await wait("window.fixture.uploads.length===1 && !!document.querySelector('.landmark-preview-card img')");
  const photo = await evaluate('window.fixture.uploads[0]');
  assert.equal(photo.name, 'landmark-photo.jpg'); assert.equal(photo.type, 'image/jpeg'); assert.ok(photo.size > 0);
  assert.equal(await evaluate("window.fixture.streams[0].getTracks().every(track=>track.readyState==='ended')"), true, 'Capture releases the camera');
  assert.equal(await evaluate("document.getElementById('root').inert"), false);
  await click('.landmark-remove-btn');
  await wait("!!document.querySelector('.landmark-upload-trigger-btn')");
  await click('.landmark-upload-trigger-btn');
  await wait("!!document.querySelector('.landmark-option-btn.gallery')"); await pause(350);
  await click('.landmark-option-btn.camera');
  await wait("!!document.querySelector('.landmark-capture-btn:not(:disabled)')");
  await click('.landmark-cancel-btn');
  assert.equal(await evaluate("window.fixture.streams[1].getTracks().every(track=>track.readyState==='ended')"), true, 'Cancel releases the camera');
  assert.equal(await evaluate('window.fixture.uploads.length'), 1);

  await click('.landmark-upload-trigger-btn'); await pause(350);
  await evaluate("navigator.mediaDevices.getUserMedia=async()=>{throw new DOMException('Denied','NotAllowedError')}");
  await click('.landmark-option-btn.camera');
  await wait("document.querySelector('.landmark-modal-sheet [role=alert]')?.textContent.includes('permission was denied')");
  assert.equal(choosers.length, 0, 'Denied camera access never opens the gallery automatically');

  // Closing a pending permission request must stop a stream that arrives late.
  await evaluate("navigator.mediaDevices.getUserMedia=()=>new Promise(resolve=>{window.fixture.grant=resolve})");
  await click('.landmark-option-btn.camera');
  await wait("!!window.fixture.grant");
  await click('.landmark-cancel-btn');
  await evaluate("(async()=>{const stream=await window.fixture.getUserMedia({video:true});window.fixture.lateStream=stream;window.fixture.grant(stream)})()");
  await wait("window.fixture.lateStream.getTracks().every(track=>track.readyState==='ended')");
  assert.equal(await evaluate('window.fixture.uploads.length'), 1);
  assert.equal(await evaluate("!!document.querySelector('.landmark-modal-overlay')"), false);

  await click('.landmark-upload-trigger-btn'); await pause(350);
  await click('.landmark-option-btn.gallery');
  for (let i = 0; i < 50 && !choosers.length; i++) await pause(100);
  assert.equal(choosers.length, 1, 'Gallery still opens');
  await command('DOM.setFileInputFiles', { backendNodeId: choosers[0].backendNodeId, files: [resolve('public/favicon.svg')] });
  await wait('window.fixture.uploads.length===2');

  await click('.landmark-remove-btn');
  await click('.landmark-upload-trigger-btn'); await pause(350);
  await evaluate("navigator.mediaDevices.getUserMedia=window.fixture.getUserMedia");
  await click('.landmark-option-btn.camera');
  await wait("!!document.querySelector('.landmark-capture-btn:not(:disabled)')");
  await evaluate("window.fixture.activeStream=document.querySelector('video').srcObject;window.fixture.unmount()");
  assert.equal(await evaluate("window.fixture.activeStream.getTracks().every(track=>track.readyState==='ended')"), true, 'Leaving the address form releases the camera');

  await command('Page.navigate', { url: origin + '/checkout-review-fixture?review' });
  console.log('Checking review scrolling and four large photo uploads.');
  await wait("!!document.querySelector('.write-review-page textarea')");
  assert.equal(await evaluate("document.querySelector('.write-review-page').scrollTop"), 0);
  await evaluate("document.querySelector('textarea').focus()");
  await command('Emulation.setDeviceMetricsOverride', { width: 390, height: 440, deviceScaleFactor: 1, mobile: true });
  await pause(500);
  assert.equal(await evaluate("(()=>{const r=document.querySelector('textarea').getBoundingClientRect();return r.top>=0&&r.bottom<=visualViewport.height})()"), true, 'Review field scrolls into the keyboard-sized viewport');
  await command('Emulation.setDeviceMetricsOverride', { width: 390, height: 740, deviceScaleFactor: 1, mobile: true });
  await evaluate(`(async()=>{
    const canvas=document.createElement('canvas');canvas.width=1600;canvas.height=1200;
    const context=canvas.getContext('2d'), image=context.createImageData(1600,1200);
    let seed=7;for(let i=0;i<image.data.length;i+=4){seed=(seed*1664525+1013904223)>>>0;image.data[i]=seed&255;image.data[i+1]=(seed>>>8)&255;image.data[i+2]=(seed>>>16)&255;image.data[i+3]=255;}
    context.putImageData(image,0,0);const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',0.96));
    window.fixture.originalPhotoBytes=blob.size;
    const data=new DataTransfer();for(let i=0;i<4;i++)data.items.add(new File([blob],'photo-'+i+'.jpg',{type:'image/jpeg'}));
    const input=document.querySelector('input[type=file]');input.files=data.files;input.dispatchEvent(new Event('change',{bubbles:true}));
    const field=document.querySelector('textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(field,'Delivered product review');field.dispatchEvent(new Event('input',{bubbles:true}));
  })()`);
  await wait("document.querySelectorAll('img[alt^=\"Review photo\"]').length===4");
  await evaluate("[...document.querySelectorAll('button')].find(button=>button.textContent.includes('Submit')).click()");
  await wait('window.fixture.backs===1');
  const submission = await evaluate('window.fixture.submissions[0]');
  assert.equal(submission.comment, 'Delivered product review');
  assert.equal(submission.photos.length, 4);
  assert.ok(submission.photos.every(photo => photo.size <= 192 * 1024));
  assert.ok(submission.bytes < 1024 * 1024);
  assert.ok(await evaluate('window.fixture.originalPhotoBytes > 1024 * 1024'));

  console.log('Checking delivery rating actions above the mobile footer and system safe area.');
  await command('Page.navigate', { url: origin + '/checkout-review-fixture?rating' });
  await wait("!!document.querySelector('.delivery-rating-card > button')");
  await click('.delivery-rating-card > button');
  await wait("!!document.querySelector('.delivery-rating-sheet')");
  await command('Emulation.setSafeAreaInsetsOverride', { insets: { top: 0, left: 0, right: 0, bottom: 34 } });
  for (const [width, height] of [[390, 740], [320, 568], [390, 440]]) {
    await command('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: true });
    await pause(350);
    await evaluate("document.querySelector('.delivery-rating-sheet').scrollTop=10000");
    const geometry = await evaluate(`(()=>{
      const buttons=[...document.querySelectorAll('.user-form-actions button')];
      return buttons.map(button=>{const r=button.getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,clickable:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===button}});
    })()`);
    assert.ok(geometry.every(button => button.top >= 0 && button.bottom <= height - 34 && button.left >= 0 && button.right <= width && button.clickable), JSON.stringify({ width, height, geometry }));
  }
  await click('[aria-label="Rate delivery 4 stars"]');
  await click('.user-form-actions button:last-child');
  await wait("document.querySelector('.delivery-rating-card').textContent.includes('4/5')");
  assert.equal(await evaluate('window.fixture.deliveryRating'), 4);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, camera: true, gallery: true, reviewScroll: true, mobileRatingActions: true, fourPhotoRequestBytes: submission.bytes }));
} finally {
  socket?.close(); browser.kill(); await vite.close();
  assert.equal(dirname(resolve(temp)), resolve(tmpdir())); assert.ok(basename(temp).startsWith('bulkimart-checkout-review-'));
  for (let i = 0; i < 15; i++) { try { await rm(temp, { recursive: true, force: true }); break; } catch { await pause(200); } }
}
