import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { hookHarness } from './componentHarness.mjs';

let vite, Reports, ReportsModule, Charts;
before(async () => {
  vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' });
  ReportsModule = await vite.ssrLoadModule('/src/modules/Admin/components/ReportsTab.jsx');
  Reports = ReportsModule.default;
  Charts = await vite.ssrLoadModule('/src/modules/Admin/components/DashboardCharts.jsx');
});
after(async () => vite.close());
const text = node => node == null || typeof node === 'boolean' ? '' : typeof node !== 'object' ? String(node) : [node.props?.children].flat(Infinity).map(text).join(' ');
const query = request => Object.fromEntries(new URL(request.url, 'http://fixture').searchParams);
const path = request => new URL(request.url, 'http://fixture').pathname;
const metric = amountPaise => ({ amountPaise, status: amountPaise === null ? 'incomplete' : 'complete', verifiedSubtotalPaise: amountPaise ?? 12300, invalidRecords: amountPaise === null ? 1 : 0, basis: 'fixture basis' });
const range = { preset: 'last30', from: '2026-09-28', to: '2026-10-27', days: 30 };
const series = [{ day: '2026-10-26', ordersPlaced: 2, orderValuePaise: 150000, completedOrders: 1, completedSalesPaise: 100000, refundsPaise: 0, refundCount: 0 }, { day: '2026-10-27', ordersPlaced: 1, orderValuePaise: 50000, completedOrders: 1, completedSalesPaise: 50000, refundsPaise: 2000, refundCount: 1 }];
const overview = (extra = {}) => ({ report: 'overview', range, asOf: '2026-10-27T10:00:00Z', series, statuses: [{ key: 'delivered', count: 2 }], vendors: [{ sellerId: 's1', name: 'Alpha Store', merchandisePaise: 140000, orders: 2 }], disclosures: { unattributedCompletedOrders: 0 },
  counts: { totalOrders: 3, cancelledOrders: 0, completedOrders: 2, activeCustomers: 2, activeSellers: 1, deliveriesCompleted: 2, deliveriesFailed: 0, deliverySuccessRate: 1 },
  kpis: { grossOrderValue: metric(200000), cancelledOrderValue: metric(0), completedSales: metric(150000), refunds: { ...metric(2000), count: 1 }, netSales: metric(148000), averageOrderValue: metric(75000),
    platformCommission: metric(null), sellerEarnings: metric(120000), paymentsCaptured: metric(100000), codVerified: metric(50000), pendingRefunds: { ...metric(0), count: 0 } }, ...extra });
const customers = rows => ({ report: 'customers', range, asOf: '2026-10-27T10:00:00Z', series, totals: { registeredCustomers: 10, newRegistrations: 2, activeCustomers: 2, customersWithCompletedOrders: 1, repeatCustomers: 1 },
  rows, meta: { page: 1, limit: 20, total: 45, pages: 3 }, definitions: { activeCustomer: 'fixture' } });
function setup() { return hookHarness(Reports, {}, '/admin/reports', { triggerToast() {} }); }

// The harness renders one component level; each layer is checked through the
// props it passes down, and children are rendered on their own.
const child = (h, type) => h.find(n => n.type === type);
const card = (h, label) => h.find(n => n.type === ReportsModule.MoneyCard && n.props.label === label) || h.find(n => n.type === ReportsModule.CountCard && n.props.label === label);

test('loads the overview for the last 30 days, without any manual-entry action', async () => {
  const h = setup();
  try {
    assert.equal(path(h.requests[0]), '/api/admin/reports/overview'); assert.deepEqual(query(h.requests[0]), { range: 'last30' });
    assert.ok(h.find(n => n.props?.className === 'sa-report-kpi is-skeleton'), 'skeleton while loading');
    h.requests[0].resolve({ success: true, data: overview() }); await h.settle();
    assert.equal(child(h, ReportsModule.Overview).props.data.kpis.grossOrderValue.amountPaise, 200000);
    assert.match(text(h.tree), /28 Sept 2026\s+–\s+27 Oct 2026/);
    assert.equal(h.find(n => n.type === 'button' && /Add New Entry/.test(text(n))), undefined, 'reports cannot be entered manually');
  } finally { h.close(); }
});

test('overview passes each separate measure to its own card and charts', () => {
  const h = hookHarness(ReportsModule.Overview, { data: overview() }, '/admin/reports');
  try {
    assert.equal(card(h, 'Gross order value').props.metric.amountPaise, 200000);
    assert.equal(card(h, 'Net sales').props.metric.amountPaise, 148000);
    assert.equal(card(h, 'Platform commission').props.metric.status, 'incomplete');
    assert.equal(card(h, 'Completed orders').props.value, '2');
    assert.equal(card(h, 'Deliveries completed').props.note, 'Success rate 100.0% · 0 failed');
    assert.equal(h.find(n => n.type === Charts.DashboardBars && /vendor/.test(n.props.title)).props.rows[0].value, 140000);
    assert.equal(h.find(n => n.type === ReportsModule.ColumnChart && n.props.field === 'refundsPaise').props.series.length, 2);
  } finally { h.close(); }
});

