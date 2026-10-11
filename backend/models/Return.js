import mongoose from 'mongoose';
import {
  RETURN_STATUS, RETURN_STATUSES, RETURN_REASONS, RESTOCK_DECISIONS,
  RESTOCK_STATUS, RESTOCK_STATUSES, RETURN_REFUND_STATUSES,
  RETURN_PICKUP_STATUS, RETURN_PICKUP_STATUSES, OFFER_ATTEMPT_STATUS, OFFER_ATTEMPT_STATUSES,
} from '../constants/enums.js';

const { Schema, model } = mongoose;
const ObjectId = Schema.Types.ObjectId;

/**
 * One customer's return of a SPECIFIC QUANTITY of a SPECIFIC Order item —
 * never the whole order. `order.controller.js::requestReturn` (the legacy
 * whole-order endpoint) is untouched and unrelated; this is the real,
 * item-level system described in the V1 spec.
 *
 * Everything needed to judge and refund this return is SNAPSHOTTED here at
 * request time — productName/Image/price come from the Order item itself
 * (already frozen at purchase, per Phase 3), never a fresh Product lookup,
 * because a Product's name/image/price/category can all change after the
 * sale (Section 15 of the spec).
 *
 * Every status transition is recorded in `history` — the current `status`
 * field is a projection of that history, never the only record of it.
 */
const returnHistorySchema = new Schema(
  {
    fromStatus:    String,
    toStatus:      { type: String, required: true },
    changedBy:     { type: ObjectId, refPath: 'history.changedByModel' },
    changedByModel: { type: String, enum: ['User', 'Admin'] },
    changedByRole: String, // 'customer' | 'admin' — human-readable, independent of the ref
    comment:       String,
    timestamp:     { type: Date, default: Date.now },
  },
  { _id: false }
);

/**
 * One rider's offer for the REVERSE PICKUP leg (customer -> rider -> seller)
 * of a Quick Commerce return. Same shape and same "one row per rider,
 * resolved in place, never duplicated" discipline as Order.js's own
 * `offerAttemptSchema` for a forward delivery — kept as its own copy here
 * rather than imported, because a Return is not an Order and this array
 * lives on a completely different document.
 */
const returnPickupOfferSchema = new Schema(
  {
    riderId:     { type: ObjectId, ref: 'DeliveryPartner', required: true },
    status:      { type: String, enum: OFFER_ATTEMPT_STATUSES, default: OFFER_ATTEMPT_STATUS.OFFERED },
    offeredAt:   { type: Date, default: Date.now },
    respondedAt: Date,
    expiredAt:   Date,
    reason:      String, // decline-only
  },
  { _id: false }
);

