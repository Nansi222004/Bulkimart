import { httpError } from './response.js';

// Owner-confirmed application policy: one checkout, including fees/tip, <= ₹1 lakh.
// This is not a claim about the merchant's account-specific gateway limit.
export const MAX_CHECKOUT_PAISE = 10_000_000;
export const toPaise = (value, maximum = MAX_CHECKOUT_PAISE) => {
  if (!['number', 'string'].includes(typeof value) || (typeof value === 'string' && !value.trim())) throw httpError(400, 'Invalid monetary amount');
  const number = Number(value), paise = Math.round(number * 100);
  if (!Number.isFinite(number) || number < 0 || !Number.isSafeInteger(paise) || paise > maximum || Math.abs(number * 100 - paise) > 0.000001) throw httpError(400, 'Amounts must use at most two decimals and checkout cannot exceed ₹1,00,000');
  return paise;
};
export const fromPaise = paise => {
  if (!Number.isSafeInteger(paise) || paise < 0 || paise > MAX_CHECKOUT_PAISE) throw httpError(400, 'Checkout cannot exceed ₹1,00,000');
  return paise / 100;
};
export const sumMoney = (...values) => fromPaise(values.reduce((sum, value) => sum + toPaise(value), 0));
export const lineMoney = (price, quantity) => {
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 100000) throw httpError(400, 'Invalid order quantity');
  return fromPaise(toPaise(price) * quantity);
};
