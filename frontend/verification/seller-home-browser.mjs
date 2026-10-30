import assert from 'node:assert/strict';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
let source = await readFile(new URL('../tests/mobile-layout.test.mjs', import.meta.url), 'utf8');
source = source.replace("['--headless=new',", "['--headless=new', '--no-sandbox', '--disable-gpu',");
const dashboardFixture = "if (path === '/api/sellers/dashboard') return { success: true, kpis: { totalRevenue: 100, totalOrders: 1, lowStockCount: 1 } };";
assert.ok(source.includes(dashboardFixture));
const storeMetrics = { totalRevenue:2050, knownRevenue:2050, revenuePendingOrders:0, totalOrders:10, completedOrders:3, avgOrderValue:683.33, netEarnings:null, knownNetEarnings:0, netEarningsCalculatedOrders:0, netEarningsPendingOrders:3, unpostedOrders:3, pendingOrders:4 };
const storeBreakdown = {ecommerce:{revenue:1150,orders:5},grocery:{revenue:900,orders:5}};
source = source.replace(dashboardFixture, "if (path === '/api/sellers/dashboard') return {success:true,kpis:"+JSON.stringify(storeMetrics)+",byChannel:"+JSON.stringify(storeBreakdown)+",salesPerformance:Array.from({length:30},(_,index)=>({date:'2026-10-'+String(index+1).padStart(2,'0'),revenue:index===29?360:0}))};\n"+
  "  if (path === '/api/products/bulk/upload') return {success:false,message:'Product sheet validation failed',meta:{errors:[{row:2,name:'Test product',reason:'Stock must be a whole number of zero or more'}]}};\n"+
  "  if (path === '/api/sellers/finances/summary') return {success:true,data:{balances:{pending:0,held:0,eligible:0,reserved:0,settled:0,earnedEarnings:0,quickFreightObligations:0,bulkimartServiceFees:0},salesMetrics:"+JSON.stringify(storeMetrics)+",salesByChannel:"+JSON.stringify(storeBreakdown)+",payouts:[],deliveredSales:{orderCount:3,grossAmount:2050,orders:[]},coverage:{unpostedOrders:3},payoutPolicy:{},payoutActionsEnabled:false}};\n"+
  "  if (path === '/api/sellers/finances/ledger') return {success:true,data:[],meta:{}};");
