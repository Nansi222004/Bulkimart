/**
 * Money rules for the rider app. The backend is the source of truth; this file only
 * mirrors its rules so the app never shows a figure the server would reject.
 *
 * Canonical COD rule (backend/utils/financeMoney.js -> codCashDuePaise):
 *   cash due = order total rounded to the nearest whole rupee, .50 rounds up.
 *   Rs 839.20 -> Rs 839, Rs 839.50 -> Rs 840.
 * The server already sends that figure as `codAmount` (Math.round(order.pricing.totalAmount))
 * on the offer, the active delivery and the earnings breakdown. The app shows `codAmount`
 * as received and never re-rounds it per screen.
 */

// Exact copy of backend/utils/financeMoney.js codCashDuePaise.
export const codCashDuePaise = (expectedPaise) => Math.round(expectedPaise / 100) * 100;

/** Rupees (number or numeric string, at most 2 decimals) -> integer paise, or null when invalid. */
export function rupeesToPaise(value) {
  if (value === null || value === undefined || value === '') return null;
  const text = String(value).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  const paise = Math.round(Number(text) * 100);
  return Number.isSafeInteger(paise) ? paise : null;
}

/** The whole-rupee cash due for an active COD delivery, taken from the server, or null if unusable. */
export function codDueRupees(order) {
  if (!order || order.paymentMethod !== 'COD') return null;
  const due = Number(order.codAmount);
  return Number.isSafeInteger(due) && due > 0 ? due : null;
}

/**
 * Validates the cash a rider typed at the door before OTP completion.
 *
 * Only the exact rounded amount passes. Less is a shortage the web portal also refuses;
 * more is rejected by the backend cash recorder (collect allows at most max(expected, due)).
 * Whole rupees only, because cash changes hands in whole rupees.
 */
export function validateCodCollection(input, dueRupees) {
  if (!Number.isSafeInteger(dueRupees) || dueRupees <= 0) {
    return { ok: false, message: 'The cash amount for this order is unavailable. Pull down to refresh before completing.' };
  }
  const text = String(input ?? '').trim();
  if (!text) return { ok: false, message: `Enter the cash you collected (₹${dueRupees}).` };
  if (!/^\d+$/.test(text)) return { ok: false, message: 'Enter whole rupees only, without paise.' };
  const amount = Number(text);
  if (amount < dueRupees) return { ok: false, message: `Collect the full ₹${dueRupees}. A smaller amount cannot be accepted.` };
  if (amount > dueRupees) return { ok: false, message: `Collect exactly ₹${dueRupees}. Give any extra cash back to the customer.` };
  return { ok: true, amount };
}

/**
 * Limit for a COD report on the Cash screen, in paise (mirrors the web DeliveryFinancePanel
 * and backend recordCodEvent):
 *   collection -> max(expected, due); handover -> what was collected.
 */
export function codReportLimitPaise(cash) {
  if (!cash) return 0;
  if (cash.status === 'collected') return Number(cash.collectedPaise) || 0;
  const expected = Number(cash.expectedPaise) || 0;
  const due = Number.isFinite(Number(cash.duePaise)) && cash.duePaise !== null && cash.duePaise !== undefined
    ? Number(cash.duePaise) : codCashDuePaise(expected);
  return Math.max(expected, due);
}

const inr = (n, digits) => n.toLocaleString('en-IN', { minimumFractionDigits: digits, maximumFractionDigits: digits });

/** Rupee text for a rupee amount. Whole amounts have no decimals; others show two. Invalid -> '—'. */
export function formatRupees(value) {
  if (value === null || value === undefined || value === '') return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  const whole = Math.abs(n - Math.round(n)) < 0.000001;
  return `₹${whole ? inr(Math.round(n), 0) : inr(n, 2)}`;
}

/** Rupee text for an integer paise amount, always two decimals (finance records). */
export function formatPaise(paise) {
  if (paise === null || paise === undefined || paise === '') return '—';
  const n = Number(paise);
  if (!Number.isFinite(n)) return '—';
  return `₹${inr(n / 100, 2)}`;
}
