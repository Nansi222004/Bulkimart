import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
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
      if(['/acceptance/admin','/acceptance/seller','/acceptance/customer'].includes(new URL(req.url,'http://acceptance.local').pathname)){
        // Browser fixtures contain only short-lived synthetic local sessions.
        const setup=JSON.stringify({categoryId:fixture.categoryId,otherId:fixture.otherId,lampId:fixture.lampId});
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

  // One wizard, three categories of one storefront: a category, its sub-category and an unrelated one.
  const NAMES={category:'Acceptance campaign – Acceptance category',child:'Acceptance campaign – Acceptance child',other:'Acceptance campaign – Acceptance other'};
  const tickProduct=name=>evaluate(`(()=>{const item=[...document.querySelectorAll('.ad-product-item')].find(i=>i.querySelector('strong')?.textContent===${JSON.stringify(name)});item.querySelector('input[type=checkbox]').click();})()`);
  const openCampaign=async name=>{await waitFor(`[...document.querySelectorAll('.ad-campaign-card')].some(c=>c.querySelector('.ad-card-title')?.textContent===${JSON.stringify(name)})`);await evaluate(`[...document.querySelectorAll('.ad-campaign-card')].find(c=>c.querySelector('.ad-card-title').textContent===${JSON.stringify(name)}).querySelector('.ad-view-btn').click()`);await waitFor(`document.querySelector('.ad-modal-header h3')?.textContent===${JSON.stringify(name)}`);};
  const builderShots=resolve('test-artifacts/advertising-builder');await mkdir(builderShots,{recursive:true});const snap=async name=>{await evaluate("document.querySelector('.ad-modal-body')&&(document.querySelector('.ad-modal-body').scrollTop=0)");const shot=await command('Page.captureScreenshot',{format:'png'});await writeFile(join(builderShots,name+'.png'),Buffer.from(shot.data,'base64'));};
  const campaignsVia=async(token,path)=>(await(await fetch(`${origin}/api/${path}/advertising/campaigns?limit=50`,{headers:{Authorization:`Bearer ${token}`}})).json()).data;
  await navigate('/acceptance/seller');await waitFor(has('Create campaign'));await click('Create campaign');await waitFor(has('Acceptance lamp'));await field('Campaign name','Acceptance campaign');
  for(const name of ['Acceptance product','Acceptance shirt','Acceptance lamp'])await tickProduct(name);
  await waitFor(has('Picked 3 products in 3 categories'));await snap('1-products');await click('Continue');await waitFor(has('Step 2 of 5'));
  for(const name of Object.values(NAMES))assert.equal(await evaluate(has(name)),true,`${name} is its own group`);
  await snap('2-groups');await click('Continue');await waitFor(has('Step 3 of 5'));
  const start=new Date(Date.now()+3600000),localStart=new Date(start.getTime()-start.getTimezoneOffset()*60000).toISOString().slice(0,16);
  await field('Start date for all campaigns',localStart);
  for(const name of Object.values(NAMES))await evaluate(`(()=>{const s=document.querySelector('section[aria-label=${JSON.stringify('Campaign '+name)}] select');const o=[...s.options].find(o=>o.textContent.includes('Acceptance package'));Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(s,o.value);s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await snap('3-packages');await click('Continue');await waitFor(has('Step 4 of 5'));await waitFor(has('Total for 3 campaigns: ₹3.00'));await waitFor(has('Each campaign is reviewed and paid separately. You pay only for campaigns approved by Bulkimart.'));
  await snap('4-review');await click('Save 3 campaigns');await waitFor(has('All 3 campaigns are saved as drafts'));
  assert.equal((await campaignsVia(fixture.sellerToken,'sellers')).length,3,'Exactly one campaign per group');
  await click('Submit all for review');await waitFor(has('Confirm terms and submit 3 campaigns'));await click('Confirm terms and submit 3 campaigns');
  await waitFor(`[...document.querySelectorAll('.ad-builder .ad-status-pill')].filter(p=>p.textContent==='Waiting for review').length===3`);
  await snap('5-submitted');await click('Close');await waitFor(`document.querySelectorAll('.ad-campaign-card').length===3`);
  const submitted=await campaignsVia(fixture.sellerToken,'sellers');
  assert.deepEqual(submitted.map(c=>c.name).sort(),Object.values(NAMES).sort());assert.equal(submitted.every(c=>c.review==='PENDING_REVIEW'&&c.funding==='UNPAID'),true);
  assert.deepEqual(Object.fromEntries(submitted.map(c=>[c.name,[c.category.id,c.products.map(p=>p.name)]])),{[NAMES.category]:[fixture.categoryId,['Acceptance product']],[NAMES.child]:[fixture.childId,['Acceptance shirt']],[NAMES.other]:[fixture.otherId,['Acceptance lamp']]});
  checks.push('seller-multi-category-wizard-creates-and-submits-one-campaign-per-category-real-api');

  // Every campaign reaches Admin → Advertising on its own, named with its seller, category and products.
  await navigate('/acceptance/admin');for(const name of Object.values(NAMES))await waitFor(has(name));
  assert.equal(await evaluate(`[...document.querySelectorAll('.ad-campaign-card')].every(c=>c.textContent.includes('Seller: Acceptance Store · Indore'))`),true);
  assert.equal(await evaluate(`[...document.querySelectorAll('.ad-campaign-card')].find(c=>c.querySelector('.ad-card-title').textContent===${JSON.stringify(NAMES.child)}).textContent.includes('Shop All · Acceptance category › Acceptance child')`),true);
  await openCampaign(NAMES.other);await waitFor(has('Decision reason'));
  for(const text of ['Acceptance Store (Acceptance Traders) · Indore','Shop All · Acceptance other','Acceptance lamp','Acceptance package: ₹1.00 for 3 days · up to 1 product per ad'])assert.equal(await evaluate(has(text)),true,`Admin detail shows ${text}`);
  assert.equal(await evaluate(has('Acceptance shirt')),false,'No product of another campaign is shown');
  await field('Decision reason','Synthetic approval via real review interface');await click('Approve & request payment');await waitFor(has('APPROVED AWAITING PAYMENT'));
  assert.equal(await evaluate(has('Acceptance lamp')),true,'Names stay after the decision');checks.push('admin-review-real-api');checks.push('admin-sees-each-campaign-with-seller-category-products');
  await waitFor(has('Seller can pay: yes, payment is open'));
  assert.equal(await evaluate(has('In the “Sponsored” row at the top of the “Acceptance other” category page in Shop All, for shoppers the seller delivers to.')),true);
  assert.equal(await evaluate(has('Starts once the seller pays')),true);
  const panelShot=async name=>{await evaluate(`document.querySelector(${JSON.stringify(name==='admin-where'?'.ad-meta-wide':'section[aria-label="Payment and ad status"]')}).scrollIntoView({block:'start'})`);await delay(100);const shot=await command('Page.captureScreenshot',{format:'png'});await writeFile(join(builderShots,name+'.png'),Buffer.from(shot.data,'base64'));};
  await panelShot('admin-where');await panelShot('admin-payment-panel');
  assert.equal(await evaluate(`[...document.querySelectorAll('button')].some(b=>b.textContent==='Authorize accepted billing policy')`),false);
  checks.push('approval-opens-standard-payment-without-second-finance-action');
  const screenshots=resolve('test-artifacts/advertising-review');await mkdir(screenshots,{recursive:true});
  for(const width of [320,390,1280]){
    await command('Emulation.setDeviceMetricsOverride',{width,height:585,deviceScaleFactor:1,mobile:width<600});
    await delay(120);
    const layout=await evaluate(`(()=>{const dialog=document.querySelector('.ad-modal-dialog'),body=dialog.querySelector('.ad-modal-body'),close=dialog.querySelector('[aria-label="Close details"]');body.scrollTop=0;return {overflow:dialog.scrollWidth>dialog.clientWidth+1,closeText:close.textContent.trim(),closeWidth:close.getBoundingClientRect().width,bodyHeight:body.clientHeight};})()`);
    assert.equal(layout.overflow,false,'review dialog fits width '+width);assert.equal(layout.closeText,'✕');assert.ok(layout.closeWidth>=32);assert.ok(layout.bodyHeight>100);
    const shot=await command('Page.captureScreenshot',{format:'png'});await writeFile(join(screenshots,'review-'+width+'.png'),Buffer.from(shot.data,'base64'));
    await evaluate(`document.querySelector('.ad-review-actions textarea').scrollIntoView({block:'center'})`);
    assert.equal(await evaluate(`(()=>{const e=document.querySelector('.ad-review-actions textarea'),r=e.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===e;})()`),true,'review reason reachable '+width);
  }
  checks.push('campaign-review-close-button-payment-guidance-and-controls-responsive');
  await command('Emulation.setDeviceMetricsOverride',{width:1280,height:1000,deviceScaleFactor:1,mobile:false});

  // Decisions are independent: changes for one campaign, the third stays waiting.
  await navigate('/acceptance/admin');await openCampaign(NAMES.category);await waitFor(has('Decision reason'));await field('Decision reason','Synthetic change request');await click('Request changes');await waitFor(has('CHANGES REQUESTED'));
  const reviewed=Object.fromEntries((await campaignsVia(fixture.adminToken,'admin')).map(c=>[c.name,c.review]));
  assert.deepEqual(reviewed,{[NAMES.other]:'APPROVED',[NAMES.category]:'CHANGES_REQUESTED',[NAMES.child]:'PENDING_REVIEW'});checks.push('admin-decisions-are-independent-per-campaign');

  await navigate('/acceptance/seller');await openCampaign(NAMES.other);await waitFor(has('Approved. Pay to start your ad.'));
  assert.equal(await evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>/^Pay ₹/.test(b.textContent));return b.disabled;})()`),true);
  const id=(await campaignsVia(fixture.sellerToken,'sellers')).find(c=>c.name===NAMES.other).id;
  // Back-end checks the same gate even if a client bypasses the disabled button.
  const blocked=await evaluate(`(async()=>{const r=await fetch('/api/sellers/advertising/campaigns/${id}/payment-attempts',{method:'POST',headers:{Authorization:'Bearer '+localStorage.getItem('sellerToken'),'Content-Type':'application/json'},body:JSON.stringify({version:0,idempotencyKey:'acceptance-boundary-only'})});return r.status;})()`);assert.equal(blocked,503);checks.push('external-checkout-boundary-fails-closed');
  const other=await fetch(`${origin}/api/sellers/advertising/campaigns/${id}`,{headers:{Authorization:`Bearer ${fixture.otherToken}`}});assert.equal(other.status,404);checks.push('real-authenticated-seller-isolation');

  // Authorize and view the free pilot through actual review/customer interfaces.
  await navigate('/acceptance/admin');await openCampaign(NAMES.other);await waitFor(has('Authorize non-billable pilot'));await field('Decision reason','Synthetic pilot distinct from unpaid billing');
  const localDate=value=>new Date(value.getTime()-value.getTimezoneOffset()*60000).toISOString().slice(0,16);
  await field('Pilot start',localDate(new Date(Date.now()-60000)));await field('Pilot end',localDate(new Date(Date.now()+3600000)));await click('Authorize non-billable pilot');await waitFor(has('Separate non-billable pilot: Authorized'));checks.push('admin-explicit-unpaid-pilot-real-api');
  // The storefront: only the approved campaign's own category page shows its product as sponsored.
  for(const page of [fixture.categoryId,fixture.childId]){await navigate(`/acceptance/customer?category=${page}`);await waitFor(has('Organic results remain available'));await delay(500);assert.equal(await evaluate('!!document.querySelector(".sponsored-category-block")'),false,'Campaigns not approved show nowhere, and the lamp is not shown in other categories');}
  checks.push('unapproved-and-unrelated-category-pages-show-no-sponsored-products');
  await navigate(`/acceptance/customer?category=${fixture.otherId}`);await waitFor('!!document.querySelector(".sponsored-category-item")');assert.equal(await evaluate(has('Non-billable pilot')),true);
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('.sponsored-category-item')].map(i=>i.textContent.includes('Acceptance lamp'))`),[true],'Only the campaign product is sponsored on its category page');
  assert.equal(await evaluate(`/Acceptance (product|shirt)/.test(document.querySelector('.sponsored-category-block').textContent)`),false);
  assert.equal(await evaluate(`document.querySelector('.sponsored-category-block').textContent.includes('Sponsored')`),true,'Sponsored label shown');checks.push('approved-campaign-sponsored-on-its-own-category-page');
  // The lamp is also in this page's own product list: it is shown once, as Sponsored, and left out below.
  await waitFor(`document.querySelectorAll('#organic .organic-product').length===0`);checks.push('advertised-product-in-page-list-shown-once-as-sponsored');
  await delay(1400);await evaluate('document.querySelector(".sponsored-product-link").click()');await waitFor('document.querySelector("#opened").textContent.length>0');
  const analytics=async()=>{const r=await fetch(`${origin}/api/sellers/advertising/campaigns/${id}/analytics`,{headers:{Authorization:`Bearer ${fixture.sellerToken}`}});return(await r.json()).data;};
  let summary;for(let i=0;i<30;i++){summary=await analytics();if(summary.rows.some(r=>r.type==='CLICK'))break;await delay(100);}
  assert.equal(summary.rows.find(r=>r.type==='IMPRESSION')?.count,1);assert.equal(summary.rows.find(r=>r.type==='CLICK')?.count,1);assert.equal(summary.rows.every(r=>r.mode==='NON_BILLABLE_PILOT'),true);checks.push('real-viewability-clicks-and-durable-pilot-telemetry');
  const retries=await evaluate(`(async()=>{const bodies=Object.values(window.__acceptanceEventBodies);const results=await Promise.all(bodies.flatMap(body=>[1,2,3].map(async()=>{const r=await fetch('/api/advertising/events',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return(await r.json()).data;})));return results.every(r=>r.accepted&&r.duplicate);})()`);
  assert.equal(retries,true);summary=await analytics();assert.equal(summary.rows.find(r=>r.type==='IMPRESSION').count,1);assert.equal(summary.rows.find(r=>r.type==='CLICK').count,1);checks.push('concurrent-browser-event-retries-deduplicated-in-real-database');
  await command('Fetch.disable');await command('Fetch.enable',{patterns:[{urlPattern:'*'}]});
  // Disable advertising from its existing admin interface by stopping the pilot.
  await navigate('/acceptance/admin');await openCampaign(NAMES.other);await waitFor(has('Stop non-billable pilot'));await field('Decision reason','End synthetic pilot');await click('Stop non-billable pilot');await waitFor(has('Separate non-billable pilot: Stopped'));
  await navigate(`/acceptance/customer?category=${fixture.otherId}`);await waitFor(has('Organic results remain available'));await delay(300);assert.equal(await evaluate('!!document.querySelector(".sponsored-category-block")'),false);
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('#organic .organic-product')].map(p=>p.textContent)`),['Acceptance lamp'],'Once the ad stops, the lamp is back in the normal list');checks.push('stopped-pilot-organic-fallback');
  failPlacements=true;await navigate(`/acceptance/customer?category=${fixture.otherId}`);await waitFor(has('Organic results remain available'));await delay(300);assert.equal(await evaluate('!!document.querySelector(".sponsored-category-block")'),false);failPlacements=false;checks.push('advertising-transport-failure-preserves-organic-content');
  const finance=await fetch(`${origin}/api/admin/advertising/finance`,{headers:{Authorization:`Bearer ${fixture.adminToken}`}});const financial=(await finance.json()).data;assert.equal(financial.total,0);assert.equal(financial.totals.receivedPaise,0);assert.equal(financial.totals.recognizedPaise,0);checks.push('no-payment-no-revenue-through-pilot');
  for(const width of [320,390,768,1280]){await command('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<768});await navigate('/acceptance/seller');await waitFor(has('Acceptance campaign'));assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),true);}
  checks.push('real-workspace-responsive-layouts');
  // A product existing in the DOM is insufficient: its checkbox must be reachable
  // inside the scrollable body and accept a real pointer click above the footer.
  for(const [width,height] of [[1280,585],[390,844],[320,568]]){
    await command('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<768});await navigate('/acceptance/seller');await waitFor(has('Create campaign'));await click('Create campaign');
    await waitFor(`!!document.querySelector('.ad-product-item input[type=checkbox]')`);await field('Campaign name','Reachability check');
    const target=await evaluate(`(()=>{
      const checkbox=document.querySelector('.ad-product-item input[type=checkbox]');
      checkbox.scrollIntoView({block:'center'});
      const rect=checkbox.getBoundingClientRect(),body=document.querySelector('.ad-modal-body').getBoundingClientRect();
      const x=rect.left+rect.width/2,y=rect.top+rect.height/2;
      return {x,y,reachable:y>=body.top&&y<=body.bottom&&document.elementFromPoint(x,y)===checkbox};
    })()`);
    assert.equal(target.reachable,true,`Product checkbox must be reachable at ${width}x${height}`);
    await command('Input.dispatchMouseEvent',{type:'mousePressed',x:target.x,y:target.y,button:'left',clickCount:1});
    await command('Input.dispatchMouseEvent',{type:'mouseReleased',x:target.x,y:target.y,button:'left',clickCount:1});
    await waitFor(`document.querySelector('.ad-product-item.selected input[type=checkbox]')?.checked===true`);
    assert.equal(await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Continue').disabled`),false);
    assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),true);
  }
  checks.push('wizard-products-reachable-and-selectable-on-short-desktop-and-mobile');assert.deepEqual(errors,[]);
  console.log(JSON.stringify({passed:true,checks,authenticatedAdvertisingApis:'real local Express/Mongoose',database:'disposable replica set',sessions:'synthetic signed and checked by real middleware',providerCalls:0,providerCheckout:'blocked, not simulated',fullApplicationLogin:'not tested',customerContext:'synthetic navigation adapter',widths:[320,390,768,1280]}));
}finally{
  socket?.close();browser?.kill();await vite?.close();
  if(backend.connected){const exited=new Promise(resolve=>backend.once('exit',resolve));backend.send({action:'stop'});await Promise.race([exited,delay(10000)]);}if(backend.exitCode===null)backend.kill();
  assert.equal(dirname(resolve(temp)),resolve(tmpdir()));assert.ok(basename(temp).startsWith('bulkimart-ad-acceptance-'));
  for(let i=0;i<15;i++){try{await rm(temp,{recursive:true,force:true});break;}catch{await delay(200);}}
}
