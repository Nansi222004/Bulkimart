import assert from 'node:assert/strict';
import {readFile,writeFile,rm} from 'node:fs/promises';
import {spawn} from 'node:child_process';

// Production React artifact, ephemeral browser profile. The inspected runner
// intercepts every API origin and blocks all nonlocal external resources.
// No backend/server startup, live credentials, database or providers are used.
const template=new URL('../tests/mobile-layout.test.mjs',import.meta.url);
const generated=new URL(`../tests/.admin-charts-${process.pid}.mjs`,import.meta.url);
let source=await readFile(template,'utf8');
function replace(marker,value) {assert.ok(source.includes(marker),`Browser runner marker changed: ${marker.slice(0,60)}`);source=source.replace(marker,value);}
replace("'--headless=new', '--remote-debugging-port=0'","'--headless=new', '--disable-gpu', '--remote-debugging-port=0'");
replace("const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();",
  "const target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t=>t.type==='page');");
replace('  const path = new URL(raw).pathname;',`  const path = new URL(raw).pathname;
  if(path==='/api/admin/dashboard/overview')return {success:true,data:{totalOrders:3,ecommerceOrders:1,groceryOrders:1,totalUsers:0,totalSellers:0,pendingSellers:0,recentOrders:[],lowStockAlerts:[],recentSellers:[],ecommerceCategories:[],quickCommerceCategories:[]}};
  if(path==='/api/admin/dashboard/financial-metrics'){
    if(['error','denied'].includes(layoutScenario))return {success:false,data:null,message:'Private fixture error'};
    if(layoutScenario==='malformed')return {success:true,data:{}};
    const metric={status:'complete',amountPaise:0,verifiedSubtotalPaise:0,incompleteRecords:0,excludedRecords:0};
    const data={version:1,currency:'INR',unit:'paise',scope:'all-time',timezone:'Asia/Kolkata',asOf:'2026-10-23T12:00:00Z',orderValue:{...metric,amountPaise:12345,verifiedSubtotalPaise:12345},collections:{...metric,amountPaise:5678,verifiedSubtotalPaise:5678},platformRevenue:{...metric,status:'unavailable',amountPaise:null,verifiedSubtotalPaise:1250,blocker:'Recognition policy is not approved.'}};
    if(layoutScenario==='empty'){data.orderValue={...metric};data.collections={...metric};}
    if(layoutScenario==='incomplete')data.collections={...metric,status:'incomplete',amountPaise:null,verifiedSubtotalPaise:999,incompleteRecords:2};
    return {success:true,data};
  }
  if(path==='/api/admin/dashboard/order-analytics'){
    if(layoutScenario==='error')return {success:false,data:null,message:'Private fixture error'};
    if(layoutScenario==='malformed')return {success:true,data:{}};
    const data={version:1,scope:'all-time',timezone:'Asia/Kolkata',unit:'orders',measure:'fulfilment-orders',asOf:'2026-10-23T12:00:00Z',totalOrders:3,statuses:[{key:'delivered',count:2},{key:'unknown',count:1}],channels:[{key:'grocery',count:1},{key:'unknown',count:2}],salesChannels:[{key:'wholesale',count:1},{key:'unknown',count:2}]};
    if(layoutScenario==='empty')Object.assign(data,{totalOrders:0,statuses:[],channels:[],salesChannels:[]});
    return {success:true,data};
  }
`);
const statusMarker="let body = fixture(request.url, request.postData), status = body.success === false ? 503 : 200;";
replace(statusMarker,statusMarker+"if(layoutScenario==='denied' && new URL(request.url).pathname==='/api/admin/dashboard/financial-metrics')status=403;");
replace('      if (startupOnly) {',`
      await waitFor(\`document.querySelectorAll('.sa-dashboard-chart').length===3 && ![...document.querySelectorAll('.sa-dashboard-chart')].some(el=>el.innerText.includes('Loading'))\`);
      const chartText=await evaluate(\`[...document.querySelectorAll('.sa-dashboard-chart')].map(el=>el.innerText)\`);
      if(['error','malformed'].includes(layoutScenario)){
        assert.ok(chartText[0].includes('Financial chart unavailable'));
        assert.ok(chartText[1].includes('could not be verified') && chartText[2].includes('could not be verified'));
        assert.equal(await evaluate(\`document.querySelectorAll('.sa-dashboard-bars').length\`),0);
      } else if(layoutScenario==='denied'){
        assert.ok(chartText[0].includes('Financial chart unavailable'));
        assert.ok(chartText[1].includes('Delivered') && chartText[2].includes('Unknown / Unattributed'));
      } else if(layoutScenario==='empty'){
        assert.ok(chartText[0].includes('₹0.00'));
        assert.ok(chartText[1].includes('No fulfilment Orders found.') && chartText[2].includes('No fulfilment Orders found.'));
      } else {
        assert.ok(chartText[0].includes('₹123.45'));
        assert.ok(chartText[0].includes(layoutScenario==='incomplete'?'₹9.99':'₹56.78'));
        assert.ok(chartText[1].includes('Delivered') && chartText[2].includes('Unknown / Unattributed'));
      }
      assert.ok(!chartText.join('').includes('Private fixture error'));
      const clippedCharts=await evaluate(\`[...document.querySelectorAll('.sa-dashboard-chart,.sa-dashboard-bar-label')].filter(el=>el.scrollWidth>el.clientWidth+1).length\`);
      assert.equal(clippedCharts,0,'Chart labels and cards do not clip');
      if(width===390 || width===1440){
        const directory=resolve('../test-artifacts/admin-dashboard-charts');await mkdir(directory,{recursive:true});
        await writeFile(join(directory,layoutScenario+'-'+width+'.png'),Buffer.from((await command('Page.captureScreenshot',{format:'png',captureBeyondViewport:true})).data,'base64'));
      }
      if (startupOnly) {`);
source=source.replaceAll('../test-artifacts/mobile-native','../test-artifacts/admin-dashboard-charts/geometry')
  .replaceAll('../test-artifacts/mobile-layout','../test-artifacts/admin-dashboard-charts/layout');
try {
  await writeFile(generated,source);
  const code=await new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[generated.pathname.replace(/^\/(?:([A-Za-z]:))/,'$1'),'--full',
      '--paths=/admin?layout=data,/admin?layout=empty,/admin?layout=incomplete,/admin?layout=error,/admin?layout=malformed,/admin?layout=denied',
      '--widths=320,360,375,390,430,768,1440','--label=admin-charts'],{cwd:new URL('..',import.meta.url),stdio:'inherit',windowsHide:true});
    child.on('error',reject);child.on('exit',resolve);
  });
  assert.equal(code,0,'Admin chart browser assertions failed');
} finally {await rm(generated,{force:true});}
