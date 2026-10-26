import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { hookHarness } from './componentHarness.mjs';
let vite, Page, Provider, Sellers, SellerDetail, row;
before(async () => {
  vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' });
  Page = (await vite.ssrLoadModule('/src/modules/Admin/components/SectionModuleTab.jsx')).default;
  Provider = (await vite.ssrLoadModule('/src/modules/Admin/context/AdminContext.jsx')).AdminProvider;
  Sellers = (await vite.ssrLoadModule('/src/modules/Admin/components/SellersTab.jsx')).default;
  SellerDetail = (await vite.ssrLoadModule('/src/modules/Admin/components/SellerDetailModal.jsx')).SellerDetailModal;
  row = (await vite.ssrLoadModule('/src/modules/Admin/utils/quickCommerceOrderDisplay.js')).quickCommerceOrderRow;
  const { socket } = await vite.ssrLoadModule('/src/utils/socket.js'); socket.connect = () => socket;
});
after(async () => { await vite.close(); });
const text = node => node == null || typeof node === 'boolean' ? '' : typeof node !== 'object' ? String(node) : [node.props?.children].flat(Infinity).map(text).join(' ');
const order = { _id: '507f1f77bcf86cd799439011', orderNo: 'ORD-QCOM-REAL', type: 'grocery', status: 'delivered',
  userId: { name: 'Fixture Buyer', phone: '9876500001' }, shippingAddress: { name: 'Fixture Recipient', phone: '9876500004', line1: 'Customer Road', city: 'Indore', pincode: '452001' },
  items: [{ name: 'Amla', price: 500, qty: 1, sku: 'AMLA', additionalMessage: 'Fresh fruit please', sellerId: { businessName: 'Fixture Business', storeDetails: { name: 'Fixture Store' } } }],
  pricing: { discountRepresentation: 'components-v1', subtotal: 500, discount: 0, couponDiscount: 100, deliveryCharge: 40, totalAmount: 440 }, payment: { totalAmount: 9999 },
  paymentMethod: 'online', paymentId: { status: 'paid' }, deliveryPartnerId: { vehicleType: 'bike', vehicleNo: 'MP09AA1234', userId: { name: 'Fixture Rider', phone: '9876500002' } },
  deliveryId: { status: 'delivered', otpVerified: true }, timeline: [{ status: 'delivered', timestamp: '2026-10-24T10:00:00Z', note: 'Delivered with customer code' }] };
function fixture(overrides = {}) {
  const calls = [], context = { customerOrders: [order], customerOrdersLoading: false, fetchCustomerOrders: filters => calls.push(filters), ...overrides };
  const props = { moduleId: 'qcom-orders' };
  return { h: hookHarness(Page, props, '/admin/qcom-orders', context), context, calls, props };
}

test('Quick Commerce uses the saved order number and total with real store and rider names', () => {
  const { h, calls } = fixture();
  try {
    assert.deepEqual(calls, [{ type: 'grocery' }]);
    for (const value of ['ORD-QCOM-REAL', '₹440', 'Fixture Store', 'Fixture Rider']) assert.ok(text(h.tree).includes(value), value);
    assert.doesNotMatch(text(h.tree), /507f1f77bcf86cd799439011|₹9,999|Add New Entry|Export CSV/);
    h.click('Refresh'); assert.equal(calls.length, 2);
  } finally { h.close(); }
});

test('Quick Commerce details contain the full saved order rather than a flattened record sheet', () => {
  const { h } = fixture();
  try {
    h.click('View Details');
    const details = h.find(n => n.type?.name === 'QuickCommerceOrderDetails'); assert.ok(details);
    const html = renderToStaticMarkup(details);
    for (const value of ['Order &amp; payment', 'Fixture Recipient', '9876500004', 'Customer Road', 'Amla', 'Fresh fruit please',
      'Coupon discount', '−₹100', '₹440', 'paid', 'Fixture Rider', 'MP09AA1234', 'Delivered with customer code']) assert.ok(html.includes(value), value);
    assert.doesNotMatch(text(h.tree), /Update Status|Delete/);
  } finally { h.close(); }
});

