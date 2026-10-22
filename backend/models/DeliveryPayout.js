import mongoose from 'mongoose';
import { DELIVERY_PAYOUT_STATUS, DELIVERY_PAYOUT_STATUSES } from '../constants/enums.js';

const { Schema, model } = mongoose;
const ObjectId = Schema.Types.ObjectId;

/**
 * A rider-initiated withdrawal request against `DeliveryPartner.earnings.pending`.
 *
 * `earnings.pending`/`earnings.total`/`earnings.paid` on DeliveryPartner remain
 * the single source of truth for the ledger — this record is not a second
 * balance. Creating a request atomically carves `amount` out of
 * `earnings.pending` (reserved, not yet paid); resolving it either moves that
 * reservation into `earnings.paid` (completed) or returns it to
 * `earnings.pending` (rejected) — see requestPayout/processDeliveryPayoutRequest.
 *
 * Coexists with the pre-existing admin bulk `settleRiderPayout` action
 * (admin.controller.js), which just operates on whatever `earnings.pending`
 * currently is — since a reservation already removed its amount from that
 * field the moment the request was made, there is no double-count.
 */
const deliveryPayoutSchema = new Schema(
  {
    partnerId: { type: ObjectId, ref: 'DeliveryPartner', required: true },
    userId:    { type: ObjectId, ref: 'User', required: true },

    amount: { type: Number, required: true, min: 1 },
    financeVersion: Number,
    idempotencyKey: String,
    transactionRef: String,
    reconciliationReason: String,

    status: {
      type: String,
      enum: DELIVERY_PAYOUT_STATUSES,
      default: DELIVERY_PAYOUT_STATUS.PENDING,
      index: true,
    },

    // The bank/UPI details as they stood at request time — a rider who
    // edits their bank details after requesting must not silently change
    // where an already-pending request settles.
    payoutMethod: {
      upiId:      String,
      accountNo:  String,
      ifsc:       String,
      holderName: String,
      bankName:   String,
    },

    processedBy: { type: ObjectId, ref: 'Admin' },
    processedAt: Date,
    rejectionReason: String,
  },
  { timestamps: true }
);

deliveryPayoutSchema.index({ partnerId: 1, status: 1 });

// Enforces "at most one pending request per rider" at the database level.
// A read-then-create check in the controller cannot do this atomically —
// concurrent requests would all pass the read before any of them writes —
// so the invariant is a unique index instead: a second concurrent insert
// while one is still pending collides on this index and fails with E11000,
// which the controller maps to 409.
deliveryPayoutSchema.index(
  { partnerId: 1 },
  { unique: true, partialFilterExpression: { status: 'pending' } }
);

export default model('DeliveryPayout', deliveryPayoutSchema);
