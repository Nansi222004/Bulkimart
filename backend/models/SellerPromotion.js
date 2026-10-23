import mongoose from "mongoose";
import { advertisingCampaignSchema } from './advertising.schema.js';

const { Schema, model } = mongoose;
const ObjectId = Schema.Types.ObjectId;

/**
 * A seller's paid advertisement request — visibility bought through Admin
 * verification + PhonePe payment, NEVER a discount or a Product.price
 * change (that's Campaign/CampaignParticipation, a completely separate
 * domain — see campaign.controller.js's own file comment).
 *
 * State machine (Section 5 of the spec):
 *   DRAFT -> PENDING_REVIEW -> (CHANGES_REQUESTED -> PENDING_REVIEW)* -> APPROVED
 *         -> PAYMENT_PENDING -> ACTIVE -> EXPIRED
 *   PENDING_REVIEW can also end in REJECTED; DRAFT/PENDING_REVIEW/APPROVED
 *   can be CANCELLED by the seller; ACTIVE can be admin-DISABLED.
 *
 * The spec's diagram names a transient RESUBMITTED state between
 * CHANGES_REQUESTED and PENDING_REVIEW — nothing would ever read a
 * promotion sitting in that state (the admin queue is PENDING_REVIEW
 * either way), so resubmission moves straight CHANGES_REQUESTED ->
 * PENDING_REVIEW and stamps `resubmittedAt` instead, preserving the
 * information without a status value nothing consumes.
 *
 * `selectedProducts` is a live reference (productId only) per spec Section
 * 26 — never a frozen snapshot of product data. A deleted/deactivated
 * product just drops out of the public landing page; it does not need to
 * remain listed anywhere. Seller/shop data is likewise never duplicated
 * here (Section 27) — the landing page fetches it live from `sellerId`.
 *
 * `linkedBannerId` mirrors campaign.controller.js's Banner<->Campaign
 * linkage: this is the one Banner document kept in sync with this
 * promotion's image/dates/enabled-state once it goes ACTIVE, reusing the
 * existing customer Banner engine rather than building a second one.
 *
 * V1 business rules (module split + approval-based start):
 *  - `module` is fixed at creation (the seller's very first step) and never
 *    changes — "one advertisement = one module". A seller wanting both
 *    Quick and E-commerce visibility creates two separate promotions.
 *    `selectedProducts` and `packageId` are both validated against this
 *    same module (see sellerPromotion.controller.js).
 *  - CRITICAL: `expiresAt` is computed from `approvedAt` + the package's
 *    snapshotted duration AT APPROVAL TIME, not at payment time. A seller
 *    waiting on review never loses paid days, and a seller who delays
 *    paying after approval does not get the clock reset — see
 *    approveSellerPromotion/settleSellerPromotionPayment.
 */
const MODULES = ['QUICK', 'ECOMMERCE'];
const STATUSES = [
  'DRAFT', 'PENDING_REVIEW', 'CHANGES_REQUESTED', 'APPROVED',
  'PAYMENT_PENDING', 'ACTIVE', 'EXPIRED', 'REJECTED', 'CANCELLED', 'DISABLED',
];

const sellerPromotionSchema = new Schema(
  {
    // Explicit opt-in only. Legacy documents must never acquire v2 semantics.
    advertisingVersion: { type: Number, enum: [2] },
    advertising: { type: advertisingCampaignSchema, default: undefined },
    sellerId: { type: ObjectId, ref: "Seller", required: true },
    // Chosen once, at creation — never edited afterwards (Section 11's "one
    // advertisement = one module"). Everything downstream (eligible
    // products, eligible packages, the banner's storefront placement) is
    // scoped to this value.
    module: { type: String, enum: MODULES, required: true },

    // Not `required` at the schema level — a DRAFT can be saved incomplete,
    // same convention Banner.js/Campaign.js already use (isDraft skips
    // validation; publishing/submitting does not). Enforced in the
    // controller at submit time instead.
    title:       String,
    description: String,
    bannerImage: String, // Cloudinary URL — existing upload pipeline

    selectedProducts: [{ type: ObjectId, ref: "Product" }],

    packageId: { type: ObjectId, ref: "PromotionPackage" },
    // Snapshots taken at submission time — a later admin price change on
    // PromotionPackage must never rewrite what this seller agreed to pay.
    packageNameSnapshot:  String,
    durationDaysSnapshot: Number,
    amountSnapshot:       Number,
    placementSnapshot:    String,
    maxProductsSnapshot:  Number,

    status: { type: String, enum: STATUSES, default: 'DRAFT' },
    adminFeedback: String,

    paymentId:      { type: ObjectId, ref: "Payment" },
    linkedBannerId: { type: ObjectId, ref: "Banner" },

    submittedAt:         Date,
    changesRequestedAt:  Date,
    resubmittedAt:        Date,
    approvedAt:           Date,
    rejectedAt:           Date,
    activatedAt:          Date,
    expiresAt:            Date,
  },
  { timestamps: true }
);

sellerPromotionSchema.index({ sellerId: 1, module: 1, status: 1 });
sellerPromotionSchema.pre('validate', function () {
  if (this.advertisingVersion === 2 && (!this.advertising || this.status !== 'DISABLED')) {
    this.invalidate('advertising', 'Versioned advertising requires its isolated state and a disabled legacy status');
  }
  if (this.advertisingVersion !== 2 && this.advertising) this.invalidate('advertising', 'Advertising data requires explicit version 2');
});
sellerPromotionSchema.index({ status: 1, expiresAt: 1 });

export const SELLER_PROMOTION_STATUSES = STATUSES;
export const SELLER_PROMOTION_MODULES = MODULES;

const SellerPromotion = model("SellerPromotion", sellerPromotionSchema);
export default SellerPromotion;
