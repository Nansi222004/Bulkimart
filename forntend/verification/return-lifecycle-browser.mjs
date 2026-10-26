import assert from 'node:assert/strict';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Reuse the network-isolated browser runner against the transparent local build.
const generated = new URL(`../tests/.return-layout-${process.pid}.mjs`, import.meta.url);
let source = await readFile(new URL('../tests/mobile-layout.test.mjs', import.meta.url), 'utf8');
source = source.replaceAll("resolve('dist/index.html')", "resolve('../test-artifacts/return-repair/frontend-dist/index.html')").replaceAll("resolve('dist')", "resolve('../test-artifacts/return-repair/frontend-dist')");
// Windows restricted processes can stall renderer startup with GPU enabled.
source = source.replace("['--headless=new',", "['--headless=new', '--disable-gpu', '--disable-extensions',");
const marker = '  const path = new URL(raw).pathname;';
assert.ok(source.includes(marker));
source = source.replace(marker, marker + `
  const ret={_id:'507f1f77bcf86cd799439088',returnNumber:'RET-BROWSER',productName:'Return fixture',quantity:1,reason:'DAMAGED',status:'APPROVED',requestedAt:'2026-10-20',pickup:{status:'NOT_ASSIGNED'}};
  if(path==='/api/sellers/returns'||path==='/api/admin/returns')return {success:true,data:[ret]};
  if(path==='/api/sellers/returns/'+ret._id+'/pickup'){
    const method=JSON.parse(requestBody).pickupMethod;
    assert.ok(['MANUAL','SHIPROCKET'].includes(method));
    return {success:true,message:method==='SHIPROCKET'?'Courier booking confirmed':'Manual pickup requested',data:{...ret,pickupMethod:method}};
  }
  if(path==='/api/admin/returns/'+ret._id)return {success:true,data:{...ret,status:'RETURN_RECEIVED',refundDestination:'wallet',pickupMethod:'SHIPROCKET',reverseBooking:{state:'booked',trackingState:'DELIVERED'},awbNumber:'PROVIDER401',refundBreakdown:{cashRefund:50}}};
`);
const check = '      if (startupOnly) {';
assert.ok(source.includes(check));
source = source.replace(check, `
      if(path==='/seller/returns'){
        await waitFor(\`!!document.querySelector('select[aria-label="Pickup method"]')\`);
        assert.equal(await evaluate(\`document.querySelector('select[aria-label="Pickup method"]').value\`),'');
        assert.equal(await evaluate(\`[...document.querySelectorAll('button')].find(b=>b.textContent==='Confirm pickup method').disabled\`),true);
        await evaluate(\`const s=document.querySelector('select[aria-label="Pickup method"]');s.value='SHIPROCKET';s.dispatchEvent(new Event('change',{bubbles:true}));\`);
        await evaluate(\`[...document.querySelectorAll('button')].find(b=>b.textContent==='Confirm pickup method').click()\`);
        await waitFor(\`document.body.textContent.includes('Courier booking confirmed')\`);
      }
      if(path==='/admin/returns'){
        await waitFor(\`document.body.textContent.includes('RET-BROWSER')\`);
        assert.equal(await evaluate(\`document.body.textContent.includes('Mark COD Refund Settled Manually')\`),false);
      }
` + check);
try {
  await writeFile(generated, source);
  const code = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fileURLToPath(generated), '--full', '--paths=/seller/returns,/admin/returns', '--widths=390,1440', '--label=return-lifecycle'], { cwd: new URL('..', import.meta.url), stdio: 'inherit', windowsHide: true });
    child.on('error', reject); child.on('exit', resolve);
  });
  assert.equal(code, 0);
} finally { await rm(generated, { force: true }); }
