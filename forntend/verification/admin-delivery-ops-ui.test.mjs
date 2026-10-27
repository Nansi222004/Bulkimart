import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { hookHarness } from './componentHarness.mjs';

// Delivery Fleet operations screens against GET /api/admin/delivery-live and
// /api/admin/delivery-history(/export). Shallow component harness, not a browser.
let vite, Dashboard, ActiveOps, Tracking, History;
before(async () => {
  vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' });
  Dashboard = await vite.ssrLoadModule('/src/modules/Admin/components/DeliveryDashboardTab.jsx');
  ActiveOps = (await vite.ssrLoadModule('/src/modules/Admin/components/DeliveryActiveOpsTab.jsx')).default;
  Tracking = (await vite.ssrLoadModule('/src/modules/Admin/components/DeliveryTrackingTab.jsx')).default;
  History = (await vite.ssrLoadModule('/src/modules/Admin/components/DeliveryHistoryTab.jsx')).default;
});
after(async () => vite.close());

const text = (node) => (node == null ? '' : typeof node !== 'object' ? String(node) : [node.props?.children].flat(Infinity).map(text).join(' '));
const wait = (ms = 5) => new Promise((resolve) => setTimeout(resolve, ms));
const pump = async (h) => { await wait(); h.flush(); await wait(); return h.flush(); };
const path = (request) => new URL(request.url, 'http://localhost').pathname + new URL(request.url, 'http://localhost').search;
const withDocument = (extra = {}) => {
  const previous = globalThis.document;
  globalThis.document = { visibilityState: 'visible', addEventListener() {}, removeEventListener() {}, ...extra };
  return () => { if (previous === undefined) delete globalThis.document; else globalThis.document = previous; };
};

const trip = (fields) => ({ id: fields.ref, kind: 'order', channel: 'grocery', customer: 'Meera', rider: { id: 'r1', name: 'Asha Rider', phone: '9811100001', vehicle: 'bike' },
  stage: 'picked_up', pickedUp: true, assignedAt: '2026-10-27T10:00:00Z', pickedUpAt: '2026-10-27T10:10:00Z', minutesSinceAssigned: 30, minutesSincePickup: 20,
  etaMinutes: 25, overEta: false, routeKm: 5, remainingKm: 1.2, lastPingAt: '2026-10-27T10:29:00Z', lastPingMinutes: 1, pickupAddress: 'Store Road', dropAddress: 'Home Road', reassignable: false, ...fields });
const live = (trips, summary = {}) => ({ success: true, data: { asOf: '2026-10-27T10:30:00Z',
  summary: { activeTrips: trips.length, byStage: { assigned: 0, accepted: 1, arrived_at_store: 0, picked_up: 1, in_transit: 0, arrived_at_customer: 0 }, prePickup: 1, onTheRoad: 1, overEta: 1,
    awaitingRider: 3, needsManualAssignment: 1, ridersOnline: 4, ridersBusy: 2, ridersFree: 2, deliveredToday: 9, failedToday: 1, todaySuccessRate: 90, ...summary },
  trips, meta: { total: trips.length, shown: trips.length, truncated: false } } });

test('the fleet dashboard Live Dispatch panel shows real dispatch counts instead of the old placeholder', async () => {
  const restore = withDocument();
  const tabs = [];
  const h = hookHarness(Dashboard.LiveDispatchPanel, { setActiveTab: (tab) => tabs.push(tab) }, '/admin/deliverypartner');
  try {
    await pump(h);
    assert.equal(path(h.requests[0]), '/api/admin/delivery-live');
    h.requests[0].resolve(live([trip({ ref: 'ORD-1' })]));
    await pump(h);
    const shown = text(h.tree);
    assert.doesNotMatch(shown, /not tracked yet|stays blank on purpose/);
    assert.match(shown, /Picked up\s*:\s*1/);
    const stat = (label) => h.find((n) => n.props?.label === label);
    assert.equal(stat('Awaiting rider').props.value, 3);
    assert.match(stat('Awaiting rider').props.hint, /1 need manual assignment/);
    assert.equal(stat('Delivered today').props.value, 9);
    assert.match(stat('Delivered today').props.hint, /1 failed · 90% success/);
    stat('Awaiting rider').props.onClick();
    assert.deepEqual(tabs, ['delivery-assignment']);
  } finally { h.close(); restore(); }
});

