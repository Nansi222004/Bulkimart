import CoinWallet from '../models/CoinWallet.js';
import CoinTransaction from '../models/CoinTransaction.js';
import Order from '../models/Order.js';
import Return from '../models/Return.js';
import { httpError } from '../utils/response.js';
import { COIN_TRANSACTION_TYPE, COIN_REFERENCE_TYPE, COIN_REWARD_STATUS, RETURN_STATUS } from '../constants/enums.js';
import { getCoinConfig } from './coinConfig.service.js';

/**
 * NHCONE Coins — the one place Coin business logic lives. Controllers and
 * other services (checkout, delivery, refund) call these functions; nothing
 * outside this file is allowed to write CoinWallet.availableCoins/
 * reservedCoins or create a CoinTransaction directly (Section 5 of the V1
 * spec — "controllers should remain thin").
 *
 * Every balance-changing function below follows the same two-step shape:
 *   1. One atomic `findOneAndUpdate` with the safety condition embedded in
 *      the query filter (e.g. `availableCoins: { $gte: amount }`) — the
 *      established project convention (see product.controller.js's
 *      adjustProductStock, deliveryPartner.controller.js's requestPayout)
 *      for "never read-then-check-then-write a counter under concurrency."
 *   2. A ledger row recording exactly what changed. If writing that row
 *      collides with an `idempotencyKey` already used (the caller retried
 *      the same real-world event — a repeated webhook, a repeated delivery
 *      event), the wallet mutation from step 1 is rolled back and the
 *      ORIGINAL transaction is returned instead — the event is a no-op,
 *      never applied twice.
 */

const round2 = (n) => Math.round(n * 100) / 100;

/* ============================================================================
 * WALLET
 * ========================================================================== */

export const getOrCreateWallet = async (userId, session) => {
  try {
    return await CoinWallet.findOneAndUpdate(
      { userId },
      { $setOnInsert: { userId } },
      { upsert: true, new: true, setDefaultsOnInsert: true, session }
    );
  } catch (err) {
    if (err.code === 11000) {
      // Two concurrent first-time calls both tried to create the wallet —
      // exactly one insert wins on the unique userId index, the other just
      // reads what the winner created.
      return CoinWallet.findOne({ userId }).session(session || null);
    }
    throw err;
  }
};

export const getWallet = (userId) => getOrCreateWallet(userId);

export const getCoinHistory = async (userId, { skip = 0, limit = 20, type } = {}) => {
  const filter = { userId };
  if (type) filter.type = type;
  const [rows, total] = await Promise.all([
    CoinTransaction.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    CoinTransaction.countDocuments(filter),
  ]);
  return { rows, total };
};

/* ============================================================================
 * PURE CALCULATIONS — no DB access, safe to call on any hot path
 * ========================================================================== */

/**
 * Floored, never rounded up — the platform must never owe more Coins than
 * the eligible value actually earns. `eligibleValue` must already exclude
 * any Coin discount (Section 2/15 of the spec — Coins are never part of
 * their own reward base).
 */
export const calculateEarnedCoins = (eligibleValue, config = getCoinConfig()) => {
  const value = Math.max(0, Number(eligibleValue) || 0);
  if (!config.isActive) return 0;
  return Math.floor((value * config.earnPercentage) / 100 / config.coinValue);
};

/**
 * `eligibleOrderValue` must be the TOTAL eligible order/cart value, never a
 * single product's price (Section 1 — "eligibleOrderValue >= 500", not
 * "product.price >= 500"). Returns everything the checkout response needs
 * to show, all server-calculated.
 */
export const calculateRedemptionEligibility = (eligibleOrderValue, availableCoins, config = getCoinConfig()) => {
  const value = Math.max(0, Number(eligibleOrderValue) || 0);
  const balance = Math.max(0, Math.floor(Number(availableCoins) || 0));

  const eligible = Boolean(config.isActive) && value >= config.minimumRedemptionOrderValue;
  const maxCoinsAllowed = eligible ? Math.floor((value * config.maximumRedemptionPercentage) / 100 / config.coinValue) : 0;
  const coinsToUse = eligible ? Math.min(balance, maxCoinsAllowed) : 0;
  const coinDiscount = round2(coinsToUse * config.coinValue);

  return { eligible, maxCoinsAllowed, coinsToUse, coinDiscount };
};

