import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { hookHarness } from './service-hookHarness.mjs';
let vite, Review, refs;
before(async () => {
  vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
  Review = (await vite.ssrLoadModule('/src/modules/User/components/CommittedCheckoutReview.jsx')).default;
  refs = await vite.ssrLoadModule('/src/utils/committedCheckout.js');
});
after(async () => { await vite.close(); });
function storage(initial = {}) {
  const data = { ...initial };
  return { getItem: key => data[key] ?? null, setItem: (key, value) => { data[key] = String(value); }, removeItem: key => { delete data[key]; } };
}
const reference = { version: 1, customerId: 'customer-a', operation: 'unified', key: 'original-checkout-attempt-0001' };
function setup() {
  const local = storage({ userToken: 'fixture-session' });
  const dismissed = [], navigations = [];
  const h = hookHarness(Review, { reference, onResolved: key => dismissed.push(key), onOrders: () => navigations.push('orders') }, '/checkout', null, { localStorage: local });
  refs.rememberCommittedCheckout(reference.customerId, reference.operation, reference.key);
  return { h, local, dismissed, navigations };
}
function text(node) {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node !== 'object') return String(node);
  return [node.props?.children].flat(Infinity).map(text).join(' ');
}
async function committed(h) {
  const request = h.requests[0];
  assert.equal(request.options.headers['Idempotency-Key'], reference.key);
  assert.deepEqual(JSON.parse(request.options.body), { operation: 'unified' });
  request.resolve({ data: { state: 'completed', orders: [{ _id: 'owned-order', orderNo: 'ORDER-FIXTURE' }], payment: { id: 'owned-payment', status: 'pending' } } });
  await h.settle();
  assert.match(h.requests[1].url, /\/api\/payments\/owned-order\/status$/);
}
test('references contain only locators, survive reload, isolate accounts and retain every unresolved attempt', () => {
  const previous = globalThis.localStorage; globalThis.localStorage = storage();
  try {
    refs.rememberCommittedCheckout('customer-a', 'unified', reference.key);
    refs.rememberCommittedCheckout('customer-a', 'unified', reference.key);
    refs.rememberCommittedCheckout('customer-a', 'single', 'second-original-attempt-0002');
    assert.equal(refs.committedCheckouts('customer-a').length, 2);
    assert.deepEqual(Object.keys(refs.committedCheckouts('customer-a')[0]).sort(), ['customerId', 'key', 'operation', 'version']);
    assert.deepEqual(refs.committedCheckouts('customer-b'), []);
    assert.deepEqual(refs.committedCheckouts(null), []);
    localStorage.setItem('bulkimart:committed-checkout:customer-b', JSON.stringify([reference]));
    assert.deepEqual(refs.committedCheckouts('customer-b'), []);
    refs.forgetCommittedCheckout('customer-a', reference.key);
    assert.equal(refs.committedCheckouts('customer-a').length, 1);
    localStorage.setItem('bulkimart:committed-checkout:customer-a', '{invalid');
    assert.deepEqual(refs.committedCheckouts('customer-a'), []);
  } finally { globalThis.localStorage = previous; }
});

for (const status of ['pending', 'paid', 'failed', 'refunded', 'partial_refund']) {
  test(`server ${status} determines review; only resolved outcomes offer explicit dismissal`, async () => {
    const { h, dismissed, navigations } = setup();
    try {
      await committed(h);
      h.requests[1].resolve({ data: { method: 'online', status, amount: 440, reconciliationRequired: false } }); await h.settle();
      assert.match(text(h.tree), /ORDER-FIXTURE/);
      assert.match(text(h.tree), new RegExp(`Server payment status:.*${status}`));
      assert.equal(Boolean(h.find(n => n.type === 'button' && String(n.props.children).startsWith('Done'))), status !== 'pending');
      assert.equal(refs.committedCheckouts('customer-a').length, 1);
      h.click('View My Orders'); assert.deepEqual(navigations, ['orders']);
      assert.equal(refs.committedCheckouts('customer-a').length, 1);
      if (status !== 'pending') { h.find(n => n.type === 'button' && String(n.props.children).startsWith('Done')).props.onClick(); assert.deepEqual(dismissed, [reference.key]); }
    } finally { h.close(); }
  });
}
test('uncertain attempt blocks dismissal even when another attempt reports failed', async () => {
  const { h } = setup();
  try {
    await committed(h); h.requests[1].resolve({ data: { method: 'online', status: 'failed', amount: 440, reconciliationRequired: true } }); await h.settle();
    assert.match(text(h.tree), /outcome requires review/);
    assert.equal(h.find(n => n.type === 'button' && String(n.props.children).startsWith('Done')), undefined);
    assert.equal(h.requests.filter(r => r.url.endsWith('/initiate') || /\/api\/orders$/.test(r.url)).length, 0);
  } finally { h.close(); }
});
for (const failure of ['missing', 'expired', 'server', 'network']) {
  test(`${failure} recovery remains reviewable, never retries checkout and retains its locator`, async () => {
    const { h } = setup();
    try {
      if (failure === 'server') h.requests[0].resolve({ message: 'Status unavailable' }, 503);
      else if (failure === 'network') h.requests[0].reject(new Error('Request timed out. Check your connection and retry.'));
      else h.requests[0].resolve({ data: { state: failure === 'missing' ? 'not_found' : 'unavailable' } });
      await h.settle(); assert.match(text(h.tree), /temporarily unavailable/);
      assert.equal(refs.committedCheckouts('customer-a').length, 1);
      h.click('Retry Status Check');
      assert.equal(h.requests.length, 2);
      assert.equal(h.requests[1].options.headers['Idempotency-Key'], reference.key);
      assert.equal(h.requests.filter(r => r.url.endsWith('/initiate')).length, 0);
    } finally { h.close(); }
  });
}
test('duplicate status clicks share one request, unmount aborts and late responses cannot update state', async () => {
  const { h } = setup();
  try {
    h.find(n => n.type === 'button' && n.props.disabled).props.onClick();
    assert.equal(h.requests.length, 1);
    h.unmount(); const updates = h.updates;
    assert.equal(h.requests[0].options.signal.aborted, true);
    h.requests[0].resolve({ data: { state: 'completed', orders: [{ _id: 'late-order' }] } }); await h.settle();
    assert.equal(h.updates, updates); assert.equal(h.requests.length, 1);
  } finally { h.close(); }
});
test('account change while checking ignores the previous customer response', async () => {
  const { h, local } = setup();
  try {
    local.setItem('userToken', 'another-customer-session');
    h.requests[0].resolve({ data: { state: 'completed', orders: [{ _id: 'private-order' }] } }); await h.settle();
    assert.equal(h.requests.length, 1); assert.doesNotMatch(text(h.tree), /private-order/);
  } finally { h.close(); }
});

test('a stalled status request reaches its shared deadline without losing recovery or initializing payment', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { h } = setup();
  try {
    t.mock.timers.tick(10001); await h.settle();
    assert.equal(h.requests[0].options.signal.aborted, true);
    assert.match(text(h.tree), /temporarily unavailable/);
    assert.ok(h.find(n => n.props?.children === 'Retry Status Check'));
    assert.equal(refs.committedCheckouts('customer-a').length, 1);
    assert.equal(h.requests.length, 1);
  } finally { h.close(); t.mock.timers.reset(); }
});
