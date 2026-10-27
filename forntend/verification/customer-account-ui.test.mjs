import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { hookHarness } from './componentHarness.mjs';
let vite, Profile, Wishlist;
before(async () => {
  vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' });
  Profile = (await vite.ssrLoadModule('/src/modules/User/pages/ProfilePage.jsx')).default;
  Wishlist = (await vite.ssrLoadModule('/src/modules/User/pages/WishlistPage.jsx')).default;
});
after(async () => vite.close());
const text = node => node == null || typeof node === 'boolean' ? '' : typeof node !== 'object' ? String(node) : [node.props?.children].flat(Infinity).map(text).join(' ');

test('wallet Add Money opens amount dialog and starts a single payment request', async () => {
  const previous = globalThis.document;
  globalThis.document = { getElementById: () => ({}) };
  const h = hookHarness(Profile, {}, '/account', { currentUser: { name: 'Buyer' }, savedAddresses: [] });
  try {
    h.find(node => node.props.className === 'menu-link-row' && text(node).includes('Bulkimart Wallet')).props.onClick(); h.flush();
    h.find(node => node.type === 'button' && text(node).includes('+ Add Money')).props.onClick(); h.flush();
    assert.match(text(h.tree), /Enter Custom Amount/); assert.doesNotMatch(text(h.tree), /Dev Test Mode/);
    h.find(node => node.props.id === 'wallet-topup-amount').props.onChange({ target: { value: '100.25' } }); h.flush();
    const form = h.find(node => node.type === 'form');
    form.props.onSubmit({ preventDefault() {} }); form.props.onSubmit({ preventDefault() {} }); h.flush();
    const requests = h.requests.filter(row => row.url.endsWith('/api/wallet/topup/initiate'));
    assert.equal(requests.length, 1); assert.deepEqual(JSON.parse(requests[0].options.body), { amount: 100.25 });
    requests[0].resolve({ success: false, message: 'Gateway unavailable' }, 503); await h.settle();
    assert.match(text(h.tree), /Gateway unavailable/);
  } finally { h.close(); globalThis.document = previous; }
});

test('wishlist displays saved e-books directly without a truncated catalog fetch', () => {
  const item = { _id: 'ebook-beyond-first-100', name: 'Saved E-book', images: [], price: 75, type: 'ecommerce', fulfillmentType: 'digital', digital: { stockTracked: false }, available: true };
  const added = [], opened = []; let refreshes = 0;
  const h = hookHarness(Wishlist, {}, '/wishlist', {
    wishlist: new Set([item._id]), getWishlistItems: () => [item], wishlistLoading: false,
    refreshWishlist: () => { refreshes++; }, addToCart: product => added.push(product), setSelectedProduct: product => opened.push(product),
  });
  try {
    assert.match(text(h.tree), /Saved E-book/); assert.equal(h.requests.length, 0); assert.equal(refreshes, 1);
    h.find(node => node.props.className === 'wishlist-card').props.onClick();
    h.find(node => node.props.className === 'wishlist-add-cart-btn').props.onClick({ stopPropagation() {} });
    assert.equal(added[0].fulfillmentType, 'digital'); assert.equal(added[0].stock, 1); assert.equal(opened[0].id, item._id);
  } finally { h.close(); }
});
