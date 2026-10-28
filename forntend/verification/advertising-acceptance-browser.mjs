import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {mkdtemp,mkdir,readFile,rm} from 'node:fs/promises';
import {join,resolve,dirname,basename} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';

// This runner cannot load developer .env or reach Razorpay. It verifies the real
// portal workspaces and authenticated APIs up to the external acceptance gate.
const executable=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
assert.ok(executable,'Installed Chrome or Edge is required');
const temp=await mkdtemp(join(tmpdir(),'bulkimart-ad-acceptance-')),profile=join(temp,'profile');await mkdir(profile);
const allowed=new Set(['systemroot','windir','comspec','path','pathext','temp','tmp','userprofile','localappdata','appdata','homedrive','homepath','home','lang','lc_all','number_of_processors','processor_architecture','os']);
const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>allowed.has(key.toLowerCase())));Object.assign(env,{NODE_ENV:'test',MONGOMS_VERSION:'7.0.14'});
const backend=spawn(process.execPath,[fileURLToPath(new URL('../../backend/verification/advertising-acceptance-server.mjs',import.meta.url))],{env,windowsHide:true,stdio:['ignore','ignore','ignore','ipc']});
let vite,browser,socket,sequence=0,failPlacements=false;const pending=new Map(),errors=[],checks=[];
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function command(method,params={}){const id=++sequence;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(Error(`CDP timeout: ${method}`));},15000);pending.set(id,{resolve:r=>{clearTimeout(timer);resolve(r);},reject:e=>{clearTimeout(timer);reject(e);}});socket.send(JSON.stringify({id,method,params}));});}
async function evaluate(expression){const r=await command('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error('Browser evaluation failed');return r.result.value;}
async function waitFor(expression){for(let i=0;i<120;i++){if(await evaluate(expression))return;await delay(100);}throw Error(`Timed out waiting for acceptance condition: ${expression}`);}
const has=text=>`document.body.innerText.includes(${JSON.stringify(text)})`;
async function click(text){await waitFor(`[...document.querySelectorAll('button')].some(b=>b.textContent.trim()===${JSON.stringify(text)}&&!b.disabled)`);await evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)}&&!b.disabled);b.click();})()`);await delay(50);}
async function field(label,value){await evaluate(`(()=>{const l=[...document.querySelectorAll('label')].find(l=>[...l.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent).join('').trim()===${JSON.stringify(label)}||l.querySelector('.ad-field-title')?.textContent.trim()===${JSON.stringify(label)});const e=l?.querySelector('input,textarea,select');if(!e)throw Error('Field unavailable');const p=e instanceof HTMLSelectElement?HTMLSelectElement.prototype:e instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(p,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event(e.tagName==='SELECT'?'change':'input',{bubbles:true}));})()`);await delay(30);}
async function check(label){await evaluate(`(()=>{const l=[...document.querySelectorAll('label')].find(l=>l.textContent.trim()===${JSON.stringify(label)});if(!l?.querySelector('input[type=checkbox]'))throw Error('Checkbox unavailable');l.querySelector('input').click();})()`);await delay(50);}
try{
  const fixture=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Isolated acceptance backend startup timed out')),45000);backend.once('message',m=>{clearTimeout(timer);resolve(m);});backend.once('exit',()=>{clearTimeout(timer);reject(Error('Isolated acceptance backend failed'));});});
  assert.equal(fixture.ready,true);
  vite=await createServer({define:{'import.meta.env.VITE_API_BASE_URL':'""','import.meta.env.VITE_API_URL':'""'},cacheDir:join(temp,'vite-cache'),server:{host:'127.0.0.1',port:0,hmr:false,proxy:{'/api':`http://127.0.0.1:${fixture.port}`}},plugins:[{
    name:'isolated-advertising-acceptance-entry',enforce:'pre',
    transform(_code,id){if(id.replaceAll('\\','/').endsWith('/modules/User/context/UserContext.jsx'))return 'export const useUser=()=>window.__advertisingAcceptanceCustomer;';},
    configureServer(server){server.middlewares.use(async(req,res,next)=>{
      if(req.url==='/acceptance-product.svg'){res.setHeader('Content-Type','image/svg+xml');return res.end('<svg xmlns="http://www.w3.org/2000/svg" width="50" height="50"><rect width="50" height="50" fill="#08b9e8"/></svg>');}
      if(['/acceptance/admin','/acceptance/seller','/acceptance/customer'].includes(req.url)){
        // Browser fixtures contain only short-lived synthetic local sessions.
        const setup=JSON.stringify({categoryId:fixture.categoryId});
        const session=`localStorage.setItem('sellerToken',${JSON.stringify(fixture.sellerToken)});localStorage.setItem('adminToken',${JSON.stringify(fixture.adminToken)});window.__acceptance=${setup};window.__acceptanceEventBodies={};const originalFetch=window.fetch;window.fetch=(url,options)=>{if(String(url).includes('/api/advertising/events')&&options?.body){const body=JSON.parse(options.body);window.__acceptanceEventBodies[body.type]=body;}return originalFetch(url,options);};`;
        res.setHeader('Content-Type','text/html');return res.end(await server.transformIndexHtml(req.url,`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0"><div id="root"></div><script>${session}</script><script type="module" src="/verification/advertising-acceptance-entry.jsx"></script></body></html>`));
      }next();
    });}
  }]});
  await vite.listen();const origin=`http://127.0.0.1:${vite.httpServer.address().port}`;
  browser=spawn(executable,['--headless=new','--no-sandbox','--disable-gpu','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--no-first-run','--disable-background-networking','--disable-sync','--disable-component-update','about:blank'],{windowsHide:true,stdio:'ignore'});
  let port;for(let i=0;i<100;i++){try{port=Number((await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);break;}catch{await delay(100);}}
  assert.ok(port,'Headless browser started');const target=(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t=>t.type==='page');
  socket=new WebSocket(target.webSocketDebuggerUrl);await new Promise(resolve=>socket.addEventListener('open',resolve,{once:true}));
  socket.addEventListener('message',event=>{const m=JSON.parse(event.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p?.reject(Error('CDP command failed')):p?.resolve(m.result);}if(m.method==='Runtime.exceptionThrown')errors.push('Browser runtime exception');if(m.method==='Fetch.requestPaused'){const url=new URL(m.params.request.url),allow=url.origin===origin&&!(failPlacements&&url.pathname==='/api/advertising/placements');command(allow?'Fetch.continueRequest':'Fetch.failRequest',{requestId:m.params.requestId,...(allow?{}:{errorReason:'BlockedByClient'})}).catch(()=>errors.push('Browser request interception failed'));}});
  await command('Page.enable');await command('Runtime.enable');await command('Emulation.setFocusEmulationEnabled',{enabled:true});await command('Page.bringToFront');await command('Fetch.enable',{patterns:[{urlPattern:'*'}]});
  await command('Emulation.setDeviceMetricsOverride',{width:1280,height:1000,deviceScaleFactor:1,mobile:false});
  const navigate=async path=>{await command('Page.navigate',{url:origin+path});};

  // Configure through the actual Admin package form, not an API shortcut.
  await navigate('/acceptance/admin');await waitFor(has('Packages and policies'));await click('Packages and policies');await click('Create package');await waitFor(has('Sellers buy this'));
  for(const [key,value]of [['Package name','Acceptance package'],['Price (₹)','1'],['Runs for (days)','3'],['Products per ad (1–20)','1'],['GST','NONE']])await field(key,value);
  await waitFor(has('Seller pays ₹1.00'));await click('Save package');await waitFor(`${has('Acceptance package')}&&!document.querySelector('form')`);checks.push('admin-package-form-real-api');

  await navigate('/acceptance/seller');await waitFor(has('Create campaign'));await click('Create campaign');await waitFor(has('Acceptance product'));await field('Campaign name','Acceptance campaign');
  await evaluate(`document.querySelector('form input[type=checkbox]').click()`);await click('Continue');await waitFor(has('Step 2 of 4'));await field('Category',fixture.categoryId);await click('Continue');await waitFor(has('Step 3 of 4'));
  const start=new Date(Date.now()+3600000),localStart=new Date(start.getTime()-start.getTimezoneOffset()*60000).toISOString().slice(0,16);
  await field('Start date',localStart);
  await evaluate(`(()=>{const s=[...document.querySelectorAll('select')].find(s=>s.closest('label').textContent.startsWith('Package'));const o=[...s.options].find(o=>o.textContent.includes('Acceptance package'));Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(s,o.value);s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await click('Continue');await waitFor(has('Step 4 of 4'));await click('Save campaign draft');await waitFor(has('Submit for review'));await click('Submit for review');await waitFor(has('Confirm terms and submit'));await click('Confirm terms and submit');await waitFor(has('PENDING REVIEW'));await waitFor(has('Waiting for Bulkimart to review your campaign.'));checks.push('seller-four-step-draft-and-versioned-submission-real-api');

  await navigate('/acceptance/admin');await waitFor(has('Acceptance campaign'));await click('View campaign');await waitFor(has('Decision reason'));await field('Decision reason','Synthetic approval via real review interface');await click('approve');await waitFor(has('APPROVED AWAITING PAYMENT'));checks.push('admin-review-real-api');
  await waitFor(has('Financial authorization: recorded'));
  assert.equal(await evaluate(`[...document.querySelectorAll('button')].some(b=>b.textContent==='Authorize accepted billing policy')`),false);
  checks.push('approval-opens-standard-payment-without-second-finance-action');
  await navigate('/acceptance/seller');await waitFor(has('Acceptance campaign'));await click('View campaign');await waitFor(has('Approved. Pay to start your ad.'));
  assert.equal(await evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>/^Pay ₹/.test(b.textContent));return b.disabled;})()`),true);
  const id=await evaluate(`(async()=>{const r=await fetch('/api/sellers/advertising/campaigns',{headers:{Authorization:'Bearer '+localStorage.getItem('sellerToken')}});return(await r.json()).data[0].id;})()`);
  // Back-end checks the same gate even if a client bypasses the disabled button.
  const blocked=await evaluate(`(async()=>{const r=await fetch('/api/sellers/advertising/campaigns/${id}/payment-attempts',{method:'POST',headers:{Authorization:'Bearer '+localStorage.getItem('sellerToken'),'Content-Type':'application/json'},body:JSON.stringify({version:0,idempotencyKey:'acceptance-boundary-only'})});return r.status;})()`);assert.equal(blocked,503);checks.push('external-checkout-boundary-fails-closed');
  const other=await fetch(`${origin}/api/sellers/advertising/campaigns/${id}`,{headers:{Authorization:`Bearer ${fixture.otherToken}`}});assert.equal(other.status,404);checks.push('real-authenticated-seller-isolation');

  // Authorize and view the free pilot through actual review/customer interfaces.
  await navigate('/acceptance/admin');await waitFor(has('Acceptance campaign'));await click('View campaign');await waitFor(has('Authorize non-billable pilot'));await field('Decision reason','Synthetic pilot distinct from unpaid billing');
  const localDate=value=>new Date(value.getTime()-value.getTimezoneOffset()*60000).toISOString().slice(0,16);
  await field('Pilot start',localDate(new Date(Date.now()-60000)));await field('Pilot end',localDate(new Date(Date.now()+3600000)));await click('Authorize non-billable pilot');await waitFor(has('Separate non-billable pilot: Authorized'));checks.push('admin-explicit-unpaid-pilot-real-api');
  await navigate('/acceptance/customer');await waitFor('!!document.querySelector(".sponsored-category-item")');assert.equal(await evaluate(has('Non-billable pilot')),true);
  await delay(1400);await evaluate('document.querySelector(".sponsored-product-link").click()');await waitFor('document.querySelector("#opened").textContent.length>0');
  const analytics=async()=>{const r=await fetch(`${origin}/api/sellers/advertising/campaigns/${id}/analytics`,{headers:{Authorization:`Bearer ${fixture.sellerToken}`}});return(await r.json()).data;};
  let summary;for(let i=0;i<30;i++){summary=await analytics();if(summary.rows.some(r=>r.type==='CLICK'))break;await delay(100);}
  assert.equal(summary.rows.find(r=>r.type==='IMPRESSION')?.count,1);assert.equal(summary.rows.find(r=>r.type==='CLICK')?.count,1);assert.equal(summary.rows.every(r=>r.mode==='NON_BILLABLE_PILOT'),true);checks.push('real-viewability-clicks-and-durable-pilot-telemetry');
  const retries=await evaluate(`(async()=>{const bodies=Object.values(window.__acceptanceEventBodies);const results=await Promise.all(bodies.flatMap(body=>[1,2,3].map(async()=>{const r=await fetch('/api/advertising/events',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return(await r.json()).data;})));return results.every(r=>r.accepted&&r.duplicate);})()`);
  assert.equal(retries,true);summary=await analytics();assert.equal(summary.rows.find(r=>r.type==='IMPRESSION').count,1);assert.equal(summary.rows.find(r=>r.type==='CLICK').count,1);checks.push('concurrent-browser-event-retries-deduplicated-in-real-database');
  await command('Fetch.disable');await command('Fetch.enable',{patterns:[{urlPattern:'*'}]});
  // Disable advertising from its existing admin interface by stopping the pilot.
  await navigate('/acceptance/admin');await waitFor(has('Acceptance campaign'));await click('View campaign');await waitFor(has('Stop non-billable pilot'));await field('Decision reason','End synthetic pilot');await click('Stop non-billable pilot');await waitFor(has('Separate non-billable pilot: Stopped'));
  await navigate('/acceptance/customer');await waitFor(has('Organic results remain available'));await delay(300);assert.equal(await evaluate('!!document.querySelector(".sponsored-category-block")'),false);checks.push('stopped-pilot-organic-fallback');
  failPlacements=true;await navigate('/acceptance/customer');await waitFor(has('Organic results remain available'));await delay(300);assert.equal(await evaluate('!!document.querySelector(".sponsored-category-block")'),false);failPlacements=false;checks.push('advertising-transport-failure-preserves-organic-content');
  const finance=await fetch(`${origin}/api/admin/advertising/finance`,{headers:{Authorization:`Bearer ${fixture.adminToken}`}});const financial=(await finance.json()).data;assert.equal(financial.total,0);assert.equal(financial.totals.receivedPaise,0);assert.equal(financial.totals.recognizedPaise,0);checks.push('no-payment-no-revenue-through-pilot');
  for(const width of [320,390,768,1280]){await command('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<768});await navigate('/acceptance/seller');await waitFor(has('Acceptance campaign'));assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),true);}
  checks.push('real-workspace-responsive-layouts');
  // On a phone the seller's products are listed and visible in step 1 of the campaign wizard.
  await command('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await navigate('/acceptance/seller');await waitFor(has('Create campaign'));await click('Create campaign');
  await waitFor(`[...document.querySelectorAll('.ad-product-item')].some(e=>e.textContent.includes('Acceptance product')&&e.getBoundingClientRect().height>20)`);checks.push('mobile-wizard-lists-seller-products');assert.deepEqual(errors,[]);
  console.log(JSON.stringify({passed:true,checks,authenticatedAdvertisingApis:'real local Express/Mongoose',database:'disposable replica set',sessions:'synthetic signed and checked by real middleware',providerCalls:0,providerCheckout:'blocked, not simulated',fullApplicationLogin:'not tested',customerContext:'synthetic navigation adapter',widths:[320,390,768,1280]}));
}finally{
  socket?.close();browser?.kill();await vite?.close();
  if(backend.connected){const exited=new Promise(resolve=>backend.once('exit',resolve));backend.send({action:'stop'});await Promise.race([exited,delay(10000)]);}if(backend.exitCode===null)backend.kill();
  assert.equal(dirname(resolve(temp)),resolve(tmpdir()));assert.ok(basename(temp).startsWith('bulkimart-ad-acceptance-'));
  for(let i=0;i<15;i++){try{await rm(temp,{recursive:true,force:true});break;}catch{await delay(200);}}
}
