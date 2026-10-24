import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { hookHarness } from '../tests/service-hookHarness.mjs';

let vite, Progress, Celebration, UserProvider, CouponsTab;
before(async () => {
  vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' });
  Progress = (await vite.ssrLoadModule('/src/modules/User/components/CouponThresholdProgress.jsx')).default;
  Celebration = (await vite.ssrLoadModule('/src/modules/User/components/CouponSuccessCelebration.jsx')).default;
  UserProvider = (await vite.ssrLoadModule('/src/modules/User/context/UserContext.jsx')).UserProvider;
  CouponsTab = (await vite.ssrLoadModule('/src/modules/Admin/components/CouponsTab.jsx')).default;
  const { socket } = await vite.ssrLoadModule('/src/utils/socket.js'); socket.connect = () => socket;
});

const cartData = (subtotal, code = '', saving = 0, variantId = 'variant-1') => ({ channel: 'grocery',
  items: [{ _id: 'line-1', productId: 'product-1', variantId, qty: subtotal === 340 ? 4 : 5, price: subtotal === 340 ? 85 : 100, sellerId: 'seller-1', type: 'grocery', fulfillmentType: 'physical' }],
  appliedCoupon: code ? { code } : null, couponSavings: saving,
  pricing: { subtotal, couponDiscount: saving, deliveryCharge: 40, totalAmount: subtotal + 40 - saving } });
const last = (h, fragment) => h.requests.filter(row => row.url.includes(fragment)).at(-1);
const applicationCount = h => h.requests.filter(row => row.url.endsWith('/api/coupons/validate')).length;
const celebrationEvent = h => h.tree.props.children[1].props.event;
async function loadedProvider(subtotal = 500, offers = []) {
  const profile = { _id: 'fixture-buyer', name: 'Shopper', roles: ['buyer'] };
  const h = hookHarness(UserProvider, {}, '/cart', { verified: true, profile }, {
    localStorage: storage({ userToken: 'fixture-token', userProfile: JSON.stringify(profile), nh_storefront: 'quick' }), sessionStorage: storage({}),
  });
  last(h, '/api/cart?').resolve({ data: cartData(subtotal) }); await h.settle();
  last(h, '/api/cart/summary').resolve({ data: { grocery: { lines: 1 }, ecommerce: { lines: 0 }, wholesale: { lines: 0 } } }); await h.settle();
  last(h, '/api/coupons/available?').resolve({ data: offers }); await h.settle();
  return h;
}
async function confirm(h, code, saving = 100, subtotal = 500) {
  last(h, '/api/coupons/validate').resolve({ data: { valid: true, coupon: { code }, savings: saving } }); await h.settle();
  last(h, '/api/cart?').resolve({ data: cartData(subtotal, code, saving) }); await h.settle();
}

test('340/500 does not apply; reaching 500 reevaluates and celebrates only the confirmed saving once', async () => {
  const threshold = { minimumOrderValue: 500, eligibleOrderValue: 340, remainingAmount: 160, progressPercentage: 68 };
  const h = await loadedProvider(340, [{ code: 'SAVE20', applicable: false, discountType: 'percentage', value: 20, threshold }]);
  try {
    assert.equal(applicationCount(h), 0); assert.equal(celebrationEvent(h), null);
    assert.deepEqual(h.tree.props.value.availableCoupons[0].threshold, threshold);
    const mutation = h.tree.props.value.setCartItemQty('line-1', 5);
    last(h, '/api/cart/line-1').resolve({ data: cartData(500) }); await mutation; await h.settle();
    const eligible = { code: 'SAVE20', applicable: true, discountType: 'percentage', value: 20, savingNow: 100,
      threshold: { ...threshold, eligibleOrderValue: 500, remainingAmount: 0, progressPercentage: 100 } };
    last(h, '/api/coupons/available?').resolve({ data: [eligible] }); await h.settle();
    assert.equal(applicationCount(h), 1); assert.equal(celebrationEvent(h), null);
    last(h, '/api/coupons/validate').resolve({ data: { valid: true, coupon: { code: 'SAVE20' }, savings: 999 } }); await h.settle();
    assert.equal(celebrationEvent(h), null); assert.equal(h.tree.props.value.couponCode, '');
    // The celebration must use repriced savings, never the earlier quote.
    last(h, '/api/cart?').resolve({ data: cartData(500, 'SAVE20', 100) }); await h.settle();
    assert.equal(h.tree.props.value.couponCode, 'SAVE20');
    assert.equal(h.tree.props.value.getCartTotal(), 440);
    assert.deepEqual(celebrationEvent(h), { id: 1, code: 'SAVE20', savings: 100 });
    assert.equal(h.tree.props.children[1].props.active, true);
    const refresh = h.tree.props.value.refreshCart(); last(h, '/api/cart?').resolve({ data: cartData(500, 'SAVE20', 100) }); await refresh; await h.settle();
    h.tree.props.value.setActiveNav('checkout'); h.flush();
    last(h, '/api/coupons/available?').resolve({ data: [eligible] }); await h.settle(); h.rerender();
    assert.equal(applicationCount(h), 1); assert.equal(celebrationEvent(h).id, 1);
  } finally { h.close(); }
});

