import mongoose from "mongoose";

const { Schema, model } = mongoose;
const ObjectId = Schema.Types.ObjectId;

/**
 * Rider "Go To" (destination) mode, managed from the Admin Panel.
 *
 * A rider heading somewhere (usually home) sets a destination; while the mode
 * is on they receive only orders whose pickup and drop both lie along their
 * route, in the direction they are travelling. These numbers decide how
 * strictly "along the route" is read and how often riders may use it.
 *
 * Same immutable versioning as TipSetting: a save supersedes the active row.
 */
const goToSettingSchema = new Schema(
  {
    isEnabled: { type: Boolean, default: true },
    // How far (km) a pickup or drop may lie from the route line.
    corridorKm: { type: Number, default: 2, min: 0.2, max: 20 },
    // Extra distance (km) the order may add to the rider's trip to the destination.
    maxDetourKm: { type: Number, default: 4, min: 0, max: 50 },
    // Furthest (km, straight line) a pickup may be from the rider's position.
    maxPickupKm: { type: Number, default: 10, min: 0.5, max: 100 },
    // How many times a rider may start Go To per day (India time).
    dailyLimit: { type: Number, default: 2, min: 1, max: 20 },
    // The mode switches itself off after this long.
    maxDurationMinutes: { type: Number, default: 120, min: 10, max: 720 },

    isActive:  { type: Boolean, default: true },
    updatedBy: { type: ObjectId, ref: "Admin" },
  },
  { timestamps: true }
);

goToSettingSchema.index({ isActive: 1, createdAt: -1 });

const GoToSetting = model("GoToSetting", goToSettingSchema);
export default GoToSetting;
