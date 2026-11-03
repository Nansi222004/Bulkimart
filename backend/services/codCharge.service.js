import CodChargeSetting from '../models/CodChargeSetting.js';
import { httpError } from '../utils/response.js';
import { toPaise, fromPaise } from '../utils/money.js';

/**
 * Cash on Delivery handling fee — the one place it is configured and calculated.
 *
 * - Charged per order (each order is a separate delivery and cash collection).
 * - Base = the order amount before the fee: items after discounts + delivery. Tips are excluded.
 * - Applies only to COD orders; online orders always carry zero.
 * - Fee (and optional GST on it) is platform income, never seller earnings
 *   (vendorCommission.service.js keeps it as its own `codFeePaise` component).
 * Checkout never trusts a client figure: orders recompute it from the active setting.
 */

const TTL_MS = 60_000;
let cache = null;
let cachedAt = 0;

export const COD_FEE_LIMITS = { maxFixed: 1000, maxPercentage: 20, maxGstRate: 28 };
const DEFAULTS = () => ({ _id: null, isEnabled: false, feeType: 'FIXED', fixedAmount: 0, percentage: 0, minOrderAmount: null, maxFee: null, gstRatePercent: 0, description: 'COD Handling Fee' });

const shape = (row) => (row ? {
  _id: row._id, isEnabled: Boolean(row.isEnabled), feeType: row.feeType, fixedAmount: row.fixedAmount || 0, percentage: row.percentage || 0,
  minOrderAmount: row.minOrderAmount ?? null, maxFee: row.maxFee ?? null, gstRatePercent: row.gstRatePercent || 0,
  description: row.description || 'COD Handling Fee', updatedAt: row.updatedAt,
} : DEFAULTS());

export const loadCodChargeSetting = async (session = null) => {
  const query = CodChargeSetting.findOne({ isActive: true }).sort({ createdAt: -1 }).lean();
  if (session) query.session(session);
  cache = shape(await query);
  cachedAt = Date.now();
  return cache;
};

export const invalidateCodChargeSetting = () => { cache = null; cachedAt = 0; };

/** Cached read for previews; refreshes once the cache is older than the TTL. */
export const resolveCodChargeSetting = async () => (cache && Date.now() - cachedAt < TTL_MS ? cache : loadCodChargeSetting());

/** Validates an admin form; returns the row to store. */
export function parseCodChargeInput(body = {}) {
  const isEnabled = body.isEnabled === true || body.isEnabled === 'true';
  const feeType = body.feeType === 'PERCENTAGE' ? 'PERCENTAGE' : body.feeType === 'FIXED' ? 'FIXED' : null;
  if (!feeType) throw httpError(400, 'Choose a COD fee type: FIXED or PERCENTAGE');
  const num = (value, label, { min = 0, max = Infinity, optional = false } = {}) => {
    if (optional && (value === '' || value == null)) return null;
    const n = Number(value);
    if (value === '' || value == null || !Number.isFinite(n) || n < min || n > max) throw httpError(400, `${label} must be between ${min} and ${max}`);
    if (Math.abs(Math.round(n * 100) - n * 100) > 1e-6) throw httpError(400, `${label} can have at most 2 decimal places`);
    return Math.round(n * 100) / 100;
  };
  const fixedAmount = feeType === 'FIXED' ? num(body.fixedAmount, 'COD handling fee', { max: COD_FEE_LIMITS.maxFixed }) : num(body.fixedAmount ?? 0, 'COD handling fee', { max: COD_FEE_LIMITS.maxFixed });
  const percentage = feeType === 'PERCENTAGE' ? num(body.percentage, 'COD fee percentage', { max: COD_FEE_LIMITS.maxPercentage }) : num(body.percentage ?? 0, 'COD fee percentage', { max: COD_FEE_LIMITS.maxPercentage });
  if (isEnabled && feeType === 'FIXED' && !(fixedAmount > 0)) throw httpError(400, 'Enter a COD handling fee above ₹0, or switch COD charges off');
  if (isEnabled && feeType === 'PERCENTAGE' && !(percentage > 0)) throw httpError(400, 'Enter a COD fee percentage above 0, or switch COD charges off');
  const minOrderAmount = num(body.minOrderAmount, 'Minimum order amount', { optional: true, max: 10000000 });
  const maxFee = num(body.maxFee, 'Maximum COD fee', { optional: true, max: COD_FEE_LIMITS.maxFixed });
  if (maxFee != null && maxFee <= 0) throw httpError(400, 'Maximum COD fee must be above ₹0, or left empty');
  const gstRatePercent = num(body.gstRatePercent ?? 0, 'GST on COD fee', { max: COD_FEE_LIMITS.maxGstRate });
  const description = String(body.description ?? '').trim() || 'COD Handling Fee';
  if (description.length > 200) throw httpError(400, 'Description can be at most 200 characters');
  return { isEnabled, feeType, fixedAmount, percentage, minOrderAmount, maxFee, gstRatePercent, description };
}

/**
 * The COD fee for one order. `baseAmount` = order amount before the fee (₹).
 * Returns null when no fee applies; otherwise rupee amounts rounded to paise.
 */
export function calculateCodFee(baseAmount, setting) {
  if (!setting?.isEnabled) return null;
  const basePaise = toPaise(Math.max(0, Number(baseAmount) || 0));
  if (basePaise <= 0) return null;
  if (setting.minOrderAmount != null && basePaise < toPaise(setting.minOrderAmount)) return null;
  let feePaise = setting.feeType === 'PERCENTAGE'
    ? Math.round(basePaise * Number(setting.percentage || 0) / 100)
    : toPaise(setting.fixedAmount || 0);
  if (setting.maxFee != null) feePaise = Math.min(feePaise, toPaise(setting.maxFee));
  if (feePaise <= 0) return null;
  const taxPaise = Math.round(feePaise * Number(setting.gstRatePercent || 0) / 100);
  return {
    codFeeEnabled: true,
    codFeeType: setting.feeType,
    codFeeValue: setting.feeType === 'PERCENTAGE' ? setting.percentage : setting.fixedAmount,
    codFeeAmount: fromPaise(feePaise),
    codFeeTaxRate: Number(setting.gstRatePercent || 0),
    codFeeTaxAmount: fromPaise(taxPaise),
    codFeeTotal: fromPaise(feePaise + taxPaise),
    codFeeDescription: setting.description || 'COD Handling Fee',
    ...(setting._id ? { codFeeSettingId: setting._id } : {}),
  };
}

/** Public, customer-safe view of the setting (checkout explains the fee before ordering). */
export const publicCodCharge = (setting) => ({
  isEnabled: Boolean(setting?.isEnabled), feeType: setting?.feeType, fixedAmount: setting?.fixedAmount, percentage: setting?.percentage,
  minOrderAmount: setting?.minOrderAmount ?? null, maxFee: setting?.maxFee ?? null, gstRatePercent: setting?.gstRatePercent || 0,
  description: setting?.description || 'COD Handling Fee',
});
