import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { hookHarness } from './service-hookHarness.mjs';
let vite, Checkout, OrdersTab;
before(async () => { vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' }); Checkout = (await vite.ssrLoadModule('/src/modules/User/pages/CheckoutPage.jsx')).default; OrdersTab = (await vite.ssrLoadModule('/src/modules/Seller/components/OrdersTab.jsx')).default; });
after(async () => { await vite.close(); });
const noop = () => {};
function userFixture(overrides = {}) {
  const calls = [];
  const address = { _id: 'address', name: 'Fixture Buyer', phone: '9876500000', line1: 'Fixture', city: 'Mumbai', pincode: '400001', lat: 19.11, lng: 72.91 };
  const context = { savedAddresses: [address], selectedAddressId: 'address', setSelectedAddressId: noop, addAddress: noop, uploadLandmarkImage: noop,
    currentUser: { _id: 'buyer', name: 'Fixture Buyer', phone: '9876500000' }, getCartTotal: () => 140, getCartItems: () => [{ _id: 'line', productId: 'product', name: 'Fixture', price: 100, qty: 1 }],
    getDeliveryPoint: () => address, serverCart: { items: [{ name: 'Fixture', qty: 1, fulfillmentType: 'physical' }], pricing: { subtotal: 100, deliveryCharge: 40, totalAmount: 140 } },
    cartChannel: 'ecommerce', deliveryMode: null, setDeliveryMode: noop, getCouponDiscount: () => 0, cartLoading: false, appliedCoupon: null, availableCoupons: [],
    fetchAvailableCoupons: noop, removeCoupon: noop, couponCode: '', tipSetting: { options: [] }, fetchTipSetting: noop, useCoinsSelected: false, toggleUseCoins: noop,
    walletBalance: 1000, fetchWalletBalance: noop, setActiveNav: noop, setSelectedOrder: noop,
    placeOrder: async (...args) => { calls.push(['single', ...args]); return { ok: false, message: 'Fixture stop after submission' }; },
    placeUnifiedOrder: async (...args) => { calls.push(['unified', ...args]); return { ok: false, message: 'Fixture stop after submission' }; },
    ...overrides };
  return { context, calls };
}
const group = (key = 'shop', channel = 'ecommerce') => ({ key, channel, seller: { name: 'Fixture Store' }, deliveryMode: channel === 'ecommerce' ? 'scheduled' : null,
  requestedMode: channel === 'ecommerce' ? 'scheduled' : null, modeChosen: true, items: [{ itemId: key, name: 'Fixture', qty: 1, price: 100, lineTotal: 100, image: '' }], deliveryCharge: 40, total: 140 });
const basket = (groups = [group()]) => ({ success: true, data: { groups, needsDeliveryChoice: false, totals: { subtotal: groups.length * 100, deliveryCharge: groups.length * 40, totalAmount: groups.length * 140, itemCount: groups.length } } });
function harness(overrides) { const fixture = userFixture(overrides); return { ...fixture, h: hookHarness(Checkout, {}, '/checkout', fixture.context) }; }
const placeButton = h => h.find(n => n.type === 'button' && n.props.className === 'pd-add-to-cart-btn');
async function load(h, groups) { h.requests.find(req => req.url.includes('/api/cart/unified')).resolve(basket(groups)); await h.settle(); }
function text(node) { if (node == null || typeof node === 'boolean') return ''; if (typeof node !== 'object') return String(node); return [node.props?.children].flat(Infinity).map(text).join(' '); }

test('regular checkout can submit without provider choice after authoritative pricing loads', async () => {
  const { h, calls } = harness(); try {
    assert.equal(placeButton(h).props.disabled, true); await load(h); assert.equal(placeButton(h).props.disabled, false);
    assert.match(text(h.tree), /Delivery arranged after store acceptance/); assert.match(text(h.tree), /will not add a customer charge/);
    await placeButton(h).props.onClick(); h.flush(); assert.deepEqual(calls, [['single', 'Cash on Delivery', 0]]);
  } finally { h.close(); }
});
test('a rapid double tap starts only one checkout request', async () => {
  let finish;
  const pending = new Promise(resolve => { finish = resolve; });
  const { h, calls } = harness({ placeOrder: async (...args) => { calls.push(['single', ...args]); return pending; } });
  try {
    await load(h);
    const button = placeButton(h);
    const first = button.props.onClick();
    const second = button.props.onClick();
    assert.equal(calls.length, 1);
    finish({ ok: false, message: 'Fixture completed' });
    await Promise.all([first, second]);
  } finally { h.close(); }
});
test('multi-store basket submits grouped checkout without customer-selected carriers', async () => {
  const { h, calls } = harness(); try { await load(h, [group('first'), group('second')]); await placeButton(h).props.onClick(); assert.deepEqual(calls, [['unified', 'Cash on Delivery', 0]]); } finally { h.close(); }
});
test('wallet and online payment stay independent of carrier assignment', async () => {
  for (const [value, label] of [['Bulkimart Wallet', 'wallet'], ['Razorpay Online Payment', 'Online Payment']]) {
    const { h, calls } = harness(); try {
      await load(h); const option = h.find(n => n.type === 'div' && typeof n.props.onClick === 'function' && text(n).includes(value));
      assert.ok(option); option.props.onClick(); h.flush(); await placeButton(h).props.onClick(); assert.equal(calls[0][1], label);
    } finally { h.close(); }
  }
});
test('failed basket fetch blocks ordering and exposes retry', async () => {
  const { h, calls } = harness(); try {
    h.requests[0].resolve({ message: 'Fixture unavailable' }, 503); await h.settle(); assert.equal(placeButton(h).props.disabled, true); assert.match(text(h.tree), /Fixture unavailable/);
    await placeButton(h).props.onClick(); assert.equal(calls.length, 0); h.click('Retry basket check'); h.requests[1].resolve(basket()); await h.settle(); assert.equal(placeButton(h).props.disabled, false);
  } finally { h.close(); }
});
test('Quick Commerce is shown separately and still submits without a customer carrier choice', async () => {
  const { h, calls } = harness({ cartChannel: 'grocery' }); try { await load(h, [group('quick', 'grocery')]); assert.match(text(h.tree), /Quick Commerce delivery/); await placeButton(h).props.onClick(); assert.equal(calls.length, 1); } finally { h.close(); }
});
test('seller acceptance and delivery setup remain separate actions', () => {
  const context = { orders: [{ _id: 'order', orderNo: 'ORD-FIXTURE', channel: 'ecommerce', status: 'placed', pricing: { totalAmount: 140 }, items: [{ name: 'Fixture', qty: 1 }], createdAt: new Date().toISOString() }], ordersLoading: false, fetchSellerOrders: noop, selectedTypes: ['ecommerce'], activeMode: 'ecommerce', setActiveMode: noop };
  const h = hookHarness(OrdersTab, {}, '/seller', context); try { assert.match(text(h.tree), /Accept order/); assert.doesNotMatch(text(h.tree), /Create Shiprocket shipment/); } finally { h.close(); }
});
test('an obsolete basket quote cannot replace pricing for a newer address', async () => {
  const { h, context } = harness();
  try {
    context.getDeliveryPoint = () => ({ lat: 20, lng: 73 });
    h.find(n => n.type === 'input' && n.props.placeholder === 'Enter coupon code').props.onChange({ target: { value: 'fixture' } }); h.flush();
    h.requests[1].resolve(basket([group('first'), group('second')])); await h.settle();
    h.requests[0].resolve(basket()); await h.settle();
    assert.equal(placeButton(h).props.disabled, false); assert.match(text(h.tree), /280/);
  } finally { h.close(); }
});
test('seller reviews the courier estimate and sends its confirmed limit with shipment creation', async () => {
  const calls = [];
  const context = { orders: [{ _id: 'order', orderNo: 'ORD-FIXTURE', channel: 'ecommerce', status: 'preparing', fulfillment: { assignmentPolicy: 'seller_after_acceptance' }, pricing: { totalAmount: 140 }, items: [{ name: 'Fixture', qty: 1 }], createdAt: new Date().toISOString() }],
    ordersLoading: false, fetchSellerOrders: noop, selectedTypes: ['ecommerce'], activeMode: 'ecommerce', setActiveMode: noop,
    getFulfillmentOptions: async () => ({ ok: true, data: { manual: { available: false }, shiprocket: { available: true, quote: { courierCharge: 65.25 } } } }),
    createShiprocketShipment: async (...args) => { calls.push(args); return { ok: true, message: 'Fixture shipment created' }; } };
  const h = hookHarness(OrdersTab, {}, '/seller', context);
  try {
    await h.click('Choose delivery'); h.flush(); assert.match(text(h.tree), /customer's checkout delivery charge stays unchanged/);
    for (const field of ['Length', 'Breadth', 'Height']) { h.find(n => n.type === 'input' && n.props.placeholder === `${field} (cm)`).props.onChange({ target: { value: '10' } }); h.flush(); }
    let confirmation = ''; window.confirm = message => { confirmation = message; return true; };
    await h.click('Create Shiprocket shipment');
    assert.match(confirmation, /65.25/); assert.deepEqual(calls, [['order', { length: '10', breadth: '10', height: '10' }, 65.25]]);
  } finally { h.close(); }
});