/**
 * The merchandise value a DELIVERED order actually earns Coins on —
 * reconstructed from the order's OWN frozen `pricing` snapshot (Section 10:
 * "determine eligible purchase value from authoritative order data"), never
 * recomputed from live product/campaign prices.
 *
 * `order.pricing.discount` already has `couponDiscount` folded into it (see
 * order.controller.js::createOrder's Order.create call) — subtracting both
 * would double-count the coupon. Deliberately excludes `coinDiscount`: a
 * Coin discount must never shrink the value Coins are earned on (Section
 * 2/15 — "the coin discount itself must not reduce the reward
 * calculation"), and excludes delivery/donation, which were never part of
 * the merchandise value to begin with.
 */
export const eligibleValueOfOrder = (order) => {
  const p = order?.pricing || {};
  const value = (Number(p.subtotal) || 0) - (Number(p.discount) || 0);
  return Math.max(0, Math.round(value * 100) / 100);
};

/* ============================================================================
 * LEDGER — internal helper shared by every mutation below
 * ========================================================================== */

/**
 * Writes one ledger row for a mutation already applied to the wallet.
 * `before` is derived arithmetically from `after` + the exact `$inc` that
 * was just applied (`rollbackInc`, negated) — cheaper and just as correct
 * as a second read, since we already know precisely what changed.
 *
 * On an idempotency collision (E11000 on `idempotencyKey`), the mutation is
 * undone via `rollbackInc` and the PRE-EXISTING transaction is returned —
 * the caller sees this as a successful, idempotent no-op, not an error.
 *
 * Returns `{ transaction, wallet }` rather than just the transaction: on
 * the duplicate path the wallet passed in (`after`) is stale — it reflects
 * the mutation that was just undone — so the current, post-rollback wallet
 * is re-read here and handed back instead. Every caller in this file
 * returns THIS wallet, never the `after` it computed itself, so a retried
 * call can never report a balance that doesn't actually exist in the DB.
 */
const writeLedger = async ({ userId, type, amount, after, rollbackInc, referenceType, referenceId, idempotencyKey, description, metadata, adminId, reason, session }) => {
  // rollbackInc is the exact inverse of the $inc already applied, so
  // reversing it arithmetically recovers the pre-mutation balance without
  // a second DB read: before = after + rollbackInc.
  const before = {
    availableCoins: after.availableCoins + (rollbackInc.availableCoins || 0),
    reservedCoins: after.reservedCoins + (rollbackInc.reservedCoins || 0),
  };

  try {
    const [transaction] = await CoinTransaction.create([{
      userId, type, amount,
      availableBefore: before.availableCoins, availableAfter: after.availableCoins,
      reservedBefore: before.reservedCoins, reservedAfter: after.reservedCoins,
      referenceType, referenceId, idempotencyKey, description, metadata, adminId, reason,
    }], { session });
    return { transaction, wallet: after };
  } catch (err) {
    await CoinWallet.updateOne({ userId }, { $inc: rollbackInc }, { session });
    if (err.code === 11000 && idempotencyKey) {
      const existing = await CoinTransaction.findOne({ idempotencyKey }).session(session || null);
      if (existing) {
        const currentWallet = await CoinWallet.findOne({ userId }).session(session || null);
        return { transaction: existing, wallet: currentWallet };
      }
    }
    throw err;
  }
};

const validateAmount = (amount) => {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw httpError(400, 'Coin amount must be a positive whole number');
  }
};

/* ============================================================================
 * MUTATIONS — reserve -> redeem (success) or reserve -> release (failure)
 * ========================================================================== */

/** AVAILABLE -> RESERVED. Fails cleanly (400) if the balance is insufficient. */
export const reserveCoins = async ({ userId, amount, referenceType, referenceId, idempotencyKey, description, metadata, session }) => {
  validateAmount(amount);
  const after = await CoinWallet.findOneAndUpdate(
    { userId, availableCoins: { $gte: amount } },
    { $inc: { availableCoins: -amount, reservedCoins: amount } },
    { new: true, session }
  );
  if (!after) {
    const exists = await CoinWallet.exists({ userId }).session(session || null);
    throw httpError(400, exists ? 'Insufficient Coin balance' : 'Coin wallet not found');
  }
  return writeLedger({
    userId, type: COIN_TRANSACTION_TYPE.RESERVE, amount, after,
    rollbackInc: { availableCoins: amount, reservedCoins: -amount },
    referenceType, referenceId, idempotencyKey, description, metadata, session,
  });
};

