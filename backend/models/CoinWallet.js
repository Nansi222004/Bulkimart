import mongoose from 'mongoose';

const { Schema, model } = mongoose;
const ObjectId = Schema.Types.ObjectId;

/**
 * One authoritative Coin balance per customer. Separate from the existing
 * `User.wallet` (a real-money in-app cash wallet, used for cash
 * credits/refunds — see User.js) — Coins are a distinct, non-cash reward
 * currency and must never be mixed with that field or its transactions.
 *
 * `availableCoins` — spendable right now.
 * `reservedCoins`  — carved out for an in-flight checkout attempt (between
 *                    "Use Coins" and payment settling), never spendable
 *                    elsewhere until released or redeemed. See
 *                    coin.service.js's reserve/release/redeem trio.
 * `lifetimeEarned/lifetimeUsed/lifetimeReversed/lifetimeRefunded` — pure
 *   historical counters, monotonically non-decreasing, for the customer
 *   Coins page and Admin dashboard. They never move balances themselves —
 *   only `availableCoins`/`reservedCoins` do that.
 *
 * `availableCoins` intentionally has no schema-level `min: 0`. Every wallet
 * mutation is guarded atomically in coin.service.js so it can never go
 * negative EXCEPT one deliberate case: reversing Coins that were earned on
 * an order which the customer has since spent elsewhere (Section 13 of the
 * V1 spec — "the hard case"). That reversal must still be recorded rather
 * than silently dropped or clamped, so a negative `availableCoins` is a
 * real, intentional, auditable state, not a bug — see
 * coin.service.js::reverseEarnedCoins.
 */
const coinWalletSchema = new Schema(
  {
    userId: { type: ObjectId, ref: 'User', required: true, unique: true },

    availableCoins: { type: Number, default: 0 },
    reservedCoins:  { type: Number, default: 0, min: 0 },

    lifetimeEarned:   { type: Number, default: 0, min: 0 },
    lifetimeUsed:     { type: Number, default: 0, min: 0 },
    lifetimeReversed: { type: Number, default: 0, min: 0 },
    lifetimeRefunded: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true }
);

const CoinWallet = model('CoinWallet', coinWalletSchema);
export default CoinWallet;
