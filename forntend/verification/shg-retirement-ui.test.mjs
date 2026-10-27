import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { hookHarness } from './componentHarness.mjs';

// The SHG storefront is retired: customers are never offered it as a filter or
// shown it as a label, and its old URL patterns are not treated as live pages.
let vite, Orders, customerSession;
before(async () => {
  vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' });
  Orders = (await vite.ssrLoadModule('/src/modules/User/pages/OrdersPage.jsx')).default;
  customerSession = await vite.ssrLoadModule('/src/utils/customerSession.js');
});
after(async () => { await vite.close(); });
const text = (node) => (node == null || typeof node === 'boolean' ? '' : typeof node !== 'object' ? String(node) : [node.props?.children].flat(Infinity).map(text).join(' '));
const options = (select) => [select.props.children].flat(Infinity).filter((n) => n?.type === 'option').map((n) => text(n).trim());

test('My Orders storefront filter offers no SHG Store, and a historical SHG order is not labelled SHG', () => {
  const previous = globalThis.document;
  globalThis.document = Object.assign(new EventTarget(), { visibilityState: 'visible', querySelector: () => null });
  const orders = [
    { _id: '1', orderNo: 'ORD-QUICK', status: 'dispatched', type: 'grocery', items: [{ name: 'Amla', qty: 1 }] },
    { _id: '2', orderNo: 'ORD-LEGACY-1', status: 'delivered', type: 'shg', items: [{ name: 'Clay jar', qty: 1 }] },
  ];
  const h = hookHarness(Orders, {}, '/orders', { orders, fetchOrders() {}, setSelectedOrder() {} });
  try {
    h.find((n) => n.props?.['aria-label'] === 'Open filters').props.onClick(); h.flush();
    const storefront = h.find((n) => n.type === 'label' && /Storefront/.test(text(n)));
    assert.deepEqual(options(storefront.props.children.find((n) => n?.type === 'select')), ['All storefronts', 'Quick', 'Shop All', 'Wholesale']);
    assert.doesNotMatch(text(h.tree), /SHG/);
    assert.match(text(h.tree), /ORD-LEGACY-1/);
  } finally { h.close(); if (previous === undefined) delete globalThis.document; else globalThis.document = previous; }
});

test('retired shg-- category URLs are not public customer pages; live storefront slugs still are', () => {
  assert.equal(customerSession.isPublicCustomerPath('/grocery--fresh'), true);
  assert.equal(customerSession.isPublicCustomerPath('/ecommerce--fashion'), true);
  assert.equal(customerSession.isPublicCustomerPath('/shg--handicrafts'), false);
});
