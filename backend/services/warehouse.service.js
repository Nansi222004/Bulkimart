import mongoose from 'mongoose';
import Product from '../models/Product.js';
import Seller from '../models/Seller.js';
import Order from '../models/Order.js';
import Warehouse from '../models/Warehouse.js';
import WarehouseStock from '../models/WarehouseStock.js';
import WarehouseReceipt from '../models/WarehouseReceipt.js';
import WarehouseAdjustment from '../models/WarehouseAdjustment.js';
import StockMovement from '../models/StockMovement.js';
import FbbChargeConfig from '../models/FbbChargeConfig.js';
import DeliveryMethodChange from '../models/DeliveryMethodChange.js';
import { DELIVERY_METHOD } from '../constants/enums.js';
import { httpError } from '../utils/response.js';
import { deliveryMethodApplies, deliveryMethodsEnabled, fbbEnabled, fbbChargesEnabled, warehouseOperationsEnabled, fbbSellerEligible, assertFbbSellerEligible } from './deliveryMethod.service.js';
import { persistLegacyVariantIds } from './inventory.service.js';

/**
 * FBB warehouse inventory (WarehouseStock is the source of truth; see that model).
 *
 * The product's variant `stock` of an FBB product mirrors the warehouse's sellable units, recomputed in the
 * same transaction as every change, so all existing cart/checkout/listing code keeps reading one number and
 * the warehouse row's own conditional update is what stops two shoppers taking the last unit.
 */

const ACTIVE_ORDER_STATUSES = ['placed', 'confirmed', 'preparing', 'dispatched', 'out_for_delivery'];

const withSession = async (session, work) => {
  if (session) return work(session);
  const own = await mongoose.startSession();
  try { let result; await own.withTransaction(async (s) => { result = await work(s); }); return result; }
  finally { await own.endSession(); }
};

const positiveInt = (value, label) => {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 0) throw httpError(400, `${label} must be a whole number of zero or more`);
  return n;
};

/* ------------------------------------------------------------------ readiness ------------------------------------ */

export const currentChargeConfig = async (at = new Date(), session = null) => {
  const query = FbbChargeConfig.findOne({ effectiveFrom: { $lte: at } }).sort({ effectiveFrom: -1, version: -1 });
  if (session) query.session(session);
  return query.lean();
};

/** What still stands between sellers (or, given one, this seller) and FBB (empty = ready). */
export const fbbReadiness = async ({ seller } = {}) => {
  const blockers = [];
  if (seller !== undefined && !fbbSellerEligible(seller)) blockers.push('Fulfilled by Bulkimart is not enabled for this store yet');
  if (!deliveryMethodsEnabled()) blockers.push('Delivery methods are switched off');
  if (!fbbEnabled()) blockers.push('Fulfilled by Bulkimart is switched off');
  if (!await Warehouse.exists({ isActive: true })) blockers.push('No active Bulkimart warehouse is set up');
  // FBB is a paid service: it opens only with charging on and rates in force (see fbbSellable).
  if (!fbbChargesEnabled()) blockers.push('FBB charges are switched off');
  if (!await currentChargeConfig()) blockers.push('No FBB charge rates are configured');
  return { ready: blockers.length === 0, blockers };
};

/* ------------------------------------------------------------------ stock operations ----------------------------- */

/** Recompute an FBB variant's mirror (and the product's root stock projection) from warehouse stock. */
export const syncVariantMirror = async (productId, variantId, session) => {
  const [row] = await WarehouseStock.aggregate([
    { $match: { productId: new mongoose.Types.ObjectId(String(productId)), variantId: new mongoose.Types.ObjectId(String(variantId)) } },
    { $group: { _id: null, sellable: { $sum: '$sellable' } } },
  ]).session(session);
  const total = row?.sellable || 0;
  const updated = await Product.updateOne({ _id: productId, deliveryMethod: DELIVERY_METHOD.FBB, 'variants._id': variantId },
    { $set: { 'variants.$.stock': total }, $inc: { __v: 1 } }, { session });
  if (updated.matchedCount !== 1) throw httpError(409, 'The FBB product or variant no longer matches warehouse stock; reconciliation is required');
  await Product.updateOne({ _id: productId }, [{ $set: { stock: { $sum: { $map: { input: '$variants', as: 'v', in: '$$v.stock' } } } } }], { session, updatePipeline: true });
  return total;
};

