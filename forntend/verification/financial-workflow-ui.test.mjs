import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { hookHarness } from './componentHarness.mjs';
let vite, Admin, Seller, Rider, Earnings, Payments, SellerProvider, portalRequests;
before(async () => {
  vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
  Admin = (await vite.ssrLoadModule('/src/modules/Admin/components/FinanceWorkflowTab.jsx')).default;
  Seller = (await vite.ssrLoadModule('/src/modules/Seller/components/OrderFinancialBreakdown.jsx')).default;
  Rider = (await vite.ssrLoadModule('/src/modules/Delivery/components/DeliveryFinancePanel.jsx')).default;
  Earnings = (await vite.ssrLoadModule('/src/modules/Seller/components/EarningsTab.jsx')).default;
  Payments = (await vite.ssrLoadModule('/src/modules/Seller/components/PaymentHistoryTab.jsx')).default;
  SellerProvider = (await vite.ssrLoadModule('/src/modules/Seller/context/SellerContext.jsx')).SellerProvider;
  portalRequests = await vite.ssrLoadModule('/src/utils/portalRequests.js');
});
after(async () => vite.close());
const body = harness => JSON.stringify(harness.tree, (_key, value) => typeof value === 'function' ? undefined : value);
const flags = enabled => ({ operations: enabled, payouts: enabled, policyApproved: enabled, testsApproved: enabled });
const config = enabled => ({ data: { rules: [], flags: flags(enabled) } });
const field = (harness, label) => {
  const node = harness.find(node => node.type === 'label' && [node.props.children].flat().includes(label));
  assert.ok(node, `Missing label: ${label}`);
  return [node.props.children].flat().find(child => child?.type === 'input' || child?.type === 'select');
};
const change = (harness, label, value) => { field(harness, label).props.onChange({ target: { value } }); harness.flush(); };
const cashRow = { _id: 'order-fixture', orderNo: 'COD-FIXTURE', status: 'delivered', paymentMethod: 'cod',
  financialSnapshot: { expectedPaise: 10000, lines: [] }, exceptions: ['cod_unverified'],
  cash: { expectedPaise: 10000, collectedPaise: 0, reportedPaise: 0, verifiedPaise: 0, outstandingPaise: 0, status: 'expected' } };

test('seller earnings shows unposted delivered sales separately from withdrawable funds', () => {
  const context = { financeSummary: { coverage: {}, balances: { eligible: 0 }, payoutActionsEnabled: false,
    deliveredSales: { orderCount: 2, grossAmount: 1150, orders: [
      { _id: 'legacy', orderNo: 'LEGACY-DELIVERED', grossAmount: 900 },
      { _id: 'new', orderNo: 'NEW-DELIVERED', grossAmount: 250, snapshotVersion: 2, snapshotState: 'configured' },
    ] } }, ledgerEntries: [], fetchSellerFinances() {} };
  const h = hookHarness(Earnings, {}, '/seller/earnings', context);
  try {
    assert.match(body(h), /LEGACY-DELIVERED/); assert.match(body(h), /₹1,150.00/);
    assert.match(body(h), /no financial snapshot/); assert.match(body(h), /Awaiting payment verification and admin allocation/);
    assert.equal(h.find(node => node.type === 'button' && node.props.children === 'Request payout').props.disabled, true);
    assert.equal(h.requests.length, 0);
  } finally { h.close(); }
});

test('payout read failure provides retry without claiming an empty history', () => {
  let retries = 0;
  const h = hookHarness(Payments, {}, '/seller/paymenthistory', { financeSummary: null, financeError: 'Request timed out', fetchSellerFinances() { retries++; } });
  try {
    assert.match(body(h), /Request timed out/); assert.match(body(h), /could not be loaded/);
    assert.doesNotMatch(body(h), /No payout transaction has been recorded/);
    h.click('Refresh'); assert.equal(retries, 1);
  } finally { h.close(); }
});

