import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { hookHarness } from './componentHarness.mjs';

let vite, useWholesale, Offer;
before(async () => {
  vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' });
  useWholesale = (await vite.ssrLoadModule('/src/modules/User/hooks/useProductWholesale.js')).useProductWholesale;
  Offer = (await vite.ssrLoadModule('/src/modules/User/components/ProductWholesaleOffer.jsx')).default;
});
after(async () => vite.close());
const productId = '507f1f77bcf86cd799439015', variantId = '507f1f77bcf86cd799439033';
const terms = { variantId, minimumQuantity: 5, quantityIncrement: 5, maxQuantity: 25, availableStock: 25,
  priceTiers: [{ minimumQuantity: 5, unitPrice: 80 }, { minimumQuantity: 10, unitPrice: 70 }] };
const storage = initial => { const map = new Map(Object.entries(initial)); return { getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, value) }; };
const reads = (h, route) => h.requests.filter(request => request.url.includes(route));
const current = h => h.tree.wholesale;
const view = h => Offer({ wholesale: current(h) });
function find(node, predicate) {
  if (!node || typeof node !== 'object') return;
  if (predicate(node)) return node;
  for (const child of [node.props?.children].flat(Infinity)) { const found = find(child, predicate); if (found) return found; }
}
const total = h => find(view(h), node => node.props?.className === 'pd-wholesale-total');
const quoteData = (quantity, offer = terms) => {
  const tier = [...offer.priceTiers].reverse().find(tier => tier.minimumQuantity <= quantity);
  return { ...offer, productId, quantity, unitPrice: tier.unitPrice, subtotal: quantity * tier.unitPrice, tierMinimumQuantity: tier.minimumQuantity, savings: 100, retailUnitPrice: 100 };
};
async function fixture(t, overrides = {}) {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const props = { productId, variantId, currentUser: { _id: 'buyer' }, openCart() {}, ...overrides };
  const h = hookHarness(input => ({ wholesale: useWholesale(input) }), props, `/smart-buy?product=${productId}&variant=${variantId}&purchase=wholesale`, undefined,
    { localStorage: storage({ userToken: 'quantity-fixture' }) });
  reads(h, '/wholesale/catalog').at(-1).resolve({ data: [{ variants: [terms] }] }); await h.settle();
  t.mock.timers.tick(350); await h.settle();
  reads(h, '/wholesale/quote').at(-1)?.resolve({ data: quoteData(5) }); await h.settle();
  return { h, props, close() { h.close(); t.mock.timers.reset(); } };
}

test('rapid quantity changes request only the final quantity and preserve the total layout', async t => {
  const f = await fixture(t), { h } = f;
  try {
    assert.equal(current(h).canPurchase, true);
    const initialRequests = h.requests.length;
    for (const quantity of [10, 15, 20, 25]) {
      current(h).setQuantity(quantity); h.flush(); t.mock.timers.tick(50);
      assert.ok(total(h)); assert.equal(current(h).canPurchase, false);
      assert.equal(current(h).quote, null);
      assert.equal(current(h).shownQuote.quantity, 5);
      assert.ok(find(total(h), node => node.props?.['aria-hidden'] === true && node.props?.style?.visibility === 'hidden'), 'Previous amounts are hidden while the quantity changes');
    }
    assert.equal(h.requests.length, initialRequests);
    t.mock.timers.tick(299); await h.settle(); assert.equal(h.requests.length, initialRequests);
    t.mock.timers.tick(1); await h.settle();
    const request = reads(h, '/wholesale/quote').at(-1);
    assert.equal(h.requests.length, initialRequests + 1);
    assert.equal(JSON.parse(request.options.body).quantity, 25);
    request.resolve({ data: quoteData(25) }); await h.settle();
    assert.equal(current(h).canPurchase, true); assert.equal(current(h).quote.subtotal, 1750);
    assert.equal(reads(h, '/wholesale/catalog').length, 1);
    assert.equal(reads(h, '/api/cart/wholesale').length, 0);
  } finally { f.close(); }
});