const movement = (rows, session) => StockMovement.insertMany(rows.map((r) => ({ location: 'warehouse', actorType: 'admin', ...r })), { session });

/**
 * One warehouse stock change, atomic and guarded. Ops:
 *   reserve         sellable → reserved   (customer checkout; picks any warehouse with enough stock)
 *   release         reserved → sellable   (cancelled before it left the warehouse)
 *   dispatch        reserved → out        (handed to the provider)
 *   receive         + sellable / + damaged (verified inbound)
 *   return_restock  + sellable             (a returned or RTO unit inspected as resellable)
 *   return_damaged  + damaged              (a returned unit that cannot be resold)
 *   return_quarantine + quarantine         (a courier-returned / RTO unit, held until inspected)
 *   inspect         quarantine → sellable or damaged (the admin's inspection of an RTO unit)
 *   adjust          ± sellable or damaged  (approved exceptional adjustment)
 * @returns {Promise<{ warehouseId }>}
 */
export const warehouseStockOp = async ({ op, productId, variantId, qty, warehouseId, sellerId, damagedQty = 0, bucket, session, reference = {}, actorType = 'admin', actorId, note, excludeWarehouseIds }) => {
  if (!variantId) throw httpError(409, 'FBB stock is kept per variant; this line has no variant');
  if (!Number.isSafeInteger(qty) || qty < 0 || (qty === 0 && !damagedQty && op !== 'receive')) throw httpError(400, 'Invalid warehouse quantity');
  // A checkout reserve may skip warehouses that cannot deliver to the address (services/fbbServiceability.service.js).
  const skip = op === 'reserve' && !warehouseId && excludeWarehouseIds?.length ? { warehouseId: { $nin: excludeWarehouseIds } } : {};
  const key = { productId, variantId, ...(warehouseId ? { warehouseId } : {}), ...skip };
  let filter, inc, reason, mirror = true, moves;
  switch (op) {
    case 'reserve': filter = { ...key, sellable: { $gte: qty } }; inc = { sellable: -qty, reserved: qty }; reason = 'fbb_reserve'; moves = [['sellable', -qty], ['reserved', qty]]; break;
    case 'release': filter = { ...key, reserved: { $gte: qty } }; inc = { reserved: -qty, sellable: qty }; reason = 'fbb_release'; moves = [['reserved', -qty], ['sellable', qty]]; break;
    case 'dispatch': filter = { ...key, reserved: { $gte: qty } }; inc = { reserved: -qty }; reason = 'fbb_dispatch'; mirror = false; moves = [['reserved', -qty]]; break;
    case 'return_restock': filter = key; inc = { sellable: qty }; reason = 'fbb_return_restock'; moves = [['sellable', qty]]; break;
    case 'return_damaged': filter = key; inc = { damaged: qty }; reason = 'fbb_return_damaged'; mirror = false; moves = [['damaged', qty]]; break;
    case 'return_quarantine': filter = key; inc = { quarantine: qty }; reason = 'fbb_return_quarantine'; mirror = false; moves = [['quarantine', qty]]; break;
    case 'inspect': {
      if (!['sellable', 'damaged'].includes(bucket)) throw httpError(400, 'An inspected unit is either sellable or damaged');
      filter = { ...key, quarantine: { $gte: qty } }; inc = { quarantine: -qty, [bucket]: qty }; reason = 'fbb_inspection'; mirror = bucket === 'sellable';
      moves = [['quarantine', -qty], [bucket, qty]];
      break;
    }
    case 'receive': filter = key; inc = { sellable: qty, damaged: damagedQty }; reason = 'fbb_receipt'; moves = [['sellable', qty], ['damaged', damagedQty]]; break;
    case 'adjust': {
      if (!['sellable', 'damaged'].includes(bucket)) throw httpError(400, 'Choose the sellable or damaged bucket');
      const delta = qty * (reference.sign === -1 ? -1 : 1);
      filter = { ...key, ...(delta < 0 ? { [bucket]: { $gte: -delta } } : {}) }; inc = { [bucket]: delta }; reason = 'fbb_adjustment'; mirror = bucket === 'sellable'; moves = [[bucket, delta]];
      break;
    }
    default: throw httpError(400, 'Unknown warehouse operation');
  }
  const upsert = ['receive', 'return_restock', 'return_damaged', 'return_quarantine'].includes(op);
  if (upsert && (!warehouseId || !sellerId)) throw httpError(409, 'The warehouse and seller are required to add stock');
  const row = await WarehouseStock.findOneAndUpdate(filter, { $inc: inc, ...(upsert ? { $setOnInsert: { sellerId } } : {}) },
    { session, returnDocument: 'after', upsert, sort: { sellable: -1 } });
  if (!row) {
    if (op === 'reserve') throw httpError(409, 'There is not enough warehouse stock available');
    throw httpError(409, 'Warehouse stock does not match this operation; reconciliation is required');
  }
  const stockAfter = mirror ? await syncVariantMirror(productId, variantId, session) : undefined;
  const { sign: _sign, ...ref } = reference;
  await movement(moves.filter(([, delta]) => delta).map(([b, delta]) => ({
    productId, variantId, sellerId: row.sellerId, warehouseId: row.warehouseId, delta, bucket: b, reason, stockAfter: b === 'sellable' ? stockAfter : undefined,
    actorType, actorId, note: note ? String(note).slice(0, 200) : undefined, ...ref,
  })), session);
  return { warehouseId: row.warehouseId, sellerId: row.sellerId };
};

