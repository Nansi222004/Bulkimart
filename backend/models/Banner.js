import mongoose from "mongoose";
import { BANNER_TYPES } from "../constants/enums.js";

const { Schema, model } = mongoose;
const ObjectId = Schema.Types.ObjectId;

/**
 * A Banner is DISPLAY + DISCOVERY + NAVIGATION — never a discount, a paid
 * seller advertisement, a campaign, or a payment record. Keep it that way:
 * future Campaigns / Seller Promotions should be able to reference a
 * Banner by id, but pricing/payment fields belong on THOSE models, not
 * this one.
 *
 * `type` + `category` are the existing, working slot-scoping mechanism —
 * which storefront (Quick/Shop All/SHG) and which sub-nav tab a banner
 * shows under. Unchanged; still what HeroBanner.jsx queries by.
 *
 * `placement` is new, purely for the vocabulary the admin screen now
 * uses. Only 'HOME_HERO' is real today — that's the only slot any
 * frontend component actually renders. Kept as an enum (not a free
 * string) so a genuinely new placement can't be saved without a
 * frontend consumer already built for it.
 *
 * `actionType` + targets replace ad-hoc `targetRoute` string-parsing for
 * every banner created from here on. `targetRoute` is kept, unvalidated,
 * purely so the four seeded banners (seed/data/banners.js) and anything
 * else predating this still resolve exactly as before — HeroBanner falls
 * back to it only when actionType is absent or 'NONE' with no route.
 *
 * CAMPAIGN is now real: a Banner may point at a Campaign id, but the
 * discount/eligibility/pricing logic all still lives on Campaign and
 * CampaignParticipation — this model only ever stores which campaign to
 * link to, never a price or a discount value of its own.
 *
 * SELLER_PROMOTION is the same idea for a paid seller advertisement: a
 * Banner may point at a SellerPromotion id, but every approval/payment/
 * expiry rule lives on SellerPromotion — this model only stores which
 * promotion to link to. See sellerPromotion.service.js's syncPromotionBanner
 * (the SELLER_PROMOTION equivalent of campaign.controller.js's
 * syncLinkedBanner).
 */
const ACTION_TYPES = ['NONE', 'CATEGORY', 'PRODUCT', 'EXTERNAL_URL', 'CAMPAIGN', 'SELLER_PROMOTION'];

const bannerSchema = new Schema(
  {
    title:    String,
    subtitle: String,
    image:    { type: String, required: true }, // Cloudinary URL

    // Existing slot-scoping — unchanged.
    type:     { type: String, enum: BANNER_TYPES, required: true },
    category: { type: String, default: 'home' },

    placement: { type: String, enum: ['HOME_HERO'], default: 'HOME_HERO' },

    actionType: { type: String, enum: ACTION_TYPES, default: 'NONE' },
    targetCategory: { type: ObjectId, ref: 'Category' },
    targetProduct:  { type: ObjectId, ref: 'Product' },
    targetCampaign: { type: ObjectId, ref: 'Campaign' },
    targetPromotion: { type: ObjectId, ref: 'SellerPromotion' },
    externalUrl:    String,

    // Legacy — see file comment above.
    targetRoute: String,

    isActive: { type: Boolean, default: true }, // enabled/disabled
    // A draft never reaches the public API regardless of isActive/dates —
    // it's a genuinely separate state, not derivable from them.
    isDraft:  { type: Boolean, default: false },

    priority:   { type: Number, default: 0 }, // higher shows first (unchanged)
    startDate:  Date,
    endDate:    Date,
    clickCount: { type: Number, default: 0 },

    createdBy: { type: ObjectId, ref: 'Admin' },
    updatedBy: { type: ObjectId, ref: 'Admin' },
  },
  { timestamps: true }
);

bannerSchema.index({ type: 1, isActive: 1, priority: -1 });
bannerSchema.index({ placement: 1, isActive: 1 });

export const BANNER_ACTION_TYPES = ACTION_TYPES;

const Banner = model("Banner", bannerSchema);
export default Banner;
