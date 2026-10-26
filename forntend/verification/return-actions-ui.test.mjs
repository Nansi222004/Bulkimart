import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { hookHarness } from '../tests/service-hookHarness.mjs';
let vite, Returns;
before(async () => {
  vite = await createServer({ configFile: 'vite.return-verification.config.mjs', server: { middlewareMode: true, hmr: false }, appType: 'custom' });
  Returns = (await vite.ssrLoadModule('/src/modules/Seller/components/SellerReturnsTab.jsx')).default;
});
after(async () => vite?.close());
const row = { _id: 'fixture', status: 'APPROVED', returnNumber: 'RET-FIXTURE', quantity: 1, pickup: { status: 'NOT_ASSIGNED' } };
const text = n => n == null ? '' : typeof n !== 'object' ? String(n) : [n.props?.children].flat(Infinity).map(text).join(' ');
async function setup(extra = {}) {
  const h = hookHarness(Returns, {}, '/seller/returns', { selectedTypes: ['quick'] });
  h.requests[0].resolve({ data: [{ ...row, ...extra }] }); await h.settle(); return h;
}
for (const method of ['MANUAL', 'SHIPROCKET']) test(`seller explicitly confirms ${method}; selection alone never books`, async () => {
  const h = await setup();
  try {
    assert.equal(h.find(n => n.type === 'select' && n.props['aria-label'] === 'Pickup method').props.value, '');
    assert.equal(h.find(n => n.type === 'button' && n.props.children === 'Confirm pickup method').props.disabled, true);
    h.click('Confirm pickup method'); assert.equal(h.requests.length, 1);
    h.find(n => n.type === 'select' && n.props['aria-label'] === 'Pickup method').props.onChange({ target: { value: method } }); h.flush();
    assert.equal(h.requests.length, 1);
    const pending = h.click('Confirm pickup method');
    const request = h.requests.at(-1); assert.equal(request.options.method, 'POST'); assert.deepEqual(JSON.parse(request.options.body), { pickupMethod: method });
    request.resolve({ message: 'Confirmed' }); await h.settle(); h.requests.at(-1).resolve({ data: [row] }); await pending;
  } finally { h.close(); }
});
test('uncertain booking exposes reconciliation, blocks switching, and shows the real AWB', async () => {
  const h = await setup({ pickupMethod: 'SHIPROCKET', awbNumber: 'PROVIDER401', reverseBooking: { state: 'uncertain', error: 'Refresh before retrying' } });
  try { assert.match(text(h.tree), /PROVIDER401/); assert.match(text(h.tree), /Refresh before retrying/); assert.ok(h.find(n => n.type === 'button' && n.props.children === 'Refresh courier tracking')); assert.equal(h.find(n => n.type === 'select' && n.props['aria-label'] === 'Pickup method'), undefined); }
  finally { h.close(); }
});
test('network error remains visible and never claims a completed pickup', async () => {
  const h = await setup();
  try {
    h.find(n => n.type === 'select' && n.props['aria-label'] === 'Pickup method').props.onChange({ target: { value: 'SHIPROCKET' } }); h.flush();
    const pending = h.click('Confirm pickup method'); h.requests.at(-1).reject(new Error('offline')); await pending; h.flush();
    assert.match(text(h.tree), /Could not confirm pickup; reload before retrying/);
  } finally { h.close(); }
});
