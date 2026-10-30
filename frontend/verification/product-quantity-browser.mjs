import assert from 'node:assert/strict';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';

// Reuse the existing production-artifact browser runner and intercepted APIs.
// This adds quantity/layout assertions; no real cart or payment is submitted.
let source = await readFile(new URL('../tests/mobile-layout.test.mjs', import.meta.url), 'utf8');
const marker = "          if (path.includes('variant=')) assert.equal(await evaluate(`document.querySelector('#pd-wholesale-quantity').value`),'3');";
assert.ok(source.includes(marker));
source = source.replace(marker, `
        await evaluate("window.quantityPage=document.querySelector('.product-detail-page');window.quantityInput=document.querySelector('#pd-wholesale-quantity');window.quantityTotal=document.querySelector('.pd-wholesale-total');quantityInput.focus();quantityPage.scrollTop=Math.max(0,quantityInput.offsetTop-100)");
        const start=await evaluate("({origin:performance.timeOrigin,scroll:quantityPage.scrollTop,height:quantityTotal.getBoundingClientRect().height})");
        const quoteCount=()=>productWholesaleReads.filter(url=>new URL(url).pathname.endsWith('/wholesale/quote')).length;
        const previousRequests=quoteCount();
        for(const quantity of [10,15,20,25]) {
          await evaluate("Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(quantityInput,"+quantity+");quantityInput.dispatchEvent(new Event('input',{bubbles:true}))");
          await pause(40);
          const state=await evaluate("({origin:performance.timeOrigin,samePage:quantityPage===document.querySelector('.product-detail-page'),sameInput:quantityInput===document.querySelector('#pd-wholesale-quantity'),sameTotal:quantityTotal===document.querySelector('.pd-wholesale-total'),focused:document.activeElement===quantityInput,scroll:quantityPage.scrollTop,height:quantityTotal.getBoundingClientRect().height,buyDisabled:[...document.querySelectorAll('.pd-sticky-cta button')].find(b=>b.textContent==='ADD WHOLESALE').disabled})");
          assert.equal(state.origin,start.origin,'Quantity edit does not reload the document');
          assert.ok(state.samePage&&state.sameInput&&state.sameTotal&&state.focused,'Page, total and focused quantity input stay mounted');
          assert.ok(Math.abs(state.scroll-start.scroll)<=1,'Quantity edit preserves scroll position');
          assert.ok(Math.abs(state.height-start.height)<=1,'Pending quantity check preserves total height');
          assert.equal(state.buyDisabled,true,'Unverified quantity cannot be purchased');
        }
        assert.equal(quoteCount(),previousRequests,'Rapid edits do not send one quote request per increment');
        await waitFor("document.querySelector('.pd-wholesale-total strong')?.textContent.startsWith('25 units') && ![...document.querySelectorAll('.pd-sticky-cta button')].find(b=>b.textContent==='ADD WHOLESALE').disabled");
        assert.equal(quoteCount(),previousRequests+1,'Only the final quantity is quoted');
        await evaluate("Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(quantityInput,5);quantityInput.dispatchEvent(new Event('input',{bubbles:true}))");
        await waitFor("document.querySelector('.pd-wholesale-total strong')?.textContent.startsWith('5 units') && ![...document.querySelectorAll('.pd-sticky-cta button')].find(b=>b.textContent==='ADD WHOLESALE').disabled");
        rows.push({viewport:width,path,quantityChanges:4,documentPreserved:true,focusPreserved:true,scrollPreserved:true,totalHeightPreserved:true,finalQuantityRequests:1});
        continue;
${marker}`);
// The shared runner predates the current purchase labels and Wholesale header.
source = source.replaceAll('ADD WHOLESALE', 'Add to Wholesale Cart');
source = source.replace("          assert.equal(await evaluate(`!!document.querySelector('.pd-price-row')`),false);", '');
const generated = new URL(`../tests/.product-quantity-${process.pid}.mjs`, import.meta.url);
await writeFile(generated, source);
try {
  const code = await new Promise((resolve, reject) => {
    const process = spawn(globalThis.process.execPath, [generated.pathname.replace(/^\/(\w:)/, '$1'), '--product-wholesale', '--full', '--width=390', '--paths=/grocery--home?product=507f1f77bcf86cd799439015'], { cwd: new URL('..', import.meta.url), windowsHide: true, stdio: 'inherit' });
    process.once('error', reject); process.once('exit', code => resolve(code));
  });
  assert.equal(code, 0, 'Quantity browser regression passes');
} finally {
  await rm(generated, { force: true });
}
