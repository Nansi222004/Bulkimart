import mongoose from "mongoose";

const { Schema, model } = mongoose;
const ObjectId = Schema.Types.ObjectId;

/**
 * A Campaign is DISCOUNT / DEAL — never a payment record, never a seller
 * advertisement. It owns discount rules; it never touches Product.price.
 * A product's normal price is set by its seller and stays exactly that;
 * the deal a customer sees during a campaign lives entirely in
 * CampaignParticipation, keyed off a price snapshot taken when a seller
 * accepts — see that model's own comment for why.
 *
 * `targetType` is CATEGORY or PRODUCTS only for V1 — there is no
 * Collection model in this codebase, so COLLECTION targeting is not
 * implemented rather than inventing one just for this feature.
 *
 * Lifecycle (DRAFT/SCHEDULED/ACTIVE/EXPIRED/DISABLED) is never stored —
 * it's derived from `isDraft`/`isEnabled`/`startAt`/`endAt` at read time,
 * the same discipline Banner.js already uses, so it can never drift out
 * of sync with the clock.
 */
const TARGET_TYPES = ['CATEGORY', 'PRODUCTS'];
const DISCOUNT_TYPES = ['PERCENTAGE'];
const PARTICIPATION_MODES = ['SELLER_SELECTS_PRODUCTS'];

const campaignSchema = new Schema(
  {
    name: { type: String, required: true },
    description: String,
    bannerImage: String,

    // No `required`/`min`/`max` at the schema level — a Draft is allowed to
    // be incomplete or invalid on purpose (Step 29). The campaign.controller.js
    // `validateCampaignInput` is the sole authority here, and it only runs
    // when publishing (isDraft === false).
    targetType: { type: String, enum: TARGET_TYPES },
    targetCategory: { type: ObjectId, ref: 'Category' },
    targetProducts: [{ type: ObjectId, ref: 'Product' }],

    discountType: { type: String, enum: DISCOUNT_TYPES, default: 'PERCENTAGE' },
    discountValue: Number,

    startAt: Date,
    endAt: Date,

    participationMode: { type: String, enum: PARTICIPATION_MODES, default: 'SELLER_SELECTS_PRODUCTS' },

    isEnabled: { type: Boolean, default: true },
    isDraft: { type: Boolean, default: false },

    createdBy: { type: ObjectId, ref: 'Admin' },
    updatedBy: { type: ObjectId, ref: 'Admin' },
  },
  { timestamps: true }
);

campaignSchema.index({ isEnabled: 1, isDraft: 1, startAt: 1, endAt: 1 });
campaignSchema.index({ targetCategory: 1 });

export const CAMPAIGN_TARGET_TYPES = TARGET_TYPES;
export const CAMPAIGN_DISCOUNT_TYPES = DISCOUNT_TYPES;
export const CAMPAIGN_PARTICIPATION_MODES = PARTICIPATION_MODES;

const Campaign = model('Campaign', campaignSchema);
export default Campaign;
