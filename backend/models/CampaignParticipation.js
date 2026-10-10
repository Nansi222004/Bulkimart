import mongoose from "mongoose";

const { Schema, model } = mongoose;
const ObjectId = Schema.Types.ObjectId;

/**
 * The seller's agreement, not the campaign's rule.
 *
 * `originalPriceSnapshot`/`discountValue`/`campaignPrice` are all filled
 * in the moment a seller accepts — never before, never recalculated
 * after. This is what makes Step 13's rule possible: if the seller later
 * changes the product's normal price, or the admin later changes the
 * campaign's discount, an already-accepted deal does not move. The
 * customer was promised ₹350 on Mango; that number is this row, not
 * "30% of whatever Product.price says right now."
 *
 * PENDING rows have no snapshot yet — there is nothing to lock in until
 * the seller actually accepts, so those fields stay unset and any price
 * shown to the seller for a PENDING row is computed live, for preview
 * only, never trusted as final.
 *
 * `status` is the seller's own decision, not a computed lifecycle state —
 * whether an ACCEPTED row is CURRENTLY producing a discount is derived at
 * read time from the owning Campaign's own isEnabled/startAt/endAt, the
 * same way Campaign's own lifecycle is derived rather than stored. This
 * keeps "is this row live right now" answerable from one source of truth
 * instead of a second status a sweeper job would have to keep in sync.
 */
const PARTICIPATION_STATUSES = ['PENDING', 'ACCEPTED', 'REJECTED', 'CANCELLED'];

const campaignParticipationSchema = new Schema(
  {
    campaignId: { type: ObjectId, ref: 'Campaign', required: true },
    sellerId: { type: ObjectId, ref: 'Seller', required: true },
    productId: { type: ObjectId, ref: 'Product', required: true },

    status: { type: String, enum: PARTICIPATION_STATUSES, default: 'PENDING' },

    // Filled only on accept — see file comment.
    originalPriceSnapshot: Number,
    discountType: String,
    discountValue: Number,
    campaignPrice: Number,

    rejectionReason: String,
    acceptedAt: Date,
    rejectedAt: Date,
  },
  { timestamps: true }
);

// One participation row per product per campaign — never two conflicting
// rows for the same pair.
campaignParticipationSchema.index({ campaignId: 1, productId: 1 }, { unique: true });
campaignParticipationSchema.index({ campaignId: 1, sellerId: 1 });
campaignParticipationSchema.index({ productId: 1, status: 1 });

export const CAMPAIGN_PARTICIPATION_STATUSES = PARTICIPATION_STATUSES;

const CampaignParticipation = model('CampaignParticipation', campaignParticipationSchema);
export default CampaignParticipation;
