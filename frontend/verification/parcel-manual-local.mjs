// Full existing app + full existing API router, isolated from every real account.
import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const allowed = new Set(['systemroot','windir','comspec','path','pathext','temp','tmp','userprofile','localappdata','appdata','homedrive','homepath','lang','number_of_processors','processor_architecture','os']);
const env = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => allowed.has(key.toLowerCase()))), NODE_ENV:'test', OTP_MODE:'mock', FCM_MODE:'mock' };
const backend = spawn(process.execPath, [fileURLToPath(new URL('../../backend/verification/parcel-journey-server.mjs',import.meta.url)), '--manual'], { env, windowsHide:true, stdio:['ignore','ignore','pipe','ipc'] });
let errors='', vite, stopping=false;
backend.stderr.on('data', chunk=>{errors+=chunk;});
async function stop() {
  if(stopping)return;stopping=true;
  await vite?.close();
  if(backend.connected)backend.send({action:'stop'});
  await Promise.race([new Promise(r=>backend.once('exit',r)),new Promise(r=>setTimeout(r,10000))]);
  if(backend.exitCode===null)backend.kill();
}
process.on('SIGINT',()=>void stop().then(()=>process.exit(0)));
process.on('SIGTERM',()=>void stop().then(()=>process.exit(0)));
try{
  const fixture=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('Local parcel backend timed out')),60000);
    backend.once('message',message=>{clearTimeout(timer);resolve(message);});
    backend.once('exit',()=>{clearTimeout(timer);reject(Error(errors.slice(-1500)||'Local parcel backend stopped'));});
  });
  if(!fixture.ready||!fixture.adminToken)throw Error('Isolated test admin missing');
  const target='http://127.0.0.1:'+fixture.port;
  vite=await createServer({
    root:fileURLToPath(new URL('..',import.meta.url)),envDir:false,cacheDir:resolve('../test-artifacts/parcel-local-vite-cache'),
    define:{'import.meta.env.VITE_API_BASE_URL':'""','import.meta.env.VITE_API_URL':'""','import.meta.env.VITE_GOOGLE_MAPS_API_KEY':'""'},
    server:{host:'127.0.0.1',port:4174,strictPort:true,hmr:false,proxy:{'/api':target}},
    plugins:[{name:'local-parcel-test-boundary',configureServer(server){
      server.middlewares.use(async(req,res,next)=>{
        if(req.url==='/__parcel-test/start'){
          res.setHeader('Content-Type','text/html');res.setHeader('Cache-Control','no-store');
          res.end('<!doctype html><html><body><script>localStorage.setItem("adminToken",'+JSON.stringify(fixture.adminToken)+');localStorage.setItem("userToken",'+JSON.stringify(fixture.token)+');location.replace("/admin/parcel-delivery");</script></body></html>');return;
        }
        if(req.url==='/__parcel-test/status'){
          res.setHeader('Content-Type','application/json');res.end(JSON.stringify({isolated:true,database:'disposable-memory-replica-set',maps:'simulated',productionConnected:false}));return;
        }
        if(req.url==='/__parcel-test/stats'){
          const response=await fetch(target+'/__fixture/stats');res.setHeader('Content-Type','application/json');res.end(await response.text());return;
        }
        if(req.url==='/__parcel-test/stop'&&req.method==='POST'){res.end('Stopping isolated parcel test instance');setTimeout(()=>void stop().then(()=>process.exit(0)),100);return;}
        next();
      });
      server.middlewares.use((_req,res,next)=>{
        const end=res.end;
        res.end=function(body,...args){
          if(String(this.getHeader('Content-Type')||'').includes('text/html')&&typeof body==='string'&&body.includes('<html')){
            body=body.replace('<body>','<body><aside style="position:relative;padding:10px;background:#fff1dc;color:#713f12;font:14px Arial;text-align:center;border-bottom:1px solid #ff8500">ISOLATED PARCEL TEST • synthetic data • simulated maps/fares • production unchanged</aside>');
          }
          return end.call(this,body,...args);
        };next();
      });
    }}],
  });
  await vite.listen();
  await mkdir(resolve('../test-artifacts'),{recursive:true});
  await writeFile(resolve('../test-artifacts/parcel-local-instance.json'),JSON.stringify({pid:process.pid,origin:'http://127.0.0.1:4174',start:'http://127.0.0.1:4174/__parcel-test/start',isolated:true,productionConnected:false},null,2));
  console.log('Isolated parcel test ready: http://127.0.0.1:4174/__parcel-test/start');
  console.log('Synthetic accounts and simulated geography/routes only. Shared production database not loaded.');
}catch(error){console.error(error.message);await stop();process.exitCode=1;}