test('automatic selection uses backend ordering without replacing a valid manual choice', async () => {
  const h = await loadedProvider();
  try {
    const manual = h.tree.props.value.applyCoupon(' mycode ');
    assert.equal(JSON.parse(last(h, '/api/coupons/validate').options.body).code, 'MYCODE');
    await confirm(h, 'MYCODE', 50); assert.equal((await manual).success, true);
    const refresh = h.tree.props.value.fetchAvailableCoupons();
    last(h, '/api/coupons/available?').resolve({ data: [{ code: 'BEST', applicable: true, savingNow: 200 }] }); await refresh; await h.settle();
    h.tree.props.value.setActiveNav('checkout'); h.flush();
    assert.equal(h.tree.props.value.couponCode, 'MYCODE'); assert.equal(applicationCount(h), 1);
    assert.equal(celebrationEvent(h).code, 'MYCODE');
  } finally { h.close(); }
});

test('the first eligible backend-ranked coupon wins, skipping unverified membership offers', async () => {
  const h = await loadedProvider(500, [{ code: 'MEMBER', applicable: true, cdsMembersOnly: true, savingNow: 250 },
    { code: 'BEST', applicable: true, savingNow: 150 }, { code: 'OTHER', applicable: true, savingNow: 100 }]);
  try {
    assert.equal(JSON.parse(last(h, '/api/coupons/validate').options.body).code, 'BEST');
    await confirm(h, 'BEST', 150);
    assert.equal(h.tree.props.value.couponCode, 'BEST'); assert.equal(applicationCount(h), 1);
  } finally { h.close(); }
});

test('offer-list visibility does not gate automatic application or expose unlisted offers in the manual list', async () => {
  const h = await loadedProvider(500, [{ code: 'VALID', applicable: true, isPublic: false, savingNow: 100 }]);
  try {
    assert.deepEqual(h.tree.props.value.availableCoupons, []);
    assert.equal(JSON.parse(last(h, '/api/coupons/validate').options.body).code, 'VALID');
    await confirm(h, 'VALID', 100);
    assert.equal(h.tree.props.value.couponCode, 'VALID'); assert.equal(celebrationEvent(h).savings, 100);
  } finally { h.close(); }
});

test('removing an applied coupon is respected while the cart remains unchanged', async () => {
  const h = await loadedProvider(500, [{ code: 'SAVE20', applicable: true }]);
  try {
    await confirm(h, 'SAVE20');
    const removal = h.tree.props.value.removeCoupon();
    last(h, '/api/cart?').resolve({ data: cartData(500) }); await removal; await h.settle();
    h.tree.props.value.setActiveNav('checkout'); h.flush();
    last(h, '/api/coupons/available?').resolve({ data: [{ code: 'SAVE20', applicable: true }] }); await h.settle();
    assert.equal(h.tree.props.value.couponCode, ''); assert.equal(applicationCount(h), 1);
    assert.equal(h.tree.props.children[1].props.active, false);
  } finally { h.close(); }
});

test('a changed variant triggers a fresh backend coupon evaluation', async () => {
  const h = await loadedProvider(340, [{ code: 'SAVE20', applicable: false }]);
  try {
    const before = h.requests.filter(row => row.url.includes('/api/coupons/available?')).length;
    const refresh = h.tree.props.value.refreshCart();
    last(h, '/api/cart?').resolve({ data: cartData(340, '', 0, 'variant-2') }); await refresh; await h.settle();
    assert.equal(h.requests.filter(row => row.url.includes('/api/coupons/available?')).length, before + 1);
    assert.equal(applicationCount(h), 0);
  } finally { h.close(); }
});

