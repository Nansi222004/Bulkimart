import mongoose from 'mongoose';
import { asyncHandler } from '../middlewares/error.middleware.js';
import { ok, created, httpError } from '../utils/response.js';
import Order from '../models/Order.js';
import Seller from '../models/Seller.js';
import Product from '../models/Product.js';
import Warehouse from '../models/Warehouse.js';
import WarehouseStock from '../models/WarehouseStock.js';
import WarehouseReceipt from '../models/WarehouseReceipt.js';
import WarehouseAdjustment from '../models/WarehouseAdjustment.js';
import StockMovement from '../models/StockMovement.js';
import { alertSellerStockArrived, alertSellerStockPosted } from '../services/fbbAdminAlerts.service.js';
import FbbShipment from '../models/FbbShipment.js';
import { listShipmentsAdmin, linkShipmentToReceipt, unlinkShipmentFromReceipt } from '../services/fbbShipment.service.js';
import { fbbEnabled, fbbChargesEnabled, warehouseOperationsEnabled, deliveryMethodsEnabled, fbbAllSellersEnabled } from '../services/deliveryMethod.service.js';
import { fbbServiceabilityStrict } from '../services/fbbServiceability.service.js';
import { fbbReadiness, saveWarehouse, createReceipt, postReceipt, cancelDraftReceipt, requestAdjustment, decideAdjustment, inventoryReconciliation, resyncMirror } from '../services/warehouse.service.js';
import { acceptFbbOrder, startFbbPicking, markFbbPacked, confirmFbbCourierHandoff, cancelFbbOrder, listFbbOrders, inspectFbbReturnedOrder } from '../services/fbbFulfillment.service.js';
import { saveChargeConfig, listChargeConfigs, listCharges, reverseCharge, settleFbbObligations, sellersWithFbbObligations, chargeReconciliation, fbbObligationSummary } from '../services/fbbCharges.service.js';
import { originSeller } from '../services/fulfilmentOrigin.service.js';
import { getFulfillmentOptions, selectManualFulfillment, createShiprocketShipment } from './fulfillment.controller.js';

/** Admin FBB: warehouse, receiving, stock, FBB order fulfilment, returns and FBB charges. */

const page = (req, max = 100) => ({ page: Math.max(1, Number(req.query.page) || 1), limit: Math.min(max, Math.max(1, Number(req.query.limit) || 30)) });
const oid = (value, label = 'reference') => { if (!mongoose.isValidObjectId(value)) throw httpError(400, `Invalid ${label}`); return value; };

/* ---- overview & warehouses ---------------------------------------------------------------------------------- */
export const getFbbOverview = asyncHandler(async (_req, res) => ok(res, {
  switches: { deliveryMethods: deliveryMethodsEnabled(), fbb: fbbEnabled(), warehouseOperations: warehouseOperationsEnabled(), fbbCharges: fbbChargesEnabled(),
    allSellers: fbbAllSellersEnabled(), strictServiceability: fbbServiceabilityStrict() },
  readiness: await fbbReadiness(),
  counts: {
    warehouses: await Warehouse.countDocuments({ isActive: true }),
    pilotSellers: await Seller.countDocuments({ 'fbbPilot.enabled': true }),
    fbbProducts: await Product.countDocuments({ deliveryMethod: 'fbb', isDeleted: { $ne: true } }),
    openOrders: await Order.countDocuments({ deliveryMethod: 'fbb', status: { $in: ['placed', 'confirmed', 'preparing'] } }),
    draftReceipts: await WarehouseReceipt.countDocuments({ status: 'draft' }),
    shipmentsOnTheWay: await FbbShipment.countDocuments({ status: 'in_transit' }),
    pendingAdjustments: await WarehouseAdjustment.countDocuments({ status: 'pending' }),
  },
}));
export const listWarehouses = asyncHandler(async (_req, res) => ok(res, await Warehouse.find().sort({ createdAt: 1 }).lean()));
export const createWarehouse = asyncHandler(async (req, res) => created(res, await saveWarehouse({ input: req.body, adminId: req.user._id }), 'Warehouse saved'));
export const updateWarehouse = asyncHandler(async (req, res) => ok(res, await saveWarehouse({ id: oid(req.params.id, 'warehouse'), input: req.body, adminId: req.user._id }), 'Warehouse updated'));

