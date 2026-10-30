import assert from 'node:assert/strict';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
let source = await readFile(new URL('../tests/mobile-layout.test.mjs', import.meta.url), 'utf8');
source = source.replace("const path = new URL(raw).pathname;", `const path = new URL(raw).pathname;
  if (path === '/api/notifications/unread-count') return {success:true,data:{count:1}};
  if (path === '/api/notifications') return {success:true,data:[{_id:'cash-settled-fixture',event:'COD_CASH_SETTLED',title:'COD cash settled',message:'Bulkimart confirmed your cash handover.',route:'/delivery/earnings',isRead:false,createdAt:'2026-10-27T08:00:00Z'}]};
  if (path === '/api/notifications/cash-settled-fixture/read') return {success:true};
  if (path === '/api/delivery/finances/ledger') return {success:true,data:{rows:[],balances:[],total:0,limit:50,flags:{operations:false,policyApproved:false,testsApproved:false}}};
  if (path === '/api/delivery/finances/cod' || path === '/api/delivery/finances/deliveries') return {success:true,data:[],meta:{pages:1}};
`);
source = source.replace("status:'approved',onboardingStep:4,isAvailable:false", "status:'approved',onboardingStep:4,isAvailable:false,rating:4,ratingCount:1");
const marker = '      if(feedbackOnly) {';
assert.ok(source.includes(marker));
source = source.replace(marker, `
      if (path.startsWith('/delivery/')) {
        if (path === '/delivery/dashboard') {
          await waitFor("document.querySelector('.delivery-rating-card')?.textContent.includes('4.0 / 5')");
          const logo=await evaluate("(()=>{const box=document.querySelector('.delivery-dashboard-header .brand-logo'),label=box.querySelector('.brand-logo__portal'),a=box.getBoundingClientRect(),b=label.getBoundingClientRect();return {label:label.textContent,left:b.left,right:b.right,top:b.top,bottom:b.bottom,box:{left:a.left,right:a.right,top:a.top,bottom:a.bottom},overflow:document.documentElement.scrollWidth>innerWidth};})()");
          assert.equal(logo.label,'Delivery'); assert.equal(logo.overflow,false);
          assert.ok(logo.left>=logo.box.left && logo.right<=logo.box.right && logo.top>=logo.box.top && logo.bottom<=logo.box.bottom,JSON.stringify(logo));
        } else {
          await waitFor("document.querySelector('.profile-stats-row')?.textContent.includes('4.0 / 5')");
          assert.ok(await evaluate("document.querySelector('.profile-stats-row').textContent.includes('1 customer rating')"));
        }
        await evaluate("document.querySelector('[aria-label=\\\"Delivery notifications\\\"]').click()");
        await waitFor("document.querySelector('.delivery-notifications-sheet')?.textContent.includes('Bulkimart confirmed your cash handover.')");
        const sheet=await evaluate("(()=>{const e=document.querySelector('.delivery-notifications-sheet'),r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:innerWidth,height:innerHeight};})()");
        assert.ok(sheet.left>=0 && sheet.right<=sheet.width && sheet.top>=0 && sheet.bottom<=sheet.height,JSON.stringify(sheet));
        await evaluate("document.querySelector('.delivery-notification-item').click()");
        await waitFor("location.pathname==='/delivery/earnings' && !document.querySelector('.delivery-notifications-sheet')");
        rows.push({viewport:width,path,realCustomerRating:true,fullDeliveryLabel:path.endsWith('dashboard'),settlementInbox:true,opensEarnings:true});continue;
      }
` + marker);
const generated = new URL(`../tests/.rider-feedback-${process.pid}.mjs`, import.meta.url);
await writeFile(generated, source);
try {
  const code = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [generated.pathname.replace(/^\/(\w:)/, '$1'), '--full', '--widths=320,412,1280', '--paths=/delivery/dashboard,/delivery/profile'], { cwd: new URL('..', import.meta.url), windowsHide: true, stdio: 'inherit' });
    child.once('error', reject); child.once('exit', resolve);
  });
  assert.equal(code, 0, 'Rider rating, settlement notification and logo browser checks pass');
} finally { await rm(generated, { force: true }); }
