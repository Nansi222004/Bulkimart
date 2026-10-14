import mongoose from "mongoose";
import { CHANNEL, SELLER_SALES_CHANNELS, WHOLESALE_REQUEST_STATUSES } from "../constants/enums.js";
import { RADIUS_HARD_SAFETY_CEILING_KM } from "./RadiusSetting.js";
import geoPointSchema from "./geoPoint.schema.js";

const { Schema, model } = mongoose;
const ObjectId = Schema.Types.ObjectId;

/**
 * When and how far this shop is willing to fulfil Same-Day.
 *
 * The shop-level gate. A product may also switch Same-Day on, but both have to
 * agree — a seller who closes Same-Day for the week silences every one of their
 * listings at once without editing any of them.
 *
 * `radiusKm` is a seller narrowing the platform's reach, never widening it.
 *
 * The `max` below is deliberately the static hard safety ceiling
 * (`RADIUS_HARD_SAFETY_CEILING_KM`, 100km), NOT the live admin-configured
 * business ceiling — that one is dynamic (RadiusSetting, via
 * radiusSetting.service.js) and cannot be baked into a schema validator,
 * which is only ever evaluated with whatever this constant was at server
 * boot. This `max` exists purely as a last-line typo/bad-write guard;
 * the real ceiling is enforced by sameDay.service.js's parseSellerSameDay
 * on every write.
 *
 * Referenced rather than inline, so the 12 sellers already in the database keep
 * no `sameDay` field and read as not offering it.
 */
const sellerSameDaySchema = new Schema(
  {
    enabled: { type: Boolean, default: false },

    /**
     * Latest an order can arrive and still go out today, as "HH:MM" on a
     * 24-hour clock. A string rather than a Date because it is a time of day
     * that recurs, not a moment — storing it as a Date would pin it to whichever
     * day it happened to be saved.
     */
    cutoffTime: {
      type: String,
      match: [/^([01]\d|2[0-3]):[0-5]\d$/, 'Cut-off time must look like 16:00'],
    },

    /** Days the shop fulfils Same-Day. 0 = Sunday, matching Date#getDay(). */
    availableDays: {
      type: [Number],
      validate: {
        validator: (days) => days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6),
        message: 'Available days must be whole numbers from 0 (Sunday) to 6',
      },
    },

    radiusKm: {
      type: Number,
      min: [0, 'Service radius cannot be negative'],
      max: [
        RADIUS_HARD_SAFETY_CEILING_KM,
        `Same-Day radius cannot exceed the platform's hard safety ceiling of ${RADIUS_HARD_SAFETY_CEILING_KM} km`,
      ],
    },
  },
  { _id: false }
);

/**
 * "type" is a RESERVED key in Mongoose. Writing `[{ type: String, url: String }]`
 * declares an array of Strings — not an array of objects with a `type` field —
 * so pushing an object fails with "Cast to [string] failed".
 * Nesting it as `type: { type: String }` is what makes it an ordinary field.
 */
const sellerDocumentSchema = new Schema({
  type:       { type: String },          // e.g. 'pan_card', 'gstin_cert'
  url:        String,
  uploadedAt: { type: Date, default: Date.now },
}, { _id: false });

const promoRequestSchema = new Schema({
  type:      { type: String },           // 'banner' | 'featured' | 'sponsored'
  status:    { type: String, default: 'pending' },
  startDate: Date,
  endDate:   Date,
  createdAt: { type: Date, default: Date.now },
});

const brandRequestSchema = new Schema({
  title:            String,
  description:      String,
  status:           { type: String, default: 'pending' },
  packagingRequired:{ type: Boolean, default: false },
  labelNotes:       String,
  createdAt:        { type: Date, default: Date.now },
});

