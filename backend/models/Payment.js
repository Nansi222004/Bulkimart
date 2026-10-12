import mongoose from "mongoose";

const { Schema, model } = mongoose;
const ObjectId = Schema.Types.ObjectId;

const paymentSchema = new Schema(
  {
    userId:         { type: ObjectId, ref: "User", required: true },
    orderId:        { type: ObjectId, ref: "Order" },

    /**
     * The set of orders this one payment covers.
     *
     * A unified checkout is one payment across several fulfilment orders, so
     * confirming it has to reach all of them — `orderId` names only the first.
     * That field stays and still points somewhere valid, so everything that
     * walks payment → order keeps working; this is what the confirmation reads
     * when it needs to reach the rest.
     *
     * Absent on every ordinary payment, and its absence is what makes the old
     * single-order path the default.
     */
    groupRef:       { type: String, index: true },
    subscriptionId: { type: ObjectId, ref: "Subscription" },
    // Historical references retained only so older payment documents can be
    // read without rewriting financial records. No active flow creates them.
    shgSubscriptionId: { type: ObjectId, ref: "SHGSubscription" },
    premiumMembershipId: { type: ObjectId, ref: "PremiumMembership" },
    // A fourth payment purpose: a seller paying for a Seller Promotion
    // (advertisement) slot. Absent on every other payment, same as the
    // three above — which of these is set is what the shared PhonePe
    // webhook branches on.
    sellerPromotionId: { type: ObjectId, ref: "SellerPromotion" },
    // A fifth payment purpose: a seller buying NHCONE branded packaging
    // materials (a predefined package or a custom bulk order). Absent on
    // every other payment, same as the four above.
    packagingOrderId: { type: ObjectId, ref: "PackagingOrder" },
    // A sixth payment purpose: customer adding real money to their NHCONE Wallet.
    isWalletTopup:    { type: Boolean, default: false },
    amount:         { type: Number, required: true },
    method:         { type: String, enum: ["online", "wallet", "cod"], required: true },

    // NHCONE Coins redeemed against this payment's order — read by the
    // shared settle() so it can redeem/release the matching CoinWallet
    // reservation without a second Order lookup. 0 on every payment that
    // didn't use Coins, which is every payment before this field existed.
    coinsUsed:    { type: Number, default: 0 },
    coinDiscount: { type: Number, default: 0 },

    /**
     * Gateway-specific data. PhonePe is the configured provider; the shape is
     * kept generic so a second gateway does not need a schema change.
     */
    gateway: {
      provider:        String,   // 'phonepe'
      merchantOrderId: String,   // our id for this attempt: ORD-...-A1
      orderId:         String,   // PhonePe's id
      paymentId:       String,   // Razorpay payment id after verified capture/webhook
      signatureVerifiedAt: Date,
      initiatedAt:     Date,
      errorCode:       String,
      paymentDetails:  [mongoose.Schema.Types.Mixed],
    },

    // A shopper who abandons the PhonePe page retries with a new attempt id,
    // because PhonePe rejects a reused merchantOrderId.
    attempts: { type: Number, default: 0 },

    status: {
      type: String,
      enum: ["pending", "paid", "failed", "refunded", "partial_refund"],
      default: "pending",
    },
    paidAt: Date,

    refund: {
      amount:        Number,
      reason:        String,
      status:        { type: String, enum: ["pending", "processed", "failed"] },
      razorpayRefId: String,
      processedAt:   Date,
      // Additive fields for real Return-refund execution (Phase 6). A single
      // Payment can back several fulfilment orders in a unified checkout
      // (`groupRef`), so it may be partially refunded more than once — one
      // per returned order/item — hence a running total rather than a
      // single amount.
      merchantRefundId:     String, // our idempotency key sent to PhonePe: RETRF-<returnId>
      phonepeRefundId:      String, // PhonePe's own refundId from the last successful call
      gatewayState:         String, // PhonePe's last reported refund state (raw, informational)
      totalRefundedAmount:  { type: Number, default: 0 },
    },
  },
  { timestamps: true }
);

paymentSchema.index({ userId: 1, createdAt: -1 });
// the webhook arrives with only this id to go on
paymentSchema.index({ 'gateway.merchantOrderId': 1 });

const Payment = model("Payment", paymentSchema);
export default Payment;
