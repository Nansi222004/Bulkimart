import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { hookHarness } from '../tests/service-hookHarness.mjs';
let vite, Panel;
before(async () => {
  vite = await createServer({ configFile: 'vite.return-verification.config.mjs', server: { middlewareMode: true, hmr: false }, appType: 'custom' });
  Panel = (await vite.ssrLoadModule('/src/modules/Seller/components/ReturnPickupPanel.jsx')).default;
});
after(async () => vite?.close());
const row = { _id: '507f1f77bcf86cd799439011', status: 'APPROVED', returnNumber: 'RET-FIXTURE', quantity: 1, pickup: { status: 'NOT_ASSIGNED' } };
const options = { stateReady: true, manual: { available: true, eligibleRiderCount: 1, riders: [{ id: '507f1f77bcf86cd799439012', name: 'Rider One', contact: 'masked 0012', distanceKm: 1, availability: 'On duty' }] }, shiprocket: { available: true } };
const text = n => n == null ? '' : typeof n !== 'object' ? String(n) : [n.props?.children].flat(Infinity).map(text).join(' ');
const button = (h, label) => h.find(n => n.type === 'button' && text(n).trim() === label);
async function setup(extra = {}, data = options) {
  const changes=[];
  const h = hookHarness(Panel, { r: { ...row, ...extra }, onChange: async () => { changes.push(true); } }, '/seller/item-returns');
  h.requests[0].resolve({ data }); await h.settle(); return {h,changes};
}
for (const method of ['MANUAL', 'SHIPROCKET']) test('seller explicitly confirms ' + method + '; selection alone never books', async () => {
  const {h,changes} = await setup();
  try {
    const choose = h.find(n => n.type === 'button' && n.props['aria-pressed'] === false && text(n).includes(method === 'MANUAL' ? 'Manual Delivery' : 'Shiprocket Reverse'));
    choose.props.onClick(); h.flush(); assert.equal(h.requests.length, 1);
    const label = method === 'MANUAL' ? 'Request selected delivery partner' : 'Confirm Shiprocket pickup';
    if (method === 'MANUAL') {
      assert.equal(button(h,label).props.disabled,true);
      await button(h,label).props.onClick(); assert.equal(h.requests.length,1);
      h.find(n=>n.props?.className==='seller-rider-card').props.onClick(); h.flush(); assert.equal(h.requests.length,1);
    }
    const pending = button(h,label).props.onClick();
    const request = h.requests.at(-1); assert.equal(request.options.method,'POST');
    assert.deepEqual(JSON.parse(request.options.body), { pickupMethod: method, ...(method==='MANUAL'?{riderId:options.manual.riders[0].id}:{}) });
    // A second click while the first is in flight never creates a second request.
    await button(h,label).props.onClick(); assert.equal(h.requests.filter(r=>r.options.method==='POST').length,1);
    request.resolve({ message:'Confirmed' }); await h.settle(); h.requests.at(-1).resolve({data:options}); await pending;
    assert.equal(changes.length,1);
  } finally { h.close(); }
});
test('uncertain booking exposes reconciliation, blocks switching, and shows the real AWB', async () => {
  const {h} = await setup({ pickupMethod:'SHIPROCKET', awbNumber:'PROVIDER401', reverseBooking:{state:'uncertain',error:'Refresh before retrying'} }, {stateReady:false,stateReason:'Reconcile the existing pickup'});
  try {
    assert.match(text(h.tree),/PROVIDER401/); assert.match(text(h.tree),/Refresh before retrying/);
    assert.ok(button(h,'Refresh courier tracking'));
    assert.equal(h.find(n=>n.type==='button' && n.props['aria-pressed']!==undefined),undefined);
  } finally {h.close();}
});
test('network error remains visible and disables confirmation until availability is refreshed', async () => {
  const {h}=await setup();
  try {
    h.find(n=>n.type==='button'&&text(n).includes('Shiprocket Reverse')).props.onClick(); h.flush();
    const pending=button(h,'Confirm Shiprocket pickup').props.onClick(); h.requests.at(-1).reject(new Error('offline')); await pending; h.flush();
    assert.match(text(h.tree),/Could not confirm pickup; reload before retrying/);
    assert.equal(button(h,'Confirm Shiprocket pickup'),undefined); assert.ok(button(h,'Refresh availability'));
  } finally {h.close();}
});
test('no riders shows the reason without sending a pickup', async () => {
  const {h}=await setup({}, {...options,manual:{available:false,eligibleRiderCount:0,riders:[],reason:'No on-duty riders nearby'}});
  try {
    h.find(n=>n.type==='button'&&text(n).includes('Manual Delivery')).props.onClick(); h.flush();
    assert.match(text(h.tree),/No on-duty riders nearby/); assert.equal(button(h,'Request selected delivery partner').props.disabled,true);
    assert.equal(h.requests.length,1);
  } finally {h.close();}
});
