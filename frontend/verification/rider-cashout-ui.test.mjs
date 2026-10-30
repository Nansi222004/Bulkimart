import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { hookHarness } from '../tests/service-hookHarness.mjs';
let vite, Earnings;
before(async () => { vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' }); Earnings = (await vite.ssrLoadModule('/src/modules/Delivery/pages/EarningsPage.jsx')).default; });
after(async () => vite.close());
const text = n => n == null ? '' : typeof n !== 'object' ? String(n) : [n.props?.children].flat(Infinity).map(text).join(' ');
const slice = () => ({ available: true, total: 0, trips: 0, tips: 0, breakdown: [], days: [] });
test('positive cashout shows the actual blocker and becomes clickable after a confirmed status refresh', async () => {
  let refreshes = 0, requests = 0;
  const context = { payoutBalance: 140, payoutActionsEnabled: false, payoutHistory: [], fetchPayoutHistory() {}, debitWallet: 1010,
    cashoutEarnings() { requests++; }, refreshRiderFinances: async () => { refreshes++; },
    riderProfile: { bankDetails: { upiId: 'fixture-only' }, finance: { legacyUnverified: 0, balances: { onHold: 160, requested: 0, paid: 0 }, payoutBlockers: [{ code: 'cod_outstanding', message: '₹1010 COD cash needs admin receipt confirmation.' }] } },
    earningsData: { daily: slice(), weekly: slice(), lifetime: slice() } };
  const h = hookHarness(Earnings, {}, '/delivery/earnings', context);
  try {
    await h.settle(); assert.equal(refreshes, 1); assert.equal(h.find(n => n.props?.className === 'delivery-cashout-btn').props.disabled, true);
    assert.match(text(h.tree), /₹1010 COD cash needs admin receipt confirmation/); assert.match(text(h.tree), /On hold: ₹\s*160\.00/); assert.match(text(h.tree), /UPI account linked/);
    await h.click('Refresh payout status'); assert.equal(refreshes, 2);
    context.payoutActionsEnabled = true; context.debitWallet = 0; context.riderProfile.finance.payoutBlockers = []; h.rerender();
    assert.equal(h.find(n => n.props?.className === 'delivery-cashout-btn').props.disabled, false);
    h.click('Cashout to Bank'); assert.equal(requests, 1);
  } finally { h.close(); }
});