test('seller finance requests time out, clear loading, and can be retried', async () => {
  portalRequests.clearPortalRequests('seller');
  const originalTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (fn, delay, ...args) => originalTimeout(fn, delay === 10000 ? 25 : delay, ...args);
  const h = hookHarness(SellerProvider, {}, '/seller/paymenthistory', undefined,
    { localStorage: { getItem: key => key === 'sellerToken' ? 'finance-timeout-fixture' : null } });
  try {
    assert.equal(h.tree.props.value.financeLoading, true);
    await new Promise(resolve => originalTimeout(resolve, 50)); await h.settle();
    assert.equal(h.tree.props.value.financeLoading, false);
    assert.match(h.tree.props.value.financeError, /timed out|aborted/i);
    globalThis.setTimeout = originalTimeout;
    const retry = h.tree.props.value.fetchSellerFinances(); h.flush();
    const pending = h.requests.filter(row => row.url.includes('/finances/')).slice(-2);
    pending[0].resolve({ data: { balances: { eligible: 0 }, payouts: [] } });
    pending[1].resolve({ data: [] });
    await retry; await h.settle();
    assert.equal(h.tree.props.value.financeError, '');
    assert.equal(h.tree.props.value.financeLoading, false);
    assert.equal(h.tree.props.value.financeSummary.balances.eligible, 0);
  } finally { globalThis.setTimeout = originalTimeout; portalRequests.clearPortalRequests('seller'); h.close(); }
});

test('late seller finance responses cannot restore balances after a session change', async () => {
  portalRequests.clearPortalRequests('seller');
  let token = 'finance-old-seller';
  const h = hookHarness(SellerProvider, {}, '/seller/paymenthistory', undefined,
    { localStorage: { getItem: key => key === 'sellerToken' ? token : null } });
  try {
    const old = h.requests.filter(row => row.url.includes('/finances/'));
    token = null;
    window.dispatchEvent(new Event('bulkimart:seller-session-changed')); h.flush();
    old[0].resolve({ data: { balances: { eligible: 999 }, payouts: [{ payoutNo: 'OLD-PRIVATE' }] } });
    old[1].resolve({ data: [{ reference: 'OLD-PRIVATE' }] });
    await h.settle();
    assert.equal(h.tree.props.value.financeSummary, null);
    assert.deepEqual(h.tree.props.value.ledgerEntries, []);
    assert.equal(h.tree.props.value.financeLoading, false);
  } finally { portalRequests.clearPortalRequests('seller'); h.close(); }
});

