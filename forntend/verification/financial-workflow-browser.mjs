import assert from 'node:assert/strict';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';

// Extend the existing isolated CDP layout runner. It intercepts API calls,
// uses an ephemeral browser profile and never contacts payment providers.
const original = new URL('../tests/mobile-layout.test.mjs', import.meta.url);
const generated = new URL(`../tests/.finance-layout-${process.pid}.mjs`, import.meta.url);
let source = await readFile(original, 'utf8');
source = source.replace("['--headless=new',", "['--headless=new', '--disable-gpu', '--disable-extensions',");
const sessionMarker = "localStorage.setItem('deliveryDebitWallet','500');";
assert.ok(source.includes(sessionMarker), 'Existing browser session fixture changed');
source = source.replace(sessionMarker, "localStorage.setItem('deliveryToken','rider-browser-fixture-token');");
const marker = '  const path = new URL(raw).pathname;';
assert.ok(source.includes(marker), 'Existing browser fixture hook changed');
source = source.replace(marker, marker + `
  const financeFlags={operations:layoutScenario==='finance-actions',payouts:false,policyApproved:layoutScenario==='finance-actions',testsApproved:layoutScenario==='finance-actions'};
  const financeOrder={_id:'507f1f77bcf86cd799439022',orderNo:'FINANCE-COD-FIXTURE',status:'delivered',paymentMethod:'cod',exceptions:['cod_unverified'],
    financialSnapshot:{expectedPaise:10000,lines:[{itemId:'item-fixture',itemName:'Organic Amla',sellerId:'seller-fixture',grossPaise:10000,eligiblePaise:10000,commissionPaise:1000,taxPaise:0,netPaise:9000,rule:{version:'RULE-FIXTURE'}}]},
    codFinance:{events:[{action:'collect',amountPaise:10000,reference:'COLLECT-1234',reason:'Recorded at customer delivery',actorId:'rider-fixture',at:'2026-10-28T10:00:00Z'},{action:'remit',amountPaise:10000,reference:'HANDOVER-5678',reason:'Deposited at cash desk',actorId:'rider-fixture',at:'2026-10-28T12:00:00Z'}]},
    display:{channel:'quick',actors:{'rider-fixture':{name:'Neelam',role:'Delivery partner'}},items:[{itemId:'item-fixture',name:'Organic Amla',sellerName:'Fresh Store'}]},
    cash:{expectedPaise:10000,collectedPaise:10000,reportedPaise:10000,verifiedPaise:0,outstandingPaise:10000,status:'remittance_reported'}};
  if(path.startsWith('/api/admin/finance/orders/') && requestBody){
    const payload=JSON.parse(requestBody);assert.equal(payload.reference,'CASH-BROWSER-1234');assert.equal(payload.reason,'Checked at the cash desk');
    return {success:true,message:'Cash issue recorded'};
  }
  if(path==='/api/admin/delivery-rates')return {success:true,data:{current:[{mode:'quick',source:'default',base:999,perKm:999}],history:[]}};
  if(path==='/api/admin/delivery-charge')return {success:true,data:{current:{source:'configured',flatFee:12,isActive:true,distanceRates:{quick:2,same_day:3},effectiveFrom:'2026-10-21T00:00:00Z'},history:[]}};
  if(path==='/api/admin/quick-commerce-third-party-config')return {success:true,data:{config:{revision:0,fee:{},enabled:false,paymentRequired:true},activationReady:false,blockers:['Release approval required']}};
  if(path==='/api/admin/quick-commerce-shiprocket-fees')return {success:true,data:[],meta:{total:0}};
  if(path==='/api/admin/delivery-payouts')return {success:true,data:[],meta:{pages:1,total:0}};
  if(path==='/api/admin/seller-ledger')return {success:true,data:[]};
  if(path==='/api/admin/seller-balances')return {success:true,data:{rows:[]}};
  if(path==='/api/admin/vendor-payouts')return {success:true,data:[],meta:{pages:1,total:0}};
  if(path==='/api/admin/finance/commissions')return {success:true,data:{rules:[],flags:financeFlags}};
  const financePolicy={configured:false,revision:0,tcsRatePercent:0,tdsRatePercent:0,sellerMinPayout:0,riderMinPayout:100,payoutSchedule:'on_request',payoutWeekday:1,requireIndependentPayoutReviewer:true,bankVerificationMethod:'',history:[]};
  if(path==='/api/admin/finance/policy')return {success:true,data:{policy:financePolicy,flags:financeFlags}};
  if(path==='/api/admin/finance/overview')return {success:true,data:{flags:{...financeFlags,snapshots:false},commissionRulesConfigured:false,policy:{...financePolicy,bankVerificationConfigured:false},
    todo:{cashToVerify:1,cashMismatch:0,cashWithRiders:0,missingRule:0,waitingPayment:1,needsReview:0,onHold:0,sellerPayouts:0,riderPayouts:0},
    totalsPaise:{sellersOnHold:0,sellersAvailable:0,sellersRequested:0,sellersPaid:0,ridersOnHold:0,ridersAvailable:0,ridersRequested:0,ridersPaid:0,commission:0,commissionGst:0,tcs:0,tds:0,platformDiscounts:0,codShortages:0,codCashWithRiders:10000}}};
  if(path==='/api/admin/finance/orders'||path==='/api/delivery/finances/cod')return {success:true,data:[financeOrder],meta:{page:1,pages:1,total:1}};
  if(path==='/api/admin/finance/reconciliation')return {success:true,data:{exceptions:[{orderNo:'FINANCE-COD-FIXTURE',code:'cod_unverified',detail:'Cash requires verification'}],negativeBalances:[],duplicateEventKeys:[],coverage:{ordersChecked:1,totalOrders:1,maxRiders:100}}};
  if(path==='/api/admin/finance/ledger'||path==='/api/delivery/finances/ledger')return {success:true,data:{rows:[],balances:[{_id:{account:'rider_payable',bucket:'held'},amount:40}],total:0,limit:50,flags:financeFlags}};
  if(path.endsWith('/financial-breakdown'))return {success:true,data:{entries:[],snapshot:null,financialPosting:'held',merchandise:{currency:'INR',components:{deliveryPaise:4000},lines:[{itemId:'item-fixture',grossPaise:10000,allocatedDiscounts:{couponDiscount:1000},eligiblePaise:9000,commissionPaise:900,taxPaise:0,netPaise:8100,rule:{version:'FROZEN-FINANCE-V1',method:'percentage',value:10,taxTreatment:'exempt',taxRate:0}}]}}};
`);
const checkMarker = '      if (startupOnly) {';
assert.ok(source.includes(checkMarker), 'Existing browser interaction hook changed');
source = source.replace(checkMarker, `
      if(path.startsWith('/admin/')){
        await waitFor(\`!!document.querySelector('.finance-center')\`);
        assert.equal(await evaluate(\`[...document.querySelectorAll('.sa-nav-link')].filter(link=>link.title==='Finance Center').length\`),1);
        const click=label=>evaluate(\`[...document.querySelectorAll('.finance-center button')].find(button=>button.textContent===\${JSON.stringify(label)}).click()\`);
        if(path.includes('view=cod') || path.includes('view=orders')){
          await waitFor(\`!!document.querySelector('.finance-view-details:not(:disabled)')\`);
          assert.equal(await evaluate(\`!!document.querySelector('.finance-records-table .finance-rider-report,.finance-records-table details')\`),false);
          assert.equal(await evaluate(\`document.querySelector('.finance-records-table').textContent.includes('COLLECT-1234')\`),false);
          assert.ok(await evaluate(\`document.querySelector('.finance-records-table tbody tr').getBoundingClientRect().height\`) < 140);
          const shotDir=resolve('../test-artifacts/finance-order-details');await mkdir(shotDir,{recursive:true});
          const prefix=(path.includes('view=cod')?'cod':'orders')+'-'+width;
          await evaluate(\`document.querySelector('.finance-records-table').scrollIntoView({block:'center'})\`);
          let shot=await command('Page.captureScreenshot',{format:'png'});await writeFile(join(shotDir,prefix+'-table.png'),Buffer.from(shot.data,'base64'));
          await evaluate(\`document.querySelector('.finance-view-details').focus()\`);
          await click('View details');
          await waitFor(\`!!document.querySelector('.finance-order-dialog')\`);
          const dialogClick=label=>evaluate(\`[...document.querySelectorAll('.finance-order-dialog button')].find(button=>button.textContent===\${JSON.stringify(label)}).click()\`);
          assert.equal(await evaluate(\`[...document.querySelectorAll('.finance-order-dialog button')].find(button=>button.textContent==='Confirm cash received').disabled\`),layoutScenario!=='finance-actions');
          const geometry=await evaluate(\`(()=>{const r=document.querySelector('.finance-order-dialog').getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:innerWidth,height:innerHeight}})()\`);
          assert.ok(geometry.left>=0 && geometry.right<=geometry.width+1 && geometry.top>=0 && geometry.bottom<=geometry.height+1,JSON.stringify(geometry));
          shot=await command('Page.captureScreenshot',{format:'png'});await writeFile(join(shotDir,prefix+'-details.png'),Buffer.from(shot.data,'base64'));
          await dialogClick('Payment history');await waitFor(\`!!document.querySelector('.finance-payment-timeline')\`);
          assert.equal(await evaluate(\`document.querySelector('.finance-payment-timeline').textContent.includes('COLLECT-1234') && document.querySelector('.finance-payment-timeline').textContent.includes('HANDOVER-5678')\`),true);
          assert.equal(await evaluate(\`document.querySelector('.finance-payment-timeline').textContent.includes('Neelam')\`),true);
          shot=await command('Page.captureScreenshot',{format:'png'});await writeFile(join(shotDir,prefix+'-history.png'),Buffer.from(shot.data,'base64'));
          await dialogClick('Item earnings');await waitFor(\`!!document.querySelector('[aria-label="Order money breakdown"]')\`);
          assert.equal(await evaluate(\`document.querySelector('.finance-order-dialog').textContent.includes('Organic Amla') && document.querySelector('.finance-order-dialog').textContent.includes('Fresh Store')\`),true);
          await dialogClick('Summary');await dialogClick('Refresh order');await waitFor(\`document.querySelector('.finance-order-dialog')?.textContent.includes('Order information updated.')\`);
          if(layoutScenario==='finance-actions'){
            await dialogClick('Report a cash problem');await waitFor(\`!!document.querySelector('.finance-order-dialog .finance-review')\`);
            await evaluate(\`(()=>{const inputs=document.querySelectorAll('.finance-order-dialog .finance-review input');const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;for(const [input,value] of [[inputs[0],'CASH-BROWSER-1234'],[inputs[1],'Checked at the cash desk']]){set.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));}})()\`);
            await dialogClick('Cancel');await waitFor(\`!document.querySelector('.finance-order-dialog .finance-review')\`);
            await dialogClick('Report a cash problem');await waitFor(\`!!document.querySelector('.finance-order-dialog .finance-review')\`);
            await evaluate(\`(()=>{const inputs=document.querySelectorAll('.finance-order-dialog .finance-review input');const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;for(const [input,value] of [[inputs[0],'CASH-BROWSER-1234'],[inputs[1],'Checked at the cash desk']]){set.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));}})()\`);
            await dialogClick('Save cash issue');await waitFor(\`!document.querySelector('.finance-order-dialog .finance-review') && document.querySelector('.finance-order-dialog')?.textContent.includes('Saved and reloaded')\`);
          }
          await command('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
          await command('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
          await waitFor(\`!document.querySelector('.finance-order-dialog')\`);
          assert.equal(await evaluate(\`document.activeElement===document.querySelector('.finance-view-details')\`),true);
        }
        if(path==='/admin/finance-center' || path==='/admin/finance-operations'){
          await waitFor(\`document.querySelector('.finance-center')?.textContent.includes('Setup checklist')\`);
          await waitFor(\`document.querySelector('.finance-center')?.textContent.includes('1 · COD handovers to check')\`);
          await click('Orders & COD'); await click('COD cash');
          await waitFor(\`document.querySelector('.finance-center')?.textContent.includes('FINANCE-COD-FIXTURE')\`);
          await click('View details');
          assert.equal(await evaluate(\`[...document.querySelectorAll('button')].find(button=>button.textContent==='Confirm cash received').disabled\`),true);
          await evaluate(\`document.querySelector('[aria-label="Close order details"]').click()\`);
          await click('Reports'); await click('Ledger & checks');
          await waitFor(\`document.querySelector('.finance-center')?.textContent.includes('cod unverified')\`);
        }
        if(path==='/admin/app-settings' || path.includes('view=commissions')){
          await waitFor(\`document.querySelector('.finance-center')?.textContent.includes('Money actions are switched off')\`);
          assert.equal(await evaluate(\`document.querySelector('.finance-center input[type=number]').value\`),'');
          assert.ok(await evaluate(\`document.querySelectorAll('.finance-center .finance-hint').length\`) >= 6);
        }
        if(path.includes('view=rates'))await waitFor(\`document.querySelector('.finance-center')?.textContent.includes('Quick Commerce rider pay')\`);
        if(path.includes('view=charges'))await waitFor(\`document.querySelector('.finance-center')?.textContent.includes('Flat charge')\`);
        if(path.includes('view=shiprocket') || path==='/admin/quick-third-party-settings')await waitFor(\`!!document.querySelector('.finance-center input[type=number]')\`);
        if(path.includes('view=payouts'))await waitFor(\`document.querySelector('.finance-center')?.textContent.includes('Nothing to show here')\`);
        if(path.includes('view=policies'))await waitFor(\`document.querySelector('.finance-center')?.textContent.includes('TCS rate')\`);
        if(path.includes('view=earnings'))await waitFor(\`!document.querySelector('.finance-center')?.textContent.includes('Loading')\`);
        await evaluate(\`document.querySelectorAll('.finance-center details').forEach(element=>element.open=true)\`);
      }
      if(path==='/delivery/earnings'){
        await waitFor(\`document.querySelector('[aria-label="COD and verified delivery earnings"]')?.textContent.includes('FINANCE-COD-FIXTURE')\`);
        assert.equal(await evaluate(\`document.body.textContent.includes('successful via digital gateway')\`),false);
      }
      if(path.startsWith('/seller/orders/')){
        await waitFor(\`document.querySelector('[aria-label="Order financial breakdown"]')?.textContent.includes('FROZEN-FINANCE-V1')\`);
        assert.equal(await evaluate(\`document.querySelector('[aria-label="Order financial breakdown"]').textContent.includes('₹81.00')\`),true);
      }
` + checkMarker);
try {
  await writeFile(generated, source);
  const exit = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [generated.pathname.replace(/^\/(?:([A-Za-z]:))/, '$1'), '--full',
      process.argv.find(arg=>arg.startsWith('--paths=')) || '--paths=/admin/finance-center,/admin/finance-center?area=settings&view=commissions,/admin/finance-center?area=settings&view=rates,/admin/finance-center?area=settings&view=charges,/admin/finance-center?area=settings&view=shiprocket,/admin/finance-center?area=payouts&view=earnings,/admin/finance-center?area=payouts&view=payouts,/admin/finance-center?area=payouts&view=rider-earnings,/admin/finance-center?area=payouts&view=seller-payouts,/admin/finance-center?area=payouts&view=courier-payments,/admin/finance-center?area=settings&view=policies,/admin/app-settings,/admin/finance-operations,/admin/quick-third-party-settings,/delivery/earnings,/seller/orders/507f1f77bcf86cd799439022',
      process.argv.find(arg=>arg.startsWith('--widths=')) || '--widths=320,390,768,1440', '--label=finance-center'], { cwd: new URL('..', import.meta.url), stdio: 'inherit', windowsHide: true });
    child.on('error', reject); child.on('exit', resolve);
  });
  assert.equal(exit, 0, 'Finance browser regressions failed');
} finally { await rm(generated, { force: true }); }
