import { before, after, beforeEach, afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { hookHarness } from './componentHarness.mjs';

let vite, Orders, Rating, Categories, Landing, Groceries, Provider, categoryHook, previousDocument;
before(async () => {
  vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' });
  Orders = (await vite.ssrLoadModule('/src/modules/User/pages/OrdersPage.jsx')).default;
  Rating = (await vite.ssrLoadModule('/src/modules/User/components/DeliveryPartnerRating.jsx')).default;
  Categories = (await vite.ssrLoadModule('/src/modules/User/pages/CategoriesPage.jsx')).default;
  Landing = (await vite.ssrLoadModule('/src/modules/User/pages/LandingPage.jsx')).LandingPageContent;
  Groceries = (await vite.ssrLoadModule('/src/modules/User/components/GroceriesSection.jsx')).default;
  Provider = (await vite.ssrLoadModule('/src/modules/User/context/UserContext.jsx')).UserProvider;
  categoryHook = await vite.ssrLoadModule('/src/modules/User/hooks/useCategoryTree.js');
});
after(async () => { await vite.close(); });
beforeEach(() => {
  previousDocument = globalThis.document;
  globalThis.document = Object.assign(new EventTarget(), { visibilityState: 'visible', querySelector: () => null });
  categoryHook.__resetCategoryCache();
});
afterEach(() => { if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument; });
const text = node => node == null || typeof node === 'boolean' ? '' : typeof node !== 'object' ? String(node) : [node.props?.children].flat(Infinity).map(text).join(' ');
const change = (h, node, value) => { node.props.onChange({ target: { value } }); h.flush(); };
const button = (h, label) => h.find(node => node.type === 'button' && text(node).trim() === label);
const leaf = { _id: 'leaf', slug: 'grocery--fresh--fruit--amla', name: 'Amla category', type: 'grocery', children: [] };
const main = { _id: 'main', slug: 'grocery--fresh--fruit', name: 'Fruit', type: 'grocery', children: [leaf] };
const root = { _id: 'root', slug: 'grocery--fresh', name: 'Fresh', type: 'grocery', children: [main] };
const treeRequest = h => h.requests.find(request => request.url.includes('/categories/tree'));

test('Orders filter opens, combines status/storefront/search, clears, and keeps the selected order target', () => {
  const orders = [
    { _id: '1', orderNo: 'ORD-QUICK', status: 'delivered', type: 'grocery', items: [{ name: 'Amla', qty: 1 }] },
    { _id: '2', orderNo: 'ORD-SHOP', status: 'delivered', type: 'ecommerce', items: [{ name: 'Book', qty: 1 }] },
    { _id: '3', orderNo: 'ORD-PENDING', status: 'placed', type: 'grocery', items: [{ name: 'Rice', qty: 1 }] },
  ], opened = [];
  const h = hookHarness(Orders, {}, '/orders', { orders, fetchOrders() {}, setSelectedOrder: order => opened.push(order) });
  try {
    h.find(node => node.props?.['aria-label'] === 'Open filters').props.onClick(); h.flush();
    assert.equal(h.find(node => node.props?.['aria-label'] === 'Open filters').props['aria-expanded'], true);
    change(h, h.find(node => node.type === 'select' && node.props.value === 'all'), 'delivered');
    change(h, h.find(node => node.type === 'select' && node.props.value === 'all'), 'Quick');
    assert.match(text(h.tree), /ORD-QUICK/); assert.doesNotMatch(text(h.tree), /ORD-SHOP|ORD-PENDING/);
    h.find(node => node.props?.className === 'order-product-card').props.onClick(); assert.equal(opened[0], orders[0]);
    change(h, h.find(node => node.type === 'input'), 'Rice'); assert.match(text(h.tree), /No orders match/);
    button(h, 'Clear filters').props.onClick(); h.flush(); assert.match(text(h.tree), /ORD-PENDING/);
    button(h, 'Done').props.onClick(); h.flush(); assert.equal(h.find(node => node.props?.id === 'orders-filters'), undefined);
  } finally { h.close(); }
});

test('delivery rating submits the chosen stars, blocks duplicate clicks, and reports failure for retry', async () => {
  const submitted = [], props = { orderId: 'order', riderName: 'Fixture rider', deliveryRating: { eligible: true, rating: null }, onRated: value => submitted.push(value) };
  const h = hookHarness(Rating, props, '/orders');
  try {
    button(h, 'Rate delivery partner').props.onClick(); h.flush();
    h.find(node => node.props?.['aria-label'] === 'Rate delivery 3 stars').props.onClick(); h.flush();
    const first = button(h, 'Submit rating').props.onClick();
    button(h, 'Submit rating').props.onClick(); assert.equal(h.requests.length, 1); h.flush();
    assert.deepEqual(JSON.parse(h.requests[0].options.body), { rating: 3 });
    assert.equal(h.requests[0].options.method, 'POST'); assert.match(h.requests[0].url, /\/orders\/order\/delivery-rating$/);
    h.requests[0].resolve({ message: 'Fixture offline' }, 503); await first; await h.settle();
    assert.match(text(h.tree), /Fixture offline/);
    const second = button(h, 'Submit rating').props.onClick(); h.requests[1].resolve({ data: { rating: 3 } }); await second; await h.settle();
    assert.deepEqual(submitted, [3]); assert.equal(button(h, 'Submit rating'), undefined);
    props.deliveryRating = { eligible: true, rating: 3 }; h.rerender(); assert.match(text(h.tree), /You rated your delivery partner\s+3\s*\/5/);
    props.deliveryRating = { eligible: false, rating: null }; h.rerender(); assert.equal(h.tree, null);
  } finally { h.close(); }
});

test('an empty cached tree refreshes on focus after expiry and simultaneous sections share one request', async () => {
  const props = { type: 'grocery' }, originalNow = Date.now;
  let now = originalNow(); Date.now = () => now;
  const h = hookHarness(() => categoryHook.useCategoryTree(props.type));
  try {
    treeRequest(h).resolve([]); await h.settle(); assert.deepEqual(h.tree.tree, []);
    now += 31000; window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('focus'));
    assert.equal(h.requests.length, 2);
    h.requests[1].resolve([root]); await h.settle(); assert.equal(h.tree.tree[0].name, 'Fresh');
    props.type = 'ecommerce'; h.rerender(); assert.deepEqual(h.tree.tree, []); assert.equal(h.tree.loading, true);
    h.requests[2].resolve([]); await h.settle();
  } finally { h.close(); Date.now = originalNow; }
});

