import assert from 'node:assert/strict';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
const generated = new URL(`../tests/.admin-order-display-${process.pid}.mjs`, import.meta.url);
let source = await readFile(new URL('../tests/mobile-layout.test.mjs', import.meta.url), 'utf8');
function replace(marker, value) { assert.ok(source.includes(marker), 'Browser runner marker changed'); source = source.replace(marker, value); }
replace("'--headless=new', '--remote-debugging-port=0'", "'--headless=new', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=0'");
replace("const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();", "const target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t=>t.type==='page');");
replace('  const path = new URL(raw).pathname;', `  const path = new URL(raw).pathname;
  if(path==='/api/admin/consumers/orders')return {success:true,meta:{page:1,pages:1,total:3},data:[
    {_id:'507f1f77bcf86cd799439081',orderNo:'ORD-FIXTURE-COURIER',type:'ecommerce',status:'delivered',userId:{name:'Fixture Buyer'},items:[{}],pricing:{totalAmount:1250.5},payment:{totalAmount:0},deliveryType:'shiprocket',shiprocket:{courier:'Delhivery',awb:'AWB-FIXTURE-001'}},
    {_id:'507f1f77bcf86cd799439082',orderNo:'ORD-FIXTURE-INTERNAL',type:'ecommerce',status:'delivered',userId:{name:'Fixture Buyer'},items:[{}],pricing:{totalAmount:750},deliveryType:'internal',deliveryPartnerId:{userId:{name:'Fixture Rider'}}},
    {_id:'507f1f77bcf86cd799439083',orderNo:'ORD-FIXTURE-PENDING',type:'ecommerce',status:'confirmed',userId:{name:'Fixture Buyer'},items:[{}],pricing:{totalAmount:100},deliveryType:'shiprocket'}]};
`);
replace('      if (startupOnly) {', `
      await waitFor("document.body.innerText.includes('ORD-FIXTURE-COURIER')");
      const orderText=await evaluate("document.querySelector('tbody').innerText");
      assert.ok(orderText.includes('₹1,250.5') && orderText.includes('Delhivery') && orderText.includes('AWB-FIXTURE-001'));
      assert.ok(orderText.includes('Bulkimart Delivery · Fixture Rider') && orderText.includes('Not applicable'));
      assert.ok(orderText.includes('Shiprocket · courier pending') && orderText.includes('Awaiting tracking number'));
      assert.equal(orderText.includes('507f1f77bcf86cd799439081'),false);
      await evaluate("document.querySelector('tbody button').click()");
      await waitFor("!!document.querySelector('.admin-modal-sheet')");
      const detailText=await evaluate("document.querySelector('.admin-modal-sheet').innerText");
      assert.ok(detailText.includes('Order ORD-FIXTURE-COURIER') && detailText.includes('₹1,250.5') && detailText.includes('Delhivery'));
      assert.ok(!/Delete|Update Status/.test(detailText));
      await evaluate("document.querySelector('.admin-modal-close').click()");
      await waitFor("!document.querySelector('.admin-modal-sheet')");
      if (startupOnly) {`);
source = source.replaceAll('../test-artifacts/mobile-native', '../test-artifacts/admin-order-display/geometry').replaceAll('../test-artifacts/mobile-layout', '../test-artifacts/admin-order-display/layout');
try {
  await writeFile(generated, source);
  const code = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [generated.pathname.replace(/^\/([A-Za-z]:)/, '$1'), '--full', '--paths=/admin/ecom-orders', '--widths=390,1280,1920', '--label=admin-order-display'], { cwd: new URL('..', import.meta.url), stdio: 'inherit', windowsHide: true });
    child.on('error', reject); child.on('exit', resolve);
  });
  assert.equal(code, 0, 'Admin order display browser assertions failed');
} finally { await rm(generated, { force: true }); }