test('an incomplete figure shows its verified subtotal, never a guessed total', () => {
  for (const [value, expected, absent] of [[metric(200000), /₹2,000\.00/, /Incomplete/], [metric(null), /Incomplete.*Valid records:\s+₹123\.00.*1\s+need review/s, /₹0\.00/]]) {
    const h = hookHarness(ReportsModule.MoneyCard, { label: 'Fixture', metric: value }, '/admin/reports');
    try { assert.match(text(h.tree), expected); assert.doesNotMatch(text(h.tree), absent); } finally { h.close(); }
  }
});

test('switching tabs and presets requests the matching report; a stale response cannot overwrite the newer one', async () => {
  const h = setup();
  try {
    const first = h.requests[0];
    h.find(n => n.type === 'button' && n.props.role === 'tab' && /Consumer Users/.test(text(n))).props.onClick(); h.flush();
    const second = h.requests.at(-1);
    assert.equal(path(second), '/api/admin/reports/customers');
    assert.deepEqual(query(second), { range: 'last30', status: 'all', sort: 'spend', dir: 'desc', page: '1', limit: '20' });
    second.resolve({ success: true, data: customers([{ id: 'c1', name: 'Asha Buyer', ordersPlaced: 2, completedOrders: 1, spendPaise: 50000 }]) }); await h.settle();
    first.resolve({ success: true, data: overview() }); await h.settle();
    assert.equal(child(h, ReportsModule.Customers).props.data.rows[0].name, 'Asha Buyer');
    assert.equal(child(h, ReportsModule.Overview), undefined, 'late overview response ignored');
    h.find(n => n.type === 'button' && n.props['aria-pressed'] !== undefined && /Last 7 days/.test(text(n))).props.onClick(); h.flush();
    assert.equal(query(h.requests.at(-1)).range, 'last7');
    assert.equal(child(h, ReportsModule.Customers), undefined, 'figures from the previous period are cleared');
  } finally { h.close(); }
});

test('table changes become server parameters: sort, page, filter and debounced search', async () => {
  const h = setup();
  try {
    h.find(n => n.type === 'button' && n.props.role === 'tab' && /Consumer Users/.test(text(n))).props.onClick(); h.flush();
    h.requests.at(-1).resolve({ success: true, data: customers([{ id: 'c1', name: 'Asha Buyer', ordersPlaced: 2, completedOrders: 1, spendPaise: 50000 }]) }); await h.settle();
    const change = patch => { child(h, ReportsModule.Customers).props.onChange(patch); h.flush(); return query(h.requests.at(-1)); };
    assert.deepEqual([change({ sort: 'orders', dir: 'asc', page: 1 }).sort, query(h.requests.at(-1)).dir], ['orders', 'asc']);
    assert.ok(child(h, ReportsModule.Customers), 'same-period paging keeps the table visible while loading');
    assert.equal(change({ page: 2 }).page, '2');
    assert.deepEqual([change({ status: 'repeat', page: 1 }).status, query(h.requests.at(-1)).page], ['repeat', '1']);
  } finally { h.close(); }
  // The table itself: header sort toggles direction; filter and search report back.
  const changes = [], params = { search: '', status: 'all', sort: 'spend', dir: 'desc', page: 1, limit: 20 };
  const table = hookHarness(ReportsModule.TableReport, { tab: 'customers', data: customers([{ id: 'c1', name: 'Asha Buyer', ordersPlaced: 2, completedOrders: 1, spendPaise: 50000 }]), params, onChange: patch => changes.push(patch), loading: false }, '/admin/reports');
  try {
    table.find(n => n.type === 'select').props.onChange({ target: { value: 'new' } });
    assert.deepEqual(changes.at(-1), { status: 'new', page: 1 });
    table.find(n => n.type === 'input' && n.props.type === 'search').props.onChange({ target: { value: 'ash' } }); table.flush();
    assert.equal(changes.length, 1, 'no change per keystroke');
    await new Promise(resolve => setTimeout(resolve, 400)); table.flush();
    assert.deepEqual(changes.at(-1), { search: 'ash', page: 1 });
    const grid = table.find(n => n.type === ReportsModule.DataTable);
    const rendered = hookHarness(ReportsModule.DataTable, grid.props, '/admin/reports');
    try {
      rendered.find(n => n.type === 'button' && text(n).startsWith('Orders placed')).props.onClick();
      assert.deepEqual(changes.at(-1), { sort: 'orders', dir: 'desc', page: 1 });
      rendered.find(n => n.type === 'button' && text(n).startsWith('Completed spend')).props.onClick();
      assert.deepEqual(changes.at(-1), { sort: 'spend', dir: 'asc', page: 1 });
      assert.equal(rendered.find(n => n.type === 'th' && n.props['aria-sort']).props['aria-sort'], 'descending');
      rendered.find(n => n.type === 'button' && text(n) === 'Next').props.onClick();
      assert.deepEqual(changes.at(-1), { page: 2 });
      assert.match(text(rendered.tree), /Asha Buyer/); assert.match(text(rendered.tree), /1\s*–\s*20\s+of\s+45/);
    } finally { rendered.close(); }
  } finally { table.close(); }
});

