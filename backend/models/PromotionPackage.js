import mongoose from "mongoose";

const { Schema, model } = mongoose;

/**
 * Admin-managed price list for Seller Promotion (paid advertisement) slots.
 *
 * Same discipline as PremiumPlan.js: a purchased SellerPromotion snapshots
 * this package's name/duration/price at the moment of purchase (see
 * SellerPromotion.js's packageNameSnapshot/durationDaysSnapshot/
 * amountSnapshot) — raising a price here only ever affects future
 * purchases, never a promotion already bought.
 *
 * `placement` is deliberately restricted to the same enum Banner.placement
 * already uses ('HOME_HERO') — the only slot any frontend component
 * actually renders. A package cannot promise a placement nothing displays.
 *
 * `module` (V1): QUICK and E-commerce are priced and configured completely
 * separately — a package belongs to exactly one module, and a seller
 * choosing that module only ever sees packages scoped to it (Section 5/6).
 */
const promotionPackageSchema = new Schema(
  {
    name:         { type: String, required: true },
    module:       { type: String, enum: ['QUICK', 'ECOMMERCE'], required: true },
    durationDays: { type: Number, required: true, min: 1 },
    price:        { type: Number, required: true, min: 0 },
    placement:    { type: String, enum: ['HOME_HERO'], default: 'HOME_HERO' },
    maxProducts:  { type: Number, required: true, min: 1 },
    isActive:     { type: Boolean, default: true },
  },
  { timestamps: true }
);

promotionPackageSchema.index({ module: 1, isActive: 1 });

const PromotionPackage = model("PromotionPackage", promotionPackageSchema);
export default PromotionPackage;
