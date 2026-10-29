import { itemGrossPaise } from './productGst.service.js';
import { discountAllocation } from './orderDiscounts.service.js';
import { moneyPaise } from '../utils/financeMoney.js';

const discountKeys = ['discount', 'couponDiscount', 'cdsDiscount', 'coinDiscount'];
const sum = (lines, key) => lines.reduce((total, line) => total + line[key], 0) / 100;
const paise = value => Number.isSafeInteger(value) && value >= 0;

// Read the rule frozen at checkout. Never apply today's rate to an older order
// or treat a missing commission record as a zero deduction.
export function sellerFinancialAmounts(snapshot, sellerId) {
  const lines = snapshot?.version === 2 && snapshot.lines?.filter(line => String(line.sellerId) === String(sellerId));
  if (!lines?.length || lines.some(line => !line.allocatedDiscounts || !paise(line.grossPaise) || !paise(line.eligiblePaise)
    || discountKeys.some(key => !paise(line.allocatedDiscounts?.[key] ?? 0)))) return null;
  const known = lines.every(line => line.rule && !line.blocker
    && ['commissionPaise', 'taxPaise', 'netPaise'].every(key => paise(line[key]))
    && ['tcsPaise', 'tdsPaise'].every(key => paise(line[key] ?? 0)));
  const discounts = Object.fromEntries(discountKeys.map(key => [key,
    lines.reduce((total, line) => total + (line.allocatedDiscounts[key] || 0), 0) / 100]));
  return {
    subtotal: sum(lines, 'grossPaise'), ...discounts,
    totalDiscount: lines.reduce((total, line) => total + line.grossPaise - line.eligiblePaise, 0) / 100,
    customerItemsTotal: sum(lines, 'eligiblePaise'),
    commission: known ? sum(lines, 'commissionPaise') : null,
    commissionTax: known ? sum(lines, 'taxPaise') : null,
    tcs: known ? lines.reduce((total, line) => total + (line.tcsPaise || 0), 0) / 100 : null,
    tds: known ? lines.reduce((total, line) => total + (line.tdsPaise || 0), 0) / 100 : null,
    netEarnings: known ? sum(lines, 'netPaise') : null,
  };
}

export function sellerOrderAmounts(order, sellerId) {
  const frozen = sellerFinancialAmounts(order.financialSnapshot, sellerId);
  if (frozen) return frozen;
  const items = order.items || [];
  const own = items.map((item, index) => String(item.sellerId) === String(sellerId) ? index : -1).filter(index => index >= 0);
  const result = { commission: null, commissionTax: null, tcs: null, tds: null, netEarnings: null, totalDiscount: null, customerItemsTotal: null };
  try {
    const gross = items.map(item => itemGrossPaise(item));
    const subtotal = own.reduce((total, index) => total + gross[index], 0);
    const { discounts } = discountAllocation(order.pricing, gross);
    const allocated = Object.fromEntries(discountKeys.map(key => [key, own.reduce((total, index) => total + discounts[key][index], 0)]));
    const totalDiscount = Object.values(allocated).reduce((total, amount) => total + amount, 0);
    return { ...result, subtotal: subtotal / 100, ...Object.fromEntries(Object.entries(allocated).map(([key, amount]) => [key, amount / 100])),
      totalDiscount: totalDiscount / 100, customerItemsTotal: (subtotal - totalDiscount) / 100 };
  } catch {
    // Incomplete historical pricing remains readable without inventing amounts.
    return result;
  }
}
