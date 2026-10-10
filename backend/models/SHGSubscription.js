import mongoose from "mongoose";

const { Schema, model } = mongoose;
const ObjectId = Schema.Types.ObjectId;

/**
 * One SHG business-subscription purchase attempt.
 *
 * `planName`/`durationMonths`/`amount` are a SNAPSHOT taken at purchase time,
 * not a live reference — an admin raising a plan's price later must not
 * rewrite what a seller already paid and already owns. `planId` is kept only
 * for traceability (which catalog entry this was bought from).
 *
 * Effective access is never "status === 'active'" alone — it is always
 * status + endDate compared against the current time, computed fresh on
 * every check (see requireActiveSHGSubscription in vendor.middleware.js and
 * the sweeper in shgSubscriptionSweeper.service.js). `status` here is a
 * cache for display/admin/queries, not the security boundary.
 */
const shgSubscriptionSchema = new Schema(
  {
    shgStoreId: { type: ObjectId, ref: "SHGStore", required: true },
    planId:     { type: ObjectId, ref: "SubscriptionPlan" },

    planName:        String,
    durationMonths:  Number,
    amount:          Number,

    paymentId: { type: ObjectId, ref: "Payment" },

    startDate: Date,
    endDate:   Date,

    status: {
      type: String,
      enum: ["payment_pending", "active", "expired"],
      default: "payment_pending",
    },

    // Date-only comparison (not a timestamp) — dedupes the daily expiry
    // reminder so a sweeper tick that runs more than once a day never
    // sends a second one.
    lastReminderSentOn: Date,
  },
  { timestamps: true }
);

shgSubscriptionSchema.index({ shgStoreId: 1, status: 1 });

const SHGSubscription = model("SHGSubscription", shgSubscriptionSchema);
export default SHGSubscription;