test('a successful eligibility quote followed by rejected repricing creates no application or confetti', async () => {
  const h = await loadedProvider(500, [{ code: 'SAVE20', applicable: true }]);
  try {
    last(h, '/api/coupons/validate').resolve({ data: { valid: true, coupon: { code: 'SAVE20' }, savings: 100 } }); await h.settle();
    last(h, '/api/cart?').resolve({ data: { ...cartData(500), couponError: 'Coupon expired before repricing' } }); await h.settle();
    assert.equal(h.tree.props.value.couponCode, ''); assert.equal(celebrationEvent(h), null);
  } finally { h.close(); }
});

test('celebration expiry and ordinary rerenders never restart the same application event', () => {
  const originalTimer = globalThis.setTimeout; const callbacks = [];
  globalThis.setTimeout = callback => { callbacks.push(callback); return 999999; };
  let h;
  try {
    const props = { event: { id: 1, code: 'SAVE20', savings: 100 } };
    h = hookHarness(Celebration, props); h.rerender(); h.rerender();
    assert.equal(callbacks.length, 1); callbacks[0](); h.flush(); assert.equal(h.tree, null);
    props.event = { ...props.event }; h.rerender(); assert.equal(h.tree, null); assert.equal(callbacks.length, 1);
    props.event = { id: 2, code: 'OTHER', savings: 50 }; h.rerender(); assert.equal(callbacks.length, 2);
  } finally { h?.close(); globalThis.setTimeout = originalTimer; }
});

test('admin coupon creation exposes and submits no automatic-application setting', async () => {
  const messages = [];
  const h = hookHarness(CouponsTab, {}, '/admin/coupons', { triggerToast(message) { messages.push(message); } });
  try {
    h.click('+ New Coupon');
    const form = h.find(node => node.type === 'form'); assert.ok(form);
    assert.equal(h.find(node => node.type === 'label' && String(node.props.children).includes('Apply automatically')), undefined);
    const saving = form.props.onSubmit({ preventDefault() {} });
    const created = h.requests.find(row => row.options.method === 'POST' && row.url.includes('/coupons')); assert.ok(created);
    assert.equal(Object.hasOwn(JSON.parse(created.options.body), 'autoApply'), false);
    // Form submission waits for the normal list refresh.
    created.resolve({ data: { code: 'FIXTURE' } }); await h.settle();
    for (const request of h.requests.filter(row => row.url.includes('/coupons') && row.options.method !== 'POST')) request.resolve({ data: [], meta: { total: 0 } });
    await saving;
    assert.equal(messages.length, 1); assert.match(messages[0], /created/);
  } finally { h.close(); }
});
after(async () => vite?.close());
const storage = values => ({ getItem: key => values[key] ?? null, setItem(key, value) { values[key] = String(value); }, removeItem(key) { delete values[key]; } });

test('threshold renders configured percentage, remaining amount, and a working Shop More action', () => {
  let selected;
  const offer = { code: 'SAVE20', discountType: 'percentage', value: 20, threshold: { minimumOrderValue: 500, eligibleOrderValue: 340, remainingAmount: 160, progressPercentage: 68 } };
  const h = hookHarness(Progress, { offers: [offer], onShopMore: value => { selected = value; } });
  try {
    assert.match(h.find(node => node.type === 'strong').props.children, /₹160 more.*20% off/);
    assert.equal(h.find(node => node.props?.role === 'progressbar').props['aria-valuenow'], 340);
    h.click('Shop More →'); assert.equal(selected, offer);
  } finally { h.close(); }
});

