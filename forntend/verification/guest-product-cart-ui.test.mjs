import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { hookHarness, registerFeedback } from './componentHarness.mjs';
let vite, Detail, feedback;
before(async () => {
  vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' });
  Detail = (await vite.ssrLoadModule('/src/modules/User/pages/ProductDetailPage.jsx')).default;
  feedback = (await vite.ssrLoadModule('/src/utils/feedback.js')).feedback; registerFeedback(feedback);
});
after(async () => vite.close());
function fixture({ signedIn = false, qty = 0, result = { ok: true } } = {}) {
  const adds = [], navigation = [];
  const context = {
    currentUser: signedIn ? { _id: 'buyer' } : null,
    selectedProduct: { id: 'product-fixture', name: 'Fixture product', type: 'ecommerce', price: 100, mrp: 120, stock: 10,
      variants: [{ _id: 'variant-fixture', name: 'Default', price: 100, mrp: 120, stock: 10 }] },
    getItemQty: () => qty, getDeliveryPoint: () => null, getSelectedAddress: () => null, getLocationDisplayName: () => 'Choose location',
    isWishlisted: () => false, toggleWishlist() {}, setSelectedProduct: value => navigation.push(['product', value]), setActiveNav: value => navigation.push(['page', value]),
    addToCart: async (...args) => { adds.push(args); return result; },
  };
  const h = hookHarness(Detail, {}, '/grocery--home?product=product-fixture', context);
  return { h, adds, navigation };
}
const button = (h, action) => h.find(n => n.type === 'button' && n.props.className === `pd-flipkart-btn ${action}`);

for (const action of ['buy-now', 'add-cart']) test(`guest ${action} shows the sign-in toast without an inline error, cart mutation or navigation`, async () => {
  const { h, adds, navigation } = fixture();
  try {
    await button(h, action).props.onClick(); h.flush();
    const toasts = feedback.getSnapshot().toasts;
    assert.equal(toasts.length, 1); assert.equal(toasts[0].message, 'Please sign in to use your cart.'); assert.equal(toasts[0].type, 'info');
    assert.equal(h.find(n => n.props?.className === 'cart-action-feedback'), undefined);
    assert.deepEqual(adds, []); assert.deepEqual(navigation, []);
  } finally { h.close(); }
});

test('a guest with a stale quantity cannot skip sign-in by clicking Buy Now', async () => {
  const { h, navigation } = fixture({ qty: 1 });
  try { await button(h, 'buy-now').props.onClick(); h.flush(); assert.deepEqual(navigation, []); assert.equal(feedback.getSnapshot().toasts[0].message, 'Please sign in to use your cart.'); }
  finally { h.close(); }
});

test('signed-in Buy Now still adds the selected variant and opens checkout', async () => {
  const { h, adds, navigation } = fixture({ signedIn: true });
  try {
    await button(h, 'buy-now').props.onClick(); h.flush();
    assert.deepEqual(adds, [['product-fixture', 1, 'variant-fixture']]); assert.deepEqual(navigation, [['product', null], ['page', 'checkout']]);
    assert.equal(feedback.getSnapshot().toasts.length, 0);
  } finally { h.close(); }
});

test('signed-in stock failures retain their existing error and do not open checkout', async () => {
  const { h, navigation } = fixture({ signedIn: true, result: { ok: false, message: 'Stock changed. Please retry.' } });
  try {
    await button(h, 'buy-now').props.onClick(); h.flush();
    assert.equal(h.find(n => n.props?.className === 'cart-action-feedback').props.children, 'Stock changed. Please retry.');
    assert.deepEqual(navigation, []);
  } finally { h.close(); }
});