test('category browser exposes all three levels, queries the selected branch, and ignores an older product response', async () => {
  const context = { activeMode: 'quick', setSelectedCategoryFilter() {}, setSelectedProduct() {}, addToCart() {} };
  const h = hookHarness(Categories, {}, '/categories', context);
  try {
    treeRequest(h).resolve([root]); await h.settle();
    h.find(node => node.props?.className === 'all-category-main').props.onClick(); h.flush();
    button(h, 'Fruit').props.onClick(); h.flush(); assert.ok(button(h, 'Amla category'));
    const branch = h.requests.find(request => request.url.includes('/products?') && new URL(request.url, 'http://fixture').searchParams.get('category') === 'main,leaf');
    button(h, 'Amla category').props.onClick(); h.flush();
    const selected = h.requests.at(-1); assert.equal(new URL(selected.url, 'http://fixture').searchParams.get('category'), 'leaf');
    selected.resolve({ products: [{ _id: 'product-amla', name: 'Amla product', price: 500, images: [], type: 'grocery' }] }); await h.settle();
    branch.resolve({ products: [{ _id: 'old', name: 'Stale product', images: [] }] }); await h.settle();
    assert.match(text(h.tree), /Amla product/); assert.doesNotMatch(text(h.tree), /Stale product/);
    const first = h.requests.find(request => request.url.includes('/products?') && new URL(request.url, 'http://fixture').searchParams.get('category') === 'root,main,leaf');
    first.resolve({ products: [] }); await h.settle();
  } finally { h.close(); }
});

test('Quick admin category tabs named Electronics, Fashion, or Groceries open grocery category products', () => {
  for (const name of ['electronics', 'fashion', 'groceries']) {
    const slug = `grocery--${name}`;
    const h = hookHarness(Landing, {}, `/${slug}`, { activeNav: 'home', activeMode: 'quick', activeSubNav: slug,
      getCartCount: () => 0, getCartSubtotal: () => 0, sections: [], theme: { tokens: {} } });
    try { assert.ok(h.find(node => node.type?.name === 'DynamicCategorySection' && node.props.channel === 'grocery' && node.props.slug === slug)); }
    finally { h.close(); }
  }
});

test('Groceries discovery shows active customer roots even when the first system root has no children', async () => {
  const selected = [], h = hookHarness(Groceries, {}, '/groceries', { setSelectedCategoryFilter: value => selected.push(value) });
  try {
    treeRequest(h).resolve([{ _id: 'system', isSystem: true, children: [] }, root]); await h.settle();
    assert.match(text(h.tree), /Fresh/);
    h.find(node => node.props?.className === 'groceries-card-category').props.onClick();
    assert.equal(selected[0]._id, 'root');
  } finally { h.close(); }
});

test('category links restore their own storefront instead of using the previously visited one', () => {
  for (const [slug, remembered, expected] of [['grocery--fresh', 'shop-all', 'quick'], ['ecommerce--books', 'quick', 'shop-all']]) {
    const store = new Map([['nh_storefront', remembered]]);
    const h = hookHarness(Provider, {}, `/categories/${slug}`, { verified: false, profile: null }, {
      localStorage: { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, value), removeItem: key => store.delete(key) },
    });
    try { assert.equal(h.tree.props.value.activeMode, expected); assert.equal(h.tree.props.value.selectedCategoryFilter.slug, slug); }
    finally { h.close(); }
  }
});
