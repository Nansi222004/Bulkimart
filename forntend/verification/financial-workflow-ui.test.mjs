import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { hookHarness } from './componentHarness.mjs';
let vite, Admin, Seller, Rider, Earnings, Payments, MoneyRequest, SellerProvider, portalRequests;
before(async () => {
  vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
  Admin = (await vite.ssrLoadModule('/src/modules/Admin/components/FinanceWorkflowTab.jsx')).default;
  Seller = (await vite.ssrLoadModule('/src/modules/Seller/components/OrderFinancialBreakdown.jsx')).default;
  Rider = (await vite.ssrLoadModule('/src/modules/Delivery/components/DeliveryFinancePanel.jsx')).default;
  Earnings = (await vite.ssrLoadModule('/src/modules/Seller/components/EarningsTab.jsx')).default;
  Payments = (await vite.ssrLoadModule('/src/modules/Seller/components/PaymentHistoryTab.jsx')).default;
  MoneyRequest = (await vite.ssrLoadModule('/src/modules/Seller/components/MoneyRequestTab.jsx')).default;
  SellerProvider = (await vite.ssrLoadModule('/src/modules/Seller/context/SellerContext.jsx')).SellerProvider;
  portalRequests = await vite.ssrLoadModule('/src/utils/portalRequests.js');
});
after(async () => vite.close());
const body = harness => JSON.stringify(harness.tree, (_key, value) => typeof value === 'function' ? undefined : value);
const flags = enabled => ({ operations: enabled, payouts: enabled, policyApproved: enabled, testsApproved: enabled });
const config = enabled => ({ data: { rules: [], flags: flags(enabled) } });
const finance = () => ({ balances: { earnedEarnings: 0, pending: 0, held: 0, eligible: 0, reserved: 0, settled: 0, quickFreightObligations: 0, bulkimartServiceFees: 0 }, payouts: [], payoutActionsEnabled: false, deliveredSales: { orderCount: 0, grossAmount: 0, orders: [] } });
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
    assert.match(body(h), /no financial snapshot/); assert.match(body(h), /Waiting for payment confirmation/);
    assert.match(body(h), /Coupons and coins are paid by Bulkimart/);
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

// Seller finances load only for an approved seller on a finance tab, so the
// provider's profile request is answered first.
const approveSeller = async h => {
  const profile = h.requests.find(row => row.url.endsWith('/sellers/me'));
  assert.ok(profile, 'Seller profile request missing');
  profile.resolve({ success: true, seller: { _id: 'fixture-seller', status: 'approved' } }); await h.settle();
};
test('seller finances are not requested until the seller is approved', async () => {
  portalRequests.clearPortalRequests('seller');
  const h = hookHarness(SellerProvider, {}, '/seller/earnings', undefined, { localStorage: { getItem: key => key === 'sellerToken' ? 'finance-gate-fixture' : null } });
  try {
    assert.equal(h.requests.filter(row => row.url.includes('/finances/')).length, 0);
    h.requests.find(row => row.url.endsWith('/sellers/me')).resolve({ success: true, seller: { _id: 'fixture-seller', status: 'pending' } }); await h.settle();
    assert.equal(h.requests.filter(row => row.url.includes('/finances/')).length, 0);
  } finally { portalRequests.clearPortalRequests('seller'); h.close(); }
});

