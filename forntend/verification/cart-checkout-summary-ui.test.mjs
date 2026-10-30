import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { hookHarness } from '../tests/service-hookHarness.mjs';

let vite, Cart, Checkout, Summary;
before(async () => {
  vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' });
  Cart = (await vite.ssrLoadModule('/src/modules/User/pages/CartPage.jsx')).default;
  Checkout = (await vite.ssrLoadModule('/src/modules/User/pages/CheckoutPage.jsx')).default;
  Summary = (await vite.ssrLoadModule('/src/modules/User/components/BasketGroups.jsx')).BasketSummary;
});
after(async () => { await vite.close(); });
const noop = () => {};
const text = node => node == null || typeof node === 'boolean' ? '' : typeof node !== 'object' ? String(node) : [node.props?.children].flat(Infinity).map(text).join('');
const amount = value => Number(text(value).replace(/[₹,−\-]/g, '').trim()) || 0;
const address = { _id: 'address', name: 'Fixture Buyer', phone: '9876500000', line1: 'Fixture Road', city: 'Indore', state: 'MP', pincode: '452001', lat: 22.72, lng: 75.86 };
function fixture({ coupon = 0, coins = 0, freeDelivery = false, premium = 0 } = {}) {
  const pricing = { subtotal: 500, deliveryCharge: (freeDelivery ? 0 : 40) + premium, sameDayFee: premium, sameDayIncentive: 0,
    couponDiscount: coupon, totalAmount: 500 + (freeDelivery ? 0 : 40) + premium - coupon };
  const item = { _id: 'line', itemId: 'line', productId: 'product', name: 'Amla', price: 500, qty: 1, stock: 10, available: true, fulfillmentType: 'physical' };
  const group = { key: 'quick-store', channel: 'grocery', salesChannel: 'retail', seller: { name: 'Fixture Store' }, items: [item], subtotal: 500, deliveryCharge: pricing.deliveryCharge, total: pricing.totalAmount };
  const context = { savedAddresses: [address], selectedAddressId: address._id, getDeliveryPoint: () => address,
    currentUser: { _id: 'buyer', name: address.name, phone: address.phone }, cartChannel: 'grocery',
    serverCart: { channel: 'grocery', items: [item], pricing, coins: { coinDiscount: coins, coinsToUse: coins, availableCoins: 100, eligibleForCoins: true } },
    getCartItems: () => [item], getCartTotal: () => pricing.totalAmount, getCouponDiscount: () => coupon,
    useCoinsSelected: coins > 0, cartLoading: false, availableCoupons: [], appliedCoupon: coupon ? { code: 'SAVE20' } : null,
    couponCode: coupon ? 'SAVE20' : '', deliveryMode: null, tipSetting: { options: [] }, walletBalance: 1000,
    fetchWalletBalance: noop, fetchAvailableCoupons: noop, switchCartChannel: noop, refreshCart: noop, setActiveNav: noop, setSelectedOrder: noop,
    placeOrder: async () => ({ ok: false, message: 'Fixture stopped' }),
  };
  const basket = { data: { valid: true, purchaseMode: 'basket', groups: [group], totals: { ...pricing, sameDayPremium: premium } } };
  return { context, basket, pricing };
}
async function load(h, basket) { h.requests.find(request => request.url.includes('/api/cart/unified')).resolve(basket); await h.settle(); }
const cartRows = h => {
  const node = h.find(node => node.type === Summary), rendered = Summary(node.props);
  const rows = [];
  const visit = node => {
    if (node?.type?.name === 'CartTotalRow') rows.push([node.props.label, amount(node.props.value)]);
    for (const child of [node?.props?.children].flat(Infinity)) if (child && typeof child === 'object') visit(child);
  };
  visit(rendered); return Object.fromEntries(rows);
};
const checkoutAmount = (h, label) => {
  const row = h.find(node => node.type === 'div' && Array.isArray(node.props.children) && node.props.children.length === 2
    && node.props.children[0]?.type === 'span' && text(node.props.children[0]).startsWith(label));
  return row ? amount(row.props.children[1]) : 0;
};

