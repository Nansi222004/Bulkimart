import assert from 'node:assert/strict';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';

// Reuse the production-app browser runner, intercepting every API origin.
// No real financial reads, writes, accounts or providers are used in this test.
const template = new URL('../tests/mobile-layout.test.mjs', import.meta.url);
const generated = new URL(`../tests/.seller-earnings-audit-${process.pid}.mjs`, import.meta.url);
let source = await readFile(template, 'utf8');
source = source.replace("'--headless=new', '--remote-debugging-port=0'", "'--headless=new', '--disable-gpu', '--remote-debugging-port=0'");
const targetMarker = "const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();";
assert.ok(source.includes(targetMarker));
source = source.replace(targetMarker, "const target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t=>t.type==='page');");
const fixtureMarker = '  const path = new URL(raw).pathname;';
assert.ok(source.includes(fixtureMarker));
source = source.replace(fixtureMarker, fixtureMarker + `
  if(path==='/api/sellers/gst-assistance/me')return {success:true,data:null};
  if(path==='/api/sellers/finances/summary') {
    if(layoutScenario==='readerror')return {success:false,message:'Audit finance read failed'};
    if(layoutScenario==='invalidsummary')return {success:true,data:{balances:{}}};
    return {success:true,data:{balances:{earnedEarnings:0,pending:0,held:0,eligible:0,reserved:0,settled:0,quickFreightObligations:0,bulkimartServiceFees:0},payouts:[],payoutActionsEnabled:false,coverage:{historicalOrdersIncluded:false},deliveredSales:{orderCount:2,grossAmount:1150,orders:[{_id:'507f1f77bcf86cd799439022',orderNo:'AUDIT-900',grossAmount:900},{_id:'507f1f77bcf86cd799439023',orderNo:'AUDIT-250',grossAmount:250}]}}};
  }
  if(path==='/api/sellers/finances/ledger')return {success:true,data:[],meta:{total:0,page:1,limit:50}};
`);
const checkMarker = '      if (startupOnly) {';
assert.ok(source.includes(checkMarker));
source = source.replace(checkMarker, `
      if(path.includes('readerror') || path.includes('invalidsummary')) {
        await waitFor(\`document.body.innerText.includes('Audit finance read failed') || document.body.innerText.includes('Seller balances or payout data is incomplete')\`);
        const text=await evaluate('document.body.innerText');
        assert.ok(!text.includes('₹0.00'), 'Failed finance read must not display zero balances');
        assert.ok(!text.includes('No payout requests.') && !text.includes('No payout transaction has been recorded.'), 'Failed read must not display empty history');
        assert.equal(await evaluate(\`!!document.querySelector('input#payout-amount')\`),false);
      } else {
        await waitFor(\`document.body.innerText.includes('No earnings have been posted')\`);
        const text=await evaluate('document.body.innerText');
        assert.ok(text.includes('₹1,150.00') && text.includes('₹0.00'));
        assert.ok(text.includes('Needs reconciliation: no financial snapshot'));
        assert.equal(await evaluate(\`[...document.querySelectorAll('button')].find(b=>b.textContent==='Request payout').disabled\`),true);
      }
      if(width===390) {
        const directory=resolve('../test-artifacts/seller-earnings-audit/browser');await mkdir(directory,{recursive:true});
        await writeFile(join(directory,path.replace(/[^a-zA-Z0-9-]/g,'_')+'.png'),Buffer.from((await command('Page.captureScreenshot',{format:'png'})).data,'base64'));
      }
` + checkMarker);
try {
  await writeFile(generated, source);
  const exit = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [generated.pathname.replace(/^\/(?:([A-Za-z]:))/, '$1'), '--full',
      '--paths=/seller/earnings?layout=postedzero,/seller/earnings?layout=readerror,/seller/earnings?layout=invalidsummary,/seller/moneyrequest?layout=readerror,/seller/moneyrequest?layout=invalidsummary,/seller/paymenthistory?layout=readerror',
      '--widths=320,360,375,390,430,768,1280', '--label=seller-earnings-audit'], { cwd: new URL('..', import.meta.url), stdio: 'inherit', windowsHide: true });
    child.on('error', reject); child.on('exit', resolve);
  });
  assert.equal(exit, 0, 'Seller finance read-state browser checks failed');
} finally { await rm(generated, { force: true }); }
