import mongoose from 'mongoose';
import { COIN_TRANSACTION_TYPES, COIN_REFERENCE_TYPES } from '../constants/enums.js';

const { Schema, model } = mongoose;
const ObjectId = Schema.Types.ObjectId;

/**
 * An immutable, append-only ledger row for every Coin balance change.
 * Nothing ever mutates `availableCoins`/`reservedCoins` on CoinWallet
 * without writing one of these in the same operation (coin.service.js is
 * the only code allowed to write either) — "never silently modify
 * balances without an auditable transaction" (V1 spec Section 3).
 *
 * `amount` is always a positive magnitude; `type` says which direction and
 * which counter it affects (see coin.service.js's mutation functions for
 * the exact mapping). `availableBefore/After` and `reservedBefore/After`
 * are captured together on every row — including RESERVE/RELEASE, which
 * only move Coins between the two counters — so a reader never has to
 * infer one counter's history from a row that only reported the other.
 *
 * `idempotencyKey` is how a repeated delivery/webhook/refund event is
 * guaranteed to only ever apply once: callers derive a deterministic key
 * per real-world event (e.g. `EARN:<orderId>:<productId>`,
 * `REDEEM:<orderId>`, `REFUND:<orderId>`) and the unique index below
 * rejects a second attempt at the database level — never a read-then-write
 * check in application code, which cannot be trusted under concurrency.
 */
const coinTransactionSchema = new Schema(
  {
    userId: { type: ObjectId, ref: 'User', required: true },
    type:   { type: String, enum: COIN_TRANSACTION_TYPES, required: true },

    /** Always a positive magnitude — never store a signed delta here. */
    amount: { type: Number, required: true, min: 0 },

    availableBefore: { type: Number, required: true },
    availableAfter:  { type: Number, required: true },
    reservedBefore:  { type: Number, required: true },
    reservedAfter:   { type: Number, required: true },

    referenceType: { type: String, enum: COIN_REFERENCE_TYPES, required: true },
    // A plain string, not an ObjectId ref: Package 3's line-item attribution
    // needs composite keys like "<orderId>:<productId>", not just an id.
    referenceId: { type: String, required: true },

    description: String,

    status: { type: String, enum: ['COMPLETED', 'REVERSED'], default: 'COMPLETED' },

    // ADJUSTMENT only (Section 19) — who did it and why. Never set by any
    // automated flow.
    adminId: { type: ObjectId, ref: 'Admin' },
    reason:  String,

    metadata: { type: Schema.Types.Mixed, default: {} },

    // One real-world event (a delivery, a refund, a reservation attempt)
    // produces exactly one row with this key. Sparse so ledger types that
    // don't need replay protection (none currently, but kept flexible)
    // aren't forced to fabricate one.
    idempotencyKey: { type: String },
  },
  { timestamps: true }
);

coinTransactionSchema.index({ userId: 1, createdAt: -1 });
coinTransactionSchema.index({ userId: 1, type: 1, createdAt: -1 });
coinTransactionSchema.index({ referenceType: 1, referenceId: 1 });
coinTransactionSchema.index({ idempotencyKey: 1 }, { unique: true, sparse: true });

const CoinTransaction = model('CoinTransaction', coinTransactionSchema);
export default CoinTransaction;