const sellerSchema = new Schema(
  {
    userId:         { type: ObjectId, ref: "User", required: true, unique: true },
    // Compatibility with the deployed, non-sparse unique `phone_1` index from
    // the legacy standalone-seller schema. Authentication still belongs to
    // User.phone; this mirror prevents missing/null collisions without dropping
    // an index or creating a second login identity.
    phone:          { type: String, trim: true, select: false },
    onboardingStep: { type: Number, default: 0 }, // 0-4 in-progress, 5=submitted

    // Step 1 — Business Info
    businessName: String,
    businessType: { type: String, enum: ["individual", "proprietorship", "partnership", "company"] },
    // Optional legacy/contact field. Seller sign-in is phone/OTP based, so an
    // absent email is valid and must not collide in a unique index.
    email: { type: String, trim: true, lowercase: true },
    storeDetails: {
      name:        String,
      logo:        String, // Cloudinary URL
      banner:      String,
      description: String,
      address:     String,
      city:        String,
      state:       String,
      pincode:     String,
      lat:         Number,
      lng:         Number,

      /**
       * The store's position as GeoJSON, alongside the plain lat/lng above.
       *
       * Quick Commerce only shows a shopper what can reach them, and only rings
       * riders who are near the pickup — both are "find stores within N km"
       * queries, and a 2dsphere index is the only thing MongoDB will answer them
       * with. The flat lat/lng stays because that is what every screen renders.
       *
       * Must stay a referenced schema rather than an inline object; see
       * geoPoint.schema.js for why an inline one breaks every insert.
       */
      point: geoPointSchema,

      /** How the position was captured — a GPS fix is evidence, a typed address is a claim. */
      locationSource: { type: String, enum: ["gps", "manual"] },

      phone:       String,
    },

    // Step 2 — Aadhaar KYC
    aadhaar: {
      number:   String, // stored masked XXXX-XXXX-1234
      frontUrl: String,
      backUrl:  String,
    },

    // Step 3 — Bank Details
    bankDetails: {
      accountNo:   String,
      ifsc:        String,
      holderName:  String,
      bankName:    String,
      upiId:       String,
      passbookUrl: String,
    },

    // Step 4 — Legal Documents
    gstin:        String,
    pan:          String,
    fssai:        String, // for food sellers
    tradeLicense: String,
    documents: [sellerDocumentSchema],

    // Approval Status
    status: {
      type: String,
      enum: ["incomplete", "pending", "under_review", "approved", "rejected", "suspended"],
      default: "incomplete",
    },
    submittedAt:     Date,
    rejectionReason: String,
    approvedAt:      Date,
    approvedBy:      { type: ObjectId, ref: "Admin" },
    rejectedAt:      Date,
    rejectedBy:      { type: ObjectId, ref: "Admin" },

    // Which storefronts this seller sells through. Drives the Shop All / Quick
    // toggle in the seller panel, so it has to persist across sessions.
    // Stored as the database channel values; the panel labels 'grocery' as "Quick".
    salesChannels: {
      type: [String],
      enum: SELLER_SALES_CHANNELS,
      default: [CHANNEL.ECOM],
    },
    // Provider-side pickup location identifier. It is intentionally optional:
    // Shiprocket must not be offered for a shop until an administrator has
    // registered and linked that pickup in the provider account.
    thirdPartyFulfillment: {
      shiprocketPickupLocation: { type: String, trim: true },
      enabled: { type: Boolean, default: false },
    },

    // A seller cannot activate Wholesale by submitting salesChannels. The
    // seller requests it, and an administrator changes this status; approval
    // then adds WHOLESALE_CHANNEL to salesChannels. Undefined on older seller
    // documents is treated as not_requested without a data migration.
    wholesaleChannel: {
      type: new Schema({
        status: { type: String, enum: WHOLESALE_REQUEST_STATUSES, default: 'not_requested' },
        requestedAt: Date,
        decidedAt: Date,
        decidedBy: { type: ObjectId, ref: 'Admin' },
        rejectionReason: { type: String, maxlength: 500 },
        suspensionReason: { type: String, maxlength: 500 },
      }, { _id: false }),
      default: undefined,
    },

    // Same-Day operating rules. Absent = this shop does not offer it.
    sameDay: { type: sellerSameDaySchema, default: undefined },

    /**
     * How far this seller's products are visible/orderable from, in km —
     * a general product-visibility radius, separate from and unrelated to
     * `sameDay.radiusKm` above (Same-Day's own, narrower, same-day-only
     * range). Absent/undefined = unrestricted, on purpose: every seller
     * that existed before this field was added must keep working exactly
     * as they did, not suddenly go invisible because nobody configured a
     * number for them yet.
     *
     * `max` is the static hard safety ceiling, not the live business
     * ceiling — see the comment on `sameDay.radiusKm` above for why. The
     * real, admin-tunable ceiling is enforced in admin.controller.js's
     * setSellerRadius via radiusSetting.service.js.
     */
    serviceRadiusKm: { type: Number, min: 0.1, max: RADIUS_HARD_SAFETY_CEILING_KM },

    // Business Metrics
    commissionRate: { type: Number, default: 10 },
    rating:         { type: Number, default: 0 },
    totalOrders:    { type: Number, default: 0 },
    totalRevenue:   { type: Number, default: 0 },
    // Serialization point for seller-ledger reservations. It is never a balance;
    // balances are derived exclusively from append-only SellerLedgerEntry rows.
    financialLedgerVersion: { type: Number, default: 0, select: false },

    // Promotion / Brand
    brandRequests: [brandRequestSchema],
    promoRequests: [promoRequestSchema],
  },
  { timestamps: true }
);

/**
 * Finds stores near a shopper, and stores near a rider.
 *
 * Sparse because a seller who has not pinned their location yet has no point at
 * all, and a 2dsphere index rejects such a document outright rather than
 * skipping it.
 */
sellerSchema.index({ "storeDetails.point": "2dsphere" }, { sparse: true });

// Preserve uniqueness for actual email strings while allowing any number of
// seller records with no email, null, or an empty value. The explicit name lets
// the safe index migration coexist with the legacy email_1 index until cutover.
sellerSchema.index(
  { email: 1 },
  {
    unique: true,
    name: 'email_1_optional_unique',
    partialFilterExpression: { email: { $type: 'string', $gt: '' } },
  },
);

const Seller = model("Seller", sellerSchema);
export default Seller;
