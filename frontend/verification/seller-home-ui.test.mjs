import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { hookHarness } from './componentHarness.mjs';
let vite, Dashboard, Page, Chart, Bulk, Orders, Earnings, SellerProvider, files;
before(async () => {
  vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' });
  Dashboard = (await vite.ssrLoadModule('/src/modules/Seller/components/DashboardTab.jsx')).default;
  Page = (await vite.ssrLoadModule('/src/modules/Seller/pages/DashboardPage.jsx')).default;
  Chart = (await vite.ssrLoadModule('/src/modules/Seller/components/SellerSalesChart.jsx')).default;
  Bulk = (await vite.ssrLoadModule('/src/modules/Seller/components/BulkUploadModal.jsx')).BulkUploadModal;
  Orders = (await vite.ssrLoadModule('/src/modules/Seller/components/OrdersTab.jsx')).default;
  Earnings = (await vite.ssrLoadModule('/src/modules/Seller/components/EarningsTab.jsx')).default;
  SellerProvider = (await vite.ssrLoadModule('/src/modules/Seller/context/SellerContext.jsx')).SellerProvider;
  files = await vite.ssrLoadModule('/src/modules/Seller/utils/bulkUploadValidation.js');
});
after(async () => vite.close());
const text = n => (n == null || typeof n === 'boolean' ? '' : typeof n !== 'object' ? String(n) : [n.props?.children].flat(Infinity).map(text).join(' ')).replace(/\s+/g, ' ').trim();
const context = extra => ({ selectedTypes: ['ecommerce'], activeMode: 'ecommerce', products: [], orders: [], sellerKpis: { totalRevenue: 360, totalOrders: 5, avgOrderValue: 360, pendingOrders: 3, netEarnings: 357.52 }, ...extra });
test('profile chip is a keyboard accessible button that opens seller profile', async () => {
  const tabs = [], h = hookHarness(Page, {}, '/seller', context({ setActiveTab: tab => tabs.push(tab) }));
  try { const button = h.find(n => n.props?.className === 'seller-profile-chip'); assert.equal(button.type, 'button'); button.props.onClick(); assert.deepEqual(tabs, ['profile']); h.requests.forEach(request => request.resolve({ success: true, data: { count: 0 } })); await h.settle(); }
  finally { h.close(); }
});
test('all KPI cards navigate and pending orders open the matching filter; sales and net earnings have separate values', () => {
  const tabs = [], filters = [], h = hookHarness(Dashboard, {}, '/seller', context({ setActiveTab: value => tabs.push(value), setOrderListState: value => filters.push(value) }));
  try {
    const card = title => h.find(n => n.props?.title === title);
    for (const title of ['Total Revenue', 'Total Orders', 'Average Order Value', 'Pending Orders']) {
      const node = card(title), button = node.type(node.props); assert.equal(button.type, 'button'); button.props.onClick();
    }
    assert.deepEqual(tabs, ['earnings', 'orders', 'salesreport', 'orders']); assert.equal(filters.at(-1).tab, 'pending'); assert.equal(filters.at(-1).scope, 'all');
    assert.equal(card('Total Revenue').props.value, '₹360.00'); assert.match(text(card('Total Revenue')), /Net earnings:.*₹357.52/);
    assert.equal(card('Average Order Value').props.value, '₹360.00'); assert.doesNotMatch(text(h.tree), /-3|Custom ranges disabled/);
  } finally { h.close(); }
});
test('missing historical earnings and sales do not appear as a completed zero', () => {
  const h = hookHarness(Dashboard, {}, '/seller', context({ sellerKpis: { totalRevenue: null, avgOrderValue: null, knownRevenue: 100, revenuePendingOrders: 1, netEarnings: null, knownNetEarnings: 50, netEarningsCalculatedOrders: 1, netEarningsPendingOrders: 1 } }));
  try { assert.equal(h.find(n => n.props?.title === 'Total Revenue').props.value, 'Pending calculation'); assert.match(text(h.tree), /₹50.00 calculated subtotal.*awaiting finance review/); }
  finally { h.close(); }
});
test('store dashboard requests account totals rather than silently scoping to the active channel', async () => {
  const h = hookHarness(SellerProvider, {}, '/seller');
  try {
    h.requests.find(request => request.url.endsWith('/sellers/me')).resolve({ success: true, seller: { _id: 'test-store', status: 'approved', salesChannels: ['ecommerce', 'grocery'] } }); await h.settle();
    const requests = h.requests.filter(request => request.url.includes('/sellers/dashboard'));
    assert.ok(requests.length > 0); assert.ok(requests.every(request => !request.url.includes('type=')));
  } finally { h.close(); }
});
test('Neelam-like missing commission records show sales and pending earnings separately from posted zero balances', () => {
  const metrics = { totalRevenue: 2050, completedOrders: 3, netEarnings: null, knownNetEarnings: 0, netEarningsCalculatedOrders: 0, netEarningsPendingOrders: 3 };
  const h = hookHarness(Earnings, {}, '/seller/earnings', { financeSummary: { salesMetrics: metrics, balances: { held: 0, eligible: 0, settled: 0, earnedEarnings: 0 }, coverage: { unpostedOrders: 3 }, payoutActionsEnabled: false, deliveredSales: { orderCount: 3, grossAmount: 2050, orders: [] } }, ledgerEntries: [] });
  try {
    const summary = h.find(n => n.props?.['aria-label'] === 'Sales and net earnings');
    assert.match(text(summary), /₹2,050.00/); assert.match(text(summary), /Awaiting calculation/); assert.doesNotMatch(text(summary), /₹0.00/);
    assert.match(text(h.tree), /3 delivered orders have not been posted/); assert.match(text(h.tree), /Posted settlement balances/);
    assert.equal(h.find(n => n.type === 'button' && n.props.children === 'Request payout').props.disabled, true);
  } finally { h.close(); }
});
test('sales chart supports hover/focus values and 7 day switching without sample sales', () => {
  const data = Array.from({ length: 30 }, (_, i) => ({ date: `2026-10-${String(i + 1).padStart(2, '0')}`, revenue: i === 29 ? 360 : 0 }));
  const h = hookHarness(Chart, { data });
  try {
    h.find(n => n.type === 'rect' && n.props['aria-label'].includes('2026-10-30')).props.onMouseEnter(); h.flush();
    assert.match(text(h.tree), /30 Oct: ₹360/);
    h.find(n => n.type === 'button' && text(n) === '7 Days').props.onClick(); h.flush();
    assert.equal(h.find(n => n.type === 'rect').props['aria-label'].startsWith('2026-10-24'), true);
    assert.doesNotMatch(text(h.tree), /30 Oct: ₹360/);
  } finally { h.close(); }
});
test('pending orders tab displays only the three actionable stages and requests the pending list', () => {
  const requests = [], h = hookHarness(Orders, {}, '/seller/orders', context({ orderListState: { tab: 'pending' }, fetchSellerOrders: status => requests.push(status), orders: ['placed', 'confirmed', 'preparing', 'dispatched'].map((status, index) => ({ _id: `${index}`, orderNo: `TEST-${status}`, channel: 'ecommerce', status, items: [], customer: {}, shippingAddress: {} })) }));
  try { assert.deepEqual(requests, ['all']); assert.doesNotMatch(text(h.tree), /TEST-dispatched/); assert.match(text(h.tree), /TEST-preparing/); }
  finally { h.close(); }
});
test('bulk upload validates file extension, empty content and limits before making a request', () => {
  assert.match(files.bulkFileError({ name: 'old.xls', size: 12 }, 'sheet'), /not supported/);
  assert.match(files.bulkFileError({ name: 'empty.csv', size: 0 }, 'sheet'), /empty/);
  assert.match(files.bulkFileError({ name: 'large.xlsx', size: files.BULK_SHEET_LIMIT + 1 }, 'sheet'), /10 MB/);
  assert.equal(files.bulkFileError({ name: 'valid.CSV', size: 12 }, 'sheet'), '');
  const h = hookHarness(Bulk);
  try {
    h.find(n => n.type === 'input' && n.props['aria-label'] === 'Product data sheet').props.onChange({ target: { files: [{ name: 'bad.pdf', size: 100 }], value: 'bad.pdf' } }); h.flush();
    assert.match(text(h.tree), /must be an .xlsx or .csv/); assert.equal(h.requests.length, 0);
    assert.equal(h.find(n => n.type === 'button' && n.props.type === 'submit').props.disabled, true);
  } finally { h.close(); }
});
test('bulk upload displays server row validation errors and does not signal a successful import', async () => {
  let successes = 0; const h = hookHarness(Bulk, { onSuccess: () => successes++ });
  try {
    const file = new File(['Product Name,Stock\nTest,-1'], 'test.csv', { type: 'text/csv' });
    h.find(n => n.type === 'input' && n.props['aria-label'] === 'Product data sheet').props.onChange({ target: { files: [file] } }); h.flush();
    const pending = h.find(n => n.type === 'form').props.onSubmit({ preventDefault() {} });
    h.requests[0].resolve({ success: false, message: 'Validation failed', meta: { errors: [{ row: 2, name: 'Test', reason: 'Stock must be zero or more' }] } }, 400);
    await pending; await h.settle(); assert.match(text(h.tree), /Row 2.*Test.*Stock must be zero or more/); assert.match(text(h.tree), /No products were imported/); assert.equal(successes, 0);
  } finally { h.close(); }
});
