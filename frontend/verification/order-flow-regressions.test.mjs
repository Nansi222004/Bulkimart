import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { hookHarness, registerFeedback } from '../tests/service-hookHarness.mjs';

let vite, UserProvider, SellerProvider, DeliveryProvider, Onboarding, Product, Recovery, requests, deliverySession;
before(async () => {
  vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' });
  UserProvider = (await vite.ssrLoadModule('/src/modules/User/context/UserContext.jsx')).UserProvider;
  SellerProvider = (await vite.ssrLoadModule('/src/modules/Seller/context/SellerContext.jsx')).SellerProvider;
  DeliveryProvider = (await vite.ssrLoadModule('/src/modules/Delivery/context/DeliveryContext.jsx')).DeliveryProvider;
  Onboarding = (await vite.ssrLoadModule('/src/modules/Delivery/pages/DeliveryOnboardingPage.jsx')).default;
  Product = (await vite.ssrLoadModule('/src/modules/User/pages/ProductDetailPage.jsx')).default;
  Recovery = (await vite.ssrLoadModule('/src/modules/User/components/CommittedCheckoutReview.jsx')).default;
  requests = await vite.ssrLoadModule('/src/utils/portalRequests.js');
  deliverySession = await vite.ssrLoadModule('/src/utils/deliverySession.js');
  registerFeedback((await vite.ssrLoadModule('/src/utils/feedback.js')).feedback);
  const { socket } = await vite.ssrLoadModule('/src/utils/socket.js'); socket.connect = () => socket;
});
after(async () => vite.close());
const storage = initial => {
  const map = new Map(Object.entries(initial || {}));
  return { getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, String(value)), removeItem: key => map.delete(key),
    get length() { return map.size; }, key: index => [...map.keys()][index] };
};
const stores = (initial = {}) => ({ localStorage: storage(initial), sessionStorage: storage() });
const text = node => node == null ? '' : typeof node !== 'object' ? String(node) : [node.props?.children].flat(Infinity).map(text).join(' ');
const last = (h, path) => h.requests.filter(request => request.url.includes(path)).at(-1);

for (const entry of ['/cart', '/smart-buy']) test(`${entry} explicit checkout keeps the new basket separate from old payment recovery`, () => {
  const reference = { version: 1, customerId: 'buyer', operation: 'single', key: 'old-pending-checkout-0001' };
  const local = stores({ userToken: 'fixture', 'bulkimart:committed-checkout:buyer': JSON.stringify([reference]) });
  const h = hookHarness(UserProvider, {}, entry, { verified: true, profile: { _id: 'buyer', roles: ['buyer'] } }, local);
  try {
    h.tree.props.value.setActiveNav('checkout'); h.flush();
    assert.equal(window.location.pathname, '/checkout');
    assert.equal(h.tree.props.value.activeNav, 'checkout');
    assert.deepEqual(JSON.parse(local.localStorage.getItem('bulkimart:committed-checkout:buyer')), [{ ...reference, deferred: true }]);
    assert.equal(h.requests.some(request => request.url.endsWith('/api/orders') && request.options.method === 'POST'), false);
  } finally { h.close(); }
});

test('cancelled order with an old pending payment resolves recovery rather than blocking the next checkout', async () => {
  const resolved = [];
  const h = hookHarness(Recovery, { reference: { key: 'old-pending-checkout-0001', operation: 'single' }, onResolved: key => resolved.push(key) }, '/checkout', undefined,
    stores({ userToken: 'fixture' }));
  try {
    last(h, '/checkout-status').resolve({ data: { state: 'completed', orders: [{ _id: 'old-order' }] } }); await h.settle();
    last(h, '/status').resolve({ data: { method: 'online', status: 'pending', orderStatus: 'cancelled', reconciliationRequired: false } }); await h.settle();
    assert.deepEqual(resolved, ['old-pending-checkout-0001']);
    assert.doesNotMatch(text(h.tree), /Online payment is pending or processing/);
  } finally { h.close(); }
});

test('e-book update sends digital metadata without physical delivery or return settings', async () => {
  const h = hookHarness(SellerProvider, {}, '/seller/products', undefined, stores({ sellerToken: 'seller-fixture' }));
  try {
    h.tree.props.value.startEditProduct({ _id: 'ebook', name: 'Test book', type: 'ecommerce', fulfillmentType: 'digital', category: 'category', price: 100,
      digital: { stockTracked: true }, variants: [{ _id: 'variant', price: 100, mrp: 120, stock: 4 }] }); h.flush();
    const pending = h.tree.props.value.submitProductEdit(h.tree.props.value.newProductForm);
    const update = last(h, '/api/products/ebook'); assert.equal(update.options.method, 'PUT');
    assert.equal(update.options.body.has('sameDay'), false); assert.equal(update.options.body.has('returnable'), false);
    assert.equal(JSON.parse(update.options.body.get('digital')).stockTracked, true);
    update.resolve({ success: true }); await h.settle();
    last(h, '/api/products/seller/mine')?.resolve({ products: [] }); await pending;
  } finally { h.close(); }
});

