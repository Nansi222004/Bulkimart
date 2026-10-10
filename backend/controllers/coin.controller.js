import { asyncHandler } from '../middlewares/error.middleware.js';
import { ok, paginated, getPagination } from '../utils/response.js';
import { getOrCreateWallet, getCoinHistory } from '../services/coin.service.js';
import { getCoinConfig } from '../services/coinConfig.service.js';
import { COIN_TRANSACTION_TYPES } from '../constants/enums.js';

/**
 * NHCONE Coins — customer-facing endpoints. Thin by design: everything
 * that actually moves a balance lives in coin.service.js and is invoked
 * from the checkout/delivery/refund flows, never from a route a browser
 * calls directly (Section 22 of the V1 spec).
 *
 * Wallet identity always comes from `req.user._id` (the authenticated
 * session) — never from a request param/body — so one user can never read
 * another user's Coins.
 */

// @desc    This customer's own Coin wallet summary
// @route   GET /api/coins
// @access  Private
export const getMyWallet = asyncHandler(async (req, res) => {
  const wallet = await getOrCreateWallet(req.user._id);
  return ok(res, {
    availableCoins: wallet.availableCoins,
    reservedCoins: wallet.reservedCoins,
    lifetimeEarned: wallet.lifetimeEarned,
    lifetimeUsed: wallet.lifetimeUsed,
    lifetimeReversed: wallet.lifetimeReversed,
    lifetimeRefunded: wallet.lifetimeRefunded,
  });
});

// @desc    This customer's own Coin transaction history
// @route   GET /api/coins/history?type=&page=&limit=
// @access  Private
export const getMyCoinHistory = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);
  const { type } = req.query;
  const filter = type && COIN_TRANSACTION_TYPES.includes(type) ? type : undefined;

  const { rows, total } = await getCoinHistory(req.user._id, { skip, limit, type: filter });
  return paginated(res, rows, { page, limit, total });
});

// @desc    Customer-safe Coin rules (no admin-only fields)
// @route   GET /api/coins/config
// @access  Private
export const getPublicCoinConfig = asyncHandler(async (req, res) => {
  const config = getCoinConfig();
  return ok(res, {
    earnPercentage: config.earnPercentage,
    coinValue: config.coinValue,
    minimumRedemptionOrderValue: config.minimumRedemptionOrderValue,
    maximumRedemptionPercentage: config.maximumRedemptionPercentage,
    isActive: config.isActive,
  });
});