/* ---- pilot sellers --------------------------------------------------------------------------------------------- */
const pilotView = (s) => ({ _id: s._id, businessName: s.businessName, storeName: s.storeDetails?.name, status: s.status, fbbPilot: s.fbbPilot || { enabled: false } });
const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Sellers in the FBB pilot, or (with ?q=) sellers matching a name, to add one. */
export const listFbbPilotSellers = asyncHandler(async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 60);
  const match = q ? new RegExp(escapeRegex(q), 'i') : null;
  const filter = match ? { $or: [{ businessName: match }, { 'storeDetails.name': match }] } : { 'fbbPilot.enabled': true };
  const rows = await Seller.find(filter).select('businessName storeDetails.name status fbbPilot').sort({ businessName: 1 }).limit(match ? 20 : 200).lean();
  return ok(res, { allSellers: fbbAllSellersEnabled(), rows: rows.map(pilotView) });
});
/**
 * Add a seller to, or remove one from, the FBB pilot. A reason is required and kept with who and when.
 * Removing stops new FBB activity for that seller (listing, conversion, new receipts, new customer orders);
 * orders already placed, their charges, returns and the seller's obligations carry on unchanged.
 */
export const setFbbPilotSeller = asyncHandler(async (req, res) => {
  const sellerId = oid(req.params.sellerId, 'seller');
  const { enabled } = req.body || {};
  if (typeof enabled !== 'boolean') throw httpError(400, 'Say whether FBB is enabled (true or false) for this seller');
  const note = String(req.body.note ?? '').trim();
  if (note.length < 5 || note.length > 300) throw httpError(400, 'Give a reason (5–300 characters)');
  const seller = await Seller.findById(sellerId).select('status fbbPilot').lean();
  if (!seller) throw httpError(404, 'Seller not found');
  if (enabled && seller.status !== 'approved') throw httpError(409, 'Only an approved seller can join the FBB pilot');
  const now = new Date();
  const updated = await Seller.findByIdAndUpdate(sellerId, { $set: {
    'fbbPilot.enabled': enabled, 'fbbPilot.note': note, 'fbbPilot.changedAt': now, 'fbbPilot.changedBy': req.user._id,
    ...(enabled ? { 'fbbPilot.enabledAt': now, 'fbbPilot.enabledBy': req.user._id } : {}),
  } }, { returnDocument: 'after', runValidators: true }).select('businessName storeDetails.name status fbbPilot').lean();
  return ok(res, pilotView(updated), enabled ? 'Seller added to the FBB pilot' : 'Seller removed from the FBB pilot; existing FBB orders continue');
});

