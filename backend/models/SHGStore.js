import mongoose from "mongoose";
import geoPointSchema from "./geoPoint.schema.js";

const { Schema, model } = mongoose;
const ObjectId = Schema.Types.ObjectId;

const shgStoreSchema = new Schema(
  {
    userId:         { type: ObjectId, ref: "User", required: true, unique: true },
    onboardingStep: { type: Number, default: 0 },
    shgRegId:       String,
    leaderName:     String,
    formationYear:  Number,
    totalMembers:   Number,
    primaryCategory:String,

    // Step 1 — Group Info & Location
    groupName: String,
    houseNo:   String,
    street:    String,
    landmark:  String,
    village:   String,
    block:     String,
    district:  String,
    state:     String,
    pincode:   String,
    lat:       Number,
    lng:       Number,

    /**
     * Store fulfillment position as GeoJSON for spatial Quick Commerce queries.
     * Sparse 2dsphere index added below.
     */
    point:          geoPointSchema,
    locationSource: { type: String, enum: ["gps", "manual"] },
    accuracy:       Number,

    // Step 2 — Leader Aadhaar
    leaderAadhaar: {
      number:   String,
      frontUrl: String,
      backUrl:  String,
    },

    // Step 3 — SHG Certificate
    nrlmId:      String,
    shgCertUrl:  String,
    nrlmCertUrl: String,

    // Step 4 — Group Bank Account
    groupBankAccount: {
      accountNo:  String,
      ifsc:       String,
      holderName: String, // SHG group name
      bankName:   String,
      passbookUrl:String,
    },

    // Step 5 — Members + Categories
    members: [{
      name:  String,
      phone: String,
      role:  { type: String, enum: ["leader", "treasurer", "secretary", "member"] },
    }],
    productCategories: [{ type: ObjectId, ref: "Category" }],

    // Approval Status
    /**
     * `suspended` is the withdrawal of an approval already granted, and is
     * deliberately distinct from `rejected` — that is a verdict on an
     * application which was never approved in the first place. A suspended
     * cooperative stops receiving orders (see shgSubscription.service.js's
     * getOrderableShgStoreIds) and can be put back with the ordinary approve
     * endpoint; nothing about their catalogue is destroyed meanwhile.
     *
     * The value was missing from this enum while the admin sidebar already
     * offered a "Suspended SHGs" filter, so that screen could never match
     * anything and no suspension could be saved at all.
     */
    status: {
      type: String,
      enum: ["incomplete", "pending", "under_review", "approved", "rejected", "suspended"],
      default: "incomplete",
    },
    /** Also carries the suspension reason — one field, whichever the status. */
    rejectionReason: String,

    // Business Metrics (0% commission — social mission)
    commissionRate: { type: Number, default: 0 },
    rating:         { type: Number, default: 0 },
    totalOrders:    { type: Number, default: 0 },
  },
  { timestamps: true }
);

/**
 * Finds SHG stores near a shopper or delivery partner.
 * Sparse index avoids indexing documents where location has not been pinned.
 */
shgStoreSchema.index({ point: "2dsphere" }, { sparse: true });

const SHGStore = model("SHGStore", shgStoreSchema);
export default SHGStore;
