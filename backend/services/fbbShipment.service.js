import mongoose from 'mongoose';
import FbbShipment from '../models/FbbShipment.js';
import Product from '../models/Product.js';
import Warehouse from '../models/Warehouse.js';
import { httpError } from '../utils/response.js';
import { DELIVERY_METHOD } from '../constants/enums.js';
import { fbbSellableFor } from './deliveryMethod.service.js';
import { alertAdminsShipmentSent } from './fbbAdminAlerts.service.js';

/**
 * Seller → warehouse shipment notices (models/FbbShipment.js). Information only: stock changes solely through
 * the warehouse's posted receipt. See services/warehouse.service.js for receiving.
 */
const text = (v, max) => (v == null ? undefined : String(v).trim().slice(0, max) || undefined);
const shipmentNo = () => `SHP-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${new mongoose.Types.ObjectId().toString().slice(-6).toUpperCase()}`;

export const createSellerShipment = async ({ seller, input = {} }) => {
  const key = String(input.idempotencyKey || '').trim();
  if (key.length < 8 || key.length > 100) throw httpError(400, 'An idempotency key is required');
  const existing = await FbbShipment.findOne({ sellerId: seller._id, idempotencyKey: key }).lean();
  if (existing) return { shipment: existing, alreadyRecorded: true };

  if (!fbbSellableFor(seller)) throw httpError(403, 'Fulfilled by Bulkimart is not open for your store right now. Contact Bulkimart support.');
  const { warehouseId, lines } = input;
  if (!mongoose.isValidObjectId(warehouseId)) throw httpError(400, 'Choose the warehouse you sent the stock to');
  const warehouse = await Warehouse.findOne({ _id: warehouseId, isActive: true }).select('name code').lean();
  if (!warehouse) throw httpError(400, 'That warehouse is not open. Choose another one.');
  if (!Array.isArray(lines) || !lines.length || lines.length > 50) throw httpError(400, 'Add 1–50 products');

  const productIds = [...new Set(lines.map((l) => String(l?.productId)))];
  if (productIds.some((id) => !mongoose.isValidObjectId(id))) throw httpError(400, 'Choose a product for every line');
  const products = new Map((await Product.find({ _id: { $in: productIds }, sellerId: seller._id, isDeleted: { $ne: true } })
    .select('name deliveryMethod variants._id variants.name').lean()).map((p) => [String(p._id), p]));
  const seen = new Set();
  const parsed = lines.map((raw) => {
    const product = products.get(String(raw.productId));
    if (!product) throw httpError(400, 'A product on this shipment was not found in your store');
    if (product.deliveryMethod !== DELIVERY_METHOD.FBB) throw httpError(409, `${product.name} is not a Fulfilled by Bulkimart product`);
    const variant = (product.variants || []).find((v) => String(v._id) === String(raw.variantId));
    if (!variant) throw httpError(400, `Choose the variant of ${product.name}`);
    const lineKey = `${product._id}:${variant._id}`;
    if (seen.has(lineKey)) throw httpError(400, `${product.name} (${variant.name}) appears twice; combine the quantities`);
    seen.add(lineKey);
    const qty = Number(raw.qty);
    if (!Number.isSafeInteger(qty) || qty < 1 || qty > 100000) throw httpError(400, `Enter a whole quantity of at least 1 for ${product.name}`);
    return { productId: product._id, variantId: variant._id, productName: product.name, variantName: variant.name, qty };
  });
  const expectedBy = input.expectedBy ? new Date(input.expectedBy) : undefined;
  if (expectedBy && Number.isNaN(expectedBy.getTime())) throw httpError(400, 'Expected arrival date is not valid');

  let shipment;
  try {
    shipment = (await FbbShipment.create({
      shipmentNo: shipmentNo(), sellerId: seller._id, warehouseId: warehouse._id, idempotencyKey: key, lines: parsed,
      courier: text(input.courier, 80), trackingNo: text(input.trackingNo, 80), invoiceNo: text(input.invoiceNo, 80), note: text(input.note, 300), expectedBy,
    })).toObject();
  } catch (error) {
    if (error.code !== 11000) throw error;
    return { shipment: await FbbShipment.findOne({ sellerId: seller._id, idempotencyKey: key }).lean(), alreadyRecorded: true };
  }
  void alertAdminsShipmentSent(shipment, { sellerName: seller.storeDetails?.name || seller.businessName, warehouseName: warehouse.name });
  return { shipment, alreadyRecorded: false };
};

/** The seller withdraws a notice sent by mistake; only while it has not been counted. */
export const cancelSellerShipment = async ({ seller, shipmentId }) => {
  if (!mongoose.isValidObjectId(shipmentId)) throw httpError(400, 'Invalid shipment');
  const updated = await FbbShipment.findOneAndUpdate({ _id: shipmentId, sellerId: seller._id, status: 'in_transit' },
    { $set: { status: 'cancelled', cancelledAt: new Date() } }, { returnDocument: 'after' }).lean();
  if (!updated) throw httpError(409, 'This shipment was already counted by the warehouse or cancelled');
  return updated;
};

export const sellerShipments = (sellerId) => FbbShipment.find({ sellerId }).sort({ createdAt: -1 }).limit(30)
  .populate('warehouseId', 'name code').select('-idempotencyKey').lean();

export const listShipmentsAdmin = ({ status } = {}) => FbbShipment.find(status ? { status } : {}).sort({ createdAt: -1 }).limit(100)
  .populate('sellerId', 'businessName').populate('warehouseId', 'name code').populate('receiptId', 'receiptNo status').select('-idempotencyKey').lean();

/** A receipt counted from this shipment: link it (only an in-transit shipment of the same seller). */
export const linkShipmentToReceipt = async ({ shipmentId, receipt }) => {
  if (!shipmentId || !mongoose.isValidObjectId(shipmentId)) return null;
  return FbbShipment.findOneAndUpdate({ _id: shipmentId, sellerId: receipt.sellerId, status: 'in_transit' },
    { $set: { status: 'received', receiptId: receipt._id, receivedAt: new Date() } }, { returnDocument: 'after' }).lean();
};

/** The draft receipt was cancelled: the goods are not counted yet, so the shipment is on its way again. */
export const unlinkShipmentFromReceipt = (receiptId) => FbbShipment.updateOne({ receiptId, status: 'received' },
  { $set: { status: 'in_transit' }, $unset: { receiptId: 1, receivedAt: 1 } });
