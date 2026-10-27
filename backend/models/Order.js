import mongoose from "mongoose";
import { ORDER_TYPES, DELIVERY_TYPES, DELIVERY_MODES, PAYMENT_METHODS, OFFER_ATTEMPT_STATUSES, COIN_REWARD_STATUSES } from "../constants/enums.js";

const { Schema, model } = mongoose;
const ObjectId = Schema.Types.ObjectId;

/**
 * What was promised, and what it cost, at the moment the order was placed.
 *
 * A snapshot on purpose. Every number here is computed from rules that live in
 * environment variables and can be re-tuned in an afternoon — the incentive, the
 * fee, the rider's rates. Reading them live when displaying an old order would
 * quietly restate history: a customer opening a receipt from last month would
 * see today's prices against last month's purchase. So the figures are frozen
 * here and never recomputed.
 *
 * The four amounts stay four fields rather than one total, because they answer
 * to different people. `fee` is charged for carrying the parcel;
 * `sellerIncentive` is charged for fulfilling it quickly; `riderPayoutQuoted` is
 * what the platform expects to pay out and is not customer money at all. Summing
 * them into a single column would make every later question — what did the
 * customer pay for delivery, what did we owe the rider — unanswerable.
 *
 * `riderPayoutQuoted` is what the offer promised, not what was settled. The
 * amount actually paid is written to `Delivery.partnerEarnings` on completion by
 * the existing rider flow; keeping the quote separate is what makes it possible
 * to notice when the two disagree.
 *
 * Absent on every Quick order and on everything placed before Same-Day existed,
 * which is why nothing here is required.
 */
const orderDeliverySchema = new Schema(
  {
    /** What the customer chose. See DELIVERY_MODE — distinct from deliveryType. */
    mode: { type: String, enum: DELIVERY_MODES },

    /**
     * The ordinary delivery charge this order would have carried anyway.
     *
     * Recorded because Same-Day is added on top of it rather than replacing it,
     * so without this the delivery line does not add up: a ₹80 charge made of a
     * ₹40 standard fee and a ₹40 premium would show only the premium's ₹40 of
     * explanation. With it the three parts reconcile exactly to
     * `pricing.deliveryCharge`, which stays the single figure the payment is
     * taken against.
     *
     * Already net of the spend threshold and any free-shipping coupon — those
     * waive this part and only this part.
     */
    standardFee: { type: Number, min: 0 },

    /** The Same-Day premium for carrying it today. Never waived. */
    fee: { type: Number, min: 0 },

    /**
     * Charged to the customer for Same-Day fulfilment, on the seller's behalf.
     * Recorded here; no settlement engine exists yet to pay it onward.
     */
    sellerIncentive: { type: Number, min: 0 },

    /** What the rider was offered. Platform cost, never charged to the customer. */
    riderPayoutQuoted: { type: Number, min: 0 },

    /** Shop to doorstep, as measured when the promise was made. */
    distanceKm: { type: Number, min: 0 },

    /** The delivery promise shown at checkout. */
    promisedBy: Date,
  },
  { _id: false }
);

