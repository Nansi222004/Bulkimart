import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { hookHarness } from './componentHarness.mjs';

let vite, Active, Support;
before(async () => {
  vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' });
  Active = (await vite.ssrLoadModule('/src/modules/Delivery/pages/ActiveDeliveryPage.jsx')).default;
  Support = (await vite.ssrLoadModule('/src/modules/Delivery/pages/DeliverySupportPage.jsx')).default;
});
after(async () => { await vite.close(); });
const text = node => node == null || typeof node === 'boolean' ? '' : typeof node !== 'object' ? String(node)
  : [node.props?.children].flat(Infinity).map(text).join(' ');
const order = { orderId: '507f1f77bcf86cd799439011', orderNo: 'CONTACT-FIXTURE', step: 'transit', stage: 'in_transit',
  customerName: 'Fixture Customer', customerPhone: '+91 (98765) 00001', items: [], paymentMethod: 'Prepaid', orderType: 'grocery' };
const storage = { localStorage: { getItem: key => ({ deliveryToken: 'fixture-delivery-token', userToken: 'wrong-customer-token',
  sellerToken: 'wrong-seller-token', deliveryUserProfile: JSON.stringify({ _id: 'fixture-rider' }) })[key] ?? null } };
const harness = (Component, props = {}, overrides = {}) => hookHarness(Component, props, '/delivery/dashboard',
  { activeOrder: order, triggerToast() {}, ...overrides }, storage);

test('Call Customer opens the dialer with the customer phone rather than a success toast', () => {
  const h = harness(Active);
  try {
    const call = h.find(n => n.type === 'a' && text(n).includes('Call Customer'));
    assert.equal(call.props.href, 'tel:+919876500001');
    assert.equal(h.requests.length, 0, 'No call or API message is placed by rendering');
  } finally { h.close(); }
});

for (const phone of [null, 'unknown', 'javascript:alert(1)', '+919876500001;123']) {
  test(`unavailable customer phone cannot produce a broken dialer link: ${phone}`, () => {
    const notices = [], h = harness(Active, {}, { activeOrder: { ...order, customerPhone: phone }, triggerToast: message => notices.push(message) });
    try {
      assert.equal(h.find(n => n.type === 'a' && n.props.href?.startsWith('tel:')), undefined);
      h.find(n => n.type === 'button' && text(n).includes('Call Customer')).props.onClick();
      assert.match(notices[0], /unavailable.*contact support/);
    } finally { h.close(); }
  });
}

test('Chat Support opens over the delivery and returning preserves the delivery form', () => {
  const h = harness(Active);
  try {
    const otp = h.find(n => n.type === 'input' && n.props.maxLength === '4');
    assert.ok(otp); otp.props.onChange({ target: { value: '2468' } }); h.flush();
    h.find(n => n.type === 'button' && text(n).includes('Chat Support')).props.onClick(); h.flush();
    const support = h.find(n => n.type?.name === 'DeliverySupportPage');
    assert.deepEqual(support.props, { orderId: order.orderId, orderNo: order.orderNo });
    assert.equal(window.location.pathname, '/delivery/dashboard');
    h.click('Back to delivery');
    assert.equal(h.find(n => n.type?.name === 'DeliverySupportPage'), undefined);
    assert.equal(h.find(n => n.type === 'input' && n.props.maxLength === '4').props.value, '2468');
  } finally { h.close(); }
});

async function loadSupport(h, tickets = []) {
  h.requests.find(r => r.url.includes('/api/tickets/categories')).resolve({ data: { categories: ['Order / Delivery', 'Other'] } });
  h.requests.find(r => r.url.includes('/api/tickets?')).resolve({ data: tickets });
  await h.settle();
}
const ticket = { _id: '507f1f77bcf86cd799439022', ticketNumber: 'SUPPORT-FIXTURE', subject: 'Delivery help', status: 'OPEN' };
test('support creates an order-linked request with the delivery token and opens its conversation', async () => {
  const h = harness(Support, { orderId: order.orderId, orderNo: order.orderNo });
  try {
    await loadSupport(h);
    h.find(n => n.type === 'textarea').props.onChange({ target: { value: 'Need help finding the customer' } }); h.flush();
    const submitting = h.find(n => n.type === 'form').props.onSubmit({ preventDefault() {} });
    const create = h.requests.find(r => r.options.method === 'POST');
    assert.equal(create.options.headers.Authorization, 'Bearer fixture-delivery-token');
    assert.equal(create.options.body.get('relatedOrder'), order.orderId);
    assert.equal(create.options.body.get('subject'), `Delivery support: ${order.orderNo}`);
    assert.equal(create.options.body.get('description'), 'Need help finding the customer');
    create.resolve({ data: ticket }, 201); await h.settle();
    h.requests.find(r => r.url.endsWith('/api/tickets/' + ticket._id)).resolve({ data: { ticket, messages: [] } });
    await submitting; await h.settle();
    assert.ok(h.find(n => n.type?.name === 'TicketDetailModal'));
  } finally { h.close(); }
});

test('existing support conversations load and send replies through the authenticated delivery API', async () => {
  const h = harness(Support);
  try {
    await loadSupport(h, [ticket]);
    const opening = h.find(n => n.type === 'div' && n.props.onClick && text(n).includes(ticket.subject)).props.onClick();
    h.requests.find(r => r.url.endsWith('/api/tickets/' + ticket._id)).resolve({ data: { ticket, messages: [] } });
    await opening; await h.settle();
    const replying = h.find(n => n.type?.name === 'TicketDetailModal').props.onReply('Still at the customer address');
    const message = h.requests.find(r => r.url.endsWith('/messages'));
    assert.equal(message.options.headers.Authorization, 'Bearer fixture-delivery-token');
    assert.equal(message.options.body.get('message'), 'Still at the customer address');
    message.resolve({ success: true }); await h.settle();
    h.requests.filter(r => r.url.endsWith('/api/tickets/' + ticket._id)).at(-1).resolve({ data: { ticket, messages: [{ _id: 'reply', message: 'Still at the customer address' }] } });
    await replying; await h.settle();
    assert.equal(h.find(n => n.type?.name === 'TicketDetailModal').props.messages[0].message, 'Still at the customer address');
  } finally { h.close(); }
});