for (const options of [{}, { coupon: 100 }, { freeDelivery: true }]) {
  test(`Quick cart and checkout show the same server subtotal, delivery, discounts, and payable amount ${JSON.stringify(options)}`, async () => {
    const { context, basket, pricing } = fixture(options);
    // A second quote can be older while the channel quote includes the latest
    // coupon state. Navigation must not switch which quote is displayed.
    basket.data.totals = { ...basket.data.totals, subtotal: 999, totalAmount: 1039 };
    const cart = hookHarness(Cart, {}, '/cart', context);
    let rows;
    try {
      await load(cart, basket); rows = cartRows(cart);
      assert.equal(rows['Items Subtotal'], 500);
      assert.equal(rows['Grand Total'], pricing.totalAmount);
      assert.equal(rows['Bulkimart Coins'], undefined);
      assert.equal(cart.find(node => node.props?.className === 'pd-add-to-cart-btn').props.disabled, false);
    } finally { cart.close(); }
    const checkout = hookHarness(Checkout, {}, '/checkout', context);
    try {
      await load(checkout, basket);
      for (const label of ['Items Subtotal', 'Delivery Charges', 'Coupon Discount']) assert.equal(checkoutAmount(checkout, label), rows[label] || 0, label);
      assert.equal(checkoutAmount(checkout, 'Total Amount to Pay'), rows['Grand Total']);
    } finally { checkout.close(); }
  });
}

test('Same-Day delivery is split into its base charge and premium exactly once on both summaries', async () => {
  const { context, basket } = fixture({ coupon: 100, premium: 30 });
  context.cartChannel = 'ecommerce'; context.serverCart.channel = 'ecommerce';
  context.deliveryMode = 'same_day'; basket.data.groups[0].channel = 'ecommerce';
  const cart = hookHarness(Cart, {}, '/cart', context); let rows;
  try { await load(cart, basket); rows = cartRows(cart); assert.equal(rows['Delivery Charges'], 40); assert.equal(rows['Same-Day Delivery Premium'], 30); assert.equal(rows['Grand Total'], 470); }
  finally { cart.close(); }
  const checkout = hookHarness(Checkout, {}, '/checkout', context);
  try {
    await load(checkout, basket);
    assert.equal(checkoutAmount(checkout, 'Delivery Charges'), 40); assert.equal(checkoutAmount(checkout, 'Same-Day Delivery Premium'), 30);
    assert.equal(checkoutAmount(checkout, 'Total Amount to Pay'), rows['Grand Total']);
  } finally { checkout.close(); }
});

test('cart waits for its own channel quote and refresh prices reloads both quote sources', async () => {
  const { context, basket } = fixture(); let refreshes = 0;
  context.serverCart.channel = 'ecommerce'; context.refreshCart = async () => { refreshes++; };
  const cart = hookHarness(Cart, {}, '/cart', context);
  try {
    await load(cart, basket);
    assert.equal(cart.find(node => node.props?.className === 'pd-add-to-cart-btn').props.disabled, true);
    context.serverCart.channel = 'grocery'; cart.rerender();
    assert.equal(cart.find(node => node.props?.className === 'pd-add-to-cart-btn').props.disabled, false);
    const pending = cart.find(node => node.type === 'button' && node.props.children === 'Refresh prices').props.onClick();
    cart.requests.at(-1).resolve(basket); await pending; await cart.settle(); assert.equal(refreshes, 1);
  } finally { cart.close(); }
});

test('placed-order confirmation keeps the persisted payable amount after the cart is cleared', async () => {
  const { context, basket, pricing } = fixture({ coupon: 100 });
  context.placeOrder = async () => {
    context.serverCart = { channel: 'grocery', items: [], pricing: { totalAmount: 0 } };
    return { ok: true, order: { _id: 'placed', orderNo: 'ORD-FIXTURE', status: 'placed', paymentMethod: 'cod', shippingAddress: address,
      items: [], timeline: [], pricing: { ...pricing, totalAmount: 440 } } };
  };
  const checkout = hookHarness(Checkout, {}, '/checkout', context);
  try {
    await load(checkout, basket); assert.equal(checkoutAmount(checkout, 'Total Amount to Pay'), 440);
    await checkout.find(node => node.props?.className === 'pd-add-to-cart-btn').props.onClick(); checkout.flush();
    assert.equal(checkoutAmount(checkout, 'Order Amount'), 440);
  } finally { checkout.close(); }
});