test('refresh updates open detail amounts and zero totals remain zero', () => {
  const { h, context } = fixture();
  try {
    h.click('View Details');
    context.customerOrders = [{ ...order, pricing: { ...order.pricing, couponDiscount: 500, deliveryCharge: 0, totalAmount: 0 } }]; h.rerender();
    assert.equal(h.find(n => n.type?.name === 'QuickCommerceOrderDetails').props.order.pricing.totalAmount, 0);
    assert.equal(row(context.customerOrders[0]).amount, '₹0');
    assert.equal(row({ ...order, pricing: {} }).amount, 'Amount not recorded');
  } finally { h.close(); }
});

test('Quick Commerce does not show stale E-Commerce rows and uses real status filters', () => {
  const { h } = fixture({ customerOrders: [order, { ...order, orderNo: 'OTHER-CHANNEL', type: 'ecommerce' }, { ...order, orderNo: 'CANCELLED-QCOM', status: 'cancelled' }] });
  try {
    assert.doesNotMatch(text(h.tree), /OTHER-CHANNEL/);
    h.find(n => n.type === 'select').props.onChange({ target: { value: 'cancelled' } }); h.flush();
    assert.match(text(h.tree), /CANCELLED-QCOM/); assert.doesNotMatch(text(h.tree), /ORD-QCOM-REAL/);
  } finally { h.close(); }
});

test('loading and failed Quick Commerce requests do not claim an empty history', () => {
  for (const values of [{ customerOrdersLoading: true }, { customerOrdersError: 'Could not load fixture orders' }]) {
    const { h } = fixture({ customerOrders: [], ...values });
    try { assert.match(text(h.tree), /Loading orders|Could not load fixture/); assert.doesNotMatch(text(h.tree), /No matching records/); }
    finally { h.close(); }
  }
});

test('a late E-Commerce response cannot overwrite Quick Commerce and failed reads expose retry information', async () => {
  const h = hookHarness(Provider, {}, '/admin/qcom-orders', undefined, { localStorage: { getItem: key => key === 'adminToken' ? 'fixture-admin-token' : null } });
  try {
    h.requests.find(r => r.url.includes('/notifications/unread-count'))?.resolve({ data: { count: 0 } });
    const old = h.tree.props.value.fetchCustomerOrders({ type: 'ecommerce' });
    const fresh = h.tree.props.value.fetchCustomerOrders({ type: 'grocery' });
    h.requests.find(r => r.url.includes('type=grocery')).resolve({ data: [order] }); await fresh; await h.settle();
    h.requests.find(r => r.url.includes('type=ecommerce')).resolve({ data: [{ orderNo: 'STALE-ECOM', type: 'ecommerce' }] }); await old; await h.settle();
    assert.equal(h.tree.props.value.customerOrders[0].orderNo, 'ORD-QCOM-REAL');
    const failed = h.tree.props.value.fetchCustomerOrders({ type: 'grocery' });
    h.requests.filter(r => r.url.includes('type=grocery')).at(-1).resolve({ success: false, message: 'Fixture API unavailable' }, 503);
    await failed; await h.settle();
    assert.equal(h.tree.props.value.customerOrdersError, 'Fixture API unavailable');
    assert.equal(h.tree.props.value.customerOrdersLoading, false);
  } finally { h.close(); }
});

test('seller cards display fresh backend metrics and focus refreshes the open seller', () => {
  const seller = { _id: 'fixture-seller', status: 'approved', metrics: { totalOrders: 4, totalRevenue: 525, deliveredOrders: 2, products: {} } };
  const h = hookHarness(SellerDetail, { seller }, '/admin/vendors-approved', {});
  try { assert.match(text(h.tree), /Orders 4/); assert.match(text(h.tree), /Revenue ₹\s*525/); assert.match(text(h.tree), /Delivered 2/); }
  finally { h.close(); }
  const refreshed = [], page = hookHarness(Sellers, {}, '/admin/vendors-approved', { sellers: [], sellerDetail: seller, fetchSellerDetail: id => refreshed.push(id),
    setSellerStatusFilter() {}, fetchSellers() {}, fetchSellerCounts() {} });
  try { window.dispatchEvent(new Event('focus')); assert.deepEqual(refreshed, ['fixture-seller']); }
  finally { page.close(); }
});