/* ------------------------------------------------------------------ warehouses ----------------------------------- */

export const requireWarehouseOperations = () => {
  if (!warehouseOperationsEnabled()) throw httpError(503, 'Warehouse receiving and adjustments are switched off', { code: 'WAREHOUSE_OPERATIONS_DISABLED' });
};

export const saveWarehouse = async ({ id, input = {}, adminId }) => {
  const fields = {
    code: input.code, name: input.name, phone: input.phone, shiprocketPickupLocation: input.shiprocketPickupLocation || undefined,
    address: input.address, isActive: input.isActive !== false,
  };
  if (!id) return (await Warehouse.create({ ...fields, createdBy: adminId })).toObject();
  const updated = await Warehouse.findByIdAndUpdate(id, { $set: fields }, { returnDocument: 'after', runValidators: true }).lean();
  if (!updated) throw httpError(404, 'Warehouse not found');
  return updated;
};

/* ------------------------------------------------------------------ receiving ------------------------------------ */

const receiptLine = (raw, product) => {
  const variant = (product.variants || []).find((v) => String(v._id) === String(raw.variantId));
  if (!variant) throw httpError(400, `The variant does not belong to ${product.name}`);
  const accepted = positiveInt(raw.acceptedQty, 'Accepted quantity');
  const damaged = positiveInt(raw.damagedQty ?? 0, 'Damaged quantity');
  const rejected = positiveInt(raw.rejectedQty ?? 0, 'Rejected quantity');
  const received = accepted + damaged + rejected;
  if (raw.receivedQty !== undefined && raw.receivedQty !== null && raw.receivedQty !== '' && positiveInt(raw.receivedQty, 'Received quantity') !== received) {
    throw httpError(400, `${product.name} (${variant.name}): received must equal accepted + damaged + rejected (${received})`);
  }
  const expected = raw.expectedQty === undefined || raw.expectedQty === null || raw.expectedQty === '' ? undefined : positiveInt(raw.expectedQty, 'Expected quantity');
  if (received === 0) throw httpError(400, `${product.name} (${variant.name}): nothing was received on this line`);
  return {
    productId: product._id, variantId: variant._id, productName: product.name, variantName: variant.name,
    expectedQty: expected, receivedQty: received, acceptedQty: accepted, damagedQty: damaged, rejectedQty: rejected,
    missingQty: expected === undefined ? 0 : Math.max(0, expected - received),
    note: raw.note ? String(raw.note).slice(0, 300) : undefined,
  };
};

