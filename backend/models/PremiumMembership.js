import mongoose from "mongoose";

const { Schema, model } = mongoose;
const ObjectId = Schema.Types.ObjectId;

/**
 * One customer Premium Membership purchase attempt.
 *
 * `planName`/`durationMonths`/`amount` are a SNAPSHOT taken at purchase time,
 * not a live reference — an admin raising a plan's price later must not
 * rewrite what a customer already paid and already owns. `planId` is kept
 * only for traceability (which catalog entry this was bought from). Same
 * discipline SHGSubscription.js already follows.
 *
 * Effective access is never "status === 'active'" alone — it is always
 * status + expiresAt compared against the current time, computed fresh on
 * every check (see services/premium.service.js). `status` here is a cache
 * for display/admin/queries, not the security boundary.
 *
 * One active membership entitles a customer to create ANY number of Product
 * Subscriptions while it lasts, and its expiry blocks only the creation of
 * new ones — subscriptions already running are untouched by it.
 */
const premiumMembershipSchema = new Schema(
  {
    userId: { type: ObjectId, ref: "User", required: true },
    planId: { type: ObjectId, ref: "PremiumPlan" },

    planName:       String,
    durationMonths: Number,
    amount:         Number,

    paymentId: { type: ObjectId, ref: "Payment" },

    startsAt:  Date,
    expiresAt: Date,

    status: {
      type: String,
      enum: ["payment_pending", "active", "expired"],
      default: "payment_pending",
    },
  },
  { timestamps: true }
);

premiumMembershipSchema.index({ userId: 1, status: 1 });

const PremiumMembership = model("PremiumMembership", premiumMembershipSchema);
export default PremiumMembership;
