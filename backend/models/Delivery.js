import mongoose from "mongoose";

const { Schema, model } = mongoose;
const ObjectId = Schema.Types.ObjectId;

const deliverySchema = new Schema(
  {
    orderId:        { type: ObjectId, ref: "Order" },
    subscriptionId: { type: ObjectId, ref: "Subscription" },
    partnerId:      { type: ObjectId, ref: "DeliveryPartner", required: true },

    /**
     * QUICK COMMERCE ONLY — whether this trip carries an order FORWARD
     * (seller -> customer, every Delivery before this field existed) or is
     * a Return's REVERSE pickup (customer -> seller). `returnId` is the
     * reverse-leg's counterpart to `orderId`/`subscriptionId` above — never
     * both set on the same document. `pickupLocation`/`dropLocation` below
     * already carry whichever direction actually applies; this field only
     * tells a reader which one to expect without inferring it from which
     * foreign key happens to be set.
     */
    direction: { type: String, enum: ["forward", "return_pickup"], default: "forward" },
    returnId:  { type: ObjectId, ref: "Return" },

    pickupLocation: {
      address: String,
      lat:     Number,
      lng:     Number,
    },
    dropLocation: {
      address: String,
      lat:     Number,
      lng:     Number,
    },

    route: {
      distanceKm:  Number,
      durationMin: Number,
      polyline:    String, // encoded Google Maps polyline
    },

    /**
     * Where the rider is in this trip.
     *
     * `arrived_at_store` and `arrived_at_customer` were missing, so the two
     * moments a customer most wants to see had nowhere to live. Arriving at the
     * shop was being recorded as `assigned` — the initial value — which moved
     * the delivery backwards and made "just accepted" indistinguishable from
     * "standing at the counter".
     *
     * The order carries none of this: to a customer the parcel is simply "out
     * for delivery" the whole time, and this is what gives that hour some
     * texture.
     */
    status: {
      type: String,
      enum: [
        "assigned",
        "accepted",
        "arrived_at_store",
        "picked_up",
        "in_transit",
        "arrived_at_customer",
        "rejected",
        "delivered",
        "failed",
      ],
      default: "assigned",
    },

    /**
     * Delivery confirmation code.
     *
     * Sent to the customer only — never returned to the rider, or the code
     * stops being evidence that the two of them met. `otpAttempts` caps
     * guessing, since four digits is a short enough space to brute force.
     */
    otp:         String,
    otpVerified: { type: Boolean, default: false },
    otpAttempts: { type: Number, default: 0 },
    otpIssuedAt: Date,

    /**
     * Distance from the drop when the code was requested, in km.
     *
     * Recorded rather than enforced: a rider is never blocked by it, because
     * city GPS is unreliable enough that a gate would strand honest deliveries.
     * It exists so a pattern of codes requested from far away is visible after
     * the fact.
     */
    otpIssuedFromKm: Number,

    partnerLocation: {
      lat:       Number,
      lng:       Number,
      updatedAt: Date,
    },

    startTime:      Date,
    endTime:        Date,
    partnerEarnings:Number,
    financialEarningStatus: { type: String, enum: ['held', 'reconciliation_required', 'zero_value'] },

    /**
     * How much of partnerEarnings was the customer's tip.
     *
     * Broken out rather than left folded invisibly inside the total, because
     * the rider's earnings screen shows tips as their own line — a tip is the
     * one part of the payout that reflects how the rider was judged by the
     * person they delivered to, and burying it inside a single number would
     * make it unreportable. `partnerEarnings` still includes it; this is a
     * breakdown of that figure, not a second payment.
     */
    partnerTip:     { type: Number, default: 0 },

    /**
     * The pay rates this delivery was accepted under.
     *
     * Frozen when the rider takes the job, and what settlement reads. An admin
     * raising the per-kilometre rate mid-trip must not change what this rider
     * was promised — and lowering it must not either. Absent on deliveries that
     * predate configurable rates; settlement falls back to the live rate for
     * those, which is what it always did.
     */
    ratesUsed: {
      financeVersion: Number,
      mode:      { type: String },
      base:      { type: Number },
      perKm:     { type: Number },
      minPayout: { type: Number },
      maxPayout: { type: Number },
      rateId:    { type: ObjectId, ref: "DeliveryRate" },
    },
  },
  { timestamps: true }
);

deliverySchema.index({ partnerId: 1, status: 1 });
deliverySchema.index({ returnId: 1 });

const Delivery = model("Delivery", deliverySchema);
export default Delivery;
