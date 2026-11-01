// Port of frontend/src/modules/Seller/utils/sellerFinanceRead.js,
// frontend/src/components/finance/ProductGstBreakdown.jsx (validProductTax) and the
// shape checks in OrderFinancialBreakdown.jsx.
// These validate server responses. They never derive, round or replace a financial value.
// An incomplete response is an error, never a zero balance.

const balanceKeys = ['earnedEarnings', 'pending', 'held', 'eligible', 'reserved', 'settled', 'quickFreightObligations', 'bulkimartServiceFees'];
const finiteAmount = (value) => typeof value === 'number' && Number.isFinite(value);
const buckets = ['pending', 'held', 'eligible', 'reserved', 'settled'];
export const PAYOUT_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'];

export function readSellerFinances(summaryBody, ledgerBody) {
  const summary = summaryBody?.data;
  const entries = ledgerBody?.data;
  if (summaryBody?.success === false || ledgerBody?.success === false || !summary
    || !summary.balances || balanceKeys.some((key) => !finiteAmount(summary.balances[key]))
    || typeof summary.payoutActionsEnabled !== 'boolean' || !Array.isArray(summary.payouts)
    || summary.payouts.some((p) => !p || !p._id || !p.payoutNo || !finiteAmount(p.amount) || p.amount <= 0 || !PAYOUT_STATUSES.includes(p.status))) {
    throw new Error('Seller balances or payout data is incomplete. Please retry; unavailable amounts are not zero balances.');
  }
  const sales = summary.deliveredSales;
  const metrics = summary.salesMetrics;
  if (metrics && ((!finiteAmount(metrics.totalRevenue) && metrics.totalRevenue !== null)
    || (!finiteAmount(metrics.netEarnings) && metrics.netEarnings !== null)
    || !finiteAmount(metrics.knownNetEarnings) || !finiteAmount(metrics.knownRevenue)
    || ['completedOrders', 'netEarningsCalculatedOrders', 'netEarningsPendingOrders', 'unpostedOrders'].some((key) => !Number.isSafeInteger(metrics[key]) || metrics[key] < 0)
    || metrics.netEarningsCalculatedOrders + metrics.netEarningsPendingOrders !== metrics.completedOrders)) {
    throw new Error('Seller sales and net earnings coverage is incomplete. Please retry.');
  }
  if (sales && (!Number.isSafeInteger(sales.orderCount) || sales.orderCount < 0 || !finiteAmount(sales.grossAmount) || sales.grossAmount < 0
    || !Array.isArray(sales.orders) || sales.orders.some((o) => !o || !o._id || !o.orderNo || !finiteAmount(o.grossAmount) || o.grossAmount < 0))) {
    throw new Error('Delivered sales data is incomplete. Please retry.');
  }
  if (!Array.isArray(entries) || entries.some((e) => !e || !e._id || !finiteAmount(e.amount) || e.amount <= 0 || !['credit', 'debit'].includes(e.direction) || !buckets.includes(e.bucket))) {
    throw new Error('Seller ledger data is incomplete. Please retry; the ledger could not be verified.');
  }
  return { summary, entries };
}

export function validProductTax(tax) {
  return tax?.version === 'product-gst-v1'
    && ['sellingPricePaise', 'grossPaise', 'taxableValuePaise', 'gstPaise', 'addedGstPaise', 'includedGstPaise'].every((key) => Number.isSafeInteger(tax[key]) && tax[key] >= 0)
    && tax.taxableValuePaise + tax.gstPaise === tax.grossPaise
    && tax.sellingPricePaise + tax.addedGstPaise === tax.grossPaise
    && Array.isArray(tax.rates) && tax.rates.every((row) => Number.isFinite(row.gstRate) && ['inclusive', 'exclusive'].includes(row.gstPriceType)
      && Number.isSafeInteger(row.gstPaise) && Number.isSafeInteger(row.taxableValuePaise))
    && tax.rates.reduce((n, row) => n + row.gstPaise, 0) === tax.gstPaise;
}

export function readOrderFinance(result) {
  const data = result?.data;
  if (result?.success === false || !data || !Array.isArray(data.entries) || (data.merchandise
    && (!Array.isArray(data.merchandise.lines) || !data.merchandise.components || data.merchandise.lines.some((line) =>
      !line || !line.allocatedDiscounts || !Number.isSafeInteger(line.grossPaise) || !Number.isSafeInteger(line.eligiblePaise)
      || (line.rule && !(data.merchandise.state === 'held_discount_policy' && line.blocker === 'Discount funding policy is not approved')
        && ['commissionPaise', 'taxPaise', 'netPaise'].some((key) => !Number.isSafeInteger(line[key]))))))) {
    throw new Error('Order financial data is incomplete. Please retry.');
  }
  return data;
}

export function readTaxStatement(body) {
  if (body?.success === false || !Array.isArray(body?.data?.months)) {
    throw new Error(body?.message || 'Tax statement unavailable');
  }
  return body.data;
}

// Same rule as web payoutIntent: positive, at most two decimals.
export function validPayoutAmount(amount) {
  return typeof amount === 'number' && Number.isFinite(amount) && amount > 0
    && Number.isSafeInteger(Math.round(amount * 100)) && Math.abs(amount * 100 - Math.round(amount * 100)) <= 0.00001;
}
