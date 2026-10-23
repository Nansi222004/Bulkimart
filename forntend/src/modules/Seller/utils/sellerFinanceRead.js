const balanceKeys = ['earnedEarnings', 'pending', 'held', 'eligible', 'reserved', 'settled', 'quickFreightObligations', 'bulkimartServiceFees'];
const finiteAmount = value => typeof value === 'number' && Number.isFinite(value);
const buckets = ['pending', 'held', 'eligible', 'reserved', 'settled'];

// Validate read responses without deriving, rounding, or replacing financial data.
export function readSellerFinances(summaryBody, ledgerBody) {
  const summary = summaryBody?.data, entries = ledgerBody?.data;
  if (summaryBody?.success === false || ledgerBody?.success === false || !summary ||
    !summary.balances || balanceKeys.some(key => !finiteAmount(summary.balances[key])) ||
    typeof summary.payoutActionsEnabled !== 'boolean' || !Array.isArray(summary.payouts) ||
    summary.payouts.some(p => !p || !p._id || !p.payoutNo || !finiteAmount(p.amount) || p.amount <= 0 || !['PENDING', 'APPROVED', 'REJECTED'].includes(p.status))) {
    throw new Error('Seller balances or payout data is incomplete. Please retry; unavailable amounts are not zero balances.');
  }
  const sales = summary.deliveredSales;
  if (sales && (!Number.isSafeInteger(sales.orderCount) || sales.orderCount < 0 || !finiteAmount(sales.grossAmount) || sales.grossAmount < 0 ||
    !Array.isArray(sales.orders) || sales.orders.some(o => !o || !o._id || !o.orderNo || !finiteAmount(o.grossAmount) || o.grossAmount < 0))) {
    throw new Error('Delivered sales data is incomplete. Please retry.');
  }
  if (!Array.isArray(entries) || entries.some(e => !e || !e._id || !finiteAmount(e.amount) || e.amount <= 0 || !['credit', 'debit'].includes(e.direction) || !buckets.includes(e.bucket))) {
    throw new Error('Seller ledger data is incomplete. Please retry; the ledger could not be verified.');
  }
  return { summary, entries };
}

export const sellerMoney = value => finiteAmount(value)
  ? `₹${value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  : '—';
