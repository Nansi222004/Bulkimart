import mongoose from 'mongoose';

/**
 * A Bulkimart fulfilment warehouse (FBB). One to start with; nothing assumes there is only one.
 * Its address is the pickup origin for every FBB order and the destination for every FBB return.
 */
const { Schema, model } = mongoose;

const warehouseSchema = new Schema({
  code: { type: String, required: true, unique: true, trim: true, uppercase: true, match: /^[A-Z0-9-]{2,20}$/ },
  name: { type: String, required: true, trim: true, maxlength: 80 },
  address: {
    line1: { type: String, required: true, trim: true },
    line2: { type: String, trim: true },
    city: { type: String, required: true, trim: true },
    state: { type: String, required: true, trim: true },
    pincode: { type: String, required: true, match: /^[1-9]\d{5}$/ },
    lat: { type: Number, min: -90, max: 90, required: true },
    lng: { type: Number, min: -180, max: 180, required: true },
  },
  phone: { type: String, required: true, match: /^[6-9]\d{9}$/ },
  // The pickup location registered for this warehouse in Bulkimart's Shiprocket account (admin-registered).
  shiprocketPickupLocation: { type: String, trim: true },
  isActive: { type: Boolean, default: true },
  createdBy: { type: Schema.Types.ObjectId, ref: 'Admin' },
}, { timestamps: true });

export default model('Warehouse', warehouseSchema);