/* ---- stock, receiving, adjustments ---------------------------------------------------------------------------- */
export const listFbbProductsForReceiving = asyncHandler(async (req, res) => {
  const filter = { deliveryMethod: 'fbb', isDeleted: { $ne: true }, ...(req.query.sellerId ? { sellerId: oid(req.query.sellerId, 'seller') } : {}) };
  const products = await Product.find(filter).select('name sellerId sellerName images status isActive isDraft createdAt variants._id variants.name variants.stock fbb.convertedAt fbb.fromMethod')
    .populate('sellerId', 'businessName').sort({ name: 1 }).limit(500).lean();
  // Warehouse totals per product (all warehouses), so the Products list shows what has arrived.
  const totals = new Map((await WarehouseStock.aggregate([
    { $match: { productId: { $in: products.map((p) => p._id) } } },
    { $group: { _id: '$productId', sellable: { $sum: '$sellable' }, reserved: { $sum: '$reserved' }, quarantine: { $sum: { $ifNull: ['$quarantine', 0] } }, damaged: { $sum: '$damaged' } } },
  ])).map((t) => [String(t._id), t]));
  // Units sellers say are on the way (shipment notices not yet counted).
  const onTheWay = new Map((await FbbShipment.aggregate([
    { $match: { status: 'in_transit', 'lines.productId': { $in: products.map((p) => p._id) } } },
    { $unwind: '$lines' }, { $group: { _id: '$lines.productId', qty: { $sum: '$lines.qty' } } },
  ])).map((t) => [String(t._id), t.qty]));
  return ok(res, products.map((p) => {
    const t = totals.get(String(p._id));
    return { ...p, onTheWay: onTheWay.get(String(p._id)) || 0, warehouse: t ? { sellable: t.sellable, reserved: t.reserved, quarantine: t.quarantine, damaged: t.damaged } : null };
  }));
});
export const listWarehouseStock = asyncHandler(async (req, res) => {
  const filter = { ...(req.query.sellerId ? { sellerId: oid(req.query.sellerId, 'seller') } : {}), ...(req.query.warehouseId ? { warehouseId: oid(req.query.warehouseId, 'warehouse') } : {}) };
  const { page: p, limit } = page(req);
  const [rows, total] = await Promise.all([
    WarehouseStock.find(filter).sort({ updatedAt: -1 }).skip((p - 1) * limit).limit(limit).populate('productId', 'name variants._id variants.name').populate('sellerId', 'businessName').populate('warehouseId', 'code name').lean(),
    WarehouseStock.countDocuments(filter),
  ]);
  return ok(res, { rows: rows.map((r) => ({ ...r, variantName: r.productId?.variants?.find((v) => String(v._id) === String(r.variantId))?.name })), total, page: p, limit });
});
export const listWarehouseMovements = asyncHandler(async (req, res) => {
  const filter = { location: 'warehouse', ...(req.query.productId ? { productId: oid(req.query.productId, 'product') } : {}), ...(req.query.sellerId ? { sellerId: oid(req.query.sellerId, 'seller') } : {}) };
  const { page: p, limit } = page(req, 200);
  const [rows, total] = await Promise.all([StockMovement.find(filter).sort({ createdAt: -1 }).skip((p - 1) * limit).limit(limit).populate('productId', 'name').lean(), StockMovement.countDocuments(filter)]);
  return ok(res, { rows, total, page: p, limit });
});
export const listReceipts = asyncHandler(async (req, res) => {
  const filter = { ...(req.query.status ? { status: req.query.status } : {}), ...(req.query.sellerId ? { sellerId: oid(req.query.sellerId, 'seller') } : {}) };
  const { page: p, limit } = page(req);
  const [rows, total] = await Promise.all([
    WarehouseReceipt.find(filter).sort({ createdAt: -1 }).skip((p - 1) * limit).limit(limit).populate('sellerId', 'businessName').populate('warehouseId', 'code name').lean(),
    WarehouseReceipt.countDocuments(filter),
  ]);
  return ok(res, { rows, total, page: p, limit });
});
export const createReceiptAdmin = asyncHandler(async (req, res) => {
  const result = await createReceipt({ ...req.body, idempotencyKey: req.get('Idempotency-Key') || req.body?.idempotencyKey, adminId: req.user._id });
  if (!result.alreadyRecorded) {
    // Counted from a seller's "I've sent stock" notice: mark that shipment received (same seller, still in transit).
    await linkShipmentToReceipt({ shipmentId: req.body?.shipmentId, receipt: result.receipt })
      .catch((error) => console.error('[FBB] shipment link failed:', error.message));
    void alertSellerStockArrived(result.receipt);
  }
  return ok(res, result.receipt, result.alreadyRecorded ? 'Receipt already recorded' : 'Receipt counted (draft). Verify and post it to add the stock.');
});
export const listShipments = asyncHandler(async (req, res) => {
  const status = ['in_transit', 'received', 'cancelled'].includes(req.query.status) ? req.query.status : undefined;
  return ok(res, await listShipmentsAdmin({ status }));
});
export const postReceiptAdmin = asyncHandler(async (req, res) => {
  const result = await postReceipt({ receiptId: req.params.id, adminId: req.user._id });
  if (!result.alreadyPosted) void alertSellerStockPosted(result.receipt);
  return ok(res, result.receipt, result.alreadyPosted ? 'Receipt already posted' : 'Receipt posted: accepted units are now on sale');
});
export const cancelReceiptAdmin = asyncHandler(async (req, res) => {
  const receiptId = oid(req.params.id, 'receipt');
  const cancelled = await cancelDraftReceipt({ receiptId });
  // Not counted after all: a linked seller shipment is "on the way" again.
  await unlinkShipmentFromReceipt(receiptId).catch((error) => console.error('[FBB] shipment unlink failed:', error.message));
  return ok(res, cancelled, 'Draft receipt cancelled');
});
export const listAdjustments = asyncHandler(async (req, res) => ok(res, await WarehouseAdjustment.find(req.query.status ? { status: req.query.status } : {}).sort({ createdAt: -1 }).limit(200).populate('productId', 'name').populate('sellerId', 'businessName').lean()));
export const requestAdjustmentAdmin = asyncHandler(async (req, res) => created(res, await requestAdjustment({ ...req.body, adminId: req.user._id }), 'Adjustment requested; a different admin must approve it'));
export const decideAdjustmentAdmin = asyncHandler(async (req, res) => ok(res, await decideAdjustment({ adjustmentId: oid(req.params.id, 'adjustment'), adminId: req.user._id, approve: req.body?.approve === true, note: req.body?.note }), req.body?.approve === true ? 'Adjustment approved and applied' : 'Adjustment rejected'));
export const getInventoryReconciliation = asyncHandler(async (_req, res) => ok(res, await inventoryReconciliation()));
export const resyncMirrorAdmin = asyncHandler(async (req, res) => ok(res, await resyncMirror(oid(req.params.productId, 'product')), 'Listing stock re-derived from the warehouse'));

