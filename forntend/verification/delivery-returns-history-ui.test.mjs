import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { hookHarness } from './componentHarness.mjs';

let vite, DeliveryProvider, History, Returns, socket;
before(async () => {
  vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
  DeliveryProvider = (await vite.ssrLoadModule('/src/modules/Delivery/context/DeliveryContext.jsx')).DeliveryProvider;
  History = (await vite.ssrLoadModule('/src/modules/Delivery/pages/RiderHistoryPage.jsx')).RiderHistoryPage;
  Returns = await vite.ssrLoadModule('/src/modules/Delivery/pages/ReturnPickupsPage.jsx');
  socket = (await vite.ssrLoadModule('/src/utils/socket.js')).socket;
  socket.connect = () => socket;
});
after(async () => vite.close());
const text = node => !node ? '' : typeof node !== 'object' ? String(node) : [node.props?.children].flat(Infinity).map(text).join(' ');
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const storage = () => { const values = new Map(); return { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, String(v)), removeItem: k => values.delete(k), key: i => [...values.keys()][i], get length() { return values.size; } }; };

test('the delivery provider keeps fetchRiderHistory stable across re-renders', () => {
  const h = hookHarness(DeliveryProvider, {}, '/delivery/history', undefined, { localStorage: storage(), sessionStorage: storage() });
  try {
    const first = h.tree.props.value.fetchRiderHistory;
    h.rerender(); h.rerender();
    assert.equal(h.tree.props.value.fetchRiderHistory, first);
  } finally { h.close(); }
});

test('trip history does not reload when the provider re-renders, and ignores a stale filter response', async () => {
  const calls = [];
  const context = { triggerToast() {}, fetchRiderHistory: ({ type }) => { const d = deferred(); calls.push({ type, ...d }); return d.promise; } };
  const h = hookHarness(History, {}, '/delivery/history', context);
  try {
    assert.equal(calls.length, 1); assert.equal(calls[0].type, 'ALL');
    calls[0].resolve({ data: [{ _id: 'a', type: 'DELIVERED', orderNo: 'ORD-1', at: '2026-10-27T10:00:00Z' }] }); await h.settle();
    assert.doesNotMatch(text(h.tree), /Loading/);
    // A provider re-render hands the page a new function identity: nothing reloads.
    for (let i = 0; i < 5; i++) { context.fetchRiderHistory = ({ type }) => { const d = deferred(); calls.push({ type, ...d }); return d.promise; }; h.rerender(); await h.settle(); }
    assert.equal(calls.length, 1, 'no refetch on provider re-render');
    assert.doesNotMatch(text(h.tree), /Loading/);
    // Switching filters reloads; a late answer for the old filter is ignored.
    h.find(n => n.type === 'button' && /Declined/.test(text(n))).props.onClick(); h.flush();
    h.find(n => n.type === 'button' && /Delivered/.test(text(n))).props.onClick(); h.flush();
    assert.deepEqual(calls.map(c => c.type), ['ALL', 'DECLINED_BY_RIDER', 'DELIVERED']);
    calls.at(-1).resolve({ data: [] }); await h.settle();
    calls.at(-2).resolve({ data: [{ _id: 'late', type: 'DECLINED_BY_RIDER', orderNo: 'ORD-LATE' }] }); await h.settle();
    assert.doesNotMatch(text(h.tree), /ORD-LATE/);
  } finally { h.close(); }
});

const active = {
  _id: '507f1f77bcf86cd799439071', returnNumber: 'RET-20261027-SQQDEN', productName: 'Amla', productImage: 'https://fixture.test/amla.webp', quantity: 1,
  orderId: { shippingAddress: { name: 'Nansi', line1: 'b block', city: 'Indore', pincode: '452001', lat: 22.71, lng: 75.86 } },
  sellerId: { businessName: 'Always', storeDetails: { name: 'Always', address: 'MG Road', city: 'Indore', lat: 22.72, lng: 75.87 } },
  pickup: { status: 'ASSIGNED' },
};
const returnsContext = extra => ({ returnPickups: { pending: [], active: [active], history: [] }, fetchReturnPickups: async () => {}, acceptReturnPickup() {}, declineReturnPickup() {},
  generateReturnPickupOtp() {}, verifyReturnPickupOtp() {}, riderLocation: null, ...extra });

