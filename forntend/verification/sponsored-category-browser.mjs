import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { join, resolve, dirname, basename } from 'node:path';
import { tmpdir } from 'node:os';
const executable = ['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
assert.ok(executable, 'An installed Chrome/Edge is required');
const temporary = await mkdtemp(join(tmpdir(),'bulkimart-category-pilot-')), profile=join(temporary,'profile'); await mkdir(profile);
let scenario='ready', writes=0,verified=false;const events=[];
const productId='507f1f77bcf86cd799439013', variantId='507f1f77bcf86cd799439014';
const vite=await createServer({define:{'import.meta.env.VITE_API_BASE_URL':'""','import.meta.env.VITE_API_URL':'""'},cacheDir:join(temporary,'vite-cache'),server:{host:'127.0.0.1',port:0,hmr:false},plugins:[{
  name:'isolated-pilot-browser-fixture',enforce:'pre',
  transform(_code,id){if(id.replaceAll('\\','/').endsWith('/modules/User/context/UserContext.jsx'))return 'export const useUser = () => window.__pilotFixtureContext;';},
  configureServer(server){server.middlewares.use(async(req,res,next)=>{
    if(req.url.startsWith('/api/')){
      if(req.method!=='GET')writes++;
      if(req.url.startsWith('/api/sellers/advertising/')){
        res.setHeader('Content-Type','application/json');
        let data;
        if(req.url.endsWith('/billing'))data={campaign:{id:'campaign-browser',version:4,module:'ECOMMERCE',review:'APPROVED',funding:verified?'FUNDED':'PAYMENT_PENDING',delivery:verified?'ACTIVE':'NOT_SCHEDULED',terms:{name:'Synthetic package',durationDays:9}},paidAuthorization:true,payment:{reference:'AD-browser-fixture',status:verified?'paid':'pending',creation:'ISSUED',receiptPaise:verified?10500:0,refundedPaise:0,recognizedPaise:0,refunds:[]},quote:{basePaise:10000,taxPaise:500,totalPaise:10500,policy:{approvalReference:'SYNTHETIC',issuer:'Fixture issuer',taxTreatment:'EXCLUSIVE',taxRateBps:500,refunds:{cancellationBps:10000,suspensionBps:10000,unavailableBps:10000,unusedBps:10000}}}};
        else if(req.url.endsWith('/payment-attempts')){
          let raw='';for await(const part of req)raw+=part;assert.deepEqual(Object.keys(JSON.parse(raw)).sort(),['idempotencyKey','version']);
          data={checkout:{orderId:'campaign-browser',keyId:'rzp_test_fixture',razorpayOrderId:'order_browser',amountPaise:10500,currency:'INR',verificationPath:'/api/sellers/advertising/payment-verification'}};
        }else if(req.url.endsWith('/payment-verification')){verified=scenario==='billing-paid';data={status:verified?'paid':'pending'};}
        else throw Error('Unexpected fixture billing API');
        return res.end(JSON.stringify({success:true,data}));
      }
      if(req.url==='/api/advertising/events'){
        let raw='';for await(const part of req)raw+=part;
        const body=JSON.parse(raw);assert.deepEqual(Object.keys(body).sort(),['token','type']);
        events.push(body);res.setHeader('Content-Type','application/json');res.statusCode=scenario==='telemetry-error'?503:200;
        return res.end(JSON.stringify({success:scenario!=='telemetry-error',data:{accepted:true}}));
      }
      assert.match(req.url,/^\/api\/advertising\/placements\?/);
      assert.match(req.url,/exclude=507f1f77bcf86cd799439012/);
      res.setHeader('Content-Type','application/json');res.statusCode=scenario==='error'?503:200;
      const paid=['paid-telemetry','telemetry-error'].includes(scenario);
      const row={product:{_id:scenario==='duplicate'?'507f1f77bcf86cd799439012':productId,name:'Synthetic sponsored product',images:['/fixture.svg'],price:22,stock:3,type:'ecommerce',variants:[{_id:variantId,name:'Selected',price:22,stock:3}]},variantId,disclosure:'Sponsored',mode:paid?'PAID_CATEGORY':'NON_BILLABLE_PILOT',expiresAt:new Date(Date.now()+3600000).toISOString(),...(paid?{serveToken:'fixture-only-serving-token'}:{})};
      return res.end(JSON.stringify({success:scenario!=='error',data:scenario==='disabled'?[]:[row],meta:{mode:paid?'SPONSORED_CATEGORY':'NON_BILLABLE_PILOT',billable:false}}));
    }
    if(req.url==='/fixture.svg'){res.setHeader('Content-Type','image/svg+xml');return res.end('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="#08b9e8"/></svg>');}
    if(req.url==='/pilot'){res.setHeader('Content-Type','text/html');return res.end(await server.transformIndexHtml('/pilot','<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0"><div id="root"></div><script type="module" src="/verification/sponsored-category-browser-entry.jsx"></script></body></html>'));}
    if(req.url==='/billing'){res.setHeader('Content-Type','text/html');return res.end(await server.transformIndexHtml('/billing','<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0"><div id="root"></div><script type="module" src="/verification/advertising-billing-browser-entry.jsx"></script></body></html>'));}
    next();
  });}
}]});
await vite.listen();const origin=`http://127.0.0.1:${vite.httpServer.address().port}`;
const browser=spawn(executable,['--headless=new','--no-sandbox','--disable-gpu','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--no-first-run','--disable-background-networking','--disable-sync','--disable-component-update','about:blank'],{windowsHide:true,stdio:'ignore'});
let socket,sequence=0;const pending=new Map(),errors=[];
const delay=ms=>new Promise(r=>setTimeout(r,ms));
function command(method,params={}){const id=++sequence;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(Error(`CDP timeout: ${method}`));},15000);pending.set(id,{resolve:r=>{clearTimeout(timer);resolve(r);},reject:e=>{clearTimeout(timer);reject(e);}});socket.send(JSON.stringify({id,method,params}));});}
async function evaluate(expression){const r=await command('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.text);return r.result.value;}
async function waitFor(expression){for(let i=0;i<100;i++){if(await evaluate(expression))return;await delay(100);}throw Error(`Timed out: ${expression}`);}
try{
  let port;for(let i=0;i<100;i++){try{port=Number((await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);break;}catch{await delay(100);}}
  assert.ok(port,'Headless browser started');const target=(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t=>t.type==='page');
  socket=new WebSocket(target.webSocketDebuggerUrl);await new Promise(r=>socket.addEventListener('open',r,{once:true}));
  socket.addEventListener('message',event=>{const message=JSON.parse(event.data);if(message.id){const p=pending.get(message.id);pending.delete(message.id);message.error?p?.reject(Error(message.error.message)):p?.resolve(message.result);}if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails.text);if(message.method==='Fetch.requestPaused'){const local=new URL(message.params.request.url).origin===origin;command(local?'Fetch.continueRequest':'Fetch.failRequest',{requestId:message.params.requestId,...(local?{}:{errorReason:'BlockedByClient'})}).catch(e=>errors.push(e.message));}});
  await command('Page.enable');await command('Runtime.enable');await command('Emulation.setFocusEmulationEnabled',{enabled:true});await command('Page.bringToFront');await command('Fetch.enable',{patterns:[{urlPattern:'*'}]});
  for(const width of [320,390,768,1280]){
    scenario='ready';await command('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<768});await command('Page.navigate',{url:origin+'/pilot'});
    await waitFor('!!document.querySelector(".sponsored-category-block")');
    assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),true,`Responsive width ${width}`);
    assert.equal(await evaluate('document.querySelectorAll(".sponsored-disclosure").length'),1);
    await evaluate('document.querySelector(".sponsored-product-link").focus()');
    assert.equal(await evaluate('document.activeElement.className'),'sponsored-product-link');
    await command('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',text:'\r',unmodifiedText:'\r',windowsVirtualKeyCode:13});await command('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
    await waitFor(`document.querySelector('#opened').textContent==='${productId}'`);
    await evaluate('document.querySelector(".grid-product-add-btn").click()');
    assert.equal(await evaluate('document.querySelector("#added").textContent'),`${productId}:1:${variantId}`);
  }
  for(const mode of ['error','disabled','duplicate']){
    scenario=mode;await command('Page.navigate',{url:origin+'/pilot'});await waitFor('!!document.querySelector("#organic")');await delay(500);
    assert.equal(await evaluate('document.querySelector(".sponsored-category-block")'),null);
    assert.equal(await evaluate('document.querySelector("#organic").innerText'),'Organic products\n\nOriginal first product\n\nOriginal second product');
  }
  assert.equal(writes,0);assert.deepEqual(errors,[]);
  for(const width of [320,390,768,1280]){
    scenario='paid-telemetry';events.length=0;
    await command('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<768});await command('Page.navigate',{url:origin+'/pilot'});
    await waitFor('!!document.querySelector(".sponsored-category-block")');
    assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),true);
    assert.equal(await evaluate('document.querySelector(".sponsored-category-block").innerText.includes("Non-billable pilot")'),false);
    if(width===320){
      await evaluate('document.querySelector(".sponsored-category-block").style.marginTop="2000px"');await delay(1200);assert.equal(events.length,0,'An offscreen card emits no impression');
      await evaluate('document.querySelector(".sponsored-category-item").scrollIntoView({block:"center"})');
    }
    for(let n=0;n<30&&!events.some(e=>e.type==='IMPRESSION');n++)await delay(100);
    assert.equal(events.filter(e=>e.type==='IMPRESSION').length,1,'One viewable impression');
    await evaluate('document.querySelector(".sponsored-product-link").click()');
    await waitFor(`document.querySelector('#opened').textContent==='${productId}'`);await delay(100);
    assert.equal(events.filter(e=>e.type==='CLICK').length,1,'Link activation emits an independent click');
  }
  scenario='telemetry-error';await command('Page.navigate',{url:origin+'/pilot'});await waitFor('!!document.querySelector(".sponsored-product-link")');
  await evaluate('document.querySelector(".sponsored-product-link").click()');await waitFor(`document.querySelector('#opened').textContent==='${productId}'`);
  assert.equal(await evaluate('!!document.querySelector("#organic")'),true);assert.deepEqual(errors,[]);
  for(const width of [320,390,768,1280]){
    scenario=width===320?'billing-pending':'billing-paid';verified=false;
    await command('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<768});await command('Page.navigate',{url:origin+'/billing'});
    await waitFor('[...document.querySelectorAll("button")].some(b=>b.textContent==="Pay ₹105.00")');
    assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),true,`Billing/editor width ${width}`);
    await evaluate('[...document.querySelectorAll("button")].find(b=>/^Pay ₹/.test(b.textContent)).click()');
    await waitFor(`document.body.innerText.includes('${scenario==='billing-paid'?'Live until':'Payment in progress'}') && document.querySelector('[aria-label="Payment"] button').disabled===false`);
    assert.equal(await evaluate('window.__checkoutAmount'),10500);
    if(scenario==='billing-pending')assert.equal(await evaluate('document.body.innerText.includes("Paid.")||document.body.innerText.includes("Live until")'),false,'A pending payment is never shown as paid');
  }
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({passed:true,responsiveWidths:[320,390,768,1280],keyboardAndCartChecks:4,organicFallbackScenarios:3,paidViewabilityAndClickCases:4,offscreenImpressionSuppressed:true,telemetryFailurePreservesNavigation:true,billingAndPolicyEditorLayouts:4,billingGateway:'fixture SDK/API only',scope:'actual components with fixture context/API; not full application E2E'}));
}finally{
  socket?.close();browser.kill();await vite.close();
  assert.equal(dirname(resolve(temporary)),resolve(tmpdir()));assert.ok(basename(temporary).startsWith('bulkimart-category-pilot-'));
  for(let i=0;i<15;i++){try{await rm(temporary,{recursive:true,force:true});break;}catch{await delay(200);}}
}