/** Count an inbound delivery (draft). Idempotent per key: the same key returns the same receipt. */
export const createReceipt = async ({ warehouseId, sellerId, lines, reference, notes, idempotencyKey, adminId }) => {
  requireWarehouseOperations();
  const key = String(idempotencyKey || '').trim();
  if (key.length < 8 || key.length > 100) throw httpError(400, 'An idempotency key is required');
  const existing = await WarehouseReceipt.findOne({ idempotencyKey: key }).lean();
  if (existing) return { receipt: existing, alreadyRecorded: true };
  if (!mongoose.isValidObjectId(warehouseId) || !await Warehouse.exists({ _id: warehouseId, isActive: true })) throw httpError(400, 'Choose an active warehouse');
  const sender = mongoose.isValidObjectId(sellerId) ? await Seller.findById(sellerId).select('fbbPilot').lean() : null;
  if (!sender) throw httpError(400, 'Choose the seller who sent the goods');
  // New inbound stock is new FBB activity, so it needs an eligible seller (pilot). Posting a draft already counted does not.
  assertFbbSellerEligible(sender);
  if (!Array.isArray(lines) || !lines.length || lines.length > 200) throw httpError(400, 'Add 1–200 product lines');
  const productIds = [...new Set(lines.map((l) => String(l.productId)))];
  if (productIds.some((id) => !mongoose.isValidObjectId(id))) throw httpError(400, 'Invalid product');
  const products = new Map((await Product.find({ _id: { $in: productIds } }).select('name sellerId deliveryMethod variants type fulfillmentType isDeleted').lean()).map((p) => [String(p._id), p]));
  const seen = new Set();
  const parsed = lines.map((raw) => {
    const product = products.get(String(raw.productId));
    if (!product || product.isDeleted) throw httpError(400, 'A product on this receipt was not found');
    if (String(product.sellerId) !== String(sellerId)) throw httpError(400, `${product.name} belongs to a different seller`);
    if (product.deliveryMethod !== DELIVERY_METHOD.FBB) throw httpError(409, `${product.name} is not a Fulfilled by Bulkimart product`);
    const lineKey = `${raw.productId}:${raw.variantId}`;
    if (seen.has(lineKey)) throw httpError(400, `${product.name} appears twice on this receipt; combine the counts`);
    seen.add(lineKey);
    return receiptLine(raw, product);
  });
  const receiptNo = `GRN-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${new mongoose.Types.ObjectId().toString().slice(-6).toUpperCase()}`;
  try {
    const receipt = await WarehouseReceipt.create({ receiptNo, idempotencyKey: key, warehouseId, sellerId, lines: parsed,
      reference: reference ? String(reference).slice(0, 100) : undefined, notes: notes ? String(notes).slice(0, 500) : undefined, createdBy: adminId });
    return { receipt: receipt.toObject(), alreadyRecorded: false };
  } catch (error) {
    if (error?.code === 11000) return { receipt: await WarehouseReceipt.findOne({ idempotencyKey: key }).lean(), alreadyRecorded: true };
    throw error;
  }
};

