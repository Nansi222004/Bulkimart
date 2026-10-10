import mongoose from "mongoose";

const { Schema, model } = mongoose;
const ObjectId = Schema.Types.ObjectId;

const addressSchema = new Schema({
  label:         { type: String, enum: ["Home", "Work", "Other"], default: "Home" },
  name:          String,
  phone:         String,
  line1:         String,
  line2:         String,
  city:          String,
  state:         String,
  pincode:       String,
  lat:           Number,
  lng:           Number,
  placeName:     String,
  landmarkImage: { type: String, default: null },

  /**
   * How the pin was obtained.
   *
   *   gps      — the shopper stood there and shared their location
   *   manual   — they placed it themselves
   *   geocoded — nobody pinned anything; the text was looked up
   *
   * A geocoded pincode can be most of a kilometre from the actual door, so a
   * rider who cannot find the place is explained by this rather than blamed.
   */
  locationSource: { type: String, enum: ['gps', 'manual', 'geocoded'] },

  isDefault: { type: Boolean, default: false },
});

const walletTransactionSchema = new Schema({
  type:        { type: String, enum: ["credit", "debit"], required: true },
  amount:      Number,
  description: String,
  refId:       String,
  createdAt:   { type: Date, default: Date.now },
});

const userSchema = new Schema(
  {
    // Primary identity — phone-based, OTP auth, no password
    phone:    { type: String, required: true, unique: true, index: true },
    name:     String,
    email:    String,
    avatar:   String,

    // CDS Membership — discount integration (3rd party)
    cdsMembershipNo: String,
    isCDSVerified:   { type: Boolean, default: false },
    cdsVerifiedAt:   Date,

    // Multi-role: one user can be buyer + seller + shg + delivery partner
    roles: [{ type: String, enum: ["buyer", "seller", "shg", "delivery"] }],

    // Links to role-specific profiles
    sellerId:          { type: ObjectId, ref: "Seller" },
    shgStoreId:        { type: ObjectId, ref: "SHGStore" },
    deliveryPartnerId: { type: ObjectId, ref: "DeliveryPartner" },
    isShgMember:       { type: Boolean, default: false },
    shgRegNo:          { type: String, unique: true, sparse: true },

    // Saved delivery addresses
    addresses: [addressSchema],

    // Saved-for-later products. References only — never a name/price/image
    // snapshot — so a wishlisted item always reflects the Product doc's
    // current state; the Product itself stays the single source of truth.
    wishlist: [{ type: ObjectId, ref: "Product" }],

    // In-app wallet
    wallet: {
      balance:      { type: Number, default: 0 },
      transactions: [walletTransactionSchema],
    },

    // Firebase push notification token — kept for backward compatibility;
    // superseded by `pushTokens` below, which supports multiple devices.
    // notification.service.js reads pushTokens first, falling back to this.
    fcmToken: String,
    fcmPlatform: { type: String, enum: ["app", "web"], default: "app" },

    // Multi-device push tokens. A device's token is upserted here (matched
    // by token string) rather than appended blindly, so re-registering the
    // same device updates its `lastUsedAt` instead of creating duplicates.
    pushTokens: [{
      token:      { type: String, required: true },
      platform:   { type: String, enum: ["app", "web"], default: "web" },
      active:     { type: Boolean, default: true },
      lastUsedAt: { type: Date, default: Date.now },
      createdAt:  { type: Date, default: Date.now },
    }],

    // Saved donation preference for automatic preselection at checkout
    donationPreference: {
      enabled:   { type: Boolean, default: false },
      amount:    { type: Number, default: 0 },
      updatedAt: Date
    },

    isActive: { type: Boolean, default: true },

    // ---------------------------------------------------------- Referral Program
    // Lazily generated the first time this user opens "Refer & Earn" — see
    // referral.service.js::getOrCreateReferralCode. `sparse` so every
    // pre-existing user keeps working with no backfill migration.
    referralCode: { type: String, unique: true, sparse: true, index: true, uppercase: true, trim: true },
    // Set exactly once, at signup, inside auth.controller.js::verifyAndLogin's
    // `if (!user)` branch — never editable afterward, and never set on an
    // already-existing account.
    referredBy: { type: ObjectId, ref: "User" },
  },
  { timestamps: true }
);

const User = model("User", userSchema);
export default User;
