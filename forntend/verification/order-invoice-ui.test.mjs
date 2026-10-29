// Order invoices: the sheet shows only the server's stored amounts, with the right GST columns per seller.
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
let vite, render;
before(async () => {
  vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' });
  const { InvoiceSheet } = await vite.ssrLoadModule('/src/components/finance/OrderInvoices.jsx');
  const { createElement } = await import('react'), { renderToStaticMarkup } = await import('react-dom/server');
  render = invoice => renderToStaticMarkup(createElement(InvoiceSheet, { invoice })).replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
});
after(async () => vite.close());

// Shaped exactly as the server's buildInvoiceDocument returns it.
const invoice = (overrides = {}) => ({ _id: 'i1', invoiceNumber: 'INV2627-000001', issuedAt: '2026-10-29T10:00:00Z', document: {
  title: 'Tax Invoice', orderId: 'o1', orderNo: 'BM1001', deliveredAt: '2026-10-28T10:00:00Z', gstSplit: 'cgst_sgst',
  seller: { name: 'GST Store', storeName: 'GST Store', gstin: '27ABCDE1234F1Z5', address: 'Mumbai, Maharashtra', stateCode: '27' },
  customer: { name: 'Asha', address: 'Line 1, Mumbai, Maharashtra' }, placeOfSupply: 'Maharashtra (27)',
  lines: [{ description: 'Soap — One', qty: 2, unitPricePaise: 11800, grossPaise: 23600, discountPaise: 0, customerPaidPaise: 23600, gstRate: 18, taxableValuePaise: 20000, gstPaise: 3600, cgstPaise: 1800, sgstPaise: 1800, igstPaise: 0 }],
  totals: { grossPaise: 23600, discountPaise: 0, customerPaidPaise: 23600, taxableValuePaise: 20000, gstPaise: 3600, cgstPaise: 1800, sgstPaise: 1800, igstPaise: 0 },
  notes: ['All prices include GST.', 'Delivery fees are charged by Bulkimart, carry no GST, and are not part of this invoice.'], ...overrides } });

test('same-state Tax Invoice shows taxable value with CGST and SGST halves', () => {
  const text = render(invoice());
  assert.match(text, /^Tax Invoice No\. INV2627-000001/);
  assert.match(text, /GSTIN 27ABCDE1234F1Z5/);
  assert.match(text, /Place of supply: Maharashtra \(27\)/);
  assert.match(text, /CGST SGST Amount/);
  assert.match(text, /Soap — One 2 ₹118\.00 ₹200\.00 18% ₹18\.00 ₹18\.00 ₹236\.00/);
  assert.doesNotMatch(text, /IGST/);
  assert.match(text, /carry no GST/);
});

test('inter-state invoice shows a single IGST column', () => {
  const doc = invoice().document;
  const text = render(invoice({ gstSplit: 'igst', lines: [{ ...doc.lines[0], cgstPaise: 0, sgstPaise: 0, igstPaise: 3600 }], totals: { ...doc.totals, cgstPaise: 0, sgstPaise: 0, igstPaise: 3600 } }));
  assert.match(text, /IGST Amount/);
  assert.match(text, /18% ₹36\.00 ₹236\.00/);
  assert.doesNotMatch(text, /CGST/);
});

test('an unregistered seller\'s plain invoice has no GST columns or GSTIN', () => {
  const text = render(invoice({ title: 'Invoice', gstSplit: 'none', seller: { name: 'Small Shop', gstin: null, address: 'Indore' },
    lines: [{ description: 'Rice', qty: 1, unitPricePaise: 10500, grossPaise: 10500, discountPaise: 500, customerPaidPaise: 10000 }],
    totals: { grossPaise: 10500, discountPaise: 500, customerPaidPaise: 10000 }, notes: ['The seller is not registered for GST, so no GST is charged on this invoice.'] }));
  assert.match(text, /^Invoice No\./);
  assert.doesNotMatch(text, /GSTIN|CGST|IGST|Taxable/);
  assert.match(text, /Rice 1 ₹105\.00 ₹105\.00/);
  assert.match(text, /Bulkimart discount: −₹5\.00 · You paid ₹100\.00/);
});