/**
 * Verify and post a receipt: draft → posted once, then accepted units become sellable, damaged units are
 * held, storage is charged per accepted unit. All in one transaction.
 *
 * FBB is a paid service and storage is earned at receipt, so posting needs charging on and rates in force:
 * otherwise it is refused and the draft kept (posting later charges it), never posted without its charge.
 */
export const postReceipt = async ({ receiptId, adminId }) => {
  requireWarehouseOperations();
  if (!fbbChargesEnabled() || !await currentChargeConfig()) {
    throw httpError(409, 'Posting receipts is paused while FBB charges are off or no rates are set; the draft is kept.', { code: 'FBB_CHARGES_REQUIRED' });
  }
  if (!mongoose.isValidObjectId(receiptId)) throw httpError(400, 'Invalid receipt');
  return withSession(null, async (session) => {
    const receipt = await WarehouseReceipt.findOneAndUpdate({ _id: receiptId, status: 'draft' },
      { $set: { status: 'posted', postedBy: adminId, postedAt: new Date() } }, { session, returnDocument: 'after' });
    if (!receipt) {
      const current = await WarehouseReceipt.findById(receiptId).session(session).lean();
      if (current?.status === 'posted') return { receipt: current, alreadyPosted: true };
      throw httpError(current ? 409 : 404, current ? 'Only a draft receipt can be posted' : 'Receipt not found');
    }
    for (const line of receipt.lines) {
      await warehouseStockOp({ op: 'receive', productId: line.productId, variantId: line.variantId, qty: line.acceptedQty, damagedQty: line.damagedQty,
        warehouseId: receipt.warehouseId, sellerId: receipt.sellerId, session, actorId: adminId,
        reference: { referenceType: 'receipt', referenceId: receipt._id }, note: `${receipt.receiptNo}: ${line.acceptedQty} accepted, ${line.damagedQty} damaged, ${line.rejectedQty} rejected, ${line.missingQty} missing` });
    }
    const { chargeStorageForReceipt } = await import('./fbbCharges.service.js');
    const storageCharged = await chargeStorageForReceipt(receipt, session);
    if (storageCharged) await WarehouseReceipt.updateOne({ _id: receipt._id }, { $set: { storageCharged: true } }, { session });
    return { receipt: { ...receipt.toObject(), storageCharged }, alreadyPosted: false };
  });
};

export const cancelDraftReceipt = async ({ receiptId }) => {
  const updated = await WarehouseReceipt.findOneAndUpdate({ _id: receiptId, status: 'draft' }, { $set: { status: 'cancelled' } }, { returnDocument: 'after' }).lean();
  if (!updated) throw httpError(409, 'Only a draft receipt can be cancelled');
  return updated;
};

/* ------------------------------------------------------------------ adjustments ---------------------------------- */

export const requestAdjustment = async ({ warehouseId, productId, variantId, bucket, delta, reason, adminId }) => {
  requireWarehouseOperations();
  const row = await WarehouseStock.findOne({ warehouseId, productId, variantId }).lean();
  if (!row) throw httpError(404, 'This product has no stock record in that warehouse');
  const text = String(reason || '').trim();
  if (text.length < 5) throw httpError(400, 'Explain the adjustment (at least 5 characters)');
  const change = Number(delta);
  if (!Number.isSafeInteger(change) || change === 0) throw httpError(400, 'Enter a non-zero whole-number change');
  return (await WarehouseAdjustment.create({ warehouseId, productId, variantId, sellerId: row.sellerId, bucket, delta: change, reason: text, requestedBy: adminId })).toObject();
};