test('Live Dispatch shows a retryable error rather than zeros when the request fails', async () => {
  const restore = withDocument();
  const h = hookHarness(Dashboard.LiveDispatchPanel, { setActiveTab() {} }, '/admin/deliverypartner');
  try {
    await pump(h);
    h.requests[0].resolve({ success: false, message: 'Database unavailable' }, 500);
    await pump(h);
    assert.match(text(h.tree), /Database unavailable/);
    assert.equal(h.find((n) => n.props?.label === 'Active trips'), undefined);
    h.click('Retry');
    await pump(h);
    assert.equal(h.requests.length, 2);
  } finally { h.close(); restore(); }
});

test('Active Deliveries lists live trips, filters by stage on the server and has no fake status override', async () => {
  const restore = withDocument();
  const tabs = [];
  const h = hookHarness(ActiveOps, {}, '/admin/delivery-active-ops', { setActiveTab: (tab) => tabs.push(tab), triggerToast() {} });
  try {
    await pump(h);
    h.requests[0].resolve(live([trip({ ref: 'ORD-PRE', stage: 'accepted', pickedUp: false, reassignable: true }), trip({ ref: 'ORD-LATE', overEta: true })]));
    await pump(h);
    const shown = text(h.tree);
    assert.match(shown, /ORD-PRE/); assert.match(shown, /ORD-LATE/); assert.match(shown, /Past\s+25\s+min ETA/);
    assert.doesNotMatch(shown, /Manage Status|Advance Delivery Lifecycle/);
    h.click('Picked up (1)');
    await pump(h);
    assert.equal(path(h.requests.at(-1)), '/api/admin/delivery-live?stage=picked_up');
    // The summary still counts every live trip while the table is filtered.
    h.requests.at(-1).resolve(live([trip({ ref: 'ORD-LATE' })], { activeTrips: 2 }));
    await pump(h);
    assert.doesNotMatch(text(h.tree), /ORD-PRE/);
    // Pre-pickup trips hand off to the real assignment board.
    h.click('All (2)');
    await pump(h);
    h.requests.at(-1).resolve(live([trip({ ref: 'ORD-PRE', stage: 'accepted', pickedUp: false, reassignable: true })]));
    await pump(h);
    h.click('View');
    h.click('Reassign in Order Assignment');
    assert.deepEqual(tabs, ['delivery-assignment']);
  } finally { h.close(); restore(); }
});

test('a slow response from an older filter never overwrites a newer one', async () => {
  const restore = withDocument();
  const h = hookHarness(ActiveOps, {}, '/admin/delivery-active-ops', { setActiveTab() {}, triggerToast() {} });
  try {
    await pump(h);
    h.requests[0].resolve(live([trip({ ref: 'ORD-A' })]));
    await pump(h);
    h.click('Picked up (1)');
    await pump(h);
    const older = h.requests.at(-1);
    h.click('Accepted (1)');
    await pump(h);
    h.requests.at(-1).resolve(live([trip({ ref: 'ORD-NEWER', stage: 'accepted' })]));
    await pump(h);
    older.resolve(live([trip({ ref: 'ORD-OLDER' })]));
    await pump(h);
    assert.match(text(h.tree), /ORD-NEWER/);
    assert.doesNotMatch(text(h.tree), /ORD-OLDER/);
  } finally { h.close(); restore(); }
});

test('Delivery Tracking puts trips past their estimate first and filters them on the server', async () => {
  const restore = withDocument();
  const h = hookHarness(Tracking, {}, '/admin/delivery-tracking', { setActiveTab() {}, triggerToast() {} });
  try {
    await pump(h);
    h.requests[0].resolve(live([trip({ ref: 'ORD-ONTIME', minutesSincePickup: 30 }), trip({ ref: 'ORD-LATE', overEta: true, minutesSincePickup: 10 })]));
    await pump(h);
    const shown = text(h.tree);
    assert.ok(shown.indexOf('ORD-LATE') < shown.indexOf('ORD-ONTIME'));
    assert.doesNotMatch(shown, /Escalation Reassign|Alert sent|No data source yet/);
    const checkbox = h.find((n) => n.type === 'input' && n.props.type === 'checkbox');
    checkbox.props.onChange({ target: { checked: true } });
    await pump(h);
    assert.equal(path(h.requests.at(-1)), '/api/admin/delivery-live?overEta=true');
  } finally { h.close(); restore(); }
});

