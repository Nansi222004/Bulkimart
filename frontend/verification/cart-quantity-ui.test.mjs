import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { hookHarness } from '../tests/service-hookHarness.mjs';

let vite, Cart, Groups, Summary, useUnifiedCart;
before(async () => {
  vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' });
  Cart = (await vite.ssrLoadModule('/src/modules/User/pages/CartPage.jsx')).default;
  ({ BasketGroups: Groups, BasketSummary: Summary } = await vite.ssrLoadModule('/src/modules/User/components/BasketGroups.jsx'));
  ({ useUnifiedCart } = await vite.ssrLoadModule('/src/modules/User/hooks/useUnifiedCart.js'));
});
after(async () => vite.close());
const payload = (qty = 1, channel = 'grocery') => ({ purchaseMode: 'basket', valid: true,
  groups: [{ key: 'seller-group', channel: channel === 'wholesale' ? 'ecommerce' : channel, salesChannel: channel === 'wholesale' ? 'wholesale' : 'retail',
    seller: { name: 'Always' }, items: [{ itemId: 'line-one', productId: 'amla', name: 'Amla', price: 500, qty, lineTotal: 500 * qty, stock: 20, available: true }] }],
  totals: { subtotal: 500 * qty, deliveryCharge: 40, totalAmount: 500 * qty + 40 } });
const context = () => ({ getDeliveryPoint: () => ({ lat: 22, lng: 75 }), cartChannel: 'grocery', switchCartChannel() {}, setActiveNav() {}, refreshCart() {} });
const reads = h => h.requests.filter(request => request.url.includes('/api/cart/unified?'));
const section = h => h.find(node => node.type === Groups);
const checkout = h => h.find(node => node.type === 'button' && node.props.children === 'Proceed to Checkout');
async function fixture() {
  const ctx = context(), h = hookHarness(Cart, {}, '/cart', ctx);
  reads(h)[0].resolve({ data: payload() }); await h.settle();
  return { h, ctx };
}

test('plus and minus keep item cards and summary visible throughout each server update', async () => {
  const { h } = await fixture();
  try {
    for (const qty of [2, 3, 2, 1]) {
      const group = section(h).props.groups[0];
      const renderStart = h.renders.length;
      const pending = section(h).props.onQuantity(group.items[0], group, qty); h.flush();
      const write = h.requests.at(-1);
      assert.equal(write.options.method, 'PUT'); assert.deepEqual(JSON.parse(write.options.body), { qty });
      write.resolve({ success: true }); await h.settle();
      assert.ok(section(h), 'Cart item stays visible while totals reload');
      assert.ok(h.find(node => node.type === Summary));
      assert.equal(h.find(node => node.props?.className === 'basket-loading'), undefined);
      assert.equal(checkout(h).props.disabled, true);
      reads(h).at(-1).resolve({ data: payload(qty) }); await pending; await h.settle();
      assert.equal(section(h).props.groups[0].items[0].qty, qty);
      assert.equal(h.find(node => node.type === Summary).props.data.totals.totalAmount, qty * 500 + 40);
      assert.equal(checkout(h).props.disabled, false);
      for (const render of h.renders.slice(renderStart)) {
        assert.ok(h.find(node => node.type === Groups, render), 'No intermediate render removes the item card');
        assert.ok(h.find(node => node.type === Summary, render), 'No intermediate render removes the summary');
      }
    }
    assert.equal(reads(h).length, 5, 'Each quantity change performs one authoritative basket read');
  } finally { h.close(); }
});

test('coupon repricing and manual price refresh preserve cart contents while blocking stale checkout', async () => {
  const { h, ctx } = await fixture();
  try {
    ctx.couponCode = 'SAVE20'; h.rerender();
    assert.ok(section(h)); assert.equal(checkout(h).props.disabled, true);
    assert.equal(h.find(node => node.props?.className === 'basket-loading'), undefined);
    const discounted = payload(); discounted.totals.totalAmount = 440; discounted.totals.couponDiscount = 100;
    reads(h).at(-1).resolve({ data: discounted }); await h.settle();
    assert.equal(h.find(node => node.type === Summary).props.data.totals.totalAmount, 440);
    const pending = h.click('Refresh prices');
    assert.ok(section(h)); assert.equal(checkout(h).props.disabled, true);
    reads(h).at(-1).resolve({ data: discounted }); await pending; await h.settle();
    assert.equal(checkout(h).props.disabled, false);
  } finally { h.close(); }
});

test('a rejected quantity update keeps the previous quantity and server totals', async () => {
  const { h } = await fixture();
  try {
    const group = section(h).props.groups[0];
    const pending = section(h).props.onQuantity(group.items[0], group, 2); h.flush();
    h.requests.at(-1).resolve({ message: 'Only one item remains in stock' }, 409); await pending; await h.settle();
    assert.equal(section(h).props.groups[0].items[0].qty, 1);
    assert.equal(h.find(node => node.type === Summary).props.data.totals.totalAmount, 540);
    assert.equal(reads(h).length, 1);
    assert.ok(h.find(node => node.props?.role === 'alert'));
  } finally { h.close(); }
});

test('a failed basket reprice never makes old totals available for checkout', async () => {
  const { h } = await fixture();
  try {
    const pending = h.click('Refresh prices');
    reads(h).at(-1).resolve({ message: 'Pricing unavailable' }, 503); await pending; await h.settle();
    assert.ok(!checkout(h) || checkout(h).props.disabled);
    assert.ok(h.find(node => node.props?.role === 'alert'));
  } finally { h.close(); }
});

test('retained basket data never crosses accounts or delivery destinations', async () => {
  const initial = { userToken: 'first-user' }, values = new Map(Object.entries(initial));
  const local = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const props = { point: { lat: 22, lng: 75 } };
  const h = hookHarness(input => useUnifiedCart(input.point, '', 'basket'), props, '/cart', undefined, { localStorage: local });
  try {
    reads(h)[0].resolve({ data: payload() }); await h.settle(); assert.ok(h.tree.data);
    local.setItem('userToken', 'second-user'); h.rerender(); assert.equal(h.tree.data, null);
    reads(h).at(-1).resolve({ data: payload(2) }); await h.settle(); assert.equal(h.tree.data.groups[0].items[0].qty, 2);
    props.point = { lat: 23, lng: 76 }; h.rerender(); assert.equal(h.tree.data, null);
    reads(h).at(-1).resolve({ data: payload(3) }); await h.settle(); assert.equal(h.tree.data.groups[0].items[0].qty, 3);
  } finally { h.close(); }
});

test('late refresh results cannot replace the latest basket', async () => {
  const h = hookHarness(() => useUnifiedCart({ lat: 22, lng: 75 }, '', 'basket'), {}, '/cart');
  try {
    reads(h)[0].resolve({ data: payload() }); await h.settle();
    const old = h.tree.reload(); h.flush(); const oldRead = reads(h).at(-1);
    const latest = h.tree.reload(); h.flush(); const newRead = reads(h).at(-1);
    newRead.resolve({ data: payload(3) }); await latest; await h.settle();
    oldRead.resolve({ data: payload(2) }); await old; await h.settle();
    assert.equal(h.tree.data.groups[0].items[0].qty, 3);
  } finally { h.close(); }
});