test('custom range is validated before any request and then applied', async () => {
  assert.equal(ReportsModule.customRangeError('2026-09-10', '2026-09-01', '2026-10-27'), 'The end date must be on or after the start date.');
  assert.equal(ReportsModule.customRangeError('2026-09-01', '2026-11-01', '2026-10-27'), 'The end date cannot be in the future.');
  assert.match(ReportsModule.customRangeError('2025-01-01', '2026-10-01', '2026-10-27'), /366 days/);
  assert.equal(ReportsModule.customRangeError('2026-09-01', '2026-09-30', '2026-10-27'), '');
  const h = setup();
  try {
    h.requests[0].resolve({ success: true, data: overview() }); await h.settle();
    h.find(n => n.type === 'button' && /Custom range/.test(text(n))).props.onClick(); h.flush();
    const count = h.requests.length;
    h.find(n => n.type === 'form').props.onSubmit({ preventDefault() {} }); h.flush();
    assert.match(text(h.tree), /Choose both a start and an end date/); assert.equal(h.requests.length, count);
    const [fromInput, toInput] = h.findAll ? h.findAll(n => n.type === 'input' && n.props.type === 'date') : [h.find(n => n.type === 'input' && n.props.type === 'date')];
    fromInput.props.onChange({ target: { value: '2026-09-01' } }); h.flush();
    const to = [h.find(n => n.type === 'input' && n.props.type === 'date' && n.props.value !== '2026-09-01')].find(Boolean) || toInput;
    to.props.onChange({ target: { value: '2026-09-30' } }); h.flush();
    h.find(n => n.type === 'form').props.onSubmit({ preventDefault() {} }); h.flush();
    assert.deepEqual(query(h.requests.at(-1)), { range: 'custom', from: '2026-09-01', to: '2026-09-30' });
  } finally { h.close(); }
});

test('export downloads the server CSV only after a valid file arrives, and reports failures', async () => {
  const h = setup();
  const saved = { document: globalThis.document, createObjectURL: URL.createObjectURL, revokeObjectURL: URL.revokeObjectURL, fetch: globalThis.fetch };
  try {
    h.requests[0].resolve({ success: true, data: overview() }); await h.settle();
    const clicked = [], urls = [];
    globalThis.document = { createElement: () => ({ click() { clicked.push(this.download); }, remove() {} }), body: { appendChild() {} } };
    URL.createObjectURL = blob => { urls.push(blob); return 'blob:fixture'; }; URL.revokeObjectURL = () => {};
    let exportUrl;
    globalThis.fetch = async url => { exportUrl = url; return new Response('"Date (IST)"\r\n', { status: 200, headers: { 'content-type': 'text/csv', 'content-disposition': 'attachment; filename="bulkimart-platform-report-2026-09-28-to-2026-10-27.csv"' } }); };
    await h.find(n => n.type === 'button' && text(n) === 'Export CSV').props.onClick(); await h.settle();
    assert.equal(path({ url: exportUrl }), '/api/admin/reports/export'); assert.deepEqual(query({ url: exportUrl }), { report: 'overview', range: 'last30' });
    assert.deepEqual(clicked, ['bulkimart-platform-report-2026-09-28-to-2026-10-27.csv']); assert.equal(urls.length, 1);
    assert.match(text(h.tree), /Downloaded bulkimart-platform-report/);
    globalThis.fetch = async () => new Response(JSON.stringify({ message: 'Explicit manage_finance permission is required' }), { status: 403, headers: { 'content-type': 'application/json' } });
    await h.find(n => n.type === 'button' && text(n) === 'Export CSV').props.onClick(); await h.settle();
    assert.match(text(h.tree), /manage_finance permission is required/); assert.equal(clicked.length, 1, 'no download after a failed export');
    assert.doesNotMatch(text(h.tree), /Downloaded/, 'no success message after a failure');
  } finally { Object.assign(URL, { createObjectURL: saved.createObjectURL, revokeObjectURL: saved.revokeObjectURL }); globalThis.document = saved.document; globalThis.fetch = saved.fetch; h.close(); }
});

test('a failed report shows an actionable error and Refresh retries', async () => {
  const h = setup();
  try {
    h.requests[0].resolve({ success: false, message: 'Explicit manage_finance permission is required' }, 403); await h.settle();
    assert.match(text(h.tree), /could not be loaded/); assert.match(text(h.tree), /manage_finance/);
    const count = h.requests.length;
    h.find(n => n.type === 'button' && text(n) === 'Try again').props.onClick(); h.flush();
    assert.equal(h.requests.length, count + 1);
  } finally { h.close(); }
});