test('Completed Deliveries pages and searches on the server', async () => {
  const restore = withDocument();
  const h = hookHarness(History, {}, '/admin/delivery-history', { triggerToast() {} });
  try {
    await pump(h);
    assert.equal(path(h.requests[0]), '/api/admin/delivery-history?page=1&limit=20');
    h.requests[0].resolve({ success: true, data: [{ id: 'ORD-1', partner: 'Asha', customer: 'Meera', deliveredAt: '2026-10-27T10:00:00Z', durationMin: 75, otpVerified: true, status: 'delivered' }], meta: { page: 1, limit: 20, total: 45, pages: 3 } });
    await pump(h);
    assert.match(text(h.tree), /1h 15m/); assert.match(text(h.tree), /Page\s+1\s+of\s+3/);
    h.click('Next');
    await pump(h);
    assert.equal(path(h.requests.at(-1)), '/api/admin/delivery-history?page=2&limit=20');
    h.requests.at(-1).resolve({ success: true, data: [], meta: { page: 2, limit: 20, total: 45, pages: 3 } });
    await pump(h);
    const input = h.find((n) => n.type === 'input' && n.props.type === 'search');
    input.props.onChange({ target: { value: 'ravi' } });
    h.flush();
    await wait(350); h.flush(); await wait(); h.flush();
    assert.equal(path(h.requests.at(-1)), '/api/admin/delivery-history?search=ravi&page=1&limit=20');
  } finally { h.close(); restore(); }
});

test('Completed Deliveries Export CSV downloads the server file with the active filters', async () => {
  const clicks = [];
  const restore = withDocument({ body: { appendChild() {} }, createElement: () => ({ click() { clicks.push(this.download); }, remove() {} }) });
  const toasts = [];
  const h = hookHarness(History, {}, '/admin/delivery-history', { triggerToast: (message, options) => toasts.push([message, options?.type]) });
  try {
    await pump(h);
    h.requests[0].resolve({ success: true, data: [{ id: 'ORD-1', partner: 'Asha', customer: 'Meera', status: 'failed' }], meta: { total: 1, pages: 1 } });
    await pump(h);
    const status = h.find((n) => n.type === 'select');
    status.props.onChange({ target: { value: 'failed' } });
    await pump(h);
    h.requests.at(-1).resolve({ success: true, data: [{ id: 'ORD-1', partner: 'Asha', customer: 'Meera', status: 'failed' }], meta: { total: 1, pages: 1 } });
    await pump(h);
    const exported = [];
    globalThis.fetch = async (url) => { exported.push(url); return { ok: true, status: 200, headers: new Headers({ 'content-disposition': 'attachment; filename="bulkimart-delivery-history-2026-10-27.csv"' }), blob: async () => new Blob(['"Order ref"\r\n']) }; };
    await h.find((n) => n.type === 'button' && /Export CSV/.test(text(n))).props.onClick();
    assert.match(exported[0], /\/api\/admin\/delivery-history\/export\?status=failed$/);
    assert.deepEqual(clicks, ['bulkimart-delivery-history-2026-10-27.csv']);
    assert.deepEqual(toasts.at(-1), ['Downloaded bulkimart-delivery-history-2026-10-27.csv', undefined]);
    // A failed export reports the error and downloads nothing.
    globalThis.fetch = async () => ({ ok: false, status: 400, json: async () => ({ message: 'Narrow the export' }) });
    await h.find((n) => n.type === 'button' && /Export CSV/.test(text(n))).props.onClick();
    assert.deepEqual(toasts.at(-1), ['Narrow the export', 'error']);
    assert.equal(clicks.length, 1);
  } finally { h.close(); restore(); }
});
