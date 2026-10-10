import mongoose from 'mongoose';

const { Schema, model } = mongoose;
const ObjectId = Schema.Types.ObjectId;

/**
 * Admin-managed catalog of branded packaging materials (jars, bottles,
 * pouches, containers, boxes...) NHCONE supplies to sellers who lack their
 * own packaging. `materialType` is deliberately a free string, not an enum
 * — Admin must be able to add new kinds of material without a code change.
 *
 * `unitPrice` is the ONLY price for a material and is never hardcoded
 * anywhere else — every quote (package subtotal, bulk order subtotal) is
 * computed server-side from whatever this field currently holds (see
 * services/packaging.service.js).
 *
 * Deactivating a material (isActive: false) removes it from what a seller
 * can newly purchase (packages or bulk orders), but the material document
 * itself is never deleted — every PackagingOrder line item snapshots the
 * material's name/type/specification/price at the moment it was bought
 * (see PackagingOrder.js), so historical orders read from that snapshot,
 * never from this live record.
 */
const packagingMaterialSchema = new Schema(
  {
    name:          { type: String, required: true, trim: true },
    materialType:  { type: String, required: true, trim: true }, // e.g. "Jar", "Bottle", "Pouch", "Box"
    specification: { type: String, trim: true }, // e.g. "1 KG", "500 ML"
    unitPrice:     { type: Number, required: true, min: 0 },
    image:         String, // Cloudinary URL — existing upload pipeline
    description:   String,
    isActive:      { type: Boolean, default: true },

    createdBy: { type: ObjectId, ref: 'Admin' },
    updatedBy: { type: ObjectId, ref: 'Admin' },
  },
  { timestamps: true }
);

packagingMaterialSchema.index({ isActive: 1 });

const PackagingMaterial = model('PackagingMaterial', packagingMaterialSchema);
export default PackagingMaterial;
