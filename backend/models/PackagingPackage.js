import mongoose from 'mongoose';

const { Schema, model } = mongoose;
const ObjectId = Schema.Types.ObjectId;

/**
 * Admin-built predefined packaging bundle (e.g. "NHCONE Ghee Starter
 * Package" = 50 Jars + 40 Bottles + 9 Pouches). `items` only ever stores
 * `{materialId, quantity}` — never a name/price snapshot — because a
 * *package's* totals must always reflect CURRENT material pricing while it
 * is still just a catalog listing (see services/packaging.service.js's
 * `pricePackage`, recomputed on every read, never cached here).
 *
 * The purchase-time freeze happens one level down, on PackagingOrder: the
 * moment a seller actually buys this package, that order snapshots every
 * material's name/type/specification/price as they stood at that instant.
 * Editing this package afterwards (even changing its materials or a
 * material's price) can never rewrite an order already placed.
 *
 * Lifecycle: DRAFT (admin-only, editable) -> PUBLISHED (seller-visible,
 * purchasable; still editable — new purchases use whatever the package
 * looks like right now) -> DISABLED (no new purchases; already-placed
 * orders are untouched, since they hold their own snapshot).
 */
const packagingPackageSchema = new Schema(
  {
    name:        { type: String, required: true, trim: true },
    description: String,
    image:       String, // Cloudinary URL

    items: [
      {
        _id:        false,
        materialId: { type: ObjectId, ref: 'PackagingMaterial', required: true },
        quantity:   { type: Number, required: true, min: 1 },
      },
    ],

    status: { type: String, enum: ['DRAFT', 'PUBLISHED', 'DISABLED'], default: 'DRAFT' },

    createdBy:   { type: ObjectId, ref: 'Admin' },
    updatedBy:   { type: ObjectId, ref: 'Admin' },
    publishedAt: Date,
  },
  { timestamps: true }
);

packagingPackageSchema.index({ status: 1 });

const PackagingPackage = model('PackagingPackage', packagingPackageSchema);
export default PackagingPackage;
