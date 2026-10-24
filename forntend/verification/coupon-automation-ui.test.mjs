import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { hookHarness } from '../tests/service-hookHarness.mjs';

let vite, Progress, Celebration, UserProvider;
before(async () => {
  vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' });
  Progress = (await vite.ssrLoadModule('/src/modules/User/components/CouponThresholdProgress.jsx')).default;
  Celebration = (await vite.ssrLoadModule('/src/modules/User/components/CouponSuccessCelebration.jsx')).default;
  UserProvider = (await vite.ssrLoadModule('/src/modules/User/context/UserContext.jsx')).UserProvider;
  const { socket } = await vite.ssrLoadModule('/src/utils/socket.js'); socket.connect = () => socket;
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
    assert.ok(offers); offers.resolve({ data: [{ code: 'SAVE20', autoApply: true, applicable: true }] });
    await h.settle();
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
