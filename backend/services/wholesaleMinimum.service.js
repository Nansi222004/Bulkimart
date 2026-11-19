import WholesaleSetting from '../models/WholesaleSetting.js';
import { httpError } from '../utils/response.js';
import { toPaise, fromPaise } from '../utils/money.js';

/**
 * Minimum order value for Wholesale (B2B) checkout. Retail (B2C) checkout never has one.
 *
 * - Counts products only: item amounts after any discount, without delivery, COD fee or tip,
 *   so fees can never be used to reach the minimum.
 * - Counts the whole Wholesale part of a checkout together (all sellers), not per seller.
 *   In a combined basket only the Wholesale deliveries count.
 * - Checked again by the server when the order is placed; the screens only explain it.
 */

export const WHOLESALE_MINIMUM_DEFAULT = 5000;
const TTL_MS = 60_000;
let cache = null;
let cachedAt = 0;

const shape = (row) => ({
  _id: row?._id || null,
  minOrderValue: row ? Number(row.minOrderValue) || 0 : WHOLESALE_MINIMUM_DEFAULT,
  updatedAt: row?.updatedAt || null,
});

export const loadWholesaleSetting = async (session = null) => {
  const query = WholesaleSetting.findOne({ isActive: true }).sort({ createdAt: -1 }).lean();
  if (session) query.session(session);
  cache = shape(await query);
  cachedAt = Date.now();
  return cache;
};

export const resolveWholesaleSetting = async () => (cache && Date.now() - cachedAt < TTL_MS ? cache : loadWholesaleSetting());
export const invalidateWholesaleSetting = () => { cache = null; cachedAt = 0; };

export function parseWholesaleSettingInput(body = {}) {
  const raw = body.minOrderValue;
  const value = raw === '' || raw == null ? 0 : Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > 10000000) throw httpError(400, 'Wholesale minimum order value must be between ₹0 and ₹1,00,00,000');
  if (Math.abs(Math.round(value * 100) - value * 100) > 1e-6) throw httpError(400, 'Wholesale minimum order value can have at most 2 decimal places');
  return { minOrderValue: Math.round(value * 100) / 100 };
}

const isWholesaleGroup = (group, purchaseMode) => (group.salesChannel || purchaseMode) === 'wholesale';

/**
 * Where a checkout stands against the minimum. Null when it has no Wholesale items
 * or there is no minimum.
 */
export function wholesaleMinimumState(groups, setting, purchaseMode = 'basket') {
  const minimumPaise = toPaise(Number(setting?.minOrderValue) || 0);
  const wholesale = (groups || []).filter((group) => group && isWholesaleGroup(group, purchaseMode));
  if (minimumPaise <= 0 || !wholesale.length) return null;
  const productsPaise = wholesale.reduce((sum, group) => sum + toPaise(Number(group.subtotal) || 0) - toPaise(Number(group.couponDiscount) || 0), 0);
  const remainingPaise = Math.max(0, minimumPaise - productsPaise);
  return {
    minimumOrderValue: fromPaise(minimumPaise),
    wholesaleProductsTotal: fromPaise(productsPaise),
    remainingAmount: fromPaise(remainingPaise),
    met: remainingPaise === 0,
    progressPercentage: Math.min(100, Math.floor(productsPaise * 100 / minimumPaise)),
  };
}

export const wholesaleMinimumMessage = (state) => `Wholesale orders need products worth at least ₹${state.minimumOrderValue}. Add ₹${state.remainingAmount} more to place this order.`;

/** Server-side check at checkout. Throws 400 WHOLESALE_MINIMUM_NOT_MET when short. */
export function assertWholesaleMinimum(groups, setting, purchaseMode) {
  const state = wholesaleMinimumState(groups, setting, purchaseMode);
  if (state && !state.met) throw httpError(400, wholesaleMinimumMessage(state), { code: 'WHOLESALE_MINIMUM_NOT_MET', wholesaleMinimum: state });
  return state;
}
