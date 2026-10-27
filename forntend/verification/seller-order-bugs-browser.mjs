import assert from 'node:assert/strict';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
let source = await readFile(new URL('../tests/mobile-layout.test.mjs', import.meta.url), 'utf8');
source = source.replace('let layoutScenario =', 'const sellerBugRequests = [];\nlet layoutScenario =');
source = source.replace("{name:'Active fixture rider',", "{id:'507f1f77bcf86cd799439027',name:'Active fixture rider',");
source = source.replace("status:sellerOrderRedesign?'preparing':'placed'", "status:layoutScenario==='reassign'?'dispatched':sellerOrderRedesign?'preparing':'placed'");
source = source.replace("[{setup:true,label:'Choose delivery method'}]", "[{setup:true,label:layoutScenario==='reassign'?'Reassign delivery partner':'Choose delivery method'}]");
source = source.replace("note:'Order placed'},{status:'preparing'", "note:'Order placed'},{status:'placed',note:'Online payment verified'},{status:'preparing'");
const responseMarker = 'let body = fixture(request.url, request.postData), status = body.success === false ? 503 : 200;';
assert.ok(source.includes(responseMarker));
source = source.replace(responseMarker, responseMarker + `
          if (request.method === 'POST' && new URL(request.url).pathname.endsWith('/fulfillment/manual')) sellerBugRequests.push(JSON.parse(request.postData));
`);
const marker = '      if (sellerOrderRedesign) {';
assert.ok(source.includes(marker));
source = source.replace(marker, `
      if (sellerOrderRedesign) {
        await waitFor("!!document.querySelector('.seller-order-page .seller-delivery-choices')");
        assert.equal(await evaluate("!!document.querySelector('.seller-push-control')"),false);
        assert.equal(await evaluate("document.querySelectorAll('.seller-detail-timeline li').length"),2);
        assert.equal(await evaluate("document.querySelector('.seller-detail-timeline').textContent.includes('Online payment verified')"),false);
        if (layoutScenario === 'reassign') {
          assert.equal(await evaluate("!![...document.querySelectorAll('.seller-order-primary-actions button')].find(b=>b.textContent==='Reassign delivery partner')"),true);
        }
        await evaluate("document.querySelector('[aria-controls=seller-manual-delivery]').click()");
        await waitFor("!!document.querySelector('.seller-rider-card')");
        await evaluate("document.querySelector('.seller-rider-card').click()");
        await waitFor("document.querySelector('.seller-rider-card').getAttribute('aria-pressed')==='true'");
        const card=await evaluate("(()=>{const b=document.querySelector('.seller-rider-card'),s=getComputedStyle(b);return {border:s.borderTopWidth,color:s.borderTopColor,background:s.backgroundColor,label:b.textContent,overflow:document.documentElement.scrollWidth>innerWidth};})()");
        assert.equal(card.border,'2px');assert.match(card.label,/Selected/);assert.equal(card.overflow,false);
        const before=sellerBugRequests.length;
        await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent==='Confirm manual delivery').click()");
        await waitFor("!!document.querySelector('.seller-order-hero')"); await pause(200);
        assert.equal(sellerBugRequests.length,before+1);
        assert.deepEqual(sellerBugRequests.at(-1),{riderId:'507f1f77bcf86cd799439027'});
        rows.push({viewport:width,path,selectedRiderHighlighted:true,riderRequestSent:true,singlePlacement:true,noPushWarning:true}); continue;
      }
` + marker);
const generated = new URL(`../tests/.seller-order-bugs-${process.pid}.mjs`, import.meta.url);
await writeFile(generated, source);
try {
  const code = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [generated.pathname.replace(/^\/(\w:)/, '$1'), '--full', '--seller-order-redesign', '--widths=360,390,1280', '--paths=/seller/orders/507f1f77bcf86cd799439022?layout=manual,/seller/orders/507f1f77bcf86cd799439022?layout=reassign'], { cwd: new URL('..', import.meta.url), windowsHide: true, stdio: 'inherit' });
    child.once('error', reject); child.once('exit', resolve);
  });
  assert.equal(code, 0, 'Seller order browser regressions pass');
} finally { await rm(generated, { force: true }); }