/** RESERVED -> AVAILABLE. Called when a reservation's payment fails/expires/is cancelled. */
export const releaseReservedCoins = async ({ userId, amount, referenceType, referenceId, idempotencyKey, description, metadata, session }) => {
  validateAmount(amount);
  const after = await CoinWallet.findOneAndUpdate(
    { userId, reservedCoins: { $gte: amount } },
    { $inc: { reservedCoins: -amount, availableCoins: amount } },
    { new: true, session }
  );
  if (!after) throw httpError(400, 'No matching reserved Coins to release');
  return writeLedger({
    userId, type: COIN_TRANSACTION_TYPE.RELEASE, amount, after,
    rollbackInc: { reservedCoins: amount, availableCoins: -amount },
    referenceType, referenceId, idempotencyKey, description, metadata, session,
  });
};

/** RESERVED -> permanently spent. Called once, when payment settles successfully. */
export const redeemReservedCoins = async ({ userId, amount, referenceType, referenceId, idempotencyKey, description, metadata, session }) => {
  validateAmount(amount);
  const after = await CoinWallet.findOneAndUpdate(
    { userId, reservedCoins: { $gte: amount } },
    { $inc: { reservedCoins: -amount, lifetimeUsed: amount } },
    { new: true, session }
  );
  if (!after) throw httpError(400, 'No matching reserved Coins to redeem');
  return writeLedger({
    userId, type: COIN_TRANSACTION_TYPE.REDEEM, amount, after,
    rollbackInc: { reservedCoins: amount, lifetimeUsed: -amount },
    referenceType, referenceId, idempotencyKey, description, metadata, session,
  });
};

/** Credits Coins earned on DELIVERED. Upserts the wallet — a customer's first-ever reward may arrive before any checkout-triggered wallet creation. */
export const creditEarnedCoins = async ({ userId, amount, referenceType, referenceId, idempotencyKey, description, metadata, session }) => {
  validateAmount(amount);
  const after = await CoinWallet.findOneAndUpdate(
    { userId },
    { $inc: { availableCoins: amount, lifetimeEarned: amount } },
    { new: true, upsert: true, setDefaultsOnInsert: true, session }
  );
  return writeLedger({
    userId, type: COIN_TRANSACTION_TYPE.EARN, amount, after,
    rollbackInc: { availableCoins: -amount, lifetimeEarned: -amount },
    referenceType, referenceId, idempotencyKey, description, metadata, session,
  });
};

/**
 * Claws back previously-earned Coins when their order/item is refunded or
 * cancelled after DELIVERED. Deliberately has NO `$gte` balance guard — the
 * V1 spec's "hard case" (Section 13): the customer may have already spent
 * these Coins on a different order. `availableCoins` going negative here is
 * an intentional, fully-audited state (see CoinWallet.js's file comment),
 * never silently clamped to zero and never a fabricated balance.
 */
export const reverseEarnedCoins = async ({ userId, amount, referenceType, referenceId, idempotencyKey, description, metadata, session }) => {
  validateAmount(amount);
  const after = await CoinWallet.findOneAndUpdate(
    { userId },
    { $inc: { availableCoins: -amount, lifetimeReversed: amount } },
    { new: true, upsert: true, setDefaultsOnInsert: true, session }
  );
  return writeLedger({
    userId, type: COIN_TRANSACTION_TYPE.REVERSAL, amount, after,
    rollbackInc: { availableCoins: amount, lifetimeReversed: -amount },
    referenceType, referenceId, idempotencyKey, description, metadata, session,
  });
};

/** Restores Coins that were REDEEMed on an order later cancelled/refunded. */
export const refundRedeemedCoins = async ({ userId, amount, referenceType, referenceId, idempotencyKey, description, metadata, session }) => {
  validateAmount(amount);
  const after = await CoinWallet.findOneAndUpdate(
    { userId },
    { $inc: { availableCoins: amount, lifetimeRefunded: amount } },
    { new: true, upsert: true, setDefaultsOnInsert: true, session }
  );
  return writeLedger({
    userId, type: COIN_TRANSACTION_TYPE.REFUND, amount, after,
    rollbackInc: { availableCoins: -amount, lifetimeRefunded: -amount },
    referenceType, referenceId, idempotencyKey, description, metadata, session,
  });
};

