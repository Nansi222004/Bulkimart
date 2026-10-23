import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {join,resolve,dirname,basename} from 'node:path';
import {tmpdir} from 'node:os';
const exe=process.env.CHROME_BIN||['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
assert.ok(exe,'Chrome or Edge is required');
const temp=await mkdtemp(join(tmpdir(),'bulkimart-parcel-browser-')),profile=join(temp,'profile');await mkdir(profile);
const id='507f1f77bcf86cd799439022',qid='507f1f77bcf86cd799439023',pid='507f1f77bcf86cd799439024';
const address={address:'Synthetic test street',name:'Synthetic contact',phone:'9876500011',pincode:'560001',lat:12.97,lng:77.59};
const policy={version:1,terms:'Synthetic approved terms: cancellation and failure require admin review.',categories:['test_documents'],prohibitedItems:['synthetic_restricted'],areas:[{name:'Synthetic test area',pincodes:['560001']}],maxWeightKg:5,maxDimensionCm:50,payDriverEnabled:true,payDriverCategories:['test_documents'],cashCollectionPoint:'delivery',ready:true};
const fresh=()=>({_id:id,reference:'PD-BROWSER-FIXTURE',version:1,policyVersion:1,status:'needs_admin_assignment',paymentMethod:'pay_driver',paymentStatus:'cash_due',feePaise:2040,details:{pickup:address,dropoff:address,category:'test_documents',weightKg:1},cash:{status:'outstanding',amountPaise:0},finance:{held:true,earningPaise:1020},history:[],refund:{status:'none'},assignment:{reason:'no_eligible_driver',attempts:[]}});
let b=fresh(),lastQuote=null,writes=0,verifications=0,failNext=false,parcelEnabled=true,catalogueReads=0;
const reply=(res,data,status=200,meta={page:1,pages:1,total:1})=>{res.statusCode=status;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({success:status<400,data,meta,...(status>=400?{message:'Synthetic request error; retry safely'}:{})}));};
const vite=await createServer({define:{'import.meta.env.VITE_API_BASE_URL':'""','import.meta.env.VITE_API_URL':'""'},cacheDir:join(temp,'vite-cache'),server:{host:'127.0.0.1',port:0,hmr:false},plugins:[{name:'isolated-parcel-browser-fixtures',configureServer(server){server.middlewares.use(async(req,res,next)=>{
  if(req.url.startsWith('/api/')){
    const url=new URL(req.url,'http://fixture'),p=url.pathname,write=req.method!=='GET';let input={};
    if(write){writes++;let raw='';for await(const chunk of req)raw+=chunk;input=raw?JSON.parse(raw):{};}
    if(failNext){failNext=false;return reply(res,null,503);}
    if(p==='/api/parcel-delivery/capabilities')return reply(res,{catalogue:parcelEnabled,booking:parcelEnabled,auto_assignment:true,admin_fallback:true,online_payment:true,pay_driver:true,fulfilment:true,productionBlocked:false});
    if(p==='/api/parcel-delivery/catalogue'){catalogueReads++;return reply(res,policy);}
    if(p==='/api/customer-services/capabilities')return reply(res,{catalogue:true});
    if(p==='/api/customer-services')return reply(res,[{_id:id}]);
    if(p==='/api/users/addresses')return reply(res,[]);
    if(p==='/api/admin/parcel-delivery/policy')return reply(res,null);
    if(p==='/api/parcel-delivery/quotes'){lastQuote=input;return reply(res,{_id:qid,expiresAt:new Date(Date.now()+300000),details:input,pricing:{policyVersion:1,totalPaise:2040,distanceMetres:5200},terms:policy.terms},201);}
    if(p==='/api/parcel-delivery/bookings'&&write){b={...fresh(),paymentMethod:input.paymentMethod,paymentStatus:input.paymentMethod==='online'?'pending':'cash_due',status:input.paymentMethod==='online'?'payment_pending':'searching_for_driver'};return reply(res,b,201);}
    if(p.endsWith('/payment')&&write)return reply(res,{orderId:id,razorpayOrderId:'order_browser_fixture',keyId:'rzp_test_fixture',amountPaise:2040,currency:'INR',verificationPath:'/api/parcel-delivery/payments/verify'});
    if(p.endsWith('/payments/verify')&&write){verifications++;b.paymentStatus='paid';b.status='searching_for_driver';return reply(res,{status:'paid'});}
    if(p.endsWith('/payment-status'))return reply(res,{status:b.paymentStatus});
    if(p.endsWith('/candidates'))return reply(res,[{_id:pid,zones:['560001']}]);
    if(p.endsWith('/assign')){b.status='searching_for_driver';b.offer={token:'fixture-offer',expiresAt:new Date(Date.now()+60000)};return reply(res,b);}
    if(p.endsWith('/offer')){b.status=input.action==='accept'?'driver_assigned':'needs_admin_assignment';delete b.offer;b.version++;return reply(res,b);}
    if(p.endsWith('/actions')){
      if(input.action==='pickup_code')b.pickupCode='123456';
      else if(input.action==='delivery_code')b.deliveryCode='654321';
      else if(input.action==='verify_pickup')b.status='picked_up';
      else if(input.action==='verify_delivery')b.status='delivered';
      else if(input.action==='collect_cash'){b.cash={status:'collected_unreconciled',amountPaise:2040};b.paymentStatus='cash_collected';}
      else b.status=input.action;
      b.version++;return reply(res,b);
    }
    if(p.endsWith('/bookings'))return reply(res,[b]);
    if(p.endsWith(`/bookings/${id}`))return reply(res,b);
    return reply(res,null,404);
  }
  if(/^\/(parcel-delivery|delivery\/parcels|admin\/parcel-delivery)/.test(req.url)){res.setHeader('Content-Type','text/html');return res.end(await server.transformIndexHtml(req.url,'<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0"><div id="root"></div><script type="module" src="/verification/parcel-browser-entry.jsx"></script></body></html>'));}
  next();
});}}]});
await vite.listen();const origin=`http://127.0.0.1:${vite.httpServer.address().port}`;
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
  socket.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p?.reject(Error(m.error.message)):p?.resolve(m.result);}if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.text);if(m.method==='Fetch.requestPaused'){const local=new URL(m.params.request.url).origin===origin;command(local?'Fetch.continueRequest':'Fetch.failRequest',{requestId:m.params.requestId,...(local?{}:{errorReason:'BlockedByClient'})}).catch(e=>errors.push(e.message));}});
  await command('Page.enable');await command('Runtime.enable');await command('Network.enable');await command('Fetch.enable',{patterns:[{urlPattern:'*'}]});
  await navigate('/parcel-delivery/book?guest=1');await waitText('Sign in to Bulkimart');assert.equal(await evaluate('document.querySelectorAll("input").length'),0);
  parcelEnabled=false;
  await navigate('/parcel-delivery/book');await waitText('Parcel booking is currently unavailable');assert.equal(catalogueReads,0);assert.equal(await evaluate('document.querySelectorAll("form").length'),0);
  for(const width of [320,1440]){
    await command('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width<768});
    await navigate('/parcel-delivery/book?cards=1');await waitText('Browse Legal Services');await waitText('New deliveries are currently unavailable');
    assert.equal(await evaluate('document.documentElement.scrollWidth<=window.innerWidth+1'),true);
    assert.equal(await evaluate(`[...document.querySelectorAll('.customer-service-card a')].every(a=>getComputedStyle(a).textDecorationLine==='none'&&a.getBoundingClientRect().height>=44)`),true);
    assert.equal(await evaluate(`document.querySelector('a[href="/parcel-delivery/book"]').textContent`),'Send a Parcel');
  }
  assert.equal(catalogueReads,0);parcelEnabled=true;
  for(const width of [320,375,430,768,1440]){
    await command('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width<768});
    b=fresh();for(const [path,text] of [['/parcel-delivery/book','Calculate delivery fee'],['/parcel-delivery/history','PD-BROWSER-FIXTURE'],[`/parcel-delivery/track/${id}`,'needs admin assignment'],['/delivery/parcels','PD-BROWSER-FIXTURE'],['/admin/parcel-delivery','PD-BROWSER-FIXTURE']]){await navigate(path);await waitText(text);assert.equal(await evaluate('document.documentElement.scrollWidth<=window.innerWidth+1'),true,`Overflow ${width} ${path}`);views.push({width,path});
      if(path==='/admin/parcel-delivery'){await click('PD-BROWSER-FIXTURE');await waitText('Manual assignment');assert.equal(await evaluate('document.documentElement.scrollWidth<=window.innerWidth+1'),true);views.push({width,path:path+'/detail'});await click('Fare and assignment policy');await waitText('Save approved policy version');assert.equal(await evaluate(`document.querySelector('[name=basePaise]').value`),'');await click('Add service area');assert.equal(await evaluate('document.documentElement.scrollWidth<=window.innerWidth+1'),true);views.push({width,path:path+'/policy'});}
    }
  }
  await command('Emulation.setDeviceMetricsOverride',{width:390,height:1000,deviceScaleFactor:1,mobile:true});
  for(const method of ['online','pay_driver']){
    await navigate('/parcel-delivery/book');await waitText('Calculate delivery fee');
    for(const prefix of ['pickup','dropoff'])for(const [key,value]of Object.entries(address))await field(`${prefix}.${key}`,String(value));
    for(const [key,value]of Object.entries({description:'Synthetic parcel',weightKg:'1',length:'10',width:'10',height:'10'}))await field(key,value);
    await evaluate(`document.querySelector('[name=restrictions]').click()`);await click('Calculate delivery fee');await waitText('Delivery fee ₹20.40');assert.equal(lastQuote.weightKg,1);assert.equal(lastQuote.pickup.lat,12.97);await field('paymentMethod',method);await evaluate(`document.querySelector('[name=terms]').click()`);await click('Confirm parcel booking');await waitText('PD-BROWSER-FIXTURE');
    if(method==='online'){await waitText('payment pending');await click('Pay ₹20.40 online');await waitText('searching for driver');assert.equal(verifications,1);assert.equal(b.paymentStatus,'paid');}
    else{await waitText('searching for driver');assert.equal(b.paymentStatus,'cash_due');}
  }
  b=fresh();await navigate('/admin/parcel-delivery');await waitText('PD-BROWSER-FIXTURE');await click('PD-BROWSER-FIXTURE');await waitText('Manual assignment');await click('Load eligible drivers');await sleep(200);await field('partnerId',pid);await field('reason','Synthetic fallback review');await click('Offer to selected driver');await waitText('searching for driver');assert.equal(b.status,'searching_for_driver');
  await navigate('/delivery/parcels');await waitText('PD-BROWSER-FIXTURE');await click('PD-BROWSER-FIXTURE');await waitText('Accept offer');await click('Accept offer');await waitText('driver assigned');
  for(const text of ['driver arriving','arrived at pickup']){await click(text);await waitText(labelFor(text));}
  await click('Request pickup code');await field('code','123456');await click('Verify proof');await waitText('picked up');await click('in transit');await waitText('in transit');await click('arrived at dropoff');await waitText('arrived at dropoff');await click('Record exact cash received');await waitText('collected unreconciled');await click('Request delivery code');await field('code','654321');await click('Verify proof');await waitText('delivered');assert.equal(b.status,'delivered');
  // A failed response is visible and refresh can recover without a fabricated state.
  failNext=true;await navigate('/parcel-delivery/history');await waitText('Synthetic request error');await click('Retry');await waitText('PD-BROWSER-FIXTURE');
  assert.deepEqual(errors,[]);const result={responsiveViews:views.length,customerPaymentPaths:2,manualFallback:1,driverLifecycle:1,errorRecovery:1,mockedMutationRequests:writes,mockedPaymentVerifications:verifications,realGatewayCalls:0,passed:true};await writeFile(resolve('../test-artifacts/parcel-browser-results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{
  socket?.close();browser.kill();await vite.close();assert.equal(dirname(resolve(temp)),resolve(tmpdir()));assert.ok(basename(temp).startsWith('bulkimart-parcel-browser-'));
  for(let i=0;i<15;i++){try{await rm(temp,{recursive:true,force:true});break;}catch{await sleep(200);}}
}
function labelFor(text){return text;}