test('threshold completion never claims application, and absent thresholds render nothing', () => {
  const offer = { code: 'FIXED', discountType: 'fixed', value: 100, threshold: { minimumOrderValue: 500, eligibleOrderValue: 510, remainingAmount: 0, progressPercentage: 100 } };
  const h = hookHarness(Progress, { offers: [offer] });
  try {
    assert.match(h.find(node => node.type === 'strong').props.children, /unlocked ₹100 off/);
    assert.equal(h.find(node => node.type === 'button'), undefined);
  } finally { h.close(); }
  const absent = hookHarness(Progress, { offers: [{ code: 'NONE', discountType: 'free_shipping' }] });
  try { assert.equal(absent.tree, null); } finally { absent.close(); }
  const active = hookHarness(Progress, { offers: [offer], appliedCode: 'OTHER' });
  try { assert.equal(active.tree, null); } finally { active.close(); }
});

test('free delivery wording comes only from a configured free-delivery coupon', () => {
  const offer = { code: 'SHIP', discountType: 'free_shipping', threshold: { minimumOrderValue: 500, eligibleOrderValue: 340, remainingAmount: 160, progressPercentage: 68 } };
  const h = hookHarness(Progress, { offers: [offer] });
  try { assert.match(h.find(node => node.type === 'strong').props.children, /₹160 more to unlock free delivery/); }
  finally { h.close(); }
});

test('celebration is tied to an application event and cleans its timer on unmount', () => {
  const props = { event: { id: 1, code: 'SAVE20', savings: 102 } };
  const h = hookHarness(Celebration, props);
  try {
    assert.match(h.find(node => node.type === 'p').props.children.join(''), /saved ₹102/);
    props.event = { id: 2, code: 'SHIP', savings: 40 };
    h.rerender();
    assert.match(h.find(node => node.type === 'p').props.children.join(''), /SHIP.*₹40/);
  } finally { h.close(); }
});

test('a queued celebration waits for Cart and does not replay when returning to it', () => {
  const props = { event: { id: 1, code: 'SAVE20', savings: 180 }, active: false };
  const h = hookHarness(Celebration, props);
  try {
    assert.equal(h.tree, null);
    props.active = true; h.rerender();
    assert.match(h.find(node => node.type === 'p').props.children.join(''), /saved ₹180/);
    props.active = false; h.rerender(); assert.equal(h.tree, null);
    props.active = true; h.rerender(); assert.equal(h.tree, null);
    props.event = { id: 2, code: 'SAVE20', savings: 200 }; h.rerender();
    assert.match(h.find(node => node.type === 'p').props.children.join(''), /saved ₹200/);
  } finally { h.close(); }
});

test('provider automatically applies only a backend-approved offer and reprices before celebrating', async () => {
  const profile = { _id: 'fixture-buyer', name: 'Shopper', roles: ['buyer'] };
  const h = hookHarness(UserProvider, {}, '/', { verified: true, profile }, {
    localStorage: storage({ userToken: 'fixture-token', userProfile: JSON.stringify(profile), nh_storefront: 'quick' }), sessionStorage: storage({}),
  });
  try {
    const cart = h.requests.find(row => row.url.includes('/api/cart?') && row.url.includes('channel=grocery'));
    assert.ok(cart);
    cart.resolve({ data: { channel: 'grocery', items: [{ productId: 'product-1', qty: 6, price: 85, sellerId: 'seller-1', fulfillmentType: 'physical' }], pricing: { subtotal: 510, totalAmount: 550 } } });
    await h.settle();
    const summary = h.requests.find(row => row.url.endsWith('/api/cart/summary'));
    assert.ok(summary); summary.resolve({ data: { grocery: { lines: 1, count: 6 }, ecommerce: { lines: 0 }, wholesale: { lines: 0 } } });
    await h.settle();
    const offers = h.requests.find(row => row.url.includes('/api/coupons/available?channel=grocery'));
    assert.ok(offers);
    // A repeated summary with unchanged line counts must not cancel the only
    // pending offer evaluation and then prevent it from ever being retried.
    window.dispatchEvent(new Event('cart:changed'));
    const summaries = h.requests.filter(row => row.url.endsWith('/api/cart/summary'));
    assert.ok(summaries.length > 1);
    summaries.at(-1).resolve({ data: { grocery: { lines: 1, count: 6 }, ecommerce: { lines: 0 }, wholesale: { lines: 0 } } });
    await h.settle();
    // Checkout can request the same offers while the provider request is still
    // pending. The winning response must still drive automatic application.
    const pageOffers = h.tree.props.value.fetchAvailableCoupons();
    offers.resolve({ data: [{ code: 'SAVE20', applicable: true }] });
    await h.settle();
    assert.equal(h.requests.find(row => row.url.endsWith('/api/coupons/validate')), undefined);
    h.requests.filter(row => row.url.includes('/api/coupons/available?')).at(-1).resolve({ data: [{ code: 'SAVE20', applicable: true }] });
    await pageOffers; await h.settle();
    const validation = h.requests.find(row => row.url.endsWith('/api/coupons/validate'));
    assert.ok(validation); assert.equal(JSON.parse(validation.options.body).code, 'SAVE20');
    assert.equal(h.tree.props.value.couponCode, '');
    validation.resolve({ data: { valid: true, coupon: { code: 'SAVE20' }, savings: 102 } });
    await h.settle();
    const priced = h.requests.find(row => row.url.includes('/api/cart?') && row.url.includes('coupon=SAVE20'));
    assert.ok(priced);
    priced.resolve({ data: { channel: 'grocery', items: [{ productId: 'product-1', qty: 6, price: 85, sellerId: 'seller-1', fulfillmentType: 'physical' }],
      appliedCoupon: { code: 'SAVE20' }, couponSavings: 102, pricing: { subtotal: 510, couponDiscount: 102, totalAmount: 448 } } });
    await h.settle();
    assert.equal(h.tree.props.value.couponCode, 'SAVE20');
    assert.equal(h.tree.props.children[1].props.event.code, 'SAVE20');
    assert.equal(h.tree.props.children[1].props.event.savings, 102);
    assert.equal(h.tree.props.children[1].props.active, false);
    h.tree.props.value.setActiveNav('cart'); h.flush();
    assert.equal(h.tree.props.children[1].props.active, true);
    assert.equal(h.requests.filter(row => row.url.endsWith('/api/coupons/validate')).length, 1);
    assert.equal((await h.tree.props.value.applyCoupon('SAVE20')).success, false);
    assert.equal(h.tree.props.children[1].props.event.id, 1);
  } finally { h.close(); }
});