test('background refresh retains the quantity input, price and offer while verifying again', async t => {
  const f = await fixture(t), { h } = f;
  try {
    const previous = current(h).quote;
    t.mock.timers.tick(30000); h.flush();
    assert.equal(current(h).loading, false); assert.equal(current(h).quantity, 5);
    assert.deepEqual(current(h).shownQuote, previous); assert.ok(total(h));
    assert.equal(current(h).canPurchase, false);
    reads(h, '/wholesale/catalog').at(-1).resolve({ data: [{ variants: [{ ...terms }] }] }); await h.settle();
    t.mock.timers.tick(350); await h.settle();
    reads(h, '/wholesale/quote').at(-1).resolve({ data: quoteData(5) }); await h.settle();
    assert.equal(current(h).canPurchase, true); assert.equal(current(h).quantity, 5);
    assert.equal(reads(h, '/wholesale/quote').length, 2);
  } finally { f.close(); }
});

test('failed price checks preserve the offer and typed quantity, block buying and support retry', async t => {
  const f = await fixture(t), { h } = f;
  try {
    current(h).setQuantity(10); h.flush(); t.mock.timers.tick(350); await h.settle();
    reads(h, '/wholesale/quote').at(-1).resolve({ message: 'Price check unavailable' }, 503); await h.settle();
    assert.equal(current(h).available, true); assert.equal(current(h).quantity, 10);
    assert.equal(current(h).quote, null); assert.equal(current(h).canPurchase, false); assert.ok(total(h));
    await current(h).add(); assert.equal(reads(h, '/api/cart/wholesale').length, 0);
    current(h).refresh(); h.flush();
    reads(h, '/wholesale/catalog').at(-1).resolve({ data: [{ variants: [terms] }] }); await h.settle();
    t.mock.timers.tick(350); await h.settle();
    reads(h, '/wholesale/quote').at(-1).resolve({ data: quoteData(10) }); await h.settle();
    assert.equal(current(h).canPurchase, true); assert.equal(current(h).quantity, 10);
  } finally { f.close(); }
});

test('a late response for the previous quantity cannot replace the current estimate', async t => {
  const f = await fixture(t), { h } = f;
  try {
    current(h).setQuantity(10); h.flush(); t.mock.timers.tick(350); await h.settle();
    const old = reads(h, '/wholesale/quote').at(-1);
    current(h).setQuantity(15); h.flush(); t.mock.timers.tick(350); await h.settle();
    const latest = reads(h, '/wholesale/quote').at(-1);
    latest.resolve({ data: quoteData(15) }); await h.settle();
    old.resolve({ data: quoteData(10) }); await h.settle();
    assert.equal(current(h).quote.quantity, 15); assert.equal(current(h).quote.subtotal, 1050);
  } finally { f.close(); }
});

test('variant and account changes cannot display a previous selection price', async t => {
  const f = await fixture(t), { h, props } = f;
  try {
    props.variantId = '507f1f77bcf86cd799439034'; h.rerender();
    assert.equal(current(h).quote, null); assert.equal(current(h).shownQuote, null);
    props.variantId = variantId; localStorage.setItem('userToken', 'other-customer'); h.rerender();
    assert.equal(current(h).quote, null); assert.equal(current(h).shownQuote, null);
    assert.equal(current(h).canPurchase, false);
  } finally { f.close(); }
});

test('invalid intermediate quantities do not send price requests or enable buying', async t => {
  const f = await fixture(t), { h } = f;
  try {
    for (const quantity of [0, 1, 6, -1, 30]) {
      current(h).setQuantity(quantity); h.flush(); t.mock.timers.tick(350); await h.settle();
      assert.equal(current(h).canPurchase, false); assert.equal(current(h).quote, null); assert.ok(total(h));
    }
    assert.equal(reads(h, '/wholesale/quote').length, 1);
  } finally { f.close(); }
});

test('unmount cancels a queued quantity check', async t => {
  const f = await fixture(t), { h } = f;
  try {
    current(h).setQuantity(10); h.flush(); h.unmount(); t.mock.timers.tick(1000); await h.settle();
    assert.equal(reads(h, '/wholesale/quote').length, 1);
  } finally { f.close(); }
});
