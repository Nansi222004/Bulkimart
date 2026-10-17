import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { hookHarness } from './service-hookHarness.mjs';
let vite, Cart, LegacyCart, UI, GroupUI, BottomNav;
before(async () => {
  vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' });
  Cart = (await vite.ssrLoadModule('/src/modules/User/pages/CartPage.jsx')).default;
  LegacyCart = (await vite.ssrLoadModule('/src/modules/User/pages/WholesaleCartPage.jsx')).default;
  UI = await vite.ssrLoadModule('/src/modules/User/components/CartUI.jsx');
  GroupUI = await vite.ssrLoadModule('/src/modules/User/components/BasketGroups.jsx');
  BottomNav = (await vite.ssrLoadModule('/src/modules/User/components/BottomNav.jsx')).default;
});
after(async () => vite.close());
const group = channel => ({ key: channel, channel: channel === 'wholesale' ? 'ecommerce' : channel, salesChannel: channel === 'wholesale' ? 'wholesale' : 'retail', seller: { name: 'Vendor ' + channel },
  items: [{ itemId: 'line-' + channel, name: channel, variantName: 'Pack', price: 80, qty: channel === 'wholesale' ? 5 : 2, stock: 25, available: true,
    ...(channel === 'wholesale' ? { wholesaleSnapshot: { minimumQuantity: 5, quantityIncrement: 5, tierMinimumQuantity: 5 } } : {}) }], subtotal: 400, deliveryCharge: 40, total: 440 });
const payload = channels => ({ groups: channels.map(group), purchaseMode: 'basket', valid: true, quoteHash: 'server-wholesale-hash', basketHash: 'server-basket-hash', totals: { subtotal: 901, deliveryCharge: 121, totalAmount: 1022 } });
const context = { getDeliveryPoint: () => ({ lat: 19, lng: 72 }), setActiveNav() {} };

for (const channels of [['grocery'], ['ecommerce'], ['wholesale'], ['grocery', 'ecommerce'], ['grocery', 'wholesale'], ['ecommerce', 'wholesale'], ['grocery', 'ecommerce', 'wholesale']]) test('one shell renders ' + channels.join('+') + ' and authoritative summary', async () => {
  const h = hookHarness(Cart, {}, '/cart', context);
  try {
    assert.match(h.requests[0].url, /purchaseMode=basket/);
    const data = payload(channels); h.requests[0].resolve({ data }); await h.settle();
    for (const channel of channels) assert.ok(h.find(n => n.type === GroupUI.BasketGroups && n.props.groups[0].key === channel));
    assert.deepEqual(h.find(n => n.type === GroupUI.BasketSummary).props.data.totals, data.totals);
    assert.equal(h.find(n => n.props?.children === 'Proceed to Checkout').props.disabled, false);
    assert.equal(LegacyCart, Cart);
    assert.equal(UI.CartModeNav, undefined);
  } finally { h.close(); }
});

test('empty, invalid, failed, and refreshing baskets cannot proceed to checkout', async () => {
  for (const state of ['empty', 'invalid', 'failed', 'refreshing']) {
    const h = hookHarness(Cart, {}, '/wholesale/cart', context);
    try {
      const data = payload(state === 'empty' ? [] : ['wholesale']);
      if (state === 'invalid') { data.valid = false; data.totals = null; data.warnings = ['Stock changed']; }
      h.requests[0].resolve(state === 'failed' ? { message: 'Quote unavailable' } : { data }, state === 'failed' ? 503 : 200); await h.settle();
      if (state === 'refreshing') h.click('Refresh prices');
      const button = h.find(n => n.props?.children === 'Proceed to Checkout');
      assert.ok(!button || button.props.disabled);
      if (state === 'empty') assert.ok(h.find(n => n.type === UI.CartEmptyState));
    } finally { h.close(); }
  }
});

test('mutations route only the intended Wholesale or retail line and refresh real prices', async () => {
  for (const channel of ['wholesale', 'grocery', 'ecommerce']) {
    const h = hookHarness(Cart, {}, '/cart', context);
    try {
      h.requests[0].resolve({ data: payload([channel]) }); await h.settle();
      const section = h.find(n => n.type === GroupUI.BasketGroups);
      const current = section.props.groups[0];
      section.props.onQuantity(current.items[0], current, channel === 'wholesale' ? 10 : 3); h.flush();
      const write = h.requests.at(-1);
      assert.match(write.url, new RegExp('/api/cart/' + (channel === 'wholesale' ? 'wholesale/' : '') + 'line-' + channel + '$'));
      assert.equal(write.options.method, 'PUT');
      assert.equal(JSON.parse(write.options.body).qty, channel === 'wholesale' ? 10 : 3);
      write.resolve({}); await h.settle();
      assert.match(h.requests.at(-1).url, /purchaseMode=basket/);
    } finally { h.close(); }
  }
});

test('Wholesale quantity controls preserve MOQ, step and stock; retail retains its 20-unit cap', () => {
  for (const channel of ['wholesale', 'ecommerce']) {
    const section = group(channel); const h = hookHarness(GroupUI.BasketItem, { item: section.items[0], group: section, onQuantity() {}, onRemove() {} });
    try {
      const input = h.find(n => n.type === 'input');
      assert.equal(input.props.min, channel === 'wholesale' ? 5 : 1);
      assert.equal(input.props.step, channel === 'wholesale' ? 5 : 1);
      assert.equal(input.props.max, channel === 'wholesale' ? 25 : 20);
      assert.equal(h.find(n => n.props?.['aria-label'] === 'Decrease wholesale')?.props.disabled, channel === 'wholesale' ? true : undefined);
    } finally { h.close(); }
  }
});

test('bottom navigation has one Cart item using the provided aggregate count on the legacy route', () => {
  const h = hookHarness(BottomNav, {}, '/wholesale/cart', { activeNav: 'wholesale', getCartCount: () => 9, setActiveNav() {} });
  try {
    assert.equal(h.find(n => n.props?.className === 'nav-cart-badge').props.children, 9);
    assert.ok(h.find(n => n.props?.children === 'Cart'));
    assert.equal(h.find(n => n.props?.children === 'Retail Cart'), undefined);
  } finally { h.close(); }
});