test('failed coupon validation neither applies a code nor creates a celebration event', async () => {
  const profile = { _id: 'fixture-buyer', name: 'Shopper', roles: ['buyer'] };
  const h = hookHarness(UserProvider, {}, '/', { verified: true, profile }, {
    localStorage: storage({ userToken: 'fixture-token', userProfile: JSON.stringify(profile) }), sessionStorage: storage({}),
  });
  try {
    const applying = h.tree.props.value.applyCoupon('INVALID');
    const validation = h.requests.find(row => row.url.endsWith('/api/coupons/validate'));
    validation.resolve({ data: { valid: false, reason: 'Expired coupon' } });
    assert.equal((await applying).success, false);
    h.flush();
    assert.equal(h.tree.props.value.couponCode, '');
    assert.equal(h.tree.props.children[1].props.event, null);
  } finally { h.close(); }
});

for (const offer of [
  { code: 'UNVERIFIED_MEMBER', cdsMembersOnly: true, applicable: true },
  { code: 'BELOW_MINIMUM', applicable: false },
]) test(`${offer.code} does not apply or celebrate automatically`, async () => {
  const profile = { _id: 'fixture-buyer', roles: ['buyer'] };
  const h = hookHarness(UserProvider, {}, '/cart', { verified: true, profile }, {
    localStorage: storage({ userToken: 'fixture-token', userProfile: JSON.stringify(profile), nh_storefront: 'quick' }), sessionStorage: storage({}),
  });
  try {
    h.requests.find(row => row.url.includes('/api/cart?') && row.url.includes('channel=grocery')).resolve({ data: {
      items: [{ productId: 'product-1', sellerId: 'seller-1', qty: 1, price: 100 }], pricing: { subtotal: 100, totalAmount: 140 } } });
    await h.settle();
    h.requests.find(row => row.url.endsWith('/api/cart/summary')).resolve({ data: { grocery: { lines: 1 } } });
    await h.settle();
    h.requests.find(row => row.url.includes('/api/coupons/available?')).resolve({ data: [offer] });
    await h.settle();
    assert.equal(h.requests.find(row => row.url.endsWith('/api/coupons/validate')), undefined);
    assert.equal(h.tree.props.value.couponCode, '');
    assert.equal(h.tree.props.children[1].props.event, null);
  } finally { h.close(); }
});