/* ---- FBB orders ------------------------------------------------------------------------------------------------ */
export const listFbbOrdersAdmin = asyncHandler(async (req, res) => ok(res, await listFbbOrders({ stage: req.query.stage, ...page(req) })));
export const acceptFbbOrderAdmin = asyncHandler(async (req, res) => ok(res, await acceptFbbOrder({ orderId: req.params.id, adminId: req.user._id }), 'Order accepted'));
export const pickFbbOrderAdmin = asyncHandler(async (req, res) => ok(res, await startFbbPicking({ orderId: req.params.id, adminId: req.user._id }), 'Picking started'));
export const packFbbOrderAdmin = asyncHandler(async (req, res) => ok(res, await markFbbPacked({ orderId: req.params.id, adminId: req.user._id }), 'Packed and ready for a delivery partner'));
export const handoffFbbOrderAdmin = asyncHandler(async (req, res) => ok(res, await confirmFbbCourierHandoff({ orderId: req.params.id, adminId: req.user._id }), 'Hand-off recorded'));
export const cancelFbbOrderAdmin = asyncHandler(async (req, res) => ok(res, await cancelFbbOrder({ orderId: req.params.id, adminId: req.user._id, reason: req.body?.reason }), 'Order cancelled'));
export const inspectFbbOrderAdmin = asyncHandler(async (req, res) => ok(res, await inspectFbbReturnedOrder({ orderId: req.params.id, adminId: req.user._id, lines: req.body?.lines, note: req.body?.note }), 'Inspection recorded'));

/**
 * Provider choice for an FBB order runs the very same handlers a seller uses (rider offer or Shiprocket
 * booking, with their locks and checks), as the admin and with the warehouse as the pickup origin.
 */
const asFbbAdmin = (handler) => asyncHandler(async (req, res, next) => {
  const order = await Order.findById(oid(req.params.id, 'order')).select('items deliveryMethod fulfillmentOwner origin');
  if (!order) throw httpError(404, 'Order not found');
  if (order.deliveryMethod !== 'fbb') throw httpError(409, 'Only Fulfilled by Bulkimart orders are handled here');
  const seller = await Seller.findById(order.items[0]?.sellerId);
  if (!seller) throw httpError(409, 'The seller of this order was not found');
  req.seller = await originSeller(order, seller);
  req.fbbAdmin = true;
  req.fulfillmentActor = 'admin';
  return handler(req, res, next);
});
export const fbbFulfillmentOptions = asFbbAdmin(getFulfillmentOptions);
export const fbbSelectRider = asFbbAdmin(selectManualFulfillment);
export const fbbBookShiprocket = asFbbAdmin(createShiprocketShipment);

/* ---- FBB charges & billing (finance) ---------------------------------------------------------------------------- */
export const getChargeConfigs = asyncHandler(async (_req, res) => ok(res, await listChargeConfigs()));
export const createChargeConfig = asyncHandler(async (req, res) => created(res, await saveChargeConfig({ input: req.body, adminId: req.user._id }), 'New FBB rates saved'));
export const listChargesAdmin = asyncHandler(async (req, res) => ok(res, await listCharges({ sellerId: req.query.sellerId && oid(req.query.sellerId, 'seller'), status: req.query.status, type: req.query.type, ...page(req) })));
export const reverseChargeAdmin = asyncHandler(async (req, res) => ok(res, await reverseCharge({ chargeId: req.params.id, adminId: req.user._id, reason: req.body?.reason }), 'Charge reversed'));
export const listFbbBilling = asyncHandler(async (_req, res) => {
  const sellers = await sellersWithFbbObligations();
  const names = new Map((await Seller.find({ _id: { $in: sellers.map((s) => s.sellerId) } }).select('businessName').lean()).map((s) => [String(s._id), s.businessName]));
  return ok(res, sellers.map((s) => ({ ...s, sellerName: names.get(String(s.sellerId)) })));
});
export const getSellerFbbBilling = asyncHandler(async (req, res) => ok(res, await fbbObligationSummary(oid(req.params.sellerId, 'seller'))));
export const settleSellerFbbAdmin = asyncHandler(async (req, res) => ok(res, await settleFbbObligations({ sellerId: oid(req.params.sellerId, 'seller'), actorId: req.user._id }), 'Deducted from eligible earnings where available'));
export const getChargeReconciliation = asyncHandler(async (_req, res) => ok(res, await chargeReconciliation()));
