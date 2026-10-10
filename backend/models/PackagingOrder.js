import mongoose from 'mongoose';

const { Schema, model } = mongoose;
const ObjectId = Schema.Types.ObjectId;

/**
 * A seller's purchase of NHCONE branded packaging materials — either a
 * predefined admin package (`orderType: 'PACKAGE'`) or a custom 500+ item
 * bulk order (`orderType: 'BULK'`). Kept as its own model rather than
 * reusing the customer-facing `Order` (product-centric: cart items,
 * delivery fulfilment groups, rider assignment, Shiprocket-bound in the
 * ecommerce path) — a packaging purchase has none of that and forcing it
 * through Order's assumptions would be riskier than a small dedicated model.
 *
 * CRITICAL — pricing snapshot (Section 6/33 of the spec): every line item
 * freezes the material's name/type/specification/unit price exactly as they
 * stood the moment this order was created. `subtotal`/`payableAmount` are
 * likewise frozen then. An Admin changing a material's price or a package's
 * contents afterwards can NEVER alter an order that already exists — this
 * document is read for history, never recomputed from live Material/Package
 * records.
 *
 * V1 stops at CONFIRMED (see Section 14/20 of the spec) — no Shiprocket,
 * no AWB, no tracking. `PROCESSING` is the one further admin-settable state
 * V1 actually supports (an admin has started preparing/packing the order);
 * nothing beyond that is claimed.
 */
const packagingOrderItemSchema = new Schema(
  {
    _id:                     false,
    materialId:              { type: ObjectId, ref: 'PackagingMaterial', required: true },
    materialNameSnapshot:    { type: String, required: true },
    materialTypeSnapshot:    String,
    specificationSnapshot:   String,
    quantity:                { type: Number, required: true, min: 1 },
    unitPriceSnapshot:       { type: Number, required: true, min: 0 },
    lineTotal:               { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const ORDER_TYPES = ['PACKAGE', 'BULK'];
const ORDER_STATUSES = ['PAYMENT_PENDING', 'CONFIRMED', 'PROCESSING', 'CANCELLED'];

const packagingOrderSchema = new Schema(
  {
    orderNumber: { type: String, required: true, unique: true },
    sellerId:    { type: ObjectId, ref: 'Seller', required: true, index: true },

    orderType: { type: String, enum: ORDER_TYPES, required: true },

    // PACKAGE orders only — absent for BULK.
    packageId:            { type: ObjectId, ref: 'PackagingPackage' },
    packageNameSnapshot:  String,
    packageQuantity:      Number, // number of package units purchased

    items: { type: [packagingOrderItemSchema], required: true },

    totalItems:     { type: Number, required: true, min: 1 },
    subtotal:       { type: Number, required: true, min: 0 },
    payableAmount:  { type: Number, required: true, min: 0 }, // == subtotal in V1; kept distinct for future-readiness (Section 20)

    // The seller's own registered store address, captured automatically at
    // order time purely for admin fulfilment visibility — not a new address
    // form, and never edited from here.
    shippingAddressSnapshot: {
      address: String,
      city:    String,
      state:   String,
      pincode: String,
    },

    paymentId:     { type: ObjectId, ref: 'Payment' },
    paymentStatus: { type: String, enum: ['pending', 'paid', 'failed', 'refunded', 'partial_refund'], default: 'pending' },
    orderStatus:   { type: String, enum: ORDER_STATUSES, default: 'PAYMENT_PENDING' },

    confirmedAt: Date,
  },
  { timestamps: true }
);

packagingOrderSchema.index({ sellerId: 1, createdAt: -1 });
packagingOrderSchema.index({ orderStatus: 1 });

// Same convention as Order.js's orderNo (ORD-YYYYMMDD-RANDOM6).
packagingOrderSchema.pre('validate', async function () {
  if (!this.orderNumber) {
    const d = new Date();
    const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    const rand = Math.random().toString(36).slice(2, 8).toUpperCase().padEnd(6, '0');
    this.orderNumber = `PKG-${ymd}-${rand}`;
  }
});

export const PACKAGING_ORDER_TYPES = ORDER_TYPES;
export const PACKAGING_ORDER_STATUSES = ORDER_STATUSES;

const PackagingOrder = model('PackagingOrder', packagingOrderSchema);
export default PackagingOrder;
