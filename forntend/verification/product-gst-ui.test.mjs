// Checkout product GST display: it only shows server amounts, and the rows add up to what is charged.
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
let vite, Breakdown, validProductTax, paymentSummary, render;
before(async () => {
  vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' });
  ({ default: Breakdown, validProductTax } = await vite.ssrLoadModule('/src/components/finance/ProductGstBreakdown.jsx'));
  ({ paymentSummary } = await vite.ssrLoadModule('/src/modules/User/utils/paymentSummary.js'));
  const { createElement } = await import('react'), { renderToStaticMarkup } = await import('react-dom/server');
  render = props => renderToStaticMarkup(createElement(Breakdown, props)).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
});
after(async () => vite.close());

// Shapes exactly as the server's summarizeProductGst returns them.
const tax = rates => {
  const rows = rates.map(([gstRate, gstPriceType, taxableValuePaise, gstPaise]) => ({ gstRate, gstPriceType, taxableValuePaise, gstPaise }));
  const sum = key => rows.reduce((n, row) => n + row[key], 0), added = rows.filter(r => r.gstPriceType === 'exclusive').reduce((n, r) => n + r.gstPaise, 0);
  return { version: 'product-gst-v1', taxableValuePaise: sum('taxableValuePaise'), gstPaise: sum('gstPaise'), grossPaise: sum('taxableValuePaise') + sum('gstPaise'),
    sellingPricePaise: sum('taxableValuePaise') + sum('gstPaise') - added, addedGstPaise: added, includedGstPaise: sum('gstPaise') - added, discountPaise: 0, rates: rows };
};

test('inclusive ₹105 at 5%: ₹100 taxable and ₹5 GST already included', () => {
  const text = render({ tax: tax([[5, 'inclusive', 10000, 500]]), subtotalIncludesAddedGst: false });
  assert.match(text, /Taxable product value \(before platform discounts\) ₹100\.00/);
  assert.match(text, /Included GST \(5%\) ₹5\.00/);
  assert.doesNotMatch(text, /GST added/);
});

test('exclusive ₹100 at 5%: GST of ₹5 is added', () => {
  const text = render({ tax: tax([[5, 'exclusive', 10000, 500]]), subtotalIncludesAddedGst: false });
  assert.match(text, /GST added \(5%\) ₹5\.00/);
  assert.doesNotMatch(text, /included in subtotal/);
  assert.match(render({ tax: tax([[5, 'exclusive', 10000, 500]]) }), /GST added \(5%\) · included in subtotal ₹5\.00/);
});

test('mixed rates show one row per rate and treatment', () => {
  const text = render({ tax: tax([[0, 'inclusive', 5000, 0], [5, 'inclusive', 20000, 1000], [18, 'exclusive', 10000, 1800]]), subtotalIncludesAddedGst: false });
  assert.match(text, /Included GST \(0%\) ₹0\.00 Included GST \(5%\) ₹10\.00 GST added \(18%\) ₹18\.00/);
});

test('missing or inconsistent server data is never shown as zero GST', () => {
  assert.equal(render({ tax: undefined }), 'Product GST breakdown unavailable.');
  assert.equal(render({ tax: undefined, pending: true }), 'Loading product GST breakdown…');
  const broken = tax([[5, 'inclusive', 10000, 500]]); broken.gstPaise = 400;
  assert.equal(validProductTax(broken), false); assert.equal(render({ tax: broken }), 'Product GST breakdown unavailable.');
  assert.equal(validProductTax({ ...tax([[5, 'inclusive', 10000, 500]]), version: 'other' }), false);
});

test('checkout rows add up to the amount charged: items before added GST + added GST + delivery − discounts', () => {
  const productTax = tax([[5, 'inclusive', 20000, 1000], [18, 'exclusive', 10000, 1800]]); // items ₹310 shown, ₹328 charged for goods
  const server = { subtotal: productTax.grossPaise / 100, deliveryCharge: 40, couponDiscount: 10, totalAmount: (productTax.grossPaise + 4000 - 1000) / 100, productTax };
  const summary = paymentSummary(server, { coinDiscount: 5, tipAmount: 20 });
  assert.equal(summary.subtotal, 310);
  assert.equal(summary.totalAmount, 328 + 40 - 10 - 5 + 20);
  assert.equal(Math.round((summary.subtotal + productTax.addedGstPaise / 100 + summary.deliveryCharge - summary.couponDiscount - summary.coinDiscount + summary.tipAmount) * 100), Math.round(summary.totalAmount * 100));
  // Older responses without product GST keep showing their own subtotal.
  assert.equal(paymentSummary({ subtotal: 99.5, totalAmount: 99.5 }).subtotal, 99.5);
});

test('order pages say plainly when an older order has no GST record, but never hide inconsistent data', () => {
  assert.equal(render({ tax: undefined, whenMissing: 'GST details were not recorded for this older order.' }), 'GST details were not recorded for this older order.');
  const broken = tax([[5, 'inclusive', 10000, 500]]); broken.taxableValuePaise = 1;
  assert.equal(render({ tax: broken, whenMissing: 'GST details were not recorded for this older order.' }), 'Product GST breakdown unavailable.');
});
