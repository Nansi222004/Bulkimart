import mongoose from "mongoose";

const { Schema, model } = mongoose;

/**
 * Admin-managed catalog of SHG seller business-subscription plans.
 *
 * Purely a price list — a purchase never re-reads this document later. See
 * SHGSubscription.js for why: editing a plan here must only affect future
 * purchases, never an already-bought one.
 */
const subscriptionPlanSchema = new Schema(
  {
    name:           { type: String, required: true },
    durationMonths: { type: Number, required: true, min: 1 },
    price:          { type: Number, required: true, min: 0 },
    isActive:       { type: Boolean, default: true },
  },
  { timestamps: true }
);

const SubscriptionPlan = model("SubscriptionPlan", subscriptionPlanSchema);
export default SubscriptionPlan;