test('return pickups list shows request cards that open a full-page pickup', () => {
  const h = hookHarness(Returns.default, {}, '/delivery/returns', returnsContext());
  try {
    const card = h.find(n => n.type === 'button' && n.props.className === 'delivery-return-card is-link');
    assert.match(text(card), /RET-20261027-SQQDEN/); assert.match(text(card), /Collect from customer/); assert.match(text(card), /Open pickup/);
    assert.equal(h.find(n => n.props?.['aria-label'] === "Customer's pickup code" || n.type === 'input'), undefined, 'no code entry in the list');
    card.props.onClick(); h.rerender();
    assert.equal(window.location.pathname, '/delivery/returns/507f1f77bcf86cd799439071');
    assert.equal(h.tree.type, Returns.ReturnPickupDetail); assert.equal(h.tree.props.r._id, active._id);
  } finally { h.close(); }
});

test('an unknown or completed pickup id shows a clear message with a way back', () => {
  const h = hookHarness(Returns.default, {}, '/delivery/returns/507f1f77bcf86cd799439099', returnsContext());
  try {
    assert.match(text(h.tree), /no longer assigned to you/);
    h.find(n => n.type === 'button' && /All return pickups/.test(text(n))).props.onClick(); h.rerender();
    assert.equal(window.location.pathname, '/delivery/returns');
  } finally { h.close(); }
});

test('pickup detail shows both stops and requires the 4-digit code before confirming', () => {
  const confirmed = [], sent = [];
  const props = { r: active, busy: false, riderLocation: null, onSendCode: () => sent.push(1), onConfirm: code => confirmed.push(code) };
  const h = hookHarness(Returns.ReturnPickupDetail, props, '/delivery/returns/' + active._id);
  try {
    const page = text(h.tree);
    assert.match(page, /Pick up from customer/); assert.match(page, /b block, Indore, 452001/);
    assert.match(page, /Drop at seller/); assert.match(page, /MG Road, Indore/);
    const confirm = () => h.find(n => n.type === 'button' && /Confirm pickup/.test(text(n)));
    assert.equal(confirm().props.disabled, true);
    h.find(n => n.type === 'button' && /Send pickup code/.test(text(n))).props.onClick(); assert.equal(sent.length, 1);
    h.find(n => n.type === 'input').props.onChange({ target: { value: '12a3' } }); h.flush();
    assert.equal(h.find(n => n.type === 'input').props.value, '123'); assert.equal(confirm().props.disabled, true);
    h.find(n => n.type === 'input').props.onChange({ target: { value: '1234' } }); h.flush();
    assert.equal(confirm().props.disabled, false); confirm().props.onClick(); assert.deepEqual(confirmed, ['1234']);
    props.r = { ...active, pickup: { status: 'PICKED_UP' } }; h.rerender();
    assert.equal(h.find(n => n.type === 'input'), undefined); assert.match(text(h.tree), /drop this off with\s+Always/);
  } finally { h.close(); }
});

test('parcel jobs read as parcels in trip history and their pay is shown in earnings', async () => {
  const context = { triggerToast() {}, fetchRiderHistory: async () => ({ data: [{ id: 'p1', type: 'DELIVERED', kind: 'parcel', orderNo: '#ABC123', timestamp: '2026-10-27T10:00:00Z', amount: 10.2 }] }) };
  const h = hookHarness(History, {}, '/delivery/history', context);
  try { await h.settle(); const out = text(h.tree); assert.match(out, /Parcel\s+#ABC123/); assert.match(out, /₹\s*10\.2/); assert.doesNotMatch(out, /Order\s+#ABC123/); } finally { h.close(); }

  const Earnings = (await vite.ssrLoadModule('/src/modules/Delivery/pages/EarningsPage.jsx')).EarningsPage;
  const slice = (extra) => ({ trips: 0, total: 0, tips: 0, breakdown: [], days: [], available: true, ...extra });
  const earnings = { payoutBalance: 0, payoutHistory: [], payoutActionsEnabled: false, fetchPayoutHistory() {}, debitWallet: 0, riderProfile: {},
    earningsData: { daily: slice({ trips: 1, total: 10.2, breakdown: [{ id: 'p1', type: 'Parcel delivery', time: '10:00 am', orderId: '#ABC123', amount: 10.2, tip: 0 }] }), weekly: slice({ trips: 1, total: 10.2 }), lifetime: slice({ trips: 4, total: 100 }),
      parcels: { weekTotal: 10.2, lifetimeTrips: 2, lifetimeTotal: 20.4 } } };
  const e = hookHarness(Earnings, {}, '/delivery/earnings', earnings);
  try {
    let out = text(e.tree); assert.match(out, /Parcel deliveries/); assert.match(out, /Parcel\s+#ABC123/);
    e.find(n => n.type === 'button' && n.props.children === 'Lifetime').props.onClick(); e.flush();
    out = text(e.tree); assert.match(out, /₹\s*120\.4/, 'Lifetime total adds parcel pay'); assert.match(out, /\b6\b/, 'Lifetime trips add parcel jobs');
  } finally { e.close(); }
});