const orderItemSchema = new Schema({
  productId:  { type: ObjectId },
  variantId:  { type: ObjectId },
  sku:        String,
  variantName: String,
  variantAttributes: [{ name: String, value: String }],
  unitSnapshot: String,
  weightSnapshot: Number,
  name:       String,
  image:      String,
  qty:        Number,
  price:      Number,
  wholesaleSnapshot: {
    type: new Schema({
      minimumQuantity: { type: Number, required: true },
      quantityIncrement: { type: Number, required: true },
      tierMinimumQuantity: { type: Number, required: true },
      unitPrice: { type: Number, required: true },
    }, { _id: false }),
    default: undefined,
    immutable: true,
  },
  // Set only when `price` reflects an accepted Campaign deal rather than
  // the product's normal price — a receipt-time record of why this line
  // charged what it did. The deal itself lives in CampaignParticipation;
  // this is only a pointer, never a second copy of the discount math.
  campaignId: { type: ObjectId, ref: "Campaign" },
  sellerId:   { type: ObjectId, ref: "Seller" },
  shgStoreId: { type: ObjectId, ref: "SHGStore" },
  type:       String,
  fulfillmentType: { type: String, enum: ['physical', 'digital'], default: 'physical' },
  // An e-book line that took one of the seller's limited copies at checkout;
  // only these give a copy back on cancellation.
  stockReserved: { type: Boolean },
  digitalSnapshot: {
    author: String,
    language: String,
    licenseTerms: String,
    format: String,
  },
  digitalFile: {
    type: new Schema({
      fileId: String,
      sha256: String,
      sizeBytes: Number,
      status: { type: String, enum: ['uploaded'] },
    }, { _id: false }),
    select: false,
  },
  additionalMessage: { type: String, default: "" },

  /**
   * The Return & Refund category policy, frozen at the moment THIS order
   * was created — never a live join to CategoryReturnPolicy. Resolved via
   * services/returnPolicy.service.js::buildReturnPolicySnapshot, the same
   * header-category walk (leaf/mid -> parent:null) Admin's own policy
   * screen uses; never recomputed later, so an Admin editing the category's
   * window afterwards can never move this order's own deadline.
   *
   * `returnWindowDays: null` means no policy was configured for this
   * item's header at all when the order was placed — distinct from an
   * admin's own explicit `0` (still non-returnable, but a deliberate
   * choice, not an absence). Both read as `returnEligible: false`.
   */
  returnPolicy: {
    headerCategoryId:   { type: ObjectId, ref: "Category" },
    headerCategoryName: String,
    returnEligible:     { type: Boolean, default: false },
    returnWindowDays:   { type: Number, default: null },
    source: { type: String, enum: ['global'] },

    /**
   * Seller return preference at purchase time. The resolved eligibility and
     * window above are immutable order terms, independent of later product edits.
   */
    sellerReturnable: { type: Boolean },
  },

  /**
   * When THIS item was actually delivered — set once, by whichever of the
   * two existing DELIVERED transitions applies (deliveryPartner.controller.js
   * ::verifyDeliveryOtp for rider-carried orders, seller.controller.js
   * ::updateOrderStatus for courier-carried ones). Always stamped on
   * delivery regardless of return eligibility; `returnEligibleUntil` is the
   * one that stays null for a non-returnable item.
   */
  deliveredAt: Date,

  /** deliveredAt + returnPolicy.returnWindowDays, computed once at delivery time. Null when not return-eligible. */
  returnEligibleUntil: Date,

  /**
   * Quantity of THIS item currently reserved by a Return that hasn't been
   * rejected/cancelled — i.e. RETURN_REQUESTED through REFUNDED, every
   * status except REJECTED/CANCELLED (see RETURN_QUANTITY_RELEASING_STATUSES
   * in constants/enums.js). Mutated ONLY via the atomic
   * `Order.updateOne({..., 'items._id':..., returnedQty:{$lte: qty-requested}}, {$inc:{'items.$.returnedQty': requested}})`
   * pattern in services/return.service.js — never read-then-written — so two
   * concurrent return requests for the same item can never together exceed
   * `qty`. Decremented back on REJECTED/CANCELLED. `qty - returnedQty` is
   * the live "still returnable" amount.
   */
  returnedQty: { type: Number, default: 0 },

  /**
   * NHCONE Coins — return-window-aware earning (Phase 7). Coins are no
   * longer credited immediately at DELIVERED; instead this item enters
   * PENDING and a sweeper (services/orderSweeper.service.js, reusing its
   * existing setInterval) evaluates it once `coinRewardEligibleAt` has
   * passed AND no non-terminal Return exists for it (services/coin.service.js
   * ::processReturnWindowRewards). Left entirely `undefined` on any item
   * delivered before this field existed — that is what makes a legacy,
   * already-rewarded order permanently invisible to the sweeper's query,
   * with no backfill and no re-evaluation ever attempted.
   */
  coinRewardStatus:     { type: String, enum: COIN_REWARD_STATUSES },
  // Returnable item: deliveredAt + returnWindowDays (the same instant as
  // `returnEligibleUntil` — reused, never recomputed a second way).
  // Non-returnable item: `deliveredAt` itself — no window to wait out.
  coinRewardEligibleAt: Date,
  // Frozen once computed (whichever of PENDING->ELIGIBLE resolves it) —
  // never recomputed after that, even though recomputing it again would be
  // deterministic; kept explicit for audit/display.
  coinRewardAmount:     Number,
});

const timelineSchema = new Schema({
  status:    String,
  timestamp: { type: Date, default: Date.now },
  note:      String,
});

/**
 * One rider's response to being offered this order.
 *
 * Lives here rather than on `Delivery` because a `Delivery` document does not
 * exist until a rider actually accepts — every OFFERED/DECLINED_BY_RIDER/
 * OFFER_EXPIRED attempt happens before that, so `Order` is the only document
 * around for the whole pre-accept phase to attach to.
 *
 * `respondedAt` and `expiredAt` are separate fields rather than one shared
 * timestamp so a later read never has to infer which kind of ending it was
 * from which field happens to be set — the `status` says that, the field
 * name confirms it.
 */