test('seller finance requests time out, clear loading, and can be retried', async () => {
  portalRequests.clearPortalRequests('seller');
  const originalTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (fn, delay, ...args) => originalTimeout(fn, delay === 10000 ? 25 : delay, ...args);
  const h = hookHarness(SellerProvider, {}, '/seller/paymenthistory', undefined,
    { localStorage: { getItem: key => key === 'sellerToken' ? 'finance-timeout-fixture' : null } });
  try {
    await approveSeller(h);
    assert.equal(h.tree.props.value.financeLoading, true);
    await new Promise(resolve => originalTimeout(resolve, 50)); await h.settle();
    assert.equal(h.tree.props.value.financeLoading, false);
    assert.match(h.tree.props.value.financeError, /timed out|aborted/i);
    globalThis.setTimeout = originalTimeout;
    const retry = h.tree.props.value.fetchSellerFinances(); h.flush();
    const pending = h.requests.filter(row => row.url.includes('/finances/')).slice(-2);
    pending[0].resolve({ data: finance() });
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
    await approveSeller(h);
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

for (const ComponentName of ['Earnings', 'MoneyRequest', 'Payments']) {
  test(ComponentName + ' distinguishes missing/error finance reads from genuine zero and empty history', () => {
    const Component = { Earnings, MoneyRequest, Payments }[ComponentName];
    for (const error of ['', 'Ledger service unavailable']) {
      let refreshes = 0;
      const h = hookHarness(Component, {}, '/seller/earnings', { financeSummary: null, ledgerEntries: [], financeError: error, fetchSellerFinances() { refreshes++; } });
      try {
        assert.doesNotMatch(body(h), /₹0\.00|No payout requests\.|No payout transaction has been recorded\.|No earnings have been posted/);
        assert.ok(h.find(n => n.props?.role === (error ? 'alert' : 'status')));
        h.click('Refresh'); assert.equal(refreshes, 1);
      } finally { h.close(); }
    }
    const h = hookHarness(Component, {}, '/seller/earnings', { financeSummary: finance(), ledgerEntries: [], fetchSellerFinances() {} });
    try {
      assert.match(body(h), ComponentName === 'Payments' ? /No payout transaction has been recorded/ : /₹0\.00/);
    } finally { h.close(); }
  });
}

test('loading payout balances never display an initial zero or accept a withdrawal', () => {
  const h = hookHarness(MoneyRequest, {}, '/seller/moneyrequest', { financeLoading: true, financeSummary: null });
  try { assert.match(body(h), /Loading payout balances/); assert.doesNotMatch(body(h), /₹0\.00|No eligible balance/); assert.equal(h.find(n => n.type === 'form'), undefined); }
  finally { h.close(); }
});

test('payout UI respects disabled server actions even with a positive eligible balance', () => {
  const summary = finance(); summary.balances.eligible = 50;
  const h = hookHarness(MoneyRequest, {}, '/seller/moneyrequest', { financeSummary: summary, payoutAmount: '10' });
  try { assert.equal(h.find(n => n.type === 'button' && n.props.type === 'submit').props.disabled, true); assert.match(body(h), /currently disabled/); }
  finally { h.close(); }
});

test('payout form locks repeated submission while retaining manual transfer wording', () => {
  const summary = finance(); summary.balances.eligible = 50; summary.payoutActionsEnabled = true;
  const h = hookHarness(MoneyRequest, {}, '/seller/moneyrequest', { financeSummary: summary, payoutAmount: '10', payoutSubmitting: true });
  try { assert.equal(h.find(n=>n.type==='button' && n.props.type==='submit').props.disabled,true); assert.match(body(h),/Submitting request|manually outside/); }
  finally { h.close(); }
});

test('payout intent survives retries and is isolated by seller and amount', async () => {
  const { payoutIntent } = await vite.ssrLoadModule('/src/modules/Seller/utils/payoutIntent.js');
  const values = new Map(), storage = { getItem: key => values.get(key), setItem: (key,value)=>values.set(key,value), removeItem: key=>values.delete(key) };
  const first = payoutIntent(storage,'seller-a',10,()=> 'attempt-1');
  assert.equal(payoutIntent(storage,'seller-a',10,()=> 'unused').key,first.key);
  assert.notEqual(payoutIntent(storage,'seller-b',10,()=> 'attempt-2').key,first.key);
  assert.notEqual(payoutIntent(storage,'seller-a',20,()=> 'attempt-3').key,first.key);
  first.complete(); assert.equal(payoutIntent(storage,'seller-a',10,()=> 'new-action').key,'seller-payout:new-action');
});

test('customer order discount rows show canonical coupon once and preserve legacy display', async () => {
  const {orderDiscountRows} = await vite.ssrLoadModule('/src/utils/orderDiscounts.js');
  assert.deepEqual(orderDiscountRows({discountRepresentation:'components-v1',discount:0,couponDiscount:10,coinDiscount:5}),[['Coupon discount',10],['Coins discount',5]]);
  assert.deepEqual(orderDiscountRows({discount:10,couponDiscount:10}),[['Total Discount',10]]);
});

test('actual payout handler suppresses double clicks and reuses the request key after an ambiguous failure', async () => {
  portalRequests.clearPortalRequests('seller');
  const values = new Map(), storage = { getItem:key=>values.get(key), setItem:(key,value)=>values.set(key,value), removeItem:key=>values.delete(key) };
  const h = hookHarness(SellerProvider, {}, '/seller/moneyrequest', undefined, { sessionStorage: storage, localStorage: { getItem:key=>key==='sellerToken'?'payout-intent-token':null } });
  try {
    const profile = h.requests.find(row=>row.url.endsWith('/sellers/me'));
    profile.resolve({seller:{_id:'fixture-seller',status:'approved'}}); await h.settle();
    const summary = finance(); summary.payoutActionsEnabled=true; summary.balances.eligible=50;
    const reads = h.requests.filter(row=>row.url.includes('/finances/'));
    reads[0].resolve({success:true,data:summary}); reads[1].resolve({success:true,data:[]}); await h.settle();
    h.tree.props.value.setPayoutAmount('10'); h.flush();
    const first = h.tree.props.value.handleRequestPayout({preventDefault(){}}); h.flush();
    assert.equal((await h.tree.props.value.handleRequestPayout({preventDefault(){}})).ok,false);
    const post = h.requests.filter(row=>row.url.endsWith('/sellers/payouts'));
    assert.equal(post.length,1); assert.equal(h.tree.props.value.payoutSubmitting,true);
    post[0].reject(new Error('Lost response after submission')); await first; await h.settle();
    const retry = h.tree.props.value.handleRequestPayout({preventDefault(){}}); h.flush();
    const attempts = h.requests.filter(row=>row.url.endsWith('/sellers/payouts'));
    assert.equal(attempts.length,2); assert.equal(attempts[0].options.headers['Idempotency-Key'],attempts[1].options.headers['Idempotency-Key']);
    attempts[1].resolve({success:false,message:'Unavailable'},503); await retry; await h.settle();
    assert.equal(h.tree.props.value.payoutSubmitting,false); assert.equal(values.size,1);
  } finally { portalRequests.clearPortalRequests('seller'); h.close(); }
});

test('discount funding blocker is a visible hold rather than invented zero net or malformed response', async () => {
  const h = hookHarness(Seller,{orderId:'discount-held'},'/seller/orders');
  try {
    h.requests[0].resolve({success:true,data:{entries:[],merchandise:{currency:'INR',state:'held_discount_policy',components:{deliveryPaise:0},lines:[{itemId:'line',itemName:'Amla',qty:1,grossPaise:10000,eligiblePaise:9000,allocatedDiscounts:{couponDiscount:1000},rule:{version:'fixture'},blocker:'Discount funding policy is not approved'}]}}});
    await h.settle(); assert.match(body(h),/Discount funding policy is not approved/); assert.doesNotMatch(body(h),/financial data is incomplete/);
  } finally { h.close(); }
});

test('historical Admin evidence view is read-only and keeps unresolved entitlement visible', async () => {
  const Historical = (await vite.ssrLoadModule('/src/modules/Admin/components/HistoricalFinancePanel.jsx')).default;
  const h = hookHarness(Historical,{},'/admin/finance-center');
  try {
    assert.equal(h.requests.length,2); assert.match(h.requests[0].url,/historical-exceptions/); assert.match(h.requests[1].url,/historical-batches$/);
    h.requests[0].resolve({success:true,data:{mode:'dry-run',limit:50,totalOrders:1,rows:[{idempotencyKey:'HISTORICAL-TEST',orderId:'507f1f77bcf86cd799439011',orderNo:'LEGACY-TEST',sellerId:'seller',itemId:'507f1f77bcf86cd799439012',classification:'missing_payment_evidence',reasons:['missing_payment_evidence'],evidenceHash:'hash',evidence:{price:50,qty:2,returns:[],payouts:[],unattributedEntries:[],payment:{method:'cod',status:'paid',legacyCapturePresent:true}}}]}});
    h.requests[1].resolve({success:true,data:{batches:[]}});
    await h.settle(); assert.match(body(h),/Payable: unresolved|requires review/); assert.match(body(h),/LEGACY-TEST/);
    assert.equal(h.requests.filter(row=>['POST','PATCH'].includes(row.options.method)).length,0);
    // Preparing a batch: every proof field has help text and the payload carries exact amounts.
    h.click('Add to batch'); assert.match(body(h),/LEGACY-TEST · item price ₹100.00/);
    for (const [label,value] of [['Commission (₹)','10'],['GST on commission (₹)','1.8'],['Original commission agreement','Agreement 2025 clause 4'],['Payment proof','Cash book page 12'],['Amount approval','Finance head email'],['COD cash proof','Hub receipt 0042'],['Batch note','October old orders']]) {
      const node = h.find(n => n.type === 'label' && [n.props.children].flat().includes(label)); assert.ok(node, label);
      assert.ok([node.props.children].flat().some(child => child?.props?.className === 'finance-hint'), `help text: ${label}`);
      change(h, label, value);
    }
    assert.match(body(h),/Seller will get: ₹88.20/);
    h.find(n => n.type === 'form').props.onSubmit({ preventDefault() {} }); h.flush();
    const post = h.requests.find(row => row.options.method === 'POST'); assert.match(post.url, /historical-batches$/);
    assert.deepEqual(JSON.parse(post.options.body), { note:'October old orders', rows:[{ orderId:'507f1f77bcf86cd799439011', itemId:'507f1f77bcf86cd799439012', commission:10, commissionGst:1.8, agreementReference:'Agreement 2025 clause 4',
      fundingEvidenceReference:'Cash book page 12', entitlementApprovalReference:'Finance head email', codCustodyApprovalReference:'Hub receipt 0042', refundReconciliationReference:'', priorPayoutReconciliationReference:'' }] });
  } finally {h.close();}
});

test('old-order batches show the next step for their status', async () => {
  const Historical = (await vite.ssrLoadModule('/src/modules/Admin/components/HistoricalFinancePanel.jsx')).default;
  const h = hookHarness(Historical,{},'/admin/finance-center');
  try {
    h.requests[0].resolve({success:true,data:{mode:'dry-run',limit:50,totalOrders:0,rows:[]}});
    const row = { proposedPayablePaise: 9000 };
    h.requests[1].resolve({success:true,data:{batches:[{_id:'HB-1',status:'pending_approval',note:'Batch one',rows:[row]},{_id:'HB-2',status:'approved',note:'Batch two',rows:[row]},{_id:'HB-3',status:'applied',note:'Batch three',rows:[row]}]}});
    await h.settle();
    assert.match(body(h),/HB-1 · Waiting for a second admin/); assert.ok(h.find(n=>n.type==='button'&&n.props.children==='Approve'));
    assert.ok(h.find(n=>n.type==='button'&&n.props.children==='Apply')); assert.ok(h.find(n=>n.type==='button'&&n.props.children==='Release to sellers'));
    h.click('Release to sellers'); const post = h.requests.find(r => r.options.method === 'POST'); assert.match(post.url, /historical-batches\/HB-3\/release$/);
  } finally { h.close(); }
});

test('seller tax statement lists monthly TCS/TDS and asks for missing GSTIN/PAN', async () => {
  const Statement = (await vite.ssrLoadModule('/src/modules/Seller/components/SellerTaxStatement.jsx')).default;
  const h = hookHarness(Statement,{},'/seller/earnings');
  try {
    assert.match(h.requests[0].url,/finances\/tax-statement$/);
    h.requests[0].resolve({success:true,data:{gstin:'',pan:'ABCDE1234F',tcsRatePercent:0.5,tdsRatePercent:0.1,months:[{month:'2026-10',grossPaise:10000,taxablePaise:8475,tcsPaise:42,tdsPaise:10},{month:'2026-09',grossPaise:0,taxablePaise:0,tcsPaise:0,tdsPaise:0}]}});
    await h.settle();
    assert.match(body(h),/₹84.75/); assert.match(body(h),/₹0.42/); assert.match(body(h),/Add your GSTIN in your profile/); assert.doesNotMatch(body(h),/September/);
  } finally { h.close(); }
});

test('rider must enter the COD cash collected, and it is sent with the OTP', async () => {
  const Page = (await vite.ssrLoadModule('/src/modules/Delivery/pages/ActiveDeliveryPage.jsx')).default;
  const calls = [], toasts = [];
  const context = { activeOrder: { step: 'transit', otpSent: true, paymentMethod: 'COD', codAmount: 500, items: [], orderId: 'o1' }, verifyOTPAndComplete: async (...args) => { calls.push(args); return true; },
    triggerToast: message => toasts.push(message), completePickup() {}, markArrivedAtStore() {}, markArrivedAtCustomer() {}, requestDeliveryOtp() {}, cancelOrder() {}, riderLocation: null };
  const h = hookHarness(Page, {}, '/delivery/active', context);
  try {
    const otp = h.find(n => n.type === 'input' && n.props.maxLength === '4'); otp.props.onChange({ target: { value: '1234' } }); h.flush();
    const form = () => h.find(n => n.type === 'form');
    await form().props.onSubmit({ preventDefault() {} }); h.flush();
    assert.equal(calls.length, 0); assert.match(toasts[0], /cash you collected/);
    const cash = h.find(n => n.type === 'input' && n.props.inputMode === 'decimal'); cash.props.onChange({ target: { value: '480' } }); h.flush();
    await form().props.onSubmit({ preventDefault() {} }); h.flush();
    assert.deepEqual(calls[0], ['1234', { codCollected: '480' }]);
  } finally { h.close(); }
});

test('Admin payout view blocks unverified transfer actions and rejects malformed reads', async () => {
  const Payouts = (await vite.ssrLoadModule('/src/modules/Admin/components/SellerLedgerAdminTab.jsx')).default;
  for (const data of [null,[{_id:'pending',payoutRef:'PAY-PENDING',amount:10,status:'pending',settlementEligible:false,beneficiaryReviewRequired:true,destinationFingerprint:'hash'}]]) {
    const h=hookHarness(Payouts,{view:'payouts'},'/admin/finance-center');
    try {
      h.requests[0].resolve({success:true,data});await h.settle();
      if (!data) {assert.match(body(h),/Payout review data is incomplete/);assert.doesNotMatch(body(h),/No payout requests/);}
      else {assert.match(body(h),/Waiting: check bank account/);assert.equal(h.find(n=>n.type==='button'&&n.props.children==='Mark as paid').props.disabled,true);assert.ok(h.find(n=>n.type==='button'&&n.props.children==='Check bank account'));}
      assert.equal(h.requests.filter(row=>['POST','PATCH'].includes(row.options.method)).length,0);
    } finally {h.close();}
  }
});

test('actual SellerProvider preserves API rupee amounts and real ledger/payout records', async () => {
  portalRequests.clearPortalRequests('seller');
  const h = hookHarness(SellerProvider, {}, '/seller/earnings', undefined, { localStorage: { getItem: k => k === 'sellerToken' ? 'audit-read-success' : null } });
  try {
    const summary = finance(); Object.assign(summary.balances, { earnedEarnings: 115.01, held: -2.03, eligible: 97.98 });
    summary.payouts = [{ _id: 'p1', payoutNo: 'PAY-REAL-FIXTURE', amount: 15, status: 'PENDING' }];
    const ledger = [{ _id: 'l1', amount: 115.01, direction: 'credit', bucket: 'held' }];
    await approveSeller(h); const reads = h.requests.filter(r => r.url.includes('/finances/'));
    reads[0].resolve({ success: true, data: summary }); reads[1].resolve({ success: true, data: ledger }); await h.settle();
    assert.equal(h.tree.props.value.financeError, '');
    assert.deepEqual(h.tree.props.value.financeSummary, summary);
    assert.deepEqual(h.tree.props.value.ledgerEntries, ledger);
    assert.equal(h.requests.filter(r => r.options.method === 'POST').length, 0);
  } finally { portalRequests.clearPortalRequests('seller'); h.close(); }
});

const invalidReads = [
  ['missing summary data', () => ({})],
  ['unsuccessful envelope', () => ({ success: false, data: finance() })],
  ['missing balances', () => ({ data: { ...finance(), balances: {} } })],
  ['null amount', () => { const f = finance(); f.balances.eligible = null; return { data: f }; }],
  ['numeric string', () => { const f = finance(); f.balances.held = '0'; return { data: f }; }],
  ['missing payouts', () => ({ data: { ...finance(), payouts: null } })],
  ['invalid ledger schema', () => ({ data: finance() }), { data: {} }],
  ['unsuccessful ledger envelope', () => ({ data: finance() }), { success: false, data: [] }],
  ['missing ledger amount', () => ({ data: finance() }), { data: [{ _id: 'bad', direction: 'credit', bucket: 'held' }] }],
];
for (const [name, summary, ledger = { data: [] }] of invalidReads) {
  test('actual SellerProvider rejects HTTP200 ' + name + ' instead of inventing zero funds', async () => {
    portalRequests.clearPortalRequests('seller');
    const h = hookHarness(SellerProvider, {}, '/seller/earnings', undefined, { localStorage: { getItem: k => k === 'sellerToken' ? 'audit-invalid-' + name : null } });
    try {
      await approveSeller(h); const reads = h.requests.filter(r => r.url.includes('/finances/'));
      reads[0].resolve(summary()); reads[1].resolve(ledger); await h.settle();
      assert.match(h.tree.props.value.financeError, /incomplete/);
      assert.equal(h.tree.props.value.financeSummary, null);
      assert.deepEqual(h.tree.props.value.ledgerEntries, []);
      assert.equal(h.tree.props.value.financeLoading, false);
    } finally { portalRequests.clearPortalRequests('seller'); h.close(); }
  });
}

for (const status of [401, 403, 500]) test('finance HTTP ' + status + ' remains an error rather than zero/empty response', async () => {
  portalRequests.clearPortalRequests('seller');
  const h = hookHarness(SellerProvider, {}, '/seller/earnings', undefined, { localStorage: { getItem: k => k === 'sellerToken' ? 'audit-http-' + status : null } });
  try {
    await approveSeller(h); const reads = h.requests.filter(r => r.url.includes('/finances/'));
    reads[0].resolve({ message: 'Audit read failed' }, status); reads[1].resolve({ data: [] }); await h.settle();
    assert.equal(h.tree.props.value.financeError, 'Audit read failed'); assert.equal(h.tree.props.value.financeSummary, null);
  } finally { portalRequests.clearPortalRequests('seller'); h.close(); }
});

test('commission editor starts without invented rates and never posts on load', async () => {
  const h = hookHarness(Admin); try {
    h.requests[0].resolve(config(false)); await h.settle();
    assert.equal(field(h, 'Commission value').props.value, ''); assert.equal(field(h, 'GST rate on commission (%)').props.value, '');
    assert.match(body(h), /Money actions are switched off on the server/); assert.equal(h.requests.filter(row => row.options.method === 'POST').length, 0);
    for (const label of ['Channel', 'Commission method', 'Commission value', 'GST treatment', 'Change reason'])
      assert.ok([field(h, label) && h.find(n => n.type === 'label' && [n.props.children].flat().includes(label)).props.children].flat().some(child => child?.props?.className === 'finance-hint'), `Missing help text: ${label}`);
  } finally { h.close(); }
});
test('commission form saves explicit version data and displays backend validation errors', async () => {
  const h = hookHarness(Admin); try {
    h.requests[0].resolve(config(false)); await h.settle();
    change(h, 'Commission value', '10'); change(h, 'GST rate on commission (%)', '0'); change(h, 'GST treatment', 'exempt');
    change(h, 'Change reason', 'Synthetic fixture only');
    h.find(node => node.type === 'form').props.onSubmit({ preventDefault() {} }); h.flush();
    assert.equal(h.requests.filter(row => row.options.method === 'POST').length, 0, 'Review must precede persistence');
    h.find(node => node.type?.name === 'FinanceReview').props.onConfirm(); h.flush();
    const pending = h.requests.find(row => row.options.method === 'POST'); assert.ok(pending);
    const payload = JSON.parse(pending.options.body);
    assert.equal(payload.value, 10); assert.equal(payload.taxRate, 0); assert.equal(payload.isActive, true); assert.equal(payload.effectiveDate, undefined);
    assert.equal(payload.base, 'eligible_item_subtotal'); assert.equal(payload.fixedScope, 'order_item'); assert.equal(payload.supersedes, null);
    pending.resolve({ message: 'Commission changed; refresh before saving' },409); await h.settle();
    assert.match(body(h), /Commission changed/); assert.equal(field(h, 'Commission value').props.value, '10');
  } finally { h.close(); }
});
test('"All channels" posts one save naming the rule each channel replaces', async () => {
  const h = hookHarness(Admin); try {
    const ecommerceRule = { _id: '507f1f77bcf86cd799439091', channel: 'ecommerce', vendorType: 'general', categoryId: null, productId: null, method: 'percentage', value: 7, isActive: true };
    h.requests[0].resolve({ data: { rules: [], current: [ecommerceRule], flags: flags(false) } }); await h.settle();
    change(h, 'Channel', 'all'); change(h, 'Commission value', '10'); change(h, 'Change reason', 'Flat 10% commission');
    assert.match(body(h), /Set commission for all channels/); assert.match(body(h), /E-Commerce: 7%/);
    h.find(node => node.type === 'form').props.onSubmit({ preventDefault() {} }); h.flush();
    h.find(node => node.type?.name === 'FinanceReview').props.onConfirm(); h.flush();
    const payload = JSON.parse(h.requests.find(row => row.options.method === 'POST').options.body);
    assert.equal(payload.channel, 'all'); assert.equal(payload.value, 10); assert.equal(payload.categoryId, '');
    assert.deepEqual(payload.supersedesByChannel, { ecommerce: ecommerceRule._id, quick: null, wholesale: null });
  } finally { h.close(); }
});
test('COD actions remain disabled until server release gates are satisfied', async () => {
  const h = hookHarness(Admin); try {
    h.requests[0].resolve(config(false)); await h.settle(); h.click('COD cash');
    h.requests[1].resolve(config(false)); await h.settle();
    h.requests[2].resolve({ data: [{ ...cashRow, cash: { ...cashRow.cash, status:'remittance_reported' } }], meta:{ pages:1 } }); await h.settle();
    assert.equal(h.find(node => node.type === 'button' && node.props.children === 'Confirm cash received').props.disabled, true);
    assert.match(body(h), /Rider says handed over/);
    assert.equal(h.requests.filter(row=>row.options.method==='POST').length,0);
  } finally { h.close(); }
});
test('a verified COD shortage can be written off by the platform without typing an amount', async () => {
  const h = hookHarness(Admin, { initialTab: 'cod', hideNavigation: true }); try {
    h.requests[0].resolve(config(true)); await h.settle();
    const row = { ...cashRow, financialRevision: 4, exceptions: ['cash_discrepancy'], cash: { ...cashRow.cash, status: 'discrepancy', collectedPaise: 10000, reportedPaise: 9000, verifiedPaise: 9000, shortagePaise: 1000 } };
    h.requests[1].resolve({ data: [row], meta: { pages: 1 } }); await h.settle();
    assert.match(body(h), /Amount mismatch/);
    h.click('Write off shortage'); assert.match(body(h), /Bulkimart absorbs the ₹10.00 shortage/);
    assert.equal(h.find(n => n.type === 'label' && [n.props.children].flat().includes('Cash received (₹)')), undefined);
    change(h, 'Evidence reference', 'SHORT-0001'); change(h, 'Reason', 'Customer paid ₹10 less');
    h.find(n => n.type === 'form' && n.props.className?.includes('finance-review')).props.onSubmit({ preventDefault() {} }); h.flush();
    const post = h.requests.find(r => r.options.method === 'POST'); assert.match(post.url, /finance\/orders\/order-fixture\/cod\/writeoff$/);
    assert.deepEqual(JSON.parse(post.options.body), { expectedRevision: 4, reference: 'SHORT-0001', reason: 'Customer paid ₹10 less' });
  } finally { h.close(); }
});
test('orders the automatic process could not finish show the reason and a manual action', async () => {
  const h = hookHarness(Admin, { initialTab: 'orders', hideNavigation: true }); try {
    h.requests[0].resolve(config(true)); await h.settle();
    h.requests[1].resolve({ data: [{ ...cashRow, paymentMethod: 'online', exceptions: ['allocation_not_posted', 'needs_admin_review'], financeAutomation: { step: 'post', lastError: 'Authoritative captured payment evidence is required' } }], meta: { pages: 1 } }); await h.settle();
    assert.match(body(h), /Needs your review/); assert.match(body(h), /Why: Authoritative captured payment evidence/);
    assert.equal(h.find(n => n.type === 'button' && n.props.children === 'Add earnings now').props.disabled, false);
  } finally { h.close(); }
});
test('seller per-order view shows product name and plain-language commission, never internal rule ids', async () => {
  const h = hookHarness(Seller,{orderId:'fixture'},'/seller/orders/fixture'); try {
    h.requests[0].resolve({data:{merchandise:{currency:'INR',components:{deliveryPaise:2000},lines:[{itemId:'line',itemName:'Amla',qty:1,grossPaise:10000,eligiblePaise:9000,allocatedDiscounts:{couponDiscount:1000},rule:{version:'FROZEN-V1',method:'percentage',value:10,taxTreatment:'exempt',taxRate:0},commissionPaise:900,taxPaise:0,netPaise:8100}]},financialPosting:'held',snapshot:null,entries:[]}});
    await h.settle(); assert.doesNotMatch(body(h),/FROZEN-V1|Item line/); assert.match(body(h),/Amla/); assert.match(body(h),/Bulkimart commission/); assert.match(body(h),/"10%"/); assert.match(body(h),/₹81.00/); assert.match(body(h),/₹20.00/); assert.match(body(h),/Customer paid for the whole order/); assert.match(body(h),/₹110.00/);
    assert.match(h.requests[0].url,/financial-breakdown/); assert.equal(h.requests.filter(row=>row.options.method==='POST').length,0);
  } finally { h.close(); }
});
test('seller historical order never invents a commission and supports a failed-read retry', async () => {
  const h=hookHarness(Seller,{orderId:'fixture'},'/seller/orders/fixture');try{
    h.requests[0].resolve({message:'Temporarily unavailable'},503);await h.settle();assert.match(body(h),/Temporarily unavailable/);
    h.click('Retry');h.requests[1].resolve({data:{merchandise:null,snapshot:null,entries:[]}});await h.settle();assert.match(body(h),/per-item earnings breakdown is not available/);
  }finally{h.close();}
});

for (const data of [undefined, {}, { entries: [], merchandise: { lines: null } }, { entries: [], merchandise: { lines: [{ grossPaise: 100 }], components: {} } }]) {
  test('invalid order finance data shows a retryable error rather than zero or endless loading: ' + JSON.stringify(data), async () => {
    const h = hookHarness(Seller, { orderId: 'fixture' }, '/seller/orders/fixture');
    try {
      h.requests[0].resolve({ data }); await h.settle();
      assert.match(body(h), /Order financial data is incomplete/);
      assert.doesNotMatch(body(h), /₹0\.00|per-item earnings breakdown is not available|Loading financial records/);
      assert.ok(h.find(n => n.type === 'button' && n.props.children === 'Retry'));
    } finally { h.close(); }
  });
}
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
