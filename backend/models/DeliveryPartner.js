import mongoose from "mongoose";
import { VENDOR_STATUSES, VENDOR_STATUS } from "../constants/enums.js";
import { RADIUS_HARD_SAFETY_CEILING_KM } from "./RadiusSetting.js";
import geoPointSchema from "./geoPoint.schema.js";

const { Schema, model } = mongoose;
const ObjectId = Schema.Types.ObjectId;


const deliveryPartnerSchema = new Schema(
  {
    userId:         { type: ObjectId, ref: "User", required: true, unique: true },
    onboardingStep: { type: Number, default: 0 },   // 0-3 in progress, 4 = ready to submit

    // ---- Step 1: Vehicle & licence -----------------------------------------
    vehicleType: { type: String, enum: ["bicycle", "bike", "auto", "car"] },
    vehicleNo:   String,
    drivingLicense: {
      no:         String,
      url:        String,
      expiryDate: Date,
    },

    // ---- Step 2: Identity ---------------------------------------------------
    aadhaar: {
      number:   String,   // stored masked: XXXX-XXXX-1234
      frontUrl: String,
      backUrl:  String,
    },

    // ---- Step 3: Where they deliver & how they get paid ---------------------
    zones: [String],      // serviceable pincodes

    /**
     * Where the rider actually starts their day.
     *
     * `zones` says which pincodes they are willing to serve; this says where
     * they physically are, which is what decides who gets a new order first.
     * Captured either from the device's GPS or typed by hand, and `source`
     * records which — a typed address is a claim, a GPS fix is evidence, and
     * an admin verifying a rider deserves to know the difference.
     */
    baseLocation: {
      address:  String,
      landmark: String,
      city:     String,
      state:    String,
      pincode:  String,
      lat:      Number,
      lng:      Number,
      accuracy: Number,   // metres, GPS only
      source:   { type: String, enum: ["gps", "manual"] },
      point:    geoPointSchema,
      updatedAt: Date,
    },
    bankDetails: {
      accountNo:   String,
      ifsc:        String,
      holderName:  String,
      bankName:    String,
      upiId:       String,
      passbookUrl: String,
    },

    /**
     * How far this rider is willing to travel for a pickup, in km.
     *
     * Absent/undefined = unrestricted — dispatch falls back to the
     * existing global `PICKUP_RADIUS_METERS` search exactly as it always
     * has, so a rider nobody has configured this for keeps receiving
     * offers the same way they did before this field existed.
     *
     * `max` is the static hard safety ceiling, not the live business
     * ceiling — the real, admin-tunable ceiling is dynamic (RadiusSetting)
     * and enforced in admin.controller.js's setDeliveryPartnerRadius.
     */
    deliveryRadiusKm: { type: Number, min: 0.1, max: RADIUS_HARD_SAFETY_CEILING_KM },

    // ---- Live status --------------------------------------------------------
    isAvailable:     { type: Boolean, default: false },
    currentLocation: {
      lat:       Number,
      lng:       Number,
      updatedAt: Date,
    },

    /**
     * Approval status.
     *
     * Starts at "incomplete", not "pending": a partner who has only tapped
     * "become a rider" has not applied for anything yet, and would otherwise
     * clutter the admin's verification queue from the first screen.
     * Riders carry cash and customer goods, so nothing unlocks until an admin
     * has checked the licence and Aadhaar by hand.
     */
    status: {
      type: String,
      enum: VENDOR_STATUSES,
      default: VENDOR_STATUS.INCOMPLETE,
    },
    rejectionReason: String,
    approvedAt:      Date,
    approvedBy:      { type: ObjectId, ref: "Admin" },

    // ---- Financials ---------------------------------------------------------
    earnings: {
      total:   { type: Number, default: 0 },
      pending: { type: Number, default: 0 },
      paid:    { type: Number, default: 0 },
      /**
       * Lifetime customer tips, already counted inside `total`.
       *
       * A running counter rather than a sum over Delivery rows, because the
       * rider's earnings screen shows this on every load and a scan of their
       * whole delivery history to render one number would get slower for
       * exactly the riders who have earned the most. Incremented in the same
       * atomic $inc that credits `total` (verifyDeliveryOtp), so the two can
       * never disagree. Not a separate pot of money — never add it to
       * `total` when computing what a rider is owed.
       */
      tips:    { type: Number, default: 0 },
    },
    totalDeliveries: { type: Number, default: 0 },
    rating:          { type: Number, default: 0 },
  },
  { timestamps: true }
);

// The admin queue filters on status; riders are matched to orders by zone.
deliveryPartnerSchema.index({ status: 1, createdAt: -1 });
deliveryPartnerSchema.index({ status: 1, isAvailable: 1, zones: 1 });
// Finds available riders near a pickup point. Sparse because a rider who typed
// their address has no point, and 2dsphere would reject the document.
deliveryPartnerSchema.index({ "baseLocation.point": "2dsphere" }, { sparse: true });

const DeliveryPartner = model("DeliveryPartner", deliveryPartnerSchema);
export default DeliveryPartner;