/** A different admin approves (stock changes once) or rejects (nothing changes). */
export const decideAdjustment = async ({ adjustmentId, adminId, approve, note }) => {
  requireWarehouseOperations();
  return withSession(null, async (session) => {
    const pending = await WarehouseAdjustment.findById(adjustmentId).session(session);
    if (!pending) throw httpError(404, 'Adjustment not found');
    if (pending.status !== 'pending') throw httpError(409, 'This adjustment was already decided');
    if (String(pending.requestedBy) === String(adminId)) throw httpError(403, 'A different admin must approve a stock adjustment');
    const decided = await WarehouseAdjustment.findOneAndUpdate({ _id: adjustmentId, status: 'pending' },
      { $set: { status: approve ? 'approved' : 'rejected', decidedBy: adminId, decidedAt: new Date(), decisionNote: note ? String(note).slice(0, 300) : undefined } },
      { session, returnDocument: 'after' });
    if (!decided) throw httpError(409, 'This adjustment was already decided');
    if (approve) {
      await warehouseStockOp({ op: 'adjust', productId: decided.productId, variantId: decided.variantId, warehouseId: decided.warehouseId, bucket: decided.bucket,
        qty: Math.abs(decided.delta), session, actorId: adminId, note: decided.reason,
        reference: { sign: decided.delta < 0 ? -1 : 1, referenceType: 'adjustment', referenceId: decided._id } });
    }
    return decided.toObject();
  });
};

/* ------------------------------------------------------------------ conversion ----------------------------------- */

/**
 * Seller converts an Easy Ship / Self Delivery listing to FBB (one-way). Refused while any order for it is
 * still being fulfilled by the seller. The seller's shop stock is recorded and set aside; the listing shows
 * out of stock until the warehouse posts a receipt for it.
 */
export const convertProductToFbb = async ({ productId, seller, userId, acceptedChargeVersion }) => {
  assertFbbSellerEligible(seller);
  const readiness = await fbbReadiness({ seller });
  if (!readiness.ready) throw httpError(409, `Fulfilled by Bulkimart is not available: ${readiness.blockers.join('; ')}`, { code: 'FBB_NOT_READY' });
  const config = await currentChargeConfig();
  if (config && Number(acceptedChargeVersion) !== config.version) throw httpError(409, 'The FBB charges changed. Review the current charges and confirm again.', { code: 'FBB_CHARGES_CHANGED' });
  if (!mongoose.isValidObjectId(productId)) throw httpError(400, 'Invalid product');
  let product = await Product.findById(productId);
  if (!product || product.isDeleted) throw httpError(404, 'Product not found');
  if (String(product.sellerId) !== String(seller._id)) throw httpError(403, 'You can only convert your own products');
  if (!deliveryMethodApplies(product)) throw httpError(400, 'Only physical E-Commerce products can use Fulfilled by Bulkimart');
  if (product.deliveryMethod === DELIVERY_METHOD.FBB) return { product: product.toObject(), alreadyConverted: true };
  product = await persistLegacyVariantIds(product);
  const fromMethod = product.deliveryMethod || DELIVERY_METHOD.EASY_SHIP;
  return withSession(null, async (session) => {
    if (await Order.exists({ 'items.productId': product._id, status: { $in: ACTIVE_ORDER_STATUSES } }).session(session)) {
      throw httpError(409, 'Finish or cancel the open orders for this product before converting it to Fulfilled by Bulkimart.', { code: 'FBB_ACTIVE_ORDERS' });
    }
    const fresh = await Product.findById(product._id).session(session);
    const held = (fresh.variants || []).map((v) => ({ variantId: v._id, variantName: v.name, qty: Number(v.stock) || 0 }));
    const updated = await Product.findOneAndUpdate({ _id: fresh._id, __v: fresh.__v, deliveryMethod: fresh.deliveryMethod ?? null }, {
      $set: { deliveryMethod: DELIVERY_METHOD.FBB, stock: 0, ...Object.fromEntries((fresh.variants || []).map((_, i) => [`variants.${i}.stock`, 0])),
        fbb: { convertedAt: new Date(), convertedBy: userId, chargeConfigVersionAccepted: config?.version, fromMethod, sellerHeldAtConversion: held } },
      $unset: { sameDay: 1 }, $inc: { __v: 1 },
    }, { session, returnDocument: 'after' });
    if (!updated) throw httpError(409, 'The product changed. Refresh and try again.');
    const moves = held.filter((h) => h.qty > 0).map((h) => ({ productId: fresh._id, variantId: h.variantId, variantName: h.variantName, sellerId: fresh.sellerId,
      delta: -h.qty, stockAfter: 0, reason: 'fbb_conversion', location: 'seller', actorType: 'seller', actorId: userId,
      note: 'Seller-held stock set aside at FBB conversion; only warehouse stock is sold from now on', referenceType: 'conversion' }));
    if (moves.length) await StockMovement.insertMany(moves, { session });
    await DeliveryMethodChange.create([{ productId: fresh._id, sellerId: fresh.sellerId, from: fromMethod, to: DELIVERY_METHOD.FBB, actorType: 'seller', actorId: userId, source: 'product_edit' }], { session });
    return { product: updated.toObject(), alreadyConverted: false };
  });
};

