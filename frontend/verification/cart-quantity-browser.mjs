import assert from 'node:assert/strict';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Exercise the built app with the existing isolated browser runner. All API
// requests are intercepted; quantity writes never reach a real customer cart.
let source = await readFile(new URL('../tests/mobile-layout.test.mjs', import.meta.url), 'utf8');
const replace = (marker, value) => { assert.ok(source.includes(marker), marker); source = source.replace(marker, value); };
replace("let layoutScenario = '';", "let layoutScenario = ''; let cartQuantity=1, cartReads=0; const cartWrites=[];");
replace("  const path = new URL(raw).pathname;", `  const path = new URL(raw).pathname;
  if(['grocery','ecommerce','wholesale'].includes(layoutScenario)) {
    const wholesale=layoutScenario==='wholesale', channel=layoutScenario==='grocery'?'grocery':'ecommerce';
    const item={...line,itemId:line._id,qty:cartQuantity,price:500,lineTotal:500*cartQuantity,stock:25,available:true,variantId:'507f1f77bcf86cd799439033',...(wholesale?{wholesaleSnapshot:{minimumQuantity:5,quantityIncrement:5,tierMinimumQuantity:5}}:{})};
    const totals={subtotal:500*cartQuantity,deliveryCharge:40,totalAmount:500*cartQuantity+40};
    if(path==='/api/cart/unified'){cartReads++;return {success:true,data:{valid:true,purchaseMode:'basket',quoteHash:'fixture-quote-'+cartQuantity,basketHash:'fixture-basket-'+cartQuantity,groups:[{key:'quantity-group',channel,salesChannel:wholesale?'wholesale':'retail',seller,items:[item],deliveryMode:'scheduled',subtotal:totals.subtotal,deliveryCharge:40,total:totals.totalAmount}],totals}};}
    if(path==='/api/cart/'+line._id||path==='/api/cart/wholesale/'+line._id){const body=JSON.parse(requestBody);cartQuantity=body.qty;cartWrites.push(body);return {success:true};}
    if(path==='/api/cart')return {success:true,data:{channel,items:[item],pricing:totals,warnings:[]}};
    if(path==='/api/cart/summary')return {success:true,data:{[wholesale?'wholesale':channel]:{lines:1,count:cartQuantity,subtotal:totals.subtotal}}};
    if(path==='/api/coupons/available')return {success:true,data:[],meta:{cartSubtotal:totals.subtotal}};
  }`);
replace("          let body = fixture(request.url, request.postData), status = body.success === false ? 503 : 200;", `          if(['grocery','ecommerce','wholesale'].includes(layoutScenario)) {
            if(request.method==='PUT')await pause(150);
            if(new URL(request.url).pathname==='/api/cart/unified'&&cartWrites.length)await pause(180);
          }
          let body = fixture(request.url, request.postData), status = body.success === false ? 503 : 200;`);
replace("productScenario = new URL(path,origin).searchParams.get('scenario') || '';", "productScenario = new URL(path,origin).searchParams.get('scenario') || ''; cartQuantity=layoutScenario==='wholesale'?5:1;cartReads=0;cartWrites.length=0;");
const marker = '      if (productWholesaleOnly) {';
replace(marker, `      if(['grocery','ecommerce','wholesale'].includes(layoutScenario)) {
        await waitFor("!!document.querySelector('.basket-quantity input') && !document.querySelector('.customer-basket[aria-busy=true]')");
        await evaluate("window.quantityCart=document.querySelector('.customer-basket');window.quantityRow=document.querySelector('.basket-item');window.quantitySummary=document.querySelector('.basket-summary-column');window.quantityScroll=document.querySelector('.user-main-content');document.querySelector('.basket-quantity').scrollIntoView({block:'center'});window.removedCartParts=0;window.cartObserver=new MutationObserver(records=>{for(const record of records)for(const node of record.removedNodes){if(node===quantityRow||node===quantitySummary||node.contains?.(quantityRow)||node.contains?.(quantitySummary))removedCartParts++;}});cartObserver.observe(quantityCart,{childList:true,subtree:true})");
        const before=await evaluate("({origin:performance.timeOrigin,scroll:quantityScroll.scrollTop,top:quantityRow.getBoundingClientRect().top})");
        let previous=cartQuantity;const initialReads=cartReads;
        for(const quantity of layoutScenario==='wholesale'?[10,15,10,5]:[2,3,2,1]) {
          const direction=quantity>previous?'Increase':'Decrease';
          await evaluate("[...document.querySelectorAll('.basket-quantity button')].find(button=>button.getAttribute('aria-label').startsWith('"+direction+"')).click()");
          await pause(230);
          const during=await evaluate("({sameCart:quantityCart===document.querySelector('.customer-basket'),rowConnected:quantityRow.isConnected,summaryConnected:quantitySummary.isConnected,origin:performance.timeOrigin,scroll:quantityScroll.scrollTop,top:quantityRow.getBoundingClientRect().top,spinner:!!document.querySelector('.basket-loading'),checkoutDisabled:document.querySelector('.basket-summary-column .pd-add-to-cart-btn').disabled})");
          assert.ok(during.sameCart&&during.rowConnected&&during.summaryConnected,'Cart cards and summary stay mounted while quantity/totals reload');
          assert.equal(during.spinner,false,'Quantity changes do not show the initial page loader');assert.equal(during.checkoutDisabled,true);
          assert.equal(during.origin,before.origin,'Quantity change does not reload the document');
          assert.ok(Math.abs(during.scroll-before.scroll)<=1,'Scroll position stays unchanged');assert.ok(Math.abs(during.top-before.top)<=1,'Cart row stays in place');
          await waitFor("document.querySelector('.basket-quantity input').value==='"+quantity+"' && !document.querySelector('.customer-basket[aria-busy=true]')");
          assert.equal(cartWrites.at(-1).qty,quantity);
          assert.equal(await evaluate('window.removedCartParts'),0,'No intermediate refresh removes the item or summary');
          assert.ok(await evaluate("document.querySelector('.basket-summary-column').textContent.replaceAll(',','').includes('"+(quantity*500)+"')"),'Authoritative totals update');
          previous=quantity;
        }
        assert.equal(cartReads-initialReads,4,'Each quantity change reads the updated basket once');
        await evaluate('cartObserver.disconnect()');
        rows.push({viewport:width,path,quantityChanges:4,cartPreserved:true,summaryPreserved:true,scrollPreserved:true,documentPreserved:true});continue;
      }
${marker}`);
const generated = new URL(`../tests/.cart-quantity-${process.pid}.mjs`, import.meta.url);
await writeFile(generated, source);
try {
  const code = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fileURLToPath(generated), '--full', '--width=390', '--paths=/cart?layout=grocery,/cart?layout=ecommerce,/cart?layout=wholesale'], { cwd: new URL('..', import.meta.url), windowsHide: true, stdio: 'inherit' });
    child.once('error', reject); child.once('exit', resolve);
  });
  assert.equal(code, 0, 'Cart quantity browser checks pass');
} finally { await rm(generated, { force: true }); }
