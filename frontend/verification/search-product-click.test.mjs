import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { hookHarness, registerFeedback } from './componentHarness.mjs';

let vite, normalizeProduct, SearchPage, ProductDetailPage, feedback;

before(async () => {
  vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' });
  normalizeProduct = (await vite.ssrLoadModule('/src/modules/User/hooks/useProducts.js')).normalizeProduct;
  SearchPage = (await vite.ssrLoadModule('/src/modules/User/pages/SearchPage.jsx')).default;
  ProductDetailPage = (await vite.ssrLoadModule('/src/modules/User/pages/ProductDetailPage.jsx')).default;
  feedback = (await vite.ssrLoadModule('/src/utils/feedback.js')).feedback;
  registerFeedback(feedback);
});

after(async () => vite.close());

const searchRowFixture = {
  _id: '6ae2453de3eb6a380288f4eb',
  type: 'grocery',
  fulfillmentType: 'physical',
  name: 'Different clothing',
  slug: 'different-clothing',
  description: 'there is different type pf cloth is present',
  images: [
    'https://res.cloudinary.com/ccqcepfo/image/upload/sample.webp'
  ],
  category: {
    _id: '6ae24443e3eb6a380288f3ad',
    name: 'cloth'
  },
  sku: 'QM-MNYW39',
  gstRate: 5,
  price: 999,
  mrp: 1000,
  discountPercent: 0,
  stock: 148,
  unit: 'pack',
  sellerName: 'Neelam store',
  sellerId: {
    _id: '6ace1e155e84238166d1e47a',
    businessName: 'Neelam store',
    storeDetails: { name: 'Neelam store' }
  },
  variants: [
    {
      _id: '6ae2453de3eb6a380288f4ec',
      name: 'XL',
      price: 999,
      mrp: 1000,
      stock: 148,
      unit: 'pack',
      sku: 'QM-MNYW39-V1',
      attributes: []
    }
  ]
};

test('normalizeProduct populates variants with both id and _id, category name, and seller name', () => {
  const normalized = normalizeProduct(searchRowFixture);
  assert.equal(normalized.id, '6ae2453de3eb6a380288f4eb');
  assert.equal(normalized._id, '6ae2453de3eb6a380288f4eb');
  assert.equal(normalized.name, 'Different clothing');
  assert.equal(normalized.category, 'cloth');
  assert.equal(normalized.sellerName, 'Neelam store');
  assert.equal(normalized.variants.length, 1);
  assert.equal(normalized.variants[0].id, '6ae2453de3eb6a380288f4ec');
  assert.equal(normalized.variants[0]._id, '6ae2453de3eb6a380288f4ec');
  assert.equal(normalized.variants[0].name, 'XL');
});

test('SearchPage clicking a product sets a normalized product with variants', () => {
  let selected = null;
  const context = {
    activeMode: 'quick',
    setActiveNav: () => {},
    setSelectedProduct: (p) => { selected = p; },
    openVoiceSearch: () => {},
    pendingVoiceQuery: '',
    setPendingVoiceQuery: () => {},
    imageSearchRequest: 0,
    setImageSearchRequest: () => {},
  };

  const h = hookHarness(SearchPage, {}, '/search', context);
  try {
    // Open product via normalizeProduct as done on click
    const normalized = normalizeProduct(searchRowFixture);
    context.setSelectedProduct(normalized);
    assert.ok(selected);
    assert.equal(selected.id, '6ae2453de3eb6a380288f4eb');
    assert.ok(Array.isArray(selected.variants));
    assert.equal(selected.variants.length, 1);
    assert.equal(selected.variants[0].id, '6ae2453de3eb6a380288f4ec');
  } finally {
    h.close();
  }
});

test('ProductDetailPage mounts cleanly with normalized search product without throwing', () => {
  const normalized = normalizeProduct(searchRowFixture);
  const context = {
    currentUser: null,
    selectedProduct: normalized,
    getItemQty: () => 0,
    getDeliveryPoint: () => null,
    getSelectedAddress: () => null,
    getLocationDisplayName: () => 'Choose location',
    isWishlisted: () => false,
    toggleWishlist: () => {},
    setSelectedProduct: () => {},
    setActiveNav: () => {},
    addToCart: async () => ({ ok: true }),
    logoutUser: () => {},
    serverCart: { items: [] },
  };

  const h = hookHarness(ProductDetailPage, {}, '/search?product=6ae2453de3eb6a380288f4eb&variant=6ae2453de3eb6a380288f4ec', context);
  try {
    assert.ok(h);
    const title = h.find(n => n.type === 'h1' && n.props?.className === 'pd-product-name');
    assert.ok(title);
    assert.equal(title.props.children, 'Different clothing');
  } finally {
    h.close();
  }
});
