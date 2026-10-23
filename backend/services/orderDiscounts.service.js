import { moneyPaise, allocatePaise } from '../utils/financeMoney.js';
import { httpError } from '../utils/response.js';

// Approved business policy: Bulkimart funds every order-level coupon, coin and
// CDS discount. The seller is paid on the full item price; commission is
// charged on the price after discount (see buildOrderFinancialSnapshot).
export const DISCOUNT_FUNDING_POLICY = { PLATFORM: 'platform' };
export const getDiscountFundingPolicy = () => DISCOUNT_FUNDING_POLICY.PLATFORM;

// No writes: legacy alias detection is permitted only when the authoritative
// total proves that discount includes coupon. Ambiguous shapes fail closed.
export const discountAllocation = (pricing, gross) => {
  const keys = ['discount', 'couponDiscount', 'cdsDiscount', 'coinDiscount'];
  const totals = keys.map(key => moneyPaise(pricing[key] ?? 0));
  const subtotal = gross.reduce((a, b) => a + b, 0);
  const extras = ['deliveryCharge', 'tipAmount', 'donationAmount'].reduce((sum, key) => sum + moneyPaise(pricing[key] ?? 0), 0);
  const payable = moneyPaise(pricing.totalAmount);
  let representation = pricing.discountRepresentation || 'legacy-distinct';
  if (subtotal - totals.reduce((a, b) => a + b, 0) + extras !== payable) {
    if (!pricing.discountRepresentation && totals[1] > 0 && totals[0] >= totals[1]
      && subtotal - totals.reduce((a, b) => a + b, 0) + totals[1] + extras === payable) {
      totals[0] -= totals[1];
      representation = 'legacy-coupon-alias';
    } else throw httpError(409, 'Discount components do not reconcile with payment total');
  }
  let remaining = allocatePaise(totals.reduce((a, b) => a + b, 0), gross);
  const discounts = Object.fromEntries(keys.map((key, index) => {
    const allocation = allocatePaise(totals[index], remaining);
    remaining = remaining.map((budget, row) => budget - allocation[row]);
    return [key, allocation];
  }));
  const hasDiscounts = totals.some(value => value > 0);
  return { keys, discounts, representation, fundingUnresolved: false, fundingPolicy: hasDiscounts ? getDiscountFundingPolicy() : 'none' };
};