/**
 * Explicit admin balance correction (Section 19). Not exposed on any route
 * yet (Package 6) — the service primitive exists now so the ledger/rollback
 * contract is identical to every other mutation. `amount` may be negative
 * (a deduction) or positive (a credit); the stored ledger `amount` is
 * always the positive magnitude, per CoinTransaction's schema.
 */
export const adjustCoins = async ({ userId, amount, adminId, reason, idempotencyKey, description }) => {
  if (!Number.isInteger(amount) || amount === 0) throw httpError(400, 'Adjustment amount must be a non-zero whole number');
  if (!adminId || !reason) throw httpError(400, 'An admin identity and a reason are required for a Coin adjustment');

  const after = await CoinWallet.findOneAndUpdate(
    { userId },
    { $inc: { availableCoins: amount } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
  return writeLedger({
    userId, type: COIN_TRANSACTION_TYPE.ADJUSTMENT, amount: Math.abs(amount), after,
    rollbackInc: { availableCoins: -amount },
    referenceType: COIN_REFERENCE_TYPE.ADMIN, referenceId: String(adminId), idempotencyKey, description, adminId, reason,
  });
};

/**
 * Diagnostic only — never mutates anything. The wallet's current balance
 * must equal the last ledger row's "after" snapshot, since every mutation
 * above writes both together in the same logical step; a mismatch means
 * something wrote to CoinWallet outside this service.
 */
export const reconcileWallet = async (userId) => {
  const wallet = await getOrCreateWallet(userId);
  const latest = await CoinTransaction.findOne({ userId }).sort({ createdAt: -1 });
  const consistent = !latest || (latest.availableAfter === wallet.availableCoins && latest.reservedAfter === wallet.reservedCoins);
  return { wallet, latestTransaction: latest, consistent };
};

/* ============================================================================
 * RETURN-WINDOW COIN REWARD (Phase 7)
 * ========================================================================== */

/**
 * The Coin-earning value of ONE order item's REMAINING (non-returned)
 * quantity — the item-level equivalent of `eligibleValueOfOrder`, using the
 * exact same proportional-allocation method already established and tested
 * in services/return.service.js::calculateReturnRefund (Phase 6B), so this
 * is a reused convention, not a second invented rule.
 *
 * `order.pricing.discount` already equals the coupon discount (see
 * order.controller.js's `Order.create` — `discount: pricing.discount +
 * pricing.couponDiscount`, where the local `discount` is always 0), which is
 * exactly what `eligibleValueOfOrder` itself excludes — kept identical here
 * for a single item's share. `coinDiscount` is deliberately NEVER subtracted
 * (Section 13 — Coins must never shrink their own reward base).
 */
export const computeItemEligibleValue = (order, item) => {
  const pricing = order?.pricing || {};
  const orderSubtotal = (order?.items || []).reduce((sum, it) => sum + (it.price || 0) * (it.qty || 0), 0);
  const itemLineGross = (item.price || 0) * (item.qty || 0);
  const shareOfOrder = orderSubtotal > 0 ? itemLineGross / orderSubtotal : 0;

  const itemDiscount = shareOfOrder * (pricing.discount || 0); // already == couponDiscount, see above
  const itemFullValue = Math.max(0, itemLineGross - itemDiscount);

  const remainingQty = Math.max(0, (item.qty || 0) - (item.returnedQty || 0));
  const remainingFraction = item.qty > 0 ? remainingQty / item.qty : 0;

  return Math.round(itemFullValue * remainingFraction * 100) / 100;
};

/** Non-terminal Return statuses — their existence must block a reward decision until resolved. */
const ACTIVE_RETURN_STATUSES = [
  RETURN_STATUS.RETURN_REQUESTED, RETURN_STATUS.UNDER_REVIEW, RETURN_STATUS.APPROVED,
  RETURN_STATUS.AWAITING_RETURN, RETURN_STATUS.RETURN_RECEIVED,
  RETURN_STATUS.REFUND_PENDING, RETURN_STATUS.REFUND_FAILED,
];

/**
 * Evaluates and, where safe, credits ONE order item's pending Coin reward.
 * Never called directly with untrusted input — only from
 * `processReturnWindowRewards` below, against a freshly-read Order.
 *
 * Concurrency (Section 16): the PENDING -> ELIGIBLE transition is claimed
 * with an atomic, query-guarded `updateOne` — the same "condition embedded
 * in the filter" convention this whole file already uses for every wallet
 * mutation — so two workers racing on the same item can never both proceed;
 * exactly one `modifiedCount === 1`.
 *
 * Restart safety (Section 18): if the process dies between claiming
 * ELIGIBLE and finishing the credit, the item is left in ELIGIBLE — which
 * the sweeper's own query (below) also matches — so the next tick resumes
 * exactly here and re-attempts the (idempotent, via CoinTransaction
 * idempotencyKey) credit rather than skipping it.
 */
const evaluateOneItem = async (order, item) => {
  const now = new Date();
  if (!item.coinRewardEligibleAt || item.coinRewardEligibleAt > now) return 'not-yet-due';

  if (item.coinRewardStatus === COIN_REWARD_STATUS.PENDING) {
    const activeReturn = await Return.exists({ orderItemId: item._id, status: { $in: ACTIVE_RETURN_STATUSES } });
    if (activeReturn) return 'blocked-by-active-return'; // stays PENDING — re-evaluated on a later tick

    const eligibleValue = computeItemEligibleValue(order, item);
    const earnedCoins = calculateEarnedCoins(eligibleValue);

    const claim = await Order.updateOne(
      { _id: order._id, 'items._id': item._id, 'items.coinRewardStatus': COIN_REWARD_STATUS.PENDING },
      { $set: { 'items.$.coinRewardStatus': COIN_REWARD_STATUS.ELIGIBLE, 'items.$.coinRewardAmount': earnedCoins } }
    );
    if (claim.modifiedCount !== 1) return 'lost-claim-race'; // another worker already claimed it
    item.coinRewardStatus = COIN_REWARD_STATUS.ELIGIBLE;
    item.coinRewardAmount = earnedCoins;
  }

  // Reached either just above, or on a retry of an item already ELIGIBLE
  // from a prior, interrupted attempt.
  const amount = item.coinRewardAmount || 0;
  if (amount <= 0) {
    await Order.updateOne(
      { _id: order._id, 'items._id': item._id, 'items.coinRewardStatus': COIN_REWARD_STATUS.ELIGIBLE },
      { $set: { 'items.$.coinRewardStatus': COIN_REWARD_STATUS.BLOCKED } }
    );
    return 'blocked-zero-value';
  }

  await creditEarnedCoins({
    userId: order.userId, amount,
    referenceType: COIN_REFERENCE_TYPE.ORDER_ITEM, referenceId: String(item._id),
    idempotencyKey: `EARN:${order._id}:${item._id}`,
    description: `Purchase reward for order ${order.orderNo}`,
    metadata: { orderId: String(order._id), orderNo: order.orderNo, orderItemId: String(item._id) },
  });
  await Order.updateOne(
    { _id: order._id, 'items._id': item._id, 'items.coinRewardStatus': COIN_REWARD_STATUS.ELIGIBLE },
    { $set: { 'items.$.coinRewardStatus': COIN_REWARD_STATUS.CREDITED } }
  );
  return 'credited';
};

/**
 * The Coins half of the return-window reward sweep — called from the
 * existing `orderSweeper.service.js` tick (Section 17: no new scheduler).
 * Only ever scans items still PENDING or ELIGIBLE whose own
 * `coinRewardEligibleAt` has passed (the compound index on Order.js makes
 * this a real index scan, never a full collection scan), so a legacy order
 * with no reward fields at all (Section 20) is structurally invisible to
 * this query — it simply never matches.
 */
export const processReturnWindowRewards = async ({ limit = 100 } = {}) => {
  const now = new Date();
  const orders = await Order.find({
    items: {
      $elemMatch: {
        coinRewardStatus: { $in: [COIN_REWARD_STATUS.PENDING, COIN_REWARD_STATUS.ELIGIBLE] },
        coinRewardEligibleAt: { $lte: now },
      },
    },
  }).limit(limit);

  let processed = 0;
  for (const order of orders) {
    for (const item of order.items) {
      if (![COIN_REWARD_STATUS.PENDING, COIN_REWARD_STATUS.ELIGIBLE].includes(item.coinRewardStatus)) continue;
      if (!item.coinRewardEligibleAt || item.coinRewardEligibleAt > now) continue;
      try {
        const outcome = await evaluateOneItem(order, item);
        if (outcome === 'credited' || outcome === 'blocked-zero-value') processed++;
      } catch (err) {
        console.error(`[COINS SWEEPER] item ${item._id} on order ${order._id} failed:`, err.message);
      }
    }
  }
  return { ordersScanned: orders.length, processed };
};
