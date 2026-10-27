import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { hookHarness } from './componentHarness.mjs';
let vite, Page, orderRow;
before(async () => {
  vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' });
  Page = (await vite.ssrLoadModule('/src/modules/Admin/components/SectionModuleTab.jsx')).default;
  orderRow = (await vite.ssrLoadModule('/src/modules/Admin/utils/ecommerceOrderDisplay.js')).ecommerceOrderRow;
});
after(async () => vite.close());
const order = fields => ({ _id: 'database-id-fixture', orderNo: 'ORD-20261026-ABC123', type: 'ecommerce', status: 'delivered',
  userId: { name: 'Fixture Buyer' }, items: [{ name: 'Fixture item', qty: 1 }], pricing: { totalAmount: 1250.5 },
  payment: { totalAmount: 0 }, ...fields });
const text = node => node == null ? '' : typeof node !== 'object' ? String(node) : [node.props?.children].flat(Infinity).map(text).join(' ');
function fixture(orders, loading = false) {
  const loads = [];
  const h = hookHarness(Page, { moduleId: 'ecom-orders' }, '/admin/ecom-orders', {
    customerOrders: orders, customerOrdersLoading: loading, fetchCustomerOrders: filters => loads.push(filters), triggerToast() {},
  });
  return { h, loads };
}

test('the table and details use the saved order number and pricing total rather than database ID or payment total', () => {
  const { h, loads } = fixture([order({ deliveryType: 'shiprocket', shiprocket: { courier: 'Delhivery', awb: 'AWB-FIXTURE' } })]);
  try {
    assert.deepEqual(loads, [{ type: 'ecommerce', salesChannel: 'retail' }]);
    assert.match(text(h.tree), /ORD-20261026-ABC123/); assert.match(text(h.tree), /₹1,250.5/);
    assert.doesNotMatch(text(h.tree), /database-id-fixture|₹0\b/); assert.match(text(h.tree), /Delhivery.*AWB-FIXTURE/);
    h.click('View Details'); const sheet = h.find(n => n.props?.className === 'admin-modal-sheet');
    assert.match(text(sheet), /Order ORD-20261026-ABC123/); assert.match(text(sheet), /Total Amount ₹1,250.5/);
    assert.match(text(sheet), /Courier Partner Delhivery/); assert.match(text(sheet), /Tracking # AWB-FIXTURE/);
    assert.doesNotMatch(text(sheet), /Update Status|Delete/);
  } finally { h.close(); }
});

test('Bulkimart rider delivery names the rider and does not pretend it has an external waybill', () => {
  const row = orderRow(order({ deliveryType: 'internal', deliveryPartnerId: { userId: { name: 'Fixture Rider' } } }));
  assert.equal(row.courier, 'Bulkimart Delivery · Fixture Rider'); assert.equal(row.tracking, 'Not applicable');
  assert.equal(orderRow(order({ fulfillment: { method: 'manual' } })).courier, 'Bulkimart Delivery');
});

test('pending shipments, cancellations and historical gaps have distinct truthful labels', () => {
  const pending = orderRow(order({ status: 'confirmed', deliveryType: 'shiprocket' }));
  assert.equal(pending.courier, 'Shiprocket · courier pending'); assert.equal(pending.tracking, 'Awaiting tracking number');
  const delivered = orderRow(order({ deliveryType: 'shiprocket' }));
  assert.equal(delivered.courier, 'Courier not recorded'); assert.equal(delivered.tracking, 'Not recorded');
  const unassigned = orderRow(order({ status: 'placed' })); assert.equal(unassigned.courier, 'Awaiting delivery assignment');
  assert.equal(orderRow(order({ status: 'cancelled' })).courier, 'Not assigned');
  assert.equal(orderRow(order()).courier, 'Delivery partner not recorded');
});

test('digital orders do not show a pending physical courier', () => {
  const row = orderRow(order({ items: [{ fulfillmentType: 'digital' }] }));
  assert.equal(row.courier, 'Digital delivery'); assert.equal(row.tracking, 'Not applicable');
});

test('real zero totals stay zero and missing or invalid totals are not fabricated as zero', () => {
  assert.equal(orderRow(order({ pricing: { totalAmount: 0 } })).amount, '₹0');
  for (const totalAmount of [undefined, null, '', 'invalid']) {
    assert.equal(orderRow(order({ pricing: { totalAmount } })).amount, 'Amount not recorded');
  }
});

test('search and order status filters match the corrected display fields', () => {
  const { h } = fixture([order(), order({ orderNo: 'ORD-CANCELLED', status: 'cancelled' })]);
  try {
    h.find(n => n.type === 'select').props.onChange({ target: { value: 'cancelled' } }); h.flush();
    assert.match(text(h.tree), /ORD-CANCELLED/); assert.doesNotMatch(text(h.tree), /ORD-20261026-ABC123/);
    h.find(n => n.type === 'select').props.onChange({ target: { value: 'All' } });
    h.find(n => n.type === 'input').props.onChange({ target: { value: 'ABC123' } }); h.flush();
    assert.match(text(h.tree), /ORD-20261026-ABC123/); assert.doesNotMatch(text(h.tree), /ORD-CANCELLED/);
  } finally { h.close(); }
});

test('loading orders is not reported as an empty order history', () => {
  const { h } = fixture([], true);
  try { assert.match(text(h.tree), /Loading orders/); assert.doesNotMatch(text(h.tree), /No matching records/); } finally { h.close(); }
});

test('Wholesale Orders lists only wholesale orders and refreshes with the same channel filter', () => {
  const loads = [];
  const h = hookHarness(Page, { moduleId: 'wholesale-orders' }, '/admin/wholesale-orders', {
    customerOrders: [order({ orderNo: 'ORD-WHOLESALE-1', salesChannel: 'wholesale' }), order({ orderNo: 'ORD-RETAIL-1', salesChannel: 'retail' })],
    customerOrdersLoading: false, fetchCustomerOrders: filters => loads.push(filters), triggerToast() {},
  });
  try {
    assert.deepEqual(loads, [{ salesChannel: 'wholesale' }]);
    assert.match(text(h.tree), /Wholesale Orders/);
    assert.match(text(h.tree), /ORD-WHOLESALE-1/); assert.doesNotMatch(text(h.tree), /ORD-RETAIL-1/);
    h.click('Refresh'); assert.deepEqual(loads.at(-1), { salesChannel: 'wholesale' });
    assert.equal(h.find(n => n.type === 'button' && /Add New Entry|Export CSV/.test(text(n))), undefined, 'no placeholder actions on order lists');
  } finally { h.close(); }
});
