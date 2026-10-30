import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

let vite, page;
before(async () => {
  vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'error' });
  page = await vite.ssrLoadModule('/src/modules/User/pages/ProductDetailPage.jsx');
});
after(async () => vite.close());

test('pack line comes from the selected variant, never a fixed "1 Pack • 250g"', () => {
  assert.equal(page.variantPackLabel({ name: 'Default', unit: 'piece', weight: 250 }), '250 g · per piece');
  assert.equal(page.variantPackLabel({ name: 'Family pack', unit: 'pack', weight: 1500 }), 'Family pack · 1.5 kg · per pack');
  assert.equal(page.variantPackLabel({ name: 'Default', unit: 'litre' }), 'per litre');
  assert.equal(page.variantPackLabel(null), '');
});

test('discount badge is the real saving against MRP, and absent when there is none', () => {
  assert.equal(page.discountPercent(200, 150), 25);
  assert.equal(page.discountPercent(100, 95.5), 5);
  assert.equal(page.discountPercent(100, 100), 0);
  assert.equal(page.discountPercent(undefined, 80), 0);
  assert.equal(page.discountPercent(80, 100), 0);
});