for (const fresh of [false, true]) test(`delivery incomplete ${fresh ? 'fresh OTP session starts at vehicle step one' : 'reopened app returns to authentication'}`, async () => {
  requests.clearPortalRequests('delivery');
  const local = stores({ deliveryToken: 'delivery-fixture', deliveryUserProfile: JSON.stringify({ _id: 'rider', roles: ['buyer'] }) });
  // Install this test's stores before saving a fresh session.
  const setup = hookHarness(() => null, {}, '/delivery', undefined, local);
  deliverySession.clearDeliverySession(false);
  if (fresh) deliverySession.saveDeliverySession({ success: true, sessionRole: 'delivery', token: 'delivery-fixture', user: { _id: 'rider', roles: ['buyer'] }, deliveryState: { status: 'incomplete' } });
  else { local.localStorage.setItem('deliveryToken', 'delivery-fixture'); }
  setup.close();
  const h = hookHarness(DeliveryProvider, {}, '/delivery', undefined, local);
  try {
    last(h, '/api/auth/me').resolve({ userType: 'user', sessionRole: 'delivery' }); await h.settle();
    last(h, '/api/delivery/me').resolve({ data: { name: 'Rider', status: 'incomplete', onboardingStep: 3, vehicleNo: 'OLD1234', zones: ['Old zone'] } }); await h.settle();
    assert.equal(h.tree.props.value.riderAuthed, fresh);
    assert.equal(h.tree.props.value.onboardingStep, 1);
    assert.equal(h.tree.props.value.onboardingForm.vehicleNumber, '');
    if (fresh) { window.dispatchEvent(new Event('pagehide')); h.flush(); }
    assert.equal(local.localStorage.getItem('deliveryToken'), null);
  } finally { h.close(); }
});

test('delivery registration Back exits step one and moves back from later steps', () => {
  for (const step of [1, 3]) {
    let exits = 0; const steps = [];
    const h = hookHarness(Onboarding, {}, '/delivery', { onboardingStep: step, riderStatus: 'incomplete', onboardingForm: {}, onboardingFiles: {},
      setOnboardingStep: value => steps.push(value), logoutDelivery: () => exits++, riderProfile: {}, triggerToast() {} }, stores());
    try { h.click('← Back'); assert.equal(exits, step === 1 ? 1 : 0); assert.deepEqual(steps, step === 3 ? [2] : []); }
    finally { h.close(); }
  }
});

test('product offers refresh after cart changes and on opening, while empty-cart offers do not claim ineligibility', async () => {
  const product = { id: 'product', name: 'Amla', type: 'grocery', price: 500, stock: 8 };
  const ctx = { selectedProduct: product, currentUser: { _id: 'buyer' }, getItemQty: () => 0, getDeliveryPoint: () => null,
    getSelectedAddress: () => null, getLocationDisplayName: () => '', isWishlisted: () => false, serverCart: { items: [] } };
  const h = hookHarness(Product, {}, '/groceries', ctx, stores({ userToken: 'fixture' }));
  const coupon = { code: 'SAVE20', applicable: false, reason: 'Add ₹500 more', title: '20% off', discountType: 'percentage', value: 20 };
  try {
    last(h, '/api/coupons/available').resolve({ data: [coupon], meta: { cartSubtotal: 0 } }); await h.settle();
    h.click('See all offers →'); h.flush();
    last(h, '/api/coupons/available').resolve({ data: [coupon], meta: { cartSubtotal: 0 } }); await h.settle();
    assert.match(text(h.tree), /Check in cart/); assert.doesNotMatch(text(h.tree), /Add ₹500 more/);
    ctx.serverCart = { items: [{ productId: 'product', qty: 1, price: 500 }] }; h.rerender();
    last(h, '/api/coupons/available').resolve({ data: [{ ...coupon, applicable: true }], meta: { cartSubtotal: 500 } }); await h.settle();
    assert.match(text(h.tree), /Applies to your cart/); assert.doesNotMatch(text(h.tree), /Not usable yet/);
  } finally { h.close(); }
});
