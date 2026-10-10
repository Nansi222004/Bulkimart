import mongoose from "mongoose";

const { Schema, model } = mongoose;
const ObjectId = Schema.Types.ObjectId;

const deliveryScheduleSchema = new Schema({
  date:              { type: Date, required: true },
  // "packed" sits between scheduled and delivered: the seller has confirmed
  // the items and a real Order now exists for the rider pipeline to pick up.
  status:            { type: String, enum: ["scheduled", "packed", "delivered", "skipped", "failed"], default: "scheduled" },
  deliveryPartnerId: { type: ObjectId, ref: "DeliveryPartner" },
  deliveryId:        { type: ObjectId, ref: "Delivery" },
  otp:               String, // 4-digit delivery confirmation OTP
  // Set once the 30-minutes-before prep sweep has alerted the seller for
  // this row, so a later sweep tick does not alert them a second time.
  prepAlertSentAt:   Date,
});

const subscriptionSchema = new Schema(
  {
    userId:          { type: ObjectId, ref: "User", required: true },
    planType:        { type: String, enum: ["10day", "15day", "monthly", "custom"], required: true },
    planDuration:    Number, // number of days: 10, 15, 30, or custom

    /**
     * How often a delivery lands, and when.
     *
     * `planType` names the package the customer bought; these three describe the
     * rhythm they chose inside it. A 4-week weekly plan and a 30-day daily plan
     * are both "custom" by plan type and are nothing alike in practice, so the
     * cadence is recorded separately rather than inferred from the duration.
     *
     * `deliveryDay` only means something for a weekly plan — a daily plan
     * arrives every day, and a monthly one repeats the start date's calendar
     * day. `timeSlot` is the window the customer picked; it is the same for
     * every delivery in the plan, so it is stored once here rather than copied
     * onto each of the thirty schedule rows.
     */
    frequency:   { type: String, enum: ["daily", "weekly", "monthly"], default: "daily" },
    deliveryDay: String,   // 'Monday'…'Sunday' — weekly plans only
    timeSlot:    String,   // e.g. '09:00 AM - 10:00 AM'

    /**
     * The single shop this plan is fulfilled by, and what one delivery weighs.
     *
     * Both are checked when the plan is created and stored as the answer that
     * was accepted. A product can change seller or packaging later; a plan that
     * was legitimately within the weight ceiling when it was bought must not
     * start failing that check months into its run.
     *
     * Exactly one of `sellerId`/`shgStoreId` is ever set — same convention
     * Product/Order already use for a Seller-owned vs SHG-owned listing.
     * "The fulfilling vendor" is never ambiguous, and every reader that used
     * to assume `sellerId` alone must now check both.
     */
    sellerId:    { type: ObjectId, ref: "Seller" },
    shgStoreId:  { type: ObjectId, ref: "SHGStore" },
    weightKg:    Number,

    rationPackageId: { type: ObjectId, ref: "RationPackage" },
    customItems: [{
      productId: { type: ObjectId, ref: "Product" },
      qty:       Number,
    }],

    shippingAddress: {
      name:    String,
      phone:   String,
      line1:   String,
      city:    String,
      state:   String,
      pincode: String,
      lat:     Number,
      lng:     Number,
    },

    pricing: {
      totalAmount:  { type: Number, default: 0 },
      cdsDiscount:  { type: Number, default: 0 },
      finalAmount:  { type: Number, default: 0 },
      // What one delivery is worth — discount already spread evenly across
      // the plan. Read by packSubscriptionDelivery when it builds that
      // delivery's real Order, so the amount a rider sees is what this
      // plan was actually bought at, not a later re-derivation.
      perDeliveryAmount: { type: Number, default: 0 },
    },

    paymentId:        { type: ObjectId, ref: "Payment" },
    startDate:        Date,
    endDate:          Date,
    nextDeliveryDate: Date,

    status: {
      type: String,
      // A subscription is created into pending_seller_acceptance, not
      // active — the seller has not yet agreed to fulfil it. It only
      // becomes active once they accept (or auto-cancels if they don't,
      // see subscriptionAcceptSweeper.service.js).
      enum: ["pending_seller_acceptance", "active", "paused", "cancelled", "expired"],
      default: "pending_seller_acceptance",
    },
    // The deadline the accept sweeper checks against. Absent on every
    // subscription created before this field existed, which is fine — the
    // sweeper only ever queries pending_seller_acceptance rows, and no
    // pre-existing subscription can be in that status.
    sellerAcceptDeadline: Date,

    renewalCount:     { type: Number, default: 0 },
    deliverySchedule: [deliveryScheduleSchema],
  },
  { timestamps: true }
);

subscriptionSchema.index({ userId: 1, status: 1 });

const Subscription = model("Subscription", subscriptionSchema);
export default Subscription;
