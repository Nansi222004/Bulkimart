// Real Chromium + local backend public GETs. Only response latency is simulated.
import assert from 'node:assert/strict';
import { preview } from 'vite';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { existsSync } from 'node:fs';
const baseline = process.argv.includes('--baseline');
const executable = process.env.CHROME_BIN || ['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
assert.ok(executable, 'Set CHROME_BIN');
const profile = await mkdtemp(join(tmpdir(), 'bulkimart-refresh-'));
const vite = await preview({preview:{host:'127.0.0.1',port:0,strictPort:false}});
const origin = `http://127.0.0.1:${vite.httpServer.address().port}`;
const path = '/grocery--home?product=6ad12379e87a768124c739d0&variant=6ad12379e87a768124c739d1';
const browser = spawn(executable,['--headless=new','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','about:blank'],{windowsHide:true,stdio:'ignore'});
const pause = ms => new Promise(r=>setTimeout(r,ms));
const pending = new Map(), errors=[];
let socket, seq=0, port;
function command(method,params={}) {return new Promise((resolve,reject)=>{const id=++seq;const timer=setTimeout(()=>{pending.delete(id);reject(new Error(method+' timed out'));},20000);pending.set(id,{resolve:r=>{clearTimeout(timer);resolve(r);},reject});socket.send(JSON.stringify({id,method,params}));});}
async function evaluate(expression) {const r=await command('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.text);return r.result.value;}
async function waitFor(expression) {for(let i=0;i<200;i++){if(await evaluate(expression))return;await pause(100);}throw new Error('Not ready: '+expression+' '+await evaluate('document.body.innerText.slice(0,1000)')+' '+JSON.stringify(errors));}
async function attach() {
  const target=await(await fetch(`http://127.0.0.1:${port}/json/new?about:blank`,{method:'PUT'})).json();
  socket?.close();socket=new WebSocket(target.webSocketDebuggerUrl);await new Promise(r=>socket.onopen=r);
  socket.onmessage=async event=>{
    const m=JSON.parse(event.data);
    if(m.id){const p=pending.get(m.id);pending.delete(m.id);if(m.error)p?.reject(new Error(m.error.message));else p?.resolve(m.result);return;}
    if(m.method==='Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.text);
    if(m.method!=='Fetch.requestPaused')return;
    const {requestId,request}=m.params;
    const requestSocket=socket;
    try {
      const url=new URL(request.url);
      const started=Date.now();
      assert.ok(['GET','HEAD','OPTIONS'].includes(request.method),'Public reads only');
      if(url.pathname==='/api/products/6ad12379e87a768124c739d0')await pause(1500);
      const response=await fetch((process.env.PRODUCT_TEST_API || 'http://localhost:5050')+url.pathname+url.search);
      const body=Buffer.from(await response.arrayBuffer()).toString('base64');
      if(socket!==requestSocket)return; // The previous tab's optional fetch finished after detaching.
      await command('Fetch.fulfillRequest',{requestId,responseCode:response.status,responseHeaders:[{name:'Content-Type',value:response.headers.get('content-type')||'application/json'}],body});
      if(url.pathname==='/api/products/6ad12379e87a768124c739d0')console.log('Real product response',response.status,Date.now()-started,'ms');
    }catch(e){if(!e.message.includes('Invalid InterceptionId'))errors.push(e.message);}
  };
  await command('Page.enable');await command('Runtime.enable');await command('Fetch.enable',{patterns:[{urlPattern:'*/api/*'}]});
  await command('Page.addScriptToEvaluateOnNewDocument',{source:`localStorage.setItem('locationAsked','true');`});
}
try {
  for(let i=0;i<100;i++){try{port=Number((await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);break;}catch{await pause(100);}}
  assert.ok(port);await attach();
  const ready = `document.querySelector('.product-detail-page')?.textContent.includes('Home things') && new URLSearchParams(location.search).get('variant')==='6ad12379e87a768124c739d1'`;
  await command('Page.navigate',{url:origin+path});await waitFor(ready);
  for(let i=0;i<3;i++){
    const stamp=await evaluate('performance.timeOrigin');await command('Page.reload');
    await waitFor(`performance.timeOrigin!==${stamp} && !!document.querySelector('.pd-product-link-state[role="status"]')`);
    assert.equal(await evaluate(`!!document.querySelector('.product-detail-overlay.pd-product-link-state')`),baseline);
    await waitFor(ready);assert.equal(await evaluate(`!!document.querySelector('.pd-product-link-state')`),false);
  }
  await attach();await command('Page.navigate',{url:origin+path});await waitFor(ready);
  await command('Page.navigate',{url:origin+'/grocery--home'});
  await waitFor(`!!document.querySelector('.home-feed-scrollable') && !document.querySelector('.product-detail-page')`);
  await evaluate('history.back()');await waitFor(ready);
  await evaluate('history.forward()');
  await waitFor(`!!document.querySelector('.home-feed-scrollable') && !document.querySelector('.product-detail-page')`);
  for(const [query,message] of [
    ['product=','Invalid product link'],
    ['product=bad','Invalid product link'],
    ['product=000000000000000000000000','not found'],
    ['product=6ad12379e87a768124c739d0&variant=bad','variant is unavailable'],
    ['product=6ad12379e87a768124c739d0&variant=000000000000000000000000','variant is unavailable'],
  ]) {
    await command('Page.navigate',{url:origin+'/grocery--home?'+query});
    await waitFor(`document.querySelector('.pd-product-link-state[role="alert"]')?.textContent.toLowerCase().includes(${JSON.stringify(message.toLowerCase())})`);
    await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent==='Back to storefront').click()`);
    await waitFor(`!!document.querySelector('.home-feed-scrollable') && !document.querySelector('.pd-product-link-state')`);
    assert.equal(await evaluate(`new URLSearchParams(location.search).has('product')`),false);
  }
  await command('Page.navigate',{url:origin+'/grocery--home?product=6ad12379e87a768124c739d0'});
  await waitFor(ready); // Missing variant deliberately selects the default pack.
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({baseline,realBrowser:true,realLocalBackend:true,latencySimulated:true,path,refreshes:3,newTab:true,backForward:true,invalidLinks:5,defaultVariant:true,passed:true}));
} finally {
  socket?.close();browser.kill();vite.httpServer.closeAllConnections?.();await new Promise(r=>vite.httpServer.close(r));
  assert.equal(dirname(resolve(profile)),resolve(tmpdir()));assert.ok(basename(profile).startsWith('bulkimart-refresh-'));
  await pause(500);await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:300});
}
