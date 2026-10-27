import assert from 'node:assert/strict';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';

// Reuse the isolated production-browser runner and its authenticated fixtures.
let source = await readFile(new URL('../tests/mobile-layout.test.mjs', import.meta.url), 'utf8');
source = source.replace('let layoutScenario =', 'let savedEbook = false;\nlet layoutScenario =');
source = source.replace('      layoutScenario = new URL(path,origin)', "      if (path === '/ecommerce--smart-buy') savedEbook = false;\n      layoutScenario = new URL(path,origin)");
source = source.replace("name: 'Mobile layout fixture product',", "name: 'Mobile layout fixture product', fulfillmentType: 'digital', digital: {stockTracked:false},");
const responseMarker = 'let body = fixture(request.url, request.postData), status = body.success === false ? 503 : 200;';
assert.ok(source.includes(responseMarker));
source = source.replace(responseMarker, responseMarker + `
          if (new URL(request.url).pathname === '/api/wishlist/'+product._id) { savedEbook = request.method === 'POST'; body = {success:true}; }
          if (new URL(request.url).pathname === '/api/wishlist') body = {success:true,data:{items:savedEbook?[product]:[],productIds:savedEbook?[product._id]:[]}};
`);
const marker = '      if(feedbackOnly) {';
assert.ok(source.includes(marker));
source = source.replace(marker, `
      if (path === '/account') {
        for (const height of [956,420]) {
          await command('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:true});
          await evaluate("document.querySelector('.user-main-content').scrollTop=10000"); await pause(100);
          const bounds = await evaluate("(() => {const m=document.querySelector('.user-main-content'),b=document.querySelector('.logout-row').getBoundingClientRect(),n=document.querySelector('.bottom-nav-bar').getBoundingClientRect();return {scroll:m.scrollHeight,client:m.clientHeight,top:m.scrollTop,logoutTop:b.top,logoutBottom:b.bottom,navTop:n.top};})()");
          assert.ok(bounds.scroll>bounds.client && bounds.top>0,JSON.stringify(bounds));
          assert.ok(bounds.logoutTop>=0 && bounds.logoutBottom<=bounds.navTop,JSON.stringify(bounds));
        }
        await evaluate("[...document.querySelectorAll('.menu-link-row')].find(e=>e.textContent.includes('Bulkimart Wallet')).click()");
        await waitFor("!![...document.querySelectorAll('button')].find(e=>e.textContent.includes('+ Add Money'))");
        await evaluate("document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).forEach(a=>{try{a.finish()}catch{}})");
        const tap=await evaluate("(()=>{const b=[...document.querySelectorAll('button')].find(e=>e.textContent.includes('+ Add Money'));b.scrollIntoView({block:'center'});const r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()");
        await command('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...tap});
        await command('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...tap});
        await waitFor("!!document.querySelector('#wallet-topup-amount')");
        assert.equal(await evaluate("!![...document.querySelectorAll('button')].find(b=>b.textContent.includes('Dev Test Mode'))"),false);
        rows.push({path,viewport:width,profileScroll:true,walletButtonClickable:true}); continue;
      }
      if (path === '/orders') {
        for (const height of [956,420,320,956]) {
          await command('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:true});
          await evaluate("(()=>{const input=document.querySelector('.orders-search-input');input.focus();Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'no-matching-order');input.dispatchEvent(new Event('input',{bubbles:true}));})()");
          await waitFor("document.querySelector('.empty-filter-view')?.textContent.includes('No orders match')");
          const bounds=await evaluate("(()=>{const list=document.querySelector('.orders-scroll-content').getBoundingClientRect(),nav=document.querySelector('.bottom-nav-bar').getBoundingClientRect();return {listBottom:list.bottom,navTop:nav.top,navBottom:nav.bottom,height:innerHeight};})()");
          assert.ok(Math.abs(bounds.listBottom-bounds.navTop)<=1,JSON.stringify(bounds));
          assert.ok(Math.abs(bounds.navBottom-bounds.height)<=1,JSON.stringify(bounds));
        }
        rows.push({path,viewport:width,orderSearch:true,noFooterGap:true}); continue;
      }
      if (path === '/ecommerce--smart-buy') {
        await waitFor("!!document.querySelector('.grid-product-card button[aria-label=\\\"Add to Wishlist\\\"]')");
        await evaluate("document.querySelector('.grid-product-card button[aria-label=\\\"Add to Wishlist\\\"]').click()");
        await waitFor("!!document.querySelector('.grid-product-card button[aria-label=\\\"Remove from Wishlist\\\"]')");
        await evaluate("document.querySelector('.header-action-btn[aria-label*=Wishlist]')?.click()");
        await command('Page.navigate',{url:origin+'/wishlist'});
        await waitFor("document.querySelector('.wishlist-card-name')?.textContent==='Mobile layout fixture product'");
        rows.push({path,viewport:width,ebookSaved:true,persistsInWishlist:true}); continue;
      }
` + marker);
const generated = new URL(`../tests/.customer-account-${process.pid}.mjs`, import.meta.url);
await writeFile(generated, source);
try {
  const code = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [generated.pathname.replace(/^\/(\w:)/, '$1'), '--full', '--widths=360,390', '--paths=/account,/orders,/ecommerce--smart-buy'], { cwd: new URL('..', import.meta.url), windowsHide: true, stdio: 'inherit' });
    child.once('error', reject); child.once('exit', resolve);
  });
  assert.equal(code, 0, 'Customer account browser regressions pass');
} finally { await rm(generated, { force: true }); }
