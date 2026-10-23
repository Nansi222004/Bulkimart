import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {join,resolve,dirname,basename} from 'node:path';
import {tmpdir} from 'node:os';
const exe=process.env.CHROME_BIN||['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
assert.ok(exe,'Chrome or Edge is required');
const temp=await mkdtemp(join(tmpdir(),'bulkimart-gst-browser-')),profile=join(temp,'profile');await mkdir(profile);

const id='507f1f77bcf86cd799439022';
let fee={amountPaise:10000,currency:'INR',terms:'Synthetic payment and cancellation terms',version:1};
const row=()=>({_id:id,version:1,status:'pending',details:{businessName:'GST browser fixture',contactName:'Test contact'},submittedAt:'2026-01-01',files:[],events:[],billing:{...fee,status:paid?'paid':'unpaid'}});
let paid=false, intakeEnabled=true, emptyQueue=false;
const reply=(res,data)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({success:true,data}));};
const vite=await createServer({define:{'import.meta.env.VITE_API_BASE_URL':'""','import.meta.env.VITE_API_URL':'""'},cacheDir:join(temp,'vite-cache'),server:{host:'127.0.0.1',port:0,hmr:false},plugins:[{name:'gst-fixtures',configureServer(server){server.middlewares.use(async(req,res,next)=>{
if(req.url.startsWith('/api/')){const p=new URL(req.url,'http://fixture').pathname;let input={};if(req.method!=='GET'){let raw='';for await(const chunk of req)raw+=chunk;input=raw?JSON.parse(raw):{};}
if(p.endsWith('/capabilities'))return reply(res,{enabled:intakeEnabled,productionBlocked:false,fee});
if(p.endsWith('/fee-policy')){if(req.method==='PUT')fee={...input,version:fee.version+1,currency:'INR'};return reply(res,fee);}
if(p.endsWith('/me/payment'))return reply(res,{orderId:id,razorpayOrderId:'order_gst_browser',keyId:'rzp_test_fixture',amountPaise:fee.amountPaise,currency:'INR',verificationPath:'/api/sellers/gst-assistance/payments/verify'});
if(p.endsWith('/payments/verify')){paid=true;return reply(res,{status:'paid'});}
if(p.endsWith('/me')||p.endsWith('/'+id))return reply(res,row());
if(p==='/api/admin/gst-assistance')return reply(res,{requests:emptyQueue?[]:[row()]});
return reply(res,{});}
if(/^\/(seller|gst-vendor|gst-admin)/.test(req.url)){res.setHeader('Content-Type','text/html');return res.end(await server.transformIndexHtml(req.url,'<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0"><div id="root"></div><script type="module" src="/verification/gst-browser-entry.jsx"></script></body></html>'));}next();});}}]});
await vite.listen();const origin='http://127.0.0.1:'+vite.httpServer.address().port;
const browser=spawn(exe,['--headless=new','--no-sandbox','--disable-gpu','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--no-first-run','--disable-background-networking','--disable-sync','--disable-component-update','about:blank'],{windowsHide:true,stdio:'ignore'});
let socket,seq=0;const pending=new Map(),errors=[],views=[];const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function command(method,params={}){const id=++seq;return new Promise((resolve,reject)=>{const timeout=setTimeout(()=>{pending.delete(id);reject(Error(`CDP timeout ${method}`));},15000);pending.set(id,{resolve:r=>{clearTimeout(timeout);resolve(r);},reject});socket.send(JSON.stringify({id,method,params}));});}
async function evaluate(expression){const r=await command('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
async function waitText(text){for(let i=0;i<150;i++){if(await evaluate(`document.body?.innerText.includes(${JSON.stringify(text)})`))return;await sleep(100);}throw Error(`Missing ${text}: ${await evaluate('document.body?.innerText')}`);}
const click=async text=>{await evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.includes(${JSON.stringify(text)}));if(!b)throw Error('Missing button');b.click();})()`);await sleep(150);for(let i=0;i<100;i++){if(await evaluate(`!document.body?.innerText.includes('Loading parcels…') && ![...document.querySelectorAll('header button')].some(b=>b.disabled)`))return;await sleep(100);}};
async function field(name,value){await evaluate(`(()=>{const e=document.querySelector('[name="${name}"]');if(!e)throw Error('Missing ${name}');Object.getOwnPropertyDescriptor(e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:e.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));})()`);}
const navigate=async path=>{await command('Page.navigate',{url:origin+path});};
try{
  let port;for(let i=0;i<100;i++){try{port=Number((await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);break;}catch{await sleep(100);}}
  assert.ok(port);let target;for(let i=0;i<60&&!target;i++){try{target=(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t=>t.type==='page');}catch{await sleep(100);}}
  assert.ok(target);socket=new WebSocket(target.webSocketDebuggerUrl);await new Promise(r=>socket.addEventListener('open',r,{once:true}));
  socket.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p?.reject(Error(m.error.message)):p?.resolve(m.result);}if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.text);if(m.method==='Fetch.requestPaused'){const local=new URL(m.params.request.url).origin===origin;command(local?'Fetch.continueRequest':'Fetch.failRequest',{requestId:m.params.requestId,...(local?{}:{errorReason:'BlockedByClient'})}).catch(e=>{if(!e.message.includes('Invalid InterceptionId'))errors.push(e.message);});}});
  await command('Page.enable');await command('Runtime.enable');await command('Network.enable');await command('Fetch.enable',{patterns:[{urlPattern:'*'}]});

  for(const width of [320,1440]){
    await command('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width<768});
    await navigate('/seller');await waitText('Continue to Review');await click('Continue to Review');await waitText('Complete these items before submitting');
    assert.equal(await evaluate('document.documentElement.scrollWidth<=window.innerWidth+1'),true);views.push({width,view:'review-missing-kyc'});
    emptyQueue=true;intakeEnabled=false;await navigate('/gst-admin');await waitText('No GST assistance requests');await waitText('GST assistance intake is disabled');
    assert.equal(await evaluate('document.documentElement.scrollWidth<=window.innerWidth+1'),true);views.push({width,view:'admin-empty-disabled'});
    intakeEnabled=true;emptyQueue=false;await click('Recheck intake');await waitText('Accepting GST assistance requests');await click('Refresh assistance status');await waitText('GST browser fixture');
    await click('GST browser fixture');await waitText('Status history');
    assert.equal(await evaluate('document.documentElement.scrollWidth<=window.innerWidth+1'),true);
    assert.equal(await evaluate(`parseFloat(getComputedStyle(document.querySelector('.gst-request-detail textarea')).borderRadius)>=8`),true);views.push({width,view:'admin-request-details'});
    await click('GST service fee settings');await waitText('Save service fee');
    await evaluate(`(()=>{const e=document.querySelector('.gst-fee-editor input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'249.50');e.dispatchEvent(new Event('input',{bubbles:true}));})()`);await click('Save service fee');await waitText('Service fee saved');assert.equal(fee.amountPaise,24950);views.push({width,view:'admin-fee'});
    paid=false;await navigate('/gst-vendor');await waitText('Pay ₹249.50 to Bulkimart');assert.equal(await evaluate('document.documentElement.scrollWidth<=window.innerWidth+1'),true);
    await evaluate(`document.querySelector('.gst-payment-panel input[type=checkbox]').click()`);await click('Pay ₹249.50 to Bulkimart');await waitText('Payment status: paid');views.push({width,view:'vendor-payment'});
  }
  assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,views:views.length,configuredFeeChanged:true,paymentsSimulated:true}));
}finally{
  socket?.close();browser.kill();await vite.close();assert.equal(dirname(resolve(temp)),resolve(tmpdir()));assert.ok(basename(temp).startsWith('bulkimart-gst-browser-'));
  for(let i=0;i<15;i++){try{await rm(temp,{recursive:true,force:true});break;}catch{await sleep(200);}}
}
