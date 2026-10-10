import mongoose from "mongoose";

const { Schema, model } = mongoose;

/**
 * Admin-managed catalog of customer Premium Membership plans.
 *
 * Premium Membership is the entitlement to CREATE Product Subscriptions
 * (models/Subscription.js) — it is not itself a recurring delivery, and it
 * never touches one.
 *
 * Deliberately a separate collection from SubscriptionPlan, which is the SHG
 * *seller* business-plan catalog: the two are managed by different admin
 * screens for different audiences, and sharing one collection would put
 * customer plans in the SHG plan manager.
 *
 * Purely a price list — a purchased membership never re-reads this document.
 * See PremiumMembership.js for why: raising a price here must only affect
 * future purchases, never one already paid for.
 */
const premiumPlanSchema = new Schema(
  {
    name:           { type: String, required: true },
    durationMonths: { type: Number, required: true, min: 1 },
    price:          { type: Number, required: true, min: 0 },
    isActive:       { type: Boolean, default: true },
  },
  { timestamps: true }
);

const PremiumPlan = model("PremiumPlan", premiumPlanSchema);
export default PremiumPlan;