const offerAttemptSchema = new Schema({
  riderId:     { type: ObjectId, ref: "DeliveryPartner", required: true },
  status:      { type: String, enum: OFFER_ATTEMPT_STATUSES, default: "OFFERED" },
  offeredAt:   { type: Date, default: Date.now },
  respondedAt: Date, // set when the rider accepts or declines
  expiredAt:   Date, // set when the offer times out unanswered
  reason:      String, // only ever set on a decline
});

const orderSchema = new Schema(
  {
    orderNo: { type: String, unique: true }, // ORD-YYYYMMDD-RANDOM6
    userId:  { type: ObjectId, ref: "User", required: true },

    /**
     * The checkout this order came out of, when one checkout produced several.
     *
     * A unified basket can hold two shops and two delivery modes, and each of
     * those is a separate journey — a separate pickup, status, carrier and
     * rider. They cannot be one order, because seven places downstream read
     * "the first item with a seller" as *the* pickup. So checkout creates one
     * order per fulfilment group and ties them together with this.
     *
     * Absent on every order placed the ordinary way, which is all 121 of them
     * today. Nothing reads it unless it is there.
     */
    groupRef: { type: String, index: true },

    /**
     * The subscription this order was generated from, when it was one.
     *
     * Absent on every ordinary order — nothing existing reads either field.
     * They exist only so the rider's OTP-completion step (which already
     * knows nothing about subscriptions) can, as one small additive step,
     * write the outcome back onto the matching `Subscription.deliverySchedule`
     * row once this order is delivered.
     */
    subscriptionId:             { type: ObjectId, ref: "Subscription" },
    subscriptionDeliveryEntryId: { type: ObjectId },
    type:    { type: String, enum: ORDER_TYPES, required: true },
    // Physical channel remains unchanged for delivery, returns and commission.
    salesChannel: { type: String, enum: ['retail', 'wholesale'], default: 'retail', immutable: true },
    items:   [orderItemSchema],

    shippingAddress: {
      name:          String,
      phone:         String,
      line1:         String,
      line2:         String,
      city:          String,
      state:         String,
      pincode:       String,
      lat:           Number,
      lng:           Number,
      landmarkImage: { type: String, default: null },

      /**
       * How the coordinates were arrived at.
       *
       *   gps      — the customer stood there and tapped the button
       *   manual   — they typed it and a pin was placed
       *   geocoded — nobody pinned anything; checkout looked the text up
       *
       * Worth keeping apart. A geocoded pincode can land most of a kilometre
       * from the actual door, so a rider who cannot find the place, or a
       * distance that looks wrong, is explained by this field rather than
       * blamed on the rider.
       */
      locationSource: { type: String, enum: ['gps', 'manual', 'geocoded'] },
    },

    pricing: {
      subtotal:       { type: Number, default: 0 },
      discountRepresentation: { type: String, enum: ['components-v1'] },
      discount:       { type: Number, default: 0 }, // distinct promotion component; coupon stored separately
      couponDiscount: { type: Number, default: 0 },
      couponCode:     String,
      cdsDiscount:    { type: Number, default: 0 }, // CDS member discount
      deliveryCharge: { type: Number, default: 0 },
      // Help Wallet / Social Work contribution — additive, never discounted
      // or waived by a coupon. donationTitle is a snapshot of the prompt's
      // title at the moment of the order, same discipline the delivery
      // snapshot uses, so an old receipt reads as it did then.
      donationAmount: { type: Number, default: 0 },
      donationTitle:  String,
      donationComment: { type: String, maxlength: 250, default: "" },
      /**
       * A tip for the rider, chosen by the customer at checkout.
       *
       * Additive and never discounted, exactly like donationAmount above —
       * and deliberately kept out of deliveryCharge. The delivery charge is
       * the platform's fee for carrying the parcel; this is the customer's
       * money for the person who carried it, and it is paid out to that rider
       * in full on delivery (see deliveryPartner.controller.js's
       * verifyDeliveryOtp). Keeping them as two fields is what makes "the
       * rider gets 100% of the tip" a thing the code can actually state.
       */
      tipAmount:      { type: Number, default: 0 },
      // NHCONE Coins redeemed on this order — a snapshot, not a live
      // reference. CoinConfig (1 Coin = ₹1, max redemption %) may change
      // later; this order must keep reading what was actually charged.
      // The full audit trail lives in CoinTransaction (see coin.service.js);
      // this is only the amount, never a duplicate of that ledger.
      coinsUsed:      { type: Number, default: 0 },
      coinDiscount:   { type: Number, default: 0 },
      totalAmount:    { type: Number, default: 0 }, // already net of coinDiscount
    },

    coupon:        { type: ObjectId, ref: "Coupon" },
    paymentMethod: { type: String, enum: PAYMENT_METHODS },
    paymentId:     { type: ObjectId, ref: "Payment" },
    financialSnapshot: { type: Schema.Types.Mixed, immutable: true },
    financialOperationLog: { type: [Schema.Types.Mixed], default: undefined },
    financialRevision: { type: Number, default: 0 },
    financialPosting: { type: String, enum: ['held', 'eligible', 'reversed'] },
    financialReturnQuantities: { type: Schema.Types.Mixed, default: {} },
    // Cash evidence is separate from customer payment and seller payable.
    codFinance: { type: Schema.Types.Mixed },
    // Last attempt by the finance automation job; an error explains why the
    // order still needs admin attention. Never holds money values.
    financeAutomation: { type: Schema.Types.Mixed },
    // Why the breakdown could not be frozen at checkout (order still placed).
    financialSnapshotError: { type: Schema.Types.Mixed },

    // Vendor acceptance is deliberately separate from payment state. Online
    // payment may complete before the shop responds; it must never count as
    // the shop accepting the work.
    vendorDecision: {
      status: { type: String, enum: ["pending", "accepted", "rejected"], default: "pending" },
      sellerId: { type: ObjectId, ref: "Seller" },
      reason: String,
      decidedAt: Date,
    },

    /**
     * Delivery routing — who carries this parcel.
     *
     * `internal` is one of our own riders, `shiprocket` is a courier. Absent
     * until seller selection on new regular e-commerce orders. `delivery.mode` below
     * records what the customer was offered and picked, which is a different
     * question with a different audience.
     */
    deliveryType: { type: String, enum: DELIVERY_TYPES },

    // What was promised and charged at placement. Absent on Quick orders.
    delivery: { type: orderDeliverySchema, default: undefined },

    // Shiprocket (E-Commerce only)
    shiprocket: {
      environment: { type: String, enum: ['mock', 'sandbox', 'live'] },
      orderId:     String,
      shipmentId:  String,
      awb:         String,
      courier:     String,
      labelUrl:    String,
      trackingUrl: String,
      status:      String,
      idempotencyKey: String,
      operationId: String,
      requestedAt: Date,
      lastError: String,
      lastErrorAt: Date,
      pickupScheduledAt: Date,
      pickupLocation: String,
      pickupAddress: { address: String, address_2: String, city: String, state: String, pin_code: String, pickup_location: String, verificationMode: String },
      package: { length: Number, breadth: Number, height: Number, weight: Number },
      webhookEvents: [{
        eventId: String,
        status: String,
        receivedAt: Date,
      }],
    },

    fulfillment: {
      requestedRiderId: { type: ObjectId, ref: 'DeliveryPartner' },
      readyAt: Date,
      assignmentPolicy: { type: String, enum: ['seller_after_acceptance'] },
      method: { type: String, enum: ["manual", "shiprocket", "third_party"] },
      selectedBy: { type: String, enum: ["seller", "admin", "system"] },
      selectedAt: Date,
      quote: {
        provider: String,
        courierCharge: Number,
        serviceFee: Number,
        customerDeliveryCharge: Number,
        customerAdditionalCharge: Number,
        quotedAt: Date,
        billingPolicy: { type: String, enum: ['checkout_charge_unchanged'] },
        currency: { type: String, default: "INR" },
        expiresAt: Date,
      },
      vendorConfirmedAt: Date,
      feeRuleVersion: String,
      chargeStatus: { type: String, enum: ["not_applicable", "pending", "blocked", "collected", "refunded"] },
      failureReason: String,
      financialSnapshotId: { type: ObjectId, ref: "QuickCommerceFinancialSnapshot" },
    },

    // Internal delivery (QCommerce + SHG)
    deliveryPartnerId: { type: ObjectId, ref: "DeliveryPartner" },
    deliveryId:        { type: ObjectId, ref: "Delivery" },

    assignmentHistory: [{
      partnerId: { type: ObjectId, ref: "DeliveryPartner" },
      assignedBy: { type: ObjectId },
      assignedByRole: { type: String, enum: ["admin", "seller", "system", "rider"] },
      assignedAt: { type: Date, default: Date.now },
      unassignedAt: Date,
      reason: String,
    }],

    // Every rider this order was offered to, and how each one resolved.
    // Empty on every order today — nothing writes to it yet.
    offerAttempts: [offerAttemptSchema],

    // Status + Timeline
    status: {
      type: String,
      enum: [
        "placed", "confirmed", "preparing", "dispatched",
        "out_for_delivery", "delivered", "cancelled",
        "return_requested", "returned", "refunded",
      ],
      default: "placed",
    },
    timeline:     [timelineSchema],
    cancelReason: String,

    /**
     * Money this order owes back, when the payment cannot be touched.
     *
     * A unified checkout takes one payment for several orders. Cancelling one of
     * them must not queue a refund for the whole payment — the other two are
     * still being delivered, and marking the shared record refund-pending would
     * be false about both of them.
     *
     * So the debt is recorded here instead, on the order that actually owes it,
     * with the amount that order was worth. A future refund phase reads this;
     * nothing today acts on it, and nothing pretends the customer has been paid.
     *
     * Absent on ordinary single-order payments, which keep queueing the refund
     * on the Payment exactly as they do now.
     */
    refundPending: {
      status: String,
      providerRefundId: String,
      amount:   { type: Number, min: 0 },
      reason:   String,
      markedAt: Date,
    },

    /**
     * Nobody could be found to carry this.
     *
     * Set when the widening rider search gives up. The order is deliberately
     * left alive — the shop has packed it and the customer has paid — so this
     * is the flag that stops it disappearing into the "dispatched" pile
     * unnoticed, and it is what an admin assignment board would query on.
     */
    needsManualAssignment: { type: Boolean, default: false },
    returnReason: String,
    returnImages: [String],
    notes:        String,
  },
  { timestamps: true }
);