test('commission editor starts without invented rates and never posts on load', async () => {
  const h = hookHarness(Admin); try {
    h.requests[0].resolve(config(false)); await h.settle();
    assert.equal(field(h, 'Approved value').props.value, ''); assert.equal(field(h, 'Approved tax rate (%)').props.value, '');
    assert.match(body(h), /disabled pending policy/); assert.equal(h.requests.filter(row => row.options.method === 'POST').length, 0);
  } finally { h.close(); }
});
test('commission form saves explicit version data and displays backend validation errors', async () => {
  const h = hookHarness(Admin); try {
    h.requests[0].resolve(config(false)); await h.settle();
    change(h, 'Approved value', '10'); change(h, 'Approved tax rate (%)', '0'); change(h, 'Tax treatment', 'exempt');
    change(h, 'Effective date and time', '2026-01-01T12:00'); change(h, 'Change reason', 'Synthetic fixture only');
    h.find(node => node.type === 'form').props.onSubmit({ preventDefault() {} }); h.flush();
    assert.equal(h.requests.filter(row => row.options.method === 'POST').length, 0, 'Review must precede persistence');
    h.find(node => node.type?.name === 'FinanceReview').props.onConfirm(); h.flush();
    const pending = h.requests.find(row => row.options.method === 'POST'); assert.ok(pending);
    const payload = JSON.parse(pending.options.body);
    assert.equal(payload.value, 10); assert.equal(payload.taxRate, 0); assert.equal(payload.isActive, false);
    assert.equal(payload.base, 'eligible_item_subtotal'); assert.equal(payload.fixedScope, 'order_item'); assert.equal(payload.supersedes, null);
    pending.resolve({ message: 'Commission changed; refresh before saving' },409); await h.settle();
    assert.match(body(h), /Commission changed/); assert.equal(field(h, 'Approved value').props.value, '10');
  } finally { h.close(); }
});
test('COD actions remain disabled until server release gates are satisfied', async () => {
  const h = hookHarness(Admin); try {
    h.requests[0].resolve(config(false)); await h.settle(); h.click('COD reconciliation');
    h.requests[1].resolve(config(false)); await h.settle();
    h.requests[2].resolve({ data: [{ ...cashRow, cash: { ...cashRow.cash, status:'remittance_reported' } }], meta:{ pages:1 } }); await h.settle();
    assert.equal(h.find(node => node.type === 'button' && node.props.children === 'Verify cash evidence').props.disabled, true);
    assert.equal(h.requests.filter(row=>row.options.method==='POST').length,0);
  } finally { h.close(); }
});
test('seller per-order view renders frozen commission version and fees separately', async () => {
  const h = hookHarness(Seller,{orderId:'fixture'},'/seller/orders/fixture'); try {
    h.requests[0].resolve({data:{merchandise:{currency:'INR',components:{deliveryPaise:2000},lines:[{itemId:'line',grossPaise:10000,eligiblePaise:9000,allocatedDiscounts:{couponDiscount:1000},rule:{version:'FROZEN-V1',method:'percentage',value:10,taxTreatment:'exempt',taxRate:0},commissionPaise:900,taxPaise:0,netPaise:8100}]},financialPosting:'held',snapshot:null,entries:[]}});
    await h.settle(); assert.match(body(h),/FROZEN-V1/); assert.match(body(h),/₹81.00/); assert.match(body(h),/₹20.00/);
    assert.match(h.requests[0].url,/financial-breakdown/); assert.equal(h.requests.filter(row=>row.options.method==='POST').length,0);
  } finally { h.close(); }
});
test('seller historical order never invents a commission and supports a failed-read retry', async () => {
  const h=hookHarness(Seller,{orderId:'fixture'},'/seller/orders/fixture');try{
    h.requests[0].resolve({message:'Temporarily unavailable'},503);await h.settle();assert.match(body(h),/Temporarily unavailable/);
    h.click('Retry');h.requests[1].resolve({data:{merchandise:null,snapshot:null,entries:[]}});await h.settle();assert.match(body(h),/no versioned commission snapshot/);
  }finally{h.close();}
});
test('rider cash screen separates custody from earnings and disables unapproved reporting', async () => {
  const h=hookHarness(Rider,{},'/delivery/earnings');try{
    h.requests[0].resolve({data:[cashRow],meta:{pages:1}});h.requests[1].resolve({data:{rows:[],balances:[{_id:{account:'rider_payable',bucket:'held'},amount:40}],total:0,limit:50,flags:flags(false)}});h.requests[2].resolve({data:[],meta:{pages:1}});await h.settle();
    assert.match(body(h),/COD-FIXTURE/);assert.match(body(h),/₹100.00/);assert.match(body(h),/₹40.00/);
    assert.equal(h.find(node=>node.type==='button'&&node.props.children==='Report cash collection').props.disabled,true);
  }finally{h.close();}
});
test('rider collection is an explicit evidenced request and preserves errors without claiming receipt', async () => {
  const h=hookHarness(Rider,{},'/delivery/earnings');try{
    h.requests[0].resolve({data:[cashRow],meta:{pages:1}});h.requests[1].resolve({data:{rows:[],balances:[],total:0,limit:50,flags:flags(true)}});h.requests[2].resolve({data:[],meta:{pages:1}});await h.settle();h.click('Report cash collection');
    change(h,'Amount (INR)','99');change(h,'Collection or handover evidence reference','CASH-TEST');change(h,'Collection or handover details','Synthetic fixture report');
    h.find(node=>node.type==='form').props.onSubmit({preventDefault(){}});h.flush();
    const pending=h.requests.find(row=>row.options.method==='POST');assert.ok(pending);assert.deepEqual(JSON.parse(pending.options.body),{amount:99,reference:'CASH-TEST',reason:'Synthetic fixture report',method:'cash'});
    pending.resolve({message:'Collected amount must match expected COD exactly'},409);await h.settle();assert.match(body(h),/must match expected COD exactly/);assert.equal(field(h,'Amount (INR)').props.value,'99');
  }finally{h.close();}
});
