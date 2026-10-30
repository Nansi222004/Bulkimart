import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { hookHarness } from '../tests/service-hookHarness.mjs';

let vite, Products;
before(async () => {
  vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' });
  Products = (await vite.ssrLoadModule('/src/modules/Seller/components/ProductsTab.jsx')).default;
});
after(async () => { await vite?.close(); });
const text = node => node == null ? '' : typeof node !== 'object' ? String(node) : [node.props?.children].flat(Infinity).map(text).join(' ');
const storage = () => { const values = new Map([['sellerToken', 'seller-fixture']]); return { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, String(v)), removeItem: k => values.delete(k) }; };
const product = (id, name, category) => ({ id, name, category, status: 'Active', stock: 5, price: 100, mrp: 120, image: '', raw: { _id: id, variants: [] } });
const products = [product('1', 'Basmati Rice', 'Rice & Grains'), product('2', 'Toor Dal', 'Pulses'), product('3', 'Brown Rice', 'Rice & Grains')];
const render = () => hookHarness(Products, {}, '/seller/products', { products, productListingMode: 'retail', activeMode: 'quick', activeChannel: 'grocery' }, { localStorage: storage() });
const search = h => h.find(n => n.type === 'input' && n.props.placeholder === 'Search by product name...');
const categorySelect = h => h.find(n => n.type === 'select' && [n.props.children].flat(Infinity).some(o => o?.props?.value === 'All'));

test('the category filter lists the real categories of the seller\'s products, each once', () => {
  const h = render();
  try {
    const options = [categorySelect(h).props.children].flat(Infinity).filter(Boolean).map(o => o.props.value);
    assert.deepEqual(options, ['All', 'Pulses', 'Rice & Grains']);
    categorySelect(h).props.onChange({ target: { value: 'Pulses' } }); h.flush();
    assert.match(text(h.tree), /Toor Dal/); assert.doesNotMatch(text(h.tree), /Basmati Rice/);
  } finally { h.close(); }
});

test('search is by product name, and spaces alone are not a search', () => {
  const h = render();
  try {
    assert.equal(search(h).props.placeholder, 'Search by product name...');
    search(h).props.onChange({ target: { value: '   ' } }); h.flush();
    assert.equal(search(h).props.value, '', 'Leading spaces are not typed');
    assert.match(text(h.tree), /Basmati Rice/); assert.match(text(h.tree), /Toor Dal/);
    search(h).props.onChange({ target: { value: 'brown   rice ' } }); h.flush();
    assert.equal(search(h).props.value, 'brown rice ');
    assert.match(text(h.tree), /Brown Rice/); assert.doesNotMatch(text(h.tree), /Basmati Rice|Toor Dal/);
  } finally { h.close(); }
});
