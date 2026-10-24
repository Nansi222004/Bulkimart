import mongoose from "mongoose";
import { CHANNELS } from "../constants/enums.js";

const { Schema, model } = mongoose;
const ObjectId = Schema.Types.ObjectId;

/**
 * A coupon is a CODE plus the rules that decide whether it applies, how much it
 * is worth, and where. The code alone triggers nothing.
 *
 * Reward types:
 *   percentage    — % off the eligible items, optionally capped (protects margin
 *                   on large carts: "20% off, up to ₹200")
 *   fixed         — flat ₹ off
 *   free_shipping — waives the delivery charge only
 *
 * Scope narrows WHICH items the discount is calculated on. An empty scope array
 * means "everything"; filling one restricts the discount to those items, so a
 * "30% off Staples" coupon never discounts a shirt sitting in the same cart.
 */

export const DISCOUNT_TYPE = {
  PERCENTAGE: 'percentage',
  FIXED: 'fixed',
  FREE_SHIPPING: 'free_shipping',
};

const couponSchema = new Schema(
  {
    code: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
    },
    title: { type: String, required: true },
    description: String,

    // ---- reward ---------------------------------------------------------
    discountType: {
      type: String,
      enum: Object.values(DISCOUNT_TYPE),
      required: true,
    },
    // percentage → 0-100 ; fixed → rupees ; free_shipping → ignored
    value: { type: Number, default: 0, min: 0 },
    // Cap for percentage coupons. 0 / null means uncapped.
    maxDiscount: { type: Number, default: 0, min: 0 },

    // ---- conditions ------------------------------------------------------
    minOrderValue: { type: Number, default: 0, min: 0 },

    // ---- scope (empty array = applies to everything) ---------------------
    // 'all' lets one code work in both storefronts.
    channel: { type: String, enum: [...CHANNELS, 'all'], default: 'all' },
    categories: [{ type: ObjectId, ref: 'Category' }],
    products: [{ type: ObjectId, ref: 'Product' }],
    sellers: [{ type: ObjectId, ref: 'Seller' }],

    // ---- usage limits ----------------------------------------------------
    // 0 = unlimited
    totalUsageLimit: { type: Number, default: 0, min: 0 },
    usedCount: { type: Number, default: 0, min: 0 },
    perUserLimit: { type: Number, default: 1, min: 0 },

    // ---- eligibility -----------------------------------------------------
    firstOrderOnly: { type: Boolean, default: false },
    cdsMembersOnly: { type: Boolean, default: false },

    // ---- validity --------------------------------------------------------
    startsAt: { type: Date, default: Date.now },
    expiresAt: Date,
    isActive: { type: Boolean, default: true },

    // Shown in the "available offers" list on the cart screen.
    isPublic: { type: Boolean, default: true },
    // Existing coupons remain manual unless an admin opts in.
    autoApply: { type: Boolean, default: false },

    createdBy: { type: ObjectId, ref: 'Admin' },
  },
  { timestamps: true }
);

couponSchema.index({ isActive: 1, expiresAt: 1 });
couponSchema.index({ channel: 1, isActive: 1 });

/** True when the code itself is live — before any cart-specific checks. */
couponSchema.methods.isLive = function () {
  const now = new Date();
  if (!this.isActive) return false;
  if (this.startsAt && this.startsAt > now) return false;
  if (this.expiresAt && this.expiresAt < now) return false;
  if (this.totalUsageLimit > 0 && this.usedCount >= this.totalUsageLimit) return false;
  return true;
};

const Coupon = model("Coupon", couponSchema);
export default Coupon;
