import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { hookHarness } from '../tests/service-hookHarness.mjs';
let vite, Admin, Seller;
before(async () => {
  vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' });
  Admin = (await vite.ssrLoadModule('/src/modules/Admin/components/SellerLedgerAdminTab.jsx')).default;
  Seller = (await vite.ssrLoadModule('/src/modules/Seller/components/EarningsTab.jsx')).default;
});
after(async () => vite.close());
const text = n => n == null || typeof n === 'boolean' ? '' : typeof n !== 'object' ? String(n) : [n.props?.children].flat(Infinity).map(text).join(' ').replace(/\s+/g, ' ');
const balances = { pending: 0, held: 0, eligible: 0, reserved: 0, settled: 0, quickFreightObligations: 0, bulkimartServiceFees: 0 };
const salesMetrics = { totalRevenue: 4800, grossSales: 5300, customerDiscounts: 500, completedOrders: 7, netEarningsPendingOrders: 5, unpostedOrders: 7 };
const salesByChannel = { ecommerce: { revenue: 2200 }, grocery: { revenue: 2600 } };
test('Admin and seller show the same completed-sales amount with gross and discount labels, without treating sales as withdrawable', async () => {
  const admin = hookHarness(Admin, {}, '/admin/finance-center?area=payouts&view=earnings');
  let adminText;
  try {
    admin.requests.find(r => r.url.includes('seller-balances')).resolve({ data: { rows: [{ sellerId: 'seller', storeName: 'Always', balances, salesMetrics, salesByChannel,
      unpostedSales: { orderCount: 7, grossPaise: 530000, reasons: [{ code: 'commission_terms_missing', orderCount: 5 }, { code: 'cod_confirmation_pending', orderCount: 2 }] } }] } });
    admin.requests.find(r => r.url.includes('seller-ledger')).resolve({ data: [] }); await admin.settle();
    adminText = text(admin.tree);
    assert.match(adminText, /Completed product sales/); assert.match(adminText, /₹4,800.00/);
    assert.match(adminText, /Gross product sales: ₹5,300.00/); assert.match(adminText, /Customer discounts: ₹500.00/);
    assert.match(adminText, /7 orders await settlement posting/); assert.match(adminText, /Shop All: ₹2,200.00/); assert.match(adminText, /Quick Commerce: ₹2,600.00/);
  } finally { admin.close(); }
  const seller = hookHarness(Seller, {}, '/seller/earnings', { financeSummary: { balances, salesMetrics, salesByChannel, payoutActionsEnabled: false }, ledgerEntries: [] });
  try {
    const out = text(seller.tree);
    for (const phrase of ['₹4,800.00', 'after customer discounts', 'Gross product sales: ₹5,300.00', 'Customer discounts: ₹500.00']) { assert.ok(out.includes(phrase)); assert.ok(adminText.includes(phrase)); }
    assert.equal(seller.find(n => n.type === 'button' && n.props.children === 'Request payout').props.disabled, true);
  } finally { seller.close(); }
});
