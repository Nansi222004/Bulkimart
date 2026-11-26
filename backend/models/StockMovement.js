import mongoose from "mongoose";

/**
 * Inventory audit trail (Developer Guide §6): every stock change — a sale, a cancellation or return putting
 * units back, a seller's manual adjustment or a stock edit on the product form — with who/what caused it.
 * Written in the same transaction as the stock change where one is available, so the log cannot drift.
 */
const { Schema, model } = mongoose;

export const STOCK_MOVEMENT_REASONS = ["sale", "restock", "seller_adjustment", "product_edit", "product_created",
  // FBB warehouse (services/warehouse.service.js): receiving, sale reservation and its release, hand-off to a
  // provider, returned units (resellable or damaged), approved adjustments, and the seller stock set aside at conversion.
  "fbb_receipt", "fbb_reserve", "fbb_release", "fbb_dispatch", "fbb_return_restock", "fbb_return_damaged", "fbb_adjustment", "fbb_conversion",
  // A courier-returned (RTO) unit held for inspection, and the inspection moving it to sellable or damaged.
  "fbb_return_quarantine", "fbb_inspection"];

const stockMovementSchema = new Schema({
  productId: { type: Schema.Types.ObjectId, ref: "Product", required: true },
  variantId: { type: Schema.Types.ObjectId },
  variantName: String,
  sellerId: { type: Schema.Types.ObjectId, ref: "Seller" },
  delta: { type: Number, required: true },  // +3 added, −2 removed
  stockAfter: Number,                       // when known
  reason: { type: String, enum: STOCK_MOVEMENT_REASONS, required: true },
  note: { type: String, maxlength: 200 },
  actorType: { type: String, enum: ["seller", "admin", "customer", "system"], default: "system" },
  actorId: { type: Schema.Types.ObjectId },
  // Where the units are: the seller's shop (default, every movement before FBB) or an FBB warehouse.
  location: { type: String, enum: ["seller", "warehouse"], default: "seller" },
  warehouseId: { type: Schema.Types.ObjectId, ref: "Warehouse" },
  bucket: { type: String, enum: ["sellable", "reserved", "damaged", "quarantine"] },
  referenceType: { type: String, enum: ["order", "receipt", "return", "adjustment", "conversion"] },
  referenceId: { type: Schema.Types.ObjectId },
}, { timestamps: { createdAt: true, updatedAt: false } });

stockMovementSchema.index({ productId: 1, createdAt: -1 });
stockMovementSchema.index({ sellerId: 1, createdAt: -1 });
stockMovementSchema.index({ warehouseId: 1, createdAt: -1 }, { sparse: true });

export default model("StockMovement", stockMovementSchema);
