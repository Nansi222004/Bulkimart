import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { hookHarness } from './componentHarness.mjs';

let vite, Orders, Ring, Earnings, helpers, details;
before(async () => {
  vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' });
  Orders = (await vite.ssrLoadModule('/src/modules/Seller/components/OrdersTab.jsx')).default;
  Ring = (await vite.ssrLoadModule('/src/modules/Seller/components/SellerOrderRingModal.jsx')).SellerOrderRingModal;
  Earnings = (await vite.ssrLoadModule('/src/modules/Seller/components/EarningsTab.jsx')).default;
  helpers = await vite.ssrLoadModule('/src/modules/Seller/utils/sellerOrderAmounts.js');
  details = (await vite.ssrLoadModule('/src/modules/Seller/components/orderDetailSections.jsx')).orderDetailSections;
});
after(async () => { await vite.close(); });
const text = node => node == null || typeof node === 'boolean' ? '' : typeof node !== 'object' ? String(node)
  : [node.props?.children].flat(Infinity).map(text).join(' ');
const amounts = { subtotal: 500, discount: 0, couponDiscount: 100, cdsDiscount: 0, coinDiscount: 0,
  totalDiscount: 100, customerItemsTotal: 400, commission: 40, commissionTax: 7.2, tcs: 0, tds: 0, netEarnings: 452.8 };
const order = { _id: 'fixture', orderNo: 'COUPON-ORDER', channel: 'grocery', status: 'placed', itemCount: 1,
  subtotal: 500, pricing: { subtotal: 500, couponDiscount: 100, deliveryCharge: 40, totalAmount: 440 }, sellerAmounts: amounts,
  items: [{ name: 'Amla', price: 500, qty: 1 }], customer: { name: 'Fixture Buyer' }, shippingAddress: {} };

test('order request cards and the incoming request use the discounted total', () => {
  const h = hookHarness(Orders, {}, '/seller/orders', { orders: [order], activeMode: 'quick', selectedTypes: ['quick'] });
  try {
    const amount = h.find(n => n.props?.className === 'order-f-amount');
    assert.equal(text(amount), '₹440'); assert.match(text(h.tree), /Discount:.*₹100/);
  } finally { h.close(); }
  const ring = hookHarness(Ring, { order, onDecline() {} }, '/seller/orders');
  try { assert.match(text(ring.tree), /Order total.*₹ 440/s); assert.doesNotMatch(text(ring.tree), /Product Subtotal/); }
  finally { ring.close(); }
});

test('order details show the coupon separately and keep the customer total', () => {
  const value = text(details(order));
  assert.match(value, /Coupon discount − ₹100/);
  assert.match(value, /Order total.*₹440/s);
  assert.doesNotMatch(value, /Item discount/);
});

test('multi-store and incomplete historical amounts retain honest labels', () => {
  const multi = { ...order, pricing: undefined };
  assert.deepEqual(helpers.sellerOrderTotal(multi), { label: 'Your items after discounts', value: 400 });
  assert.deepEqual(helpers.sellerOrderTotal({ ...multi, sellerAmounts: null }), { label: 'Item subtotal', value: 500 });
  assert.match(text(details(multi)), /Coupon discount/);
  assert.doesNotMatch(text(details(multi)), /Order total/);
});

test('earnings show admin commission and net earnings without replacing posted balances with gross sales', () => {
  const h = hookHarness(Earnings, {}, '/seller/earnings', { financeSummary: {
    balances: { held: 452.8, eligible: 0, settled: 0, earnedEarnings: 452.8 }, payouts: [], payoutActionsEnabled: false,
    deliveredSales: { orderCount: 2, grossAmount: 600, orders: [
      { ...order, grossAmount: 500, sellerAmounts: amounts, snapshotVersion: 2, snapshotState: 'configured', financialPosting: 'held' },
      { _id: 'legacy', orderNo: 'LEGACY', grossAmount: 100, sellerAmounts: null },
    ] },
  }, ledgerEntries: [] });
  try {
    const row = h.find(n => n.type === 'tr' && text(n).includes('COUPON-ORDER'));
    assert.match(text(h.tree), /Admin commission/); assert.match(text(h.tree), /Net earning/);
    assert.match(text(row), /₹40.00/); assert.match(text(row), /₹7.20/); assert.match(text(row), /₹452.80/);
    const legacy = h.find(n => n.type === 'tr' && text(n).includes('LEGACY'));
    assert.match(text(legacy), /—/); assert.match(text(legacy), /no financial snapshot/);
  } finally { h.close(); }
});
