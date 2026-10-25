// Applies coverage through the real Admin form ONLY on the isolated 4174 helper.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,dirname,basename} from 'node:path';
const origin='http://127.0.0.1:4174';
const enableCashChoice=process.argv.includes('--cash-choice');
let status;
for(let attempt=0;attempt<100&&!status;attempt++){try{status=await(await fetch(origin+'/__parcel-test/status',{signal:AbortSignal.timeout(1000)})).json();}catch{await new Promise(r=>setTimeout(r,200));}}
assert.ok(status,'Start npm run test:parcel-local before approving isolated test areas');
assert.equal(status.isolated,true);assert.equal(status.productionConnected,false);assert.equal(status.database,'disposable-memory-replica-set');
const executable=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
assert.ok(executable);
const temp=await mkdtemp(join(tmpdir(),'bulkimart-parcel-areas-')),profile=join(temp,'profile'),artifacts=resolve('../test-artifacts/parcel-local-areas');
await mkdir(profile);await mkdir(artifacts,{recursive:true});
const browser=spawn(executable,['--headless=new','--disable-gpu','--remote-debugging-port=0','--user-data-dir='+profile,'--no-first-run','--disable-background-networking','about:blank'],{windowsHide:true,stdio:'ignore'});
let socket,sequence=0;const pending=new Map(),errors=[],delay=ms=>new Promise(r=>setTimeout(r,ms));
function command(method,params={}){const id=++sequence;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout '+method));},15000);pending.set(id,{resolve:r=>{clearTimeout(timer);resolve(r);},reject:e=>{clearTimeout(timer);reject(e);}});socket.send(JSON.stringify({id,method,params}));});}
async function evaluate(expression){const r=await command('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;}
async function wait(expression){for(let i=0;i<200;i++){if(await evaluate(expression))return;await delay(100);}throw Error('Missing '+expression+'\n'+await evaluate('document.body?.innerText'));}
const text=t=>wait('document.body?.innerText.includes('+JSON.stringify(t)+')');
async function click(t){await wait('[...document.querySelectorAll("button")].some(b=>b.textContent.trim()==='+JSON.stringify(t)+'&&!b.disabled)');await evaluate('[...document.querySelectorAll("button")].find(b=>b.textContent.trim()==='+JSON.stringify(t)+'&&!b.disabled).click()');await delay(100);}
async function field(expression,value){await evaluate('(()=>{const e='+expression+';if(!e)throw Error("Missing field");const p=e instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:e instanceof HTMLSelectElement?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(p,"value").set.call(e,'+JSON.stringify(value)+');e.dispatchEvent(new Event(e instanceof HTMLSelectElement?"change":"input",{bubbles:true}));})()');await delay(50);}
const named=(name,value)=>field('document.querySelector('+JSON.stringify('input[name="'+name+'"],textarea[name="'+name+'"],select[name="'+name+'"]')+')',value);
const area=index=>'[...document.querySelectorAll("fieldset")].filter(f=>/^Area [0-9]+$/.test(f.querySelector(":scope > legend")?.textContent||""))['+index+']';
const policy=()=>evaluate('fetch("/api/admin/parcel-delivery/policy",{headers:{Authorization:"Bearer "+localStorage.getItem("adminToken")}}).then(r=>r.json()).then(b=>b.data)');
const initialStats=await(await fetch(origin+'/__parcel-test/stats')).json();
try{
  let port;for(let i=0;i<100;i++){try{port=Number((await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);break;}catch{await delay(100);}}
  assert.ok(port);const target=(await(await fetch('http://127.0.0.1:'+port+'/json/list')).json()).find(t=>t.type==='page');
  socket=new WebSocket(target.webSocketDebuggerUrl);await new Promise(r=>socket.addEventListener('open',r,{once:true}));
  socket.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p?.reject(Error(m.error.message)):p?.resolve(m.result);}if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);if(m.method==='Fetch.requestPaused'){const local=new URL(m.params.request.url).origin===origin;void command(local?'Fetch.continueRequest':'Fetch.failRequest',{requestId:m.params.requestId,...(local?{}:{errorReason:'BlockedByClient'})}).catch(()=>{});}});
  await command('Page.enable');await command('Runtime.enable');await command('Fetch.enable',{patterns:[{urlPattern:'*'}]});
  // This isolated helper intentionally has no provider credentials. Exercise the
  // actual UI against a controlled Google SDK boundary, never a live Maps call.
  await command('Page.addScriptToEvaluateOnNewDocument',{source:`(() => {
    const state=window.__coverageMaps={maps:[],markers:[],circles:[]};
    class Events { addListener(name,fn){(this.events??={})[name]=fn;return{remove:()=>delete this.events[name]};} }
    window.google={maps:{
      Map:class extends Events { constructor(holder){super();this.holder=holder;holder.dataset.simulatedMap='true';state.maps.push(this);}fitBounds(){}setCenter(){}setZoom(){} },
      LatLngBounds:class{extend(p){this.point=p;}getCenter(){return this.point;}},
      Marker:class extends Events {constructor(o){super();Object.assign(this,o);state.markers.push(this);}setMap(map){this.map=map;}},
      Circle:class{constructor(o){Object.assign(this,o);state.circles.push(this);}getBounds(){return{};}setMap(map){this.map=map;}},
      async importLibrary(){return{AutocompleteSessionToken:class{},AutocompleteSuggestion:{async fetchAutocompleteSuggestions(){return{suggestions:[]};}}};}
    }};
  })();`});
  await command('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await command('Page.navigate',{url:origin+'/__parcel-test/start'});await text('Fare and driver settings');
  const before=await policy();await click('Fare and driver settings');await text('Save parcel settings');
  const requested=[{name:'Botejhari / Katangjhari — LOCAL TEST',pincode:'481332',query:'Botejhari 481332'},{name:'Indore — LOCAL TEST',pincode:'452006',query:'Indore 452006'}];
  const already=requested.every(r=>before.config.areas.some(a=>a.pincodes.includes(r.pincode)));
  const needsCashChoice=enableCashChoice&&before.config.cashCollectionPoint!=='customer_choice';
  if(!already||needsCashChoice){
    for(const item of requested){
      if(before.config.areas.some(a=>a.pincodes.includes(item.pincode)))continue;
      await click('Add service area');
      const index=await evaluate('[...document.querySelectorAll("fieldset")].filter(f=>/^Area [0-9]+$/.test(f.querySelector(":scope > legend")?.textContent||"")).length-1'),scope=area(index);
      await field(scope+'.querySelectorAll("input")[0]',item.name);
      await field(scope+'.querySelectorAll("input")[1]',item.pincode);
      await field(scope+'.querySelector(".parcel-location-picker input")',item.query);
      await evaluate('[...'+scope+'.querySelectorAll("button")].find(b=>b.textContent==="Find address").click()');
      await wait(scope+'.textContent.includes("Use this location")');
      await evaluate('[...'+scope+'.querySelectorAll("button")].find(b=>b.textContent==="Use this location").click()');
      await field(scope+'.querySelector("input[type=number]")','10');
    }
    await named('approvalReference','Isolated local test coverage for 481332 and 452006; no production approval');
    if(enableCashChoice) {
      await named('cashCollectionPoint','customer_choice');
      await field(`document.querySelector('textarea[maxlength="10000"]')`,'Synthetic local terms: documents only. Exact delivery fee is paid in cash at the customer-selected pickup or drop-off. Cancellation and failed delivery require admin review. No production approval.');
    }
    await click('Save parcel settings');await text('Parcel settings saved.');
  }
  const after=await policy();
  assert.equal(after.version,before.version+(!already||needsCashChoice?1:0));
  if(enableCashChoice)assert.equal(after.config.cashCollectionPoint,'customer_choice');
  for(const item of requested)assert.ok(after.config.areas.some(a=>a.pincodes.includes(item.pincode)&&a.radiusKm===10));
  assert.deepEqual(after.config.areas.slice(0,before.config.areas.length),before.config.areas);
  const preserved=c=>Object.fromEntries(Object.entries(c).filter(([k])=>!['areas','approvalReference',...(enableCashChoice?['cashCollectionPoint','terms']:[])].includes(k)));
  assert.deepEqual(preserved(after.config),preserved(before.config));
  assert.ok(after.history.some(h=>h.version===after.version&&h.by));
  const areaCount=after.config.areas.length,last=areaCount-1;
  await wait('window.__coverageMaps.circles.filter(c=>c.map).length==='+areaCount);
  assert.equal(await evaluate('new Set([...document.querySelectorAll(".parcel-location-picker input")].map(e=>e.getAttribute("aria-controls"))).size'),areaCount);
  await field(area(last)+'.querySelector("input[type=number]")','5');
  await wait('window.__coverageMaps.circles.some(c=>c.map&&c.radius===5000)');
  await evaluate('(()=>{const marker=window.__coverageMaps.markers.filter(m=>m.map).at(-1);if(!marker.draggable)throw Error("Centre is not draggable");marker.events.dragend({latLng:{lat:()=>22.725,lng:()=>75.865}});})()');
  await wait(area(last)+'.textContent.includes("Use this location")');
  await evaluate('[...'+area(last)+'.querySelectorAll("button")].find(b=>b.textContent==="Use this location").click()');
  await wait('window.__coverageMaps.circles.some(c=>c.map&&c.radius===5000&&c.center.lat===22.725&&c.center.lng===75.865)');
  // Do not save the map experiment: only the explicit synthetic test coverage
  // above is persisted. Closing the editor must release all map overlays.
  assert.deepEqual(await policy(),after);
  await writeFile(join(artifacts,'admin-areas.png'),Buffer.from((await command('Page.captureScreenshot',{format:'png',captureBeyondViewport:true})).data,'base64'));
  await click('Close policy');
  await wait('window.__coverageMaps.circles.every(c=>c.map===null)&&window.__coverageMaps.markers.every(m=>m.map===null)');
  await command('Page.navigate',{url:origin+'/parcel-delivery/book'});await text('Confirm locations');
  await wait('document.querySelectorAll(".parcel-location-card select").length===2');
  const selectors=await evaluate('[...document.querySelectorAll(".parcel-location-card select")].map(s=>s.options[1].value)');
  assert.equal(selectors.length,2);
  await field('document.querySelector(".pickup select")',selectors[0]);
  const dropId=await evaluate('document.querySelector(".dropoff select").options[2].value');
  await field('document.querySelector(".dropoff select")',dropId);await click('Confirm locations');
  await named('dropoff.name','Test Recipient');
  for(const [name,value]of Object.entries({description:'Local test documents',weightKg:'1',length:'10',width:'10',height:'10'}))await named(name,value);
  await evaluate('document.querySelector(".parcel-check input[type=checkbox]").click()');await click('Confirm drop details');
  await text('Simulated test route');await text('Review fare');
  if(enableCashChoice) {
    await evaluate('[...document.querySelectorAll("button")].find(b=>b.textContent.startsWith("Review fare")).click()');
    await text('Review your booking');await evaluate('document.querySelector("input[value=pay_driver]").click()');
    await wait('!!document.querySelector("input[name=cashCollectionPoint][value=pickup]")');
    assert.equal(await evaluate('document.querySelector("input[name=cashCollectionPoint][value=pickup]").disabled'),false);
    await evaluate('document.querySelector("input[name=cashCollectionPoint][value=pickup]").click()');await text('sender pays before handover');
  }
  const stats=await(await fetch(origin+'/__parcel-test/stats')).json();assert.equal(stats.bookings,0);assert.equal(stats.quotes,initialStats.quotes+1);
  await command('Emulation.setDeviceMetricsOverride',{width:393,height:852,deviceScaleFactor:1,mobile:true});
  assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),true);
  await writeFile(join(artifacts,'customer-quote.png'),Buffer.from((await command('Page.captureScreenshot',{format:'png'})).data,'base64'));
  assert.deepEqual(errors,[]);
  const result={isolated:true,productionConnected:false,savedThrough:'Existing Admin form and protected policy API',policyVersion:after.version,cashCollectionPoint:after.config.cashCollectionPoint,areas:after.config.areas.map(a=>({name:a.name,pincodes:a.pincodes,radiusKm:a.radiusKm})),otherSettingsPreserved:true,historyRecorded:true,adminMapChecks:{independentSearchIds:true,radiusUpdate:true,draggablePinConfirmation:true,unsavedChangesNotPublished:true,overlayCleanup:true},customerQuotePassed:true,cashPickupSelectionVerified:enableCashChoice,bookingsCreated:stats.bookings,externalProviders:'simulated only',errors};
  await writeFile(join(artifacts,'results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}finally{
  socket?.close();browser.kill();assert.equal(dirname(resolve(temp)),resolve(tmpdir()));assert.ok(basename(temp).startsWith('bulkimart-parcel-areas-'));
  for(let i=0;i<15;i++){try{await rm(temp,{recursive:true,force:true});break;}catch{await delay(200);}}
}
