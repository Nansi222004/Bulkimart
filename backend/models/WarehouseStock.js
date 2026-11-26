import mongoose from 'mongoose';

/**
 * FBB warehouse inventory — the source of truth for one product variant in one warehouse.
 *
 *   sellable  verified units customers can buy. The product's variant `stock` mirrors the sum of these
 *             across warehouses (written in the same transaction), so cart and checkout code reads it as usual.
 *   reserved  units sold and still inside the warehouse (picking/packing). Leave on hand-off to a provider.
 *   damaged   units held but not sellable (damaged on arrival, or a returned item that cannot be resold).
 *   quarantine units back from the courier awaiting inspection (never sold, never assumed damaged).
 *
 * Only warehouse operations change these (services/warehouse.service.js); sellers can read, never write.
 * Every change has a StockMovement with location 'warehouse'.
 */
const { Schema, model } = mongoose;

const warehouseStockSchema = new Schema({
  warehouseId: { type: Schema.Types.ObjectId, ref: 'Warehouse', required: true },
  productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
  variantId: { type: Schema.Types.ObjectId, required: true },
  sellerId: { type: Schema.Types.ObjectId, ref: 'Seller', required: true },
  sellable: { type: Number, default: 0, min: 0 },
  reserved: { type: Number, default: 0, min: 0 },
  damaged: { type: Number, default: 0, min: 0 },
  // Units back from a courier (RTO / undelivered) that nobody has inspected yet: not for sale and not written
  // off. An admin inspection moves them to sellable or damaged (services/fbbFulfillment.service.js).
  quarantine: { type: Number, default: 0, min: 0 },
}, { timestamps: true });

warehouseStockSchema.index({ warehouseId: 1, productId: 1, variantId: 1 }, { unique: true });
warehouseStockSchema.index({ sellerId: 1, productId: 1 });

export default model('WarehouseStock', warehouseStockSchema);