/* ------------------------------------------------------------------ views & reconciliation ------------------------ */

export const sellerWarehouseView = async (sellerId) => {
  const [stock, receipts] = await Promise.all([
    WarehouseStock.find({ sellerId }).populate('productId', 'name variants._id variants.name').populate('warehouseId', 'name code').lean(),
    WarehouseReceipt.find({ sellerId, status: { $ne: 'cancelled' } }).sort({ createdAt: -1 }).limit(50).populate('warehouseId', 'name code').lean(),
  ]);
  return {
    stock: stock.map((row) => ({
      warehouse: row.warehouseId, productId: row.productId?._id, productName: row.productId?.name,
      variantId: row.variantId, variantName: row.productId?.variants?.find((v) => String(v._id) === String(row.variantId))?.name,
      sellable: row.sellable, reserved: row.reserved, damaged: row.damaged, quarantine: row.quarantine || 0, updatedAt: row.updatedAt,
    })),
    receipts: receipts.map(({ idempotencyKey: _k, createdBy: _c, postedBy: _p, ...r }) => r),
  };
};

/** Products whose mirrored stock differs from warehouse sellable stock (should always be empty). */
export const inventoryReconciliation = async () => {
  const fbbProducts = await Product.find({ deliveryMethod: DELIVERY_METHOD.FBB }).select('name sellerId variants._id variants.name variants.stock').lean();
  const totals = await WarehouseStock.aggregate([{ $group: { _id: { productId: '$productId', variantId: '$variantId' }, sellable: { $sum: '$sellable' }, reserved: { $sum: '$reserved' }, damaged: { $sum: '$damaged' }, quarantine: { $sum: '$quarantine' } } }]);
  const byKey = new Map(totals.map((t) => [`${t._id.productId}:${t._id.variantId}`, t]));
  const rows = [];
  for (const product of fbbProducts) for (const variant of product.variants || []) {
    const t = byKey.get(`${product._id}:${variant._id}`) || { sellable: 0, reserved: 0, damaged: 0, quarantine: 0 };
    rows.push({ productId: product._id, productName: product.name, sellerId: product.sellerId, variantId: variant._id, variantName: variant.name,
      mirrorStock: variant.stock, warehouseSellable: t.sellable, reserved: t.reserved, damaged: t.damaged, quarantine: t.quarantine || 0, matches: variant.stock === t.sellable });
  }
  return { rows, mismatches: rows.filter((r) => !r.matches).length };
};

/** Re-derive one product's mirror from the warehouse (the source of truth). */
export const resyncMirror = async (productId) => withSession(null, async (session) => {
  const product = await Product.findOne({ _id: productId, deliveryMethod: DELIVERY_METHOD.FBB }).select('variants._id').session(session);
  if (!product) throw httpError(404, 'FBB product not found');
  for (const variant of product.variants) await syncVariantMirror(product._id, variant._id, session);
  return { productId };
});