const marker = '      if (startupOnly) {';
assert.ok(source.includes(marker));
source = source.replace(marker, `      if (process.argv.includes('--seller-home-bugs')) {
        const home = async () => {await command('Page.navigate',{url:origin+'/seller'});await waitFor("document.querySelectorAll('.seller-home-kpi').length===4&&!document.querySelector('.seller-kpi-grid[aria-busy=true]')");};
        await waitFor("document.querySelectorAll('.seller-home-kpi').length===4&&!document.querySelector('.seller-kpi-grid[aria-busy=true]')");
        const layout=await evaluate("(()=>{const heading=[...document.querySelectorAll('.seller-home-kpi-heading>span:first-child')].find(e=>e.textContent==='Average Order Value');const r=heading.getBoundingClientRect(),card=heading.closest('button').getBoundingClientRect();return {label:heading.textContent,contained:r.left>=card.left&&r.right<=card.right&&r.bottom<=card.bottom,clipped:heading.scrollWidth>heading.clientWidth+1,overflow:document.documentElement.scrollWidth>innerWidth+1,net:document.querySelector('.seller-home-net').textContent};})()");
        assert.equal(layout.contained,true);assert.equal(layout.clipped,false);assert.equal(layout.overflow,false);assert.match(layout.net,/Not calculated yet.*3 orders awaiting finance review/);assert.equal(layout.net.includes('₹0.00'),false);
        assert.equal(await evaluate("document.querySelector('.seller-home-kpi-value').textContent"),'₹2,050.00');
        await evaluate("document.querySelector('.seller-profile-chip').click()");await waitFor("location.pathname==='/seller/profile'");await home();
        for(const [title,target] of [['Total Revenue','earnings'],['Total Orders','orders'],['Average Order Value','salesreport'],['Pending Orders','orders']]){
          await evaluate("[...document.querySelectorAll('.seller-home-kpi')].find(e=>e.querySelector('.seller-home-kpi-heading').textContent.startsWith("+JSON.stringify(title)+")).click()");
          await waitFor("location.pathname==='/seller/"+target+"'");
          if(title==='Total Revenue'){await waitFor("!!document.querySelector('.seller-earnings-summary')");const summary=await evaluate("document.querySelector('.seller-earnings-summary').textContent");assert.match(summary,/2,050.00/);assert.match(summary,/Awaiting calculation/);assert.equal(summary.includes('₹0.00'),false);assert.equal(await evaluate("!!document.querySelector('.seller-earnings-coverage')"),true);}
          if(title==='Pending Orders')await waitFor("[...document.querySelectorAll('.seller-tab-btn.active')].some(e=>e.textContent==='Pending')");
          await home();
        }
        await evaluate("document.querySelector('.seller-sales-chart').scrollIntoView({block:'center'})");
        const hover=await evaluate("(()=>{const e=document.querySelectorAll('.seller-chart-hit')[29],r=e.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2,cursor:getComputedStyle(e).cursor};})()");
        assert.equal(hover.cursor,'crosshair');await command('Input.dispatchMouseEvent',{type:'mouseMoved',x:hover.x,y:hover.y});await waitFor("document.querySelector('.seller-chart-tooltip').textContent.includes('₹360')");
        await evaluate("[...document.querySelectorAll('.chart-time-btn')].find(e=>e.textContent==='7 Days').click()");await waitFor("document.querySelectorAll('.seller-chart-hit').length===7");
        await command('Page.navigate',{url:origin+'/seller/products'});await waitFor("[...document.querySelectorAll('button')].some(e=>e.textContent.trim()==='Bulk Upload')");await evaluate("[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='Bulk Upload').click()");await waitFor("!!document.querySelector('#bulk-product-sheet')");
        assert.equal(await evaluate("document.querySelector('#bulk-product-sheet').accept"),'.xlsx,.csv');
        await evaluate("(()=>{const e=document.querySelector('#bulk-product-sheet'),d=new DataTransfer();d.items.add(new File(['invalid'],'product.pdf',{type:'application/pdf'}));e.files=d.files;e.dispatchEvent(new Event('change',{bubbles:true}));})()");await waitFor("document.querySelector('#bulk-sheet-error')?.textContent.includes('.xlsx or .csv')");
        await evaluate("(()=>{const e=document.querySelector('#bulk-product-sheet'),d=new DataTransfer();d.items.add(new File(['Product Name,Stock'+String.fromCharCode(10)+'Test product,-1'],'products.csv',{type:'text/csv'}));e.files=d.files;e.dispatchEvent(new Event('change',{bubbles:true}));})()");
        await evaluate("document.querySelector('#bulk-product-sheet').closest('form').requestSubmit()");await waitFor("document.body.innerText.includes('Row 2')&&document.body.innerText.includes('Stock must be a whole number')");
        rows.push({viewport:width,profileClickable:true,kpiNavigation:true,pendingFilter:true,averageOrderValueFullyVisible:true,chartHover:true,chartPeriod:true,fileFormat:true,rowValidation:true});continue;
      }
` + marker);
const generated = new URL(`../tests/.seller-home-${process.pid}.mjs`, import.meta.url);
await writeFile(generated, source);
try {
  const code = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [generated.pathname.replace(/^\/(\w:)/, '$1'), '--full', '--seller-home-bugs', '--widths=320,390,768,1280', '--paths=/seller'], { cwd: new URL('..', import.meta.url), windowsHide: true, stdio: 'inherit' });
    child.once('error', reject); child.once('exit', resolve);
  });
  assert.equal(code, 0, 'Seller home browser checks pass');
} finally { await rm(generated, { force: true }); }
