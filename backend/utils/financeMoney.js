import { httpError } from './response.js';

export const moneyPaise = (value, label = 'Amount') => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || !Number.isSafeInteger(Math.round(value * 100)) || Math.abs(value * 100 - Math.round(value * 100)) > 0.00001) {
    throw httpError(400, `${label} must be a nonnegative amount with at most two decimal places`);
  }
  return Math.round(value * 100);
};
export const allocatePaise = (total, weights) => {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (!Number.isSafeInteger(sum) || weights.some(value => !Number.isSafeInteger(value) || value < 0)) throw httpError(409, 'Invalid allocation weights');
  if (!Number.isSafeInteger(total) || total < 0 || total > sum) throw httpError(409, 'Discount allocation exceeds merchandise');
  if (!sum) return weights.map(() => 0);
  const rows = weights.map((weight, index) => ({ index, amount: Number((BigInt(total) * BigInt(weight)) / BigInt(sum)), remainder: (BigInt(total) * BigInt(weight)) % BigInt(sum) }));
  let rest = total - rows.reduce((n, row) => n + row.amount, 0);
  [...rows].sort((a, b) => a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1).forEach(row => { if (rest > 0) { row.amount++; rest--; } });
  return rows.map(row => row.amount);
};


export const cumulativePaise = (amount, quantity, totalQuantity) => {
 if (![amount, quantity, totalQuantity].every(Number.isSafeInteger) || amount < 0 || quantity < 0 || totalQuantity <= 0 || quantity > totalQuantity) throw httpError(409, 'Invalid cumulative allocation');
 return Number((BigInt(amount) * BigInt(quantity) * 2n + BigInt(totalQuantity)) / (2n * BigInt(totalQuantity)));
};
