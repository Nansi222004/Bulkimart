import assert from 'node:assert/strict';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Run the production build in the existing isolated Chromium fixture harness.
const generated = new URL(`../tests/.seller-returns-${process.pid}.mjs`, import.meta.url);
let source = await readFile(new URL('../tests/mobile-layout.test.mjs', import.meta.url), 'utf8');
source = source.replace("['--headless=new',", "['--headless=new', '--disable-gpu', '--disable-extensions',");
const marker = '  const path = new URL(raw).pathname;';
assert.ok(source.includes(marker));
source = source.replace('function fixture(raw, requestBody) {', `let returnPickup = {status:'NOT_ASSIGNED'}, returnStatus = 'APPROVED';
const returnWrites = [];
function fixture(raw, requestBody) {`);
source = source.replace(marker, marker + `
  const returnId = '507f1f77bcf86cd799439088', riderId = '507f1f77bcf86cd799439089';
  const ret = {_id:returnId,returnNumber:'RET-BROWSER',productName:'Organic Amla',quantity:1,reason:'DAMAGED',customerDescription:'The package arrived damaged.',status:returnStatus,requestedAt:'2026-10-28T12:00:00Z',pickup:returnPickup,
    ...(returnPickup.requestedRiderId?{pickupMethod:'MANUAL'}:{}),customerName:'Fixture Customer',order:{orderNo:'ORD-RETURN',pickupAddress:address},history:[]};
  if(path==='/api/notifications')return {success:true,data:[]};
  if(path==='/api/notifications/unread-count')return {success:true,data:{count:0}};
  if(path==='/api/sellers/orders')return {success:true,data:[]};
  if(path==='/api/sellers/returns'){
    const pending=new URL(raw).searchParams.get('status')?.includes('RETURN_REQUESTED');
    return {success:true,data:pending&&returnStatus!=='RETURN_REQUESTED'?[]:[ret],meta:{pages:1,statusCounts:{[returnStatus]:1}}};
  }
  if(path==='/api/sellers/returns/'+returnId)return {success:true,data:ret};
  if(path==='/api/sellers/returns/'+returnId+'/pickup-options')return {success:true,data:{stateReady:!returnPickup.requestedRiderId,manual:{available:true,eligibleRiderCount:1,riders:[{id:riderId,name:'Active Fixture Rider',contact:'••••••1234',availability:'On duty, capacity available',distanceKm:1.2}]},shiprocket:{available:true},pickup:address,drop:{name:'Fixture Store',address:'Market Road',city:'Indore'}}};
  if(path==='/api/sellers/returns/'+returnId+'/pickup'){
    const payload=JSON.parse(requestBody);returnWrites.push(payload);
    assert.equal(payload.pickupMethod,'MANUAL');assert.equal(payload.riderId,riderId);
    returnPickup={status:'NOT_ASSIGNED',requestedRiderId:riderId};
    return {success:true,data:{...ret,pickup:returnPickup,pickupMethod:'MANUAL'},message:'Pickup requested; awaiting delivery partner acceptance'};
  }
  if(path==='/api/sellers/returns/'+returnId+'/decision'){
    returnStatus=JSON.parse(requestBody).decision;
    return {success:true,data:{returnId,status:returnStatus},message:'Return approved — choose a pickup method'};
  }
`);
const navigation = "      layoutScenario = new URL(path,origin).searchParams.get('layout') || '';";
assert.ok(source.includes(navigation));
source = source.replace(navigation, navigation + `
      returnPickup={status:'NOT_ASSIGNED'};returnStatus=path.includes('return-alert')?'RETURN_REQUESTED':'APPROVED';returnWrites.length=0;
      await evaluate("try{for(const key of Object.keys(sessionStorage))if(key.startsWith('bulkimart:seller-return-alerts:'))sessionStorage.removeItem(key)}catch{}");
`);
const check = '      if (startupOnly) {';
assert.ok(source.includes(check));
source = source.replace(check, `
      if(path.startsWith('/seller/')){
        if(path.includes('return-alert')){
          await waitFor(\`!!document.querySelector('[aria-label="New return request"]')\`);
          await evaluate(\`[...document.querySelectorAll('button')].find(b=>b.textContent==='View return').click()\`);
          await waitFor(\`!!document.querySelector('.seller-return-page') && document.body.textContent.includes('Approve return')\`);
          await evaluate(\`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Approve return').click()\`);
        }else if(!path.includes('?return=')){
          await waitFor(\`!!document.querySelector('.return-row-card')\`);
          assert.equal(await evaluate(\`!!document.querySelector('.seller-return-pickup')\`),false);
          await evaluate(\`document.querySelector('.return-row-card').click()\`);
        }
        await waitFor(\`!!document.querySelector('.seller-delivery-choices button')\`);
        assert.equal(returnWrites.length,0);
        await evaluate(\`document.querySelector('.seller-delivery-choices button').click()\`);
        await waitFor(\`!!document.querySelector('.seller-rider-card')\`);
        assert.equal(await evaluate(\`[...document.querySelectorAll('button')].find(b=>b.textContent==='Request selected delivery partner').disabled\`),true);
        await evaluate(\`document.querySelector('.seller-rider-card').click()\`);
        await waitFor(\`[...document.querySelectorAll('button')].some(b=>b.textContent==='Request selected delivery partner'&&!b.disabled)\`);
        assert.equal(returnWrites.length,0);
        await evaluate(\`document.querySelector('.seller-rider-list').scrollIntoView({block:'center'})\`);
        // Capture the rider-selection UI at every requested viewport.
        const shot=await command('Page.captureScreenshot',{format:'png'});
        const shotDir=resolve('../test-artifacts/seller-returns');await mkdir(shotDir,{recursive:true});
        await writeFile(join(shotDir,'selection-'+width+'-'+(path.includes('return-alert')?'alert':'list')+'.png'),Buffer.from(shot.data,'base64'));
        await evaluate(\`[...document.querySelectorAll('button')].find(b=>b.textContent==='Request selected delivery partner').click()\`);
        await waitFor(\`document.body.textContent.includes('Cancel rider request')\`);
        assert.equal(returnWrites.length,1);
        assert.equal(await evaluate(\`!!document.querySelector('.seller-return-page') && !document.querySelector('.return-row-card')\`),true);
      }
` + check);
try {
  await writeFile(generated, source);
  const code = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fileURLToPath(generated), '--full', '--sticky-headers', '--paths=/seller/item-returns,/seller/dashboard?layout=return-alert', '--widths=390,1440', '--label=seller-returns'], { cwd: new URL('..', import.meta.url), stdio: 'inherit', windowsHide: true });
    child.on('error', reject); child.on('exit', resolve);
  });
  assert.equal(code, 0, 'Seller returns browser checks failed');
} finally { await rm(generated, { force: true }); }