const returnSchema = new Schema(
  {
    returnNumber: { type: String, required: true, unique: true },

    orderId:     { type: ObjectId, ref: 'Order', required: true, index: true },
    orderItemId: { type: ObjectId, required: true, index: true }, // Order.items[]._id — a subdocument, not its own collection

    customerId: { type: ObjectId, ref: 'User', required: true, index: true },
    sellerId:   { type: ObjectId, ref: 'Seller', index: true },
    shgStoreId: { type: ObjectId, ref: 'SHGStore' },
    productId:  { type: ObjectId, ref: 'Product', required: true },
    variantId:  { type: ObjectId },

    // Snapshotted from the Order item at request time — never re-read from
    // the live Product, which may have changed name/image/price since.
    productName:       String,
    productImage:      String,
    unitPriceSnapshot: { type: Number, required: true },

    quantity: { type: Number, required: true, min: 1 },

    reason:              { type: String, enum: RETURN_REASONS, required: true },
    customerDescription: String,
    attachments: [
      {
        _id: false,
        url:      String,
        publicId: String,
        fileName: String,
        mimeType: String,
      },
    ],

    status: { type: String, enum: RETURN_STATUSES, default: RETURN_STATUS.RETURN_REQUESTED, index: true },
    history: { type: [returnHistorySchema], default: [] },

    // The item's OWN return-window snapshot (Phase 3), copied here purely
    // for convenient reading on the Return record — the Order item remains
    // the one authoritative copy; this is never re-derived independently.
    returnWindowDaysSnapshot:   Number,
    returnEligibleUntilSnapshot: Date,
    headerCategoryId:   { type: ObjectId, ref: 'Category' },
    headerCategoryName: String,

    requestedAt: { type: Date, default: Date.now },
    reviewedAt:  Date,
    approvedAt:  Date,
    rejectedAt:  Date,
    receivedAt:  Date,
    refundedAt:  Date,

    reviewedBy: { type: ObjectId, ref: 'Admin' },
    receivedBy: { type: ObjectId, ref: 'Admin' },

    adminComment:    String,
    rejectionReason: String,

    // Refund — CALCULATION (Phase 4/6, services/return.service.js
    // ::calculateReturnRefund) + real gateway EXECUTION (Phase 6,
    // ::processReturnRefund). `refundBreakdown` is computed and frozen the
    // FIRST time this return enters REFUND_PENDING, then reused verbatim on
    // every retry — never silently recomputed, so the audited figure never
    // drifts even if pricing code changes later.
    refundBreakdown: {
      itemGrossAmount:          Number,
      allocatedCouponDiscount:  Number,
      allocatedCdsDiscount:     Number,
      allocatedCoinDiscount:    Number,
      allocatedCoinsCount:      Number, // whole Coins to restore via coin.service.js::refundRedeemedCoins
      refundAmount:             Number,
    },
    refundAmount:        Number, // mirrors refundBreakdown.refundAmount — kept flat for existing readers (admin list/detail, customer UI)
    refundStatus:        { type: String, enum: RETURN_REFUND_STATUSES },
    refundReference:     String, // PhonePe refundId on success; 'MANUAL-COD' on a manual COD settlement
    refundFailureReason: String,
    refundAttemptedAt:   Date,
    // Atomic processing lock (Phase 6J/6K) — set only while a refund attempt
    // (gateway call in flight) is actually running, cleared in a `finally`.
    // A stale lock (crash mid-attempt) is reclaimable after 5 minutes — see
    // return.service.js::processReturnRefund.
    refundLockedAt:      Date,
    // Manual COD settlement — the only way a COD return's refund ever
    // reaches a terminal state, since no automatic COD money-movement
    // mechanism exists in this codebase (Phase 6M).
    codSettledBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
    codSettledAt:   Date,
    codSettlementNote: String,

    // Set by Admin when marking RETURN_RECEIVED (Section 26 of the spec).
    // `restockDecision` is the admin's INTENT; `restockStatus` records
    // whether the actual, one-time Product.stock mutation has happened yet
    // (Phase 6N/6P) — kept separate so a retry can never double-restock.
    restockDecision: { type: String, enum: RESTOCK_DECISIONS },
    restockStatus:   { type: String, enum: RESTOCK_STATUSES, default: RESTOCK_STATUS.NOT_PROCESSED },

    // Future Shiprocket reverse-logistics fields — reserved, never faked.
    // Every one of these stays null/undefined until a real integration
    // (a later, separate phase) actually sets it. UNRELATED to `pickup`
    // below — that's the real, working internal-rider reverse pickup;
    // these remain a courier/AWB-shaped placeholder for a different,
    // not-yet-built integration.
    reverseShipmentId:  String,
    awbNumber:           String,
    courierName:         String,
    trackingUrl:         String,
    pickupScheduledAt:   Date,
    pickedUpAt:          Date,
    inTransitAt:         Date,

    /**
     * QUICK COMMERCE ONLY — the internal-rider reverse pickup (customer ->
     * rider -> seller), reusing the existing DeliveryPartner/Delivery
     * infrastructure exactly the way a forward order does. Deliberately a
     * SEPARATE concept from `status` above (Section 21): this tracks where
     * the physical item is, `status` tracks the refund/approval workflow.
     * A `Delivery` document (models/Delivery.js, `direction:'return_pickup'`)
     * is the fine-grained trip record — `deliveryId` just points to it.
     *
     * `sellerConfirmedReceivedAt` is the Seller's own physical-receipt
     * signal — distinct from, and never a substitute for, Admin's
     * authoritative RETURN_RECEIVED transition on `status` above (still
     * only reachable via services/return.service.js::transitionReturnStatus,
     * unchanged). This field only tells Admin the item is physically back.
     */
    pickup: {
      partnerId:  { type: ObjectId, ref: 'DeliveryPartner' },
      deliveryId: { type: ObjectId, ref: 'Delivery' },
      offerAttempts: { type: [returnPickupOfferSchema], default: [] },
      status: { type: String, enum: RETURN_PICKUP_STATUSES, default: RETURN_PICKUP_STATUS.NOT_ASSIGNED },
      sellerConfirmedReceivedAt: Date,
    },
  },
  { timestamps: true }
);

returnSchema.index({ orderItemId: 1, status: 1 });
returnSchema.index({ customerId: 1, requestedAt: -1 });
returnSchema.index({ sellerId: 1, requestedAt: -1 });
returnSchema.index({ status: 1, requestedAt: -1 });
returnSchema.index({ 'pickup.partnerId': 1, 'pickup.status': 1 });

// Same convention as Order.js's orderNo / PackagingOrder.js's orderNumber.
returnSchema.pre('validate', async function () {
  if (!this.returnNumber) {
    const d = new Date();
    const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    const rand = Math.random().toString(36).slice(2, 8).toUpperCase().padEnd(6, '0');
    this.returnNumber = `RET-${ymd}-${rand}`;
  }
});

const Return = model('Return', returnSchema);
export default Return;
