import mongoose from "mongoose";
import { PAYOUT_MODES } from "../constants/enums.js";

const { Schema, model } = mongoose;
const ObjectId = Schema.Types.ObjectId;

/**
 * What a rider earns, per delivery mode, set by an admin.
 *
 * Quick and Same-Day are not the same job. A Quick trip is short and the rider
 * is often already moving towards the shop before the order is packed; a
 * Same-Day trip carries a promise made to the customer at checkout and is worth
 * paying more for. One rate for both meant either underpaying the harder job or
 * overpaying the easy one, so each mode carries its own base and per-kilometre
 * figure and an admin sets them independently.
 *
 * Rows are never edited. A change inserts a new row and deactivates the old one,
 * which leaves the history intact and lets a delivery point at the exact rate it
 * was priced under months later. `effectiveFrom` records when it started
 * applying; `updatedBy` and `note` record who changed it and why.
 *
 * An empty collection is not an error — services/riderPay.service.js falls back
 * to the environment defaults, which is exactly what the platform paid before
 * this existed.
 */
const deliveryRateSchema = new Schema(
  {
    /** Which kind of delivery this pays for. One active row per mode. */
    mode: { type: String, enum: PAYOUT_MODES, required: true },
    financeVersion: Number,

    /** Paid on every delivery of this mode, regardless of distance. */
    base: { type: Number, required: true, min: 0 },

    /** Paid per kilometre of the shop → customer leg. */
    perKm: { type: Number, required: true, min: 0 },

    /**
     * Floor and ceiling, both optional.
     *
     * A floor keeps a very short trip worth accepting; a ceiling caps a rate
     * mistake — a typo of 150 instead of 15 would otherwise quietly promise
     * hundreds per delivery until somebody noticed.
     */
    minPayout: { type: Number, default: 0, min: 0 },
    maxPayout: { type: Number, min: 0 },

    isActive:      { type: Boolean, default: true },
    effectiveFrom: { type: Date, default: Date.now },
    updatedBy:     { type: ObjectId, ref: "Admin" },
    note:          String,
  },
  { timestamps: true }
);

// The lookup is always "the live rate for this mode", and the history read is
// always "this mode, newest first".
deliveryRateSchema.index({ mode: 1, isActive: 1 });
deliveryRateSchema.index({ mode: 1, createdAt: -1 });

const DeliveryRate = model("DeliveryRate", deliveryRateSchema);
export default DeliveryRate;