orderSchema.index({ userId: 1, createdAt: -1 });
orderSchema.index({ status: 1 });
// The Coins reward sweeper's own query shape (Phase 7) — only ever scans
// items still PENDING/ELIGIBLE whose eligible-at has passed, never every
// historical order.
orderSchema.index({ 'items.coinRewardStatus': 1, 'items.coinRewardEligibleAt': 1 });

orderSchema.pre('save', function () {
  if (!this.isNew && this.isModified('financialSnapshot')) throw new Error('Order financial snapshots are immutable');
});
for (const operation of ['updateOne', 'updateMany', 'findOneAndUpdate']) {
  orderSchema.pre(operation, function () {
    const update = this.getUpdate();
    if (Array.isArray(update)) throw new Error('Order pipeline replacement requires explicit financial history review');
    const snapshotPath = path => path === 'financialSnapshot' || String(path).startsWith('financialSnapshot.');
    for (const [operator, value] of Object.entries(update || {})) {
      const paths = operator.startsWith('$') ? Object.entries(value || {}) : [[operator, value]];
      if (paths.some(([path, target]) => snapshotPath(path) || operator === '$rename' && snapshotPath(target))) throw new Error('Order financial snapshots are immutable');
    }
  });
}
for (const operation of ['replaceOne', 'findOneAndReplace']) orderSchema.pre(operation, function () { throw new Error('Order replacement would discard financial history'); });

// Generate orderNo BEFORE validation — `unique` + required checks run at validate time,
// so a pre('save') hook would fire too late and the first two orders would collide on null.
orderSchema.pre("validate", async function () {
  if (this.isNew && !this.financialSnapshot) {
    const { buildOrderFinancialSnapshot } = await import('../services/vendorCommission.service.js');
    try {
      this.financialSnapshot = await buildOrderFinancialSnapshot(this, this.$session());
    } catch (error) {
      // Finance bookkeeping must never block a customer's checkout. An order
      // whose breakdown cannot be frozen (unusual quantity, price precision,
      // a rule larger than the item) is settled through the reviewed
      // old-order process instead; the reason is kept for the admin.
      // Database errors are not swallowed.
      if (!error?.status) throw error;
      this.financialSnapshotError = { message: error.message, at: new Date() };
      console.error(`[FINANCE] Order breakdown not recorded: ${error.message}`);
    }
  }
  if (!this.orderNo) {
    const d = new Date();
    const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
    const rand = Math.random().toString(36).slice(2, 8).toUpperCase().padEnd(6, "0");
    this.orderNo = `ORD-${ymd}-${rand}`;
  }
});

const Order = model("Order", orderSchema);
export default Order;
