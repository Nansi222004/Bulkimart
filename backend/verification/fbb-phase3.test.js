import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import Order from '../models/Order.js';
import Payment from '../models/Payment.js';
import Seller from '../models/Seller.js';
import User from '../models/User.js';
import Admin from '../models/Admin.js';
import Product from '../models/Product.js';
import Category from '../models/Category.js';
import Return from '../models/Return.js';
import Ledger from '../models/SellerLedgerEntry.js';
import WalletLedger from '../models/WalletLedger.js';
import Warehouse from '../models/Warehouse.js';
import WarehouseStock from '../models/WarehouseStock.js';
import WarehouseReceipt from '../models/WarehouseReceipt.js';
import StockMovement from '../models/StockMovement.js';
import FbbCharge from '../models/FbbCharge.js';
import FbbChargeConfig from '../models/FbbChargeConfig.js';
import { saveCommissionVersion } from '../services/vendorCommission.service.js';
import { createReceipt, postReceipt, requestAdjustment, decideAdjustment, convertProductToFbb, inventoryReconciliation, warehouseStockOp, fbbReadiness } from '../services/warehouse.service.js';
import { saveChargeConfig, chargeTermsForNewOrder, fbbObligationSummary, settleFbbObligations, reverseCharge, chargeReconciliation } from '../services/fbbCharges.service.js';
import { acceptFbbOrder, startFbbPicking, markFbbPacked, recordFbbHandoff, cancelFbbOrder } from '../services/fbbFulfillment.service.js';
import { mutateInventory } from '../services/inventory.service.js';
import { postLedgerEntry } from '../services/sellerLedger.service.js';
import { transitionReturnStatus } from '../services/return.service.js';
import { resolveDeliveryMethodInput } from '../services/deliveryMethod.service.js';

/**
 * Phase 3 — Fulfilled by Bulkimart: warehouse receiving and stock, conversion, warehouse fulfilment, FBB charges
 * and settlement, and returns. Isolated database; no provider or payment is contacted.
 */
const id = () => new mongoose.Types.ObjectId();
let db, user, admin, admin2, seller, warehouse, product, variantId;
const FLAGS = { DELIVERY_METHODS_ENABLED: 'true', FBB_ENABLED: 'true', WAREHOUSE_OPERATIONS_ENABLED: 'true', FBB_CHARGES_ENABLED: 'true' };
const setFlags = (over = {}) => { for (const [k, v] of Object.entries({ ...FLAGS, ...over })) { process.env[k] = v === undefined ? 'false' : v; } }; // undefined = switched off (unset now means ON)

const stockRow = () => WarehouseStock.findOne({ productId: product._id, variantId }).lean();
const mirror = async () => (await Product.findById(product._id).lean()).variants[0].stock;
const receive = async (accepted = 90, extra = {}) => {
  const { receipt } = await createReceipt({ warehouseId: warehouse._id, sellerId: seller._id, idempotencyKey: `KEY-${id()}`, adminId: admin._id,
    lines: [{ productId: product._id, variantId, expectedQty: 100, acceptedQty: accepted, damagedQty: 5, rejectedQty: 0, ...extra }] });
  return postReceipt({ receiptId: receipt._id, adminId: admin._id });
};
/** An FBB order as checkout creates it: warehouse stock reserved, origin and frozen charge terms recorded. */
const fbbOrder = async ({ qty = 2, paymentMethod = 'online', status = 'placed' } = {}) => {
  const session = await mongoose.startSession();
  let order;
  await session.withTransaction(async () => {
    const moved = await mutateInventory({ productId: product._id, variantId, quantity: qty, session, deliveryMethod: 'fbb' });
    const pay = (await Payment.create([{ userId: user._id, amount: 50 * qty + 40, method: paymentMethod, status: paymentMethod === 'cod' ? 'pending' : 'paid', paidAt: new Date() }], { session }))[0];
    [order] = await Order.create([{ userId: user._id, type: 'ecommerce', paymentMethod, paymentId: pay._id, status, deliveryMethod: 'fbb', fulfillmentOwner: 'bulkimart',
      origin: { kind: 'warehouse', warehouseId: moved.warehouseId }, fbb: { status: 'awaiting_acceptance', chargeTerms: await chargeTermsForNewOrder(session) },
      fulfillment: { assignmentPolicy: 'warehouse_after_acceptance' },
      items: [{ productId: product._id, variantId, sellerId: seller._id, type: 'ecommerce', name: 'Lamp', qty, price: 50, deliveryMethod: 'fbb' }],
      pricing: { subtotal: 50 * qty, deliveryCharge: 40, totalAmount: 50 * qty + 40 }, timeline: [] }], { session });
  });
  await session.endSession();
  return order;
};

beforeAll(async () => {
  db = await MongoMemoryReplSet.create({ binary: { version: '7.0.14' }, replSet: { count: 1 } });
  await mongoose.connect(db.getUri());
  await Promise.all([Ledger.init(), Payment.init(), Order.init(), WalletLedger.init(), Return.init(), WarehouseStock.init(), WarehouseReceipt.init(), FbbCharge.init(), FbbChargeConfig.init(), Warehouse.init()]);
});
afterAll(async () => { setFlags(Object.fromEntries(Object.keys(FLAGS).map((k) => [k, undefined]))); await mongoose.disconnect(); await db?.stop(); });
beforeEach(async () => {
  setFlags();
  for (const collection of Object.values(mongoose.connection.collections)) await collection.deleteMany({});
  user = await User.create({ name: 'Customer', phone: '9876600101', roles: ['buyer'], isActive: true, wallet: { balance: 0 } });
  const [a1, a2] = [id(), id()];
  await Admin.collection.insertMany([
    { _id: a1, name: 'Warehouse lead', email: 'w1@example.test', password: 'x', role: 'admin', permissions: ['manage_warehouse', 'manage_finance'], isActive: true },
    { _id: a2, name: 'Warehouse second', email: 'w2@example.test', password: 'x', role: 'admin', permissions: ['manage_warehouse'], isActive: true },
  ]);
  [admin, admin2] = [await Admin.findById(a1), await Admin.findById(a2)];
  const sellerId = id();
  await Seller.collection.insertOne({ _id: sellerId, userId: id(), businessName: 'Fixture store', status: 'approved', bankDetails: { upiId: 'fixture@test' }, storeDetails: { name: 'Shop', city: 'Indore', pincode: '452001', lat: 22.7, lng: 75.8 }, fbbPilot: { enabled: true } });
  seller = await Seller.findById(sellerId);
  warehouse = await Warehouse.create({ code: 'BLR-1', name: 'Bulkimart Warehouse', address: { line1: 'Plot 1', city: 'Bengaluru', state: 'Karnataka', pincode: '560001', lat: 12.97, lng: 77.59 }, phone: '9876500099', shiprocketPickupLocation: 'BLR-WH' });
  const category = id();
  await Category.collection.insertOne({ _id: category, name: 'Lighting', type: 'ecommerce' });
  variantId = id();
  product = await Product.create({ type: 'ecommerce', name: 'Lamp', category, sellerId, price: 50, stock: 7, deliveryMethod: undefined,
    variants: [{ _id: variantId, name: 'Default', price: 50, mrp: 50, stock: 7, unit: 'piece' }] });
  await saveCommissionVersion({ vendorType: 'general', channel: 'ecommerce', method: 'percentage', value: 10, minimum: null, maximum: null, base: 'eligible_item_subtotal',
    fixedScope: 'order_item', taxTreatment: 'exempt', taxRate: 0, effectiveDate: '2020-01-01T00:00:00Z', isActive: true, reason: 'Synthetic fixture policy only' }, admin._id);
  await saveChargeConfig({ input: { storage: { amount: 2 }, packaging: { amount: 5, basis: 'per_order' }, fulfillment: { amount: 3, basis: 'per_unit' }, reason: 'Fixture FBB rates' }, adminId: admin._id });
  ({ product } = await convertProductToFbb({ productId: product._id, seller, userId: seller.userId, acceptedChargeVersion: 1 }));
});

describe('A. conversion, receiving and warehouse stock', () => {
  test('conversion is one-way, sets seller stock aside, and needs the current charges accepted', async () => {
    expect(product.deliveryMethod).toBe('fbb');
    expect(product.variants[0].stock).toBe(0);
    expect(product.fbb.sellerHeldAtConversion).toEqual([expect.objectContaining({ qty: 7 })]);
    expect(await StockMovement.countDocuments({ productId: product._id, reason: 'fbb_conversion', delta: -7, location: 'seller' })).toBe(1);
    expect(() => resolveDeliveryMethodInput('easy_ship', product)).toThrow(expect.objectContaining({ status: 409 }));
    // Another listing: refused while it has an open seller-fulfilled order, or with stale charges.
    const other = await Product.create({ type: 'ecommerce', name: 'Fan', category: product.category, sellerId: seller._id, price: 10, stock: 3, variants: [{ name: 'Default', price: 10, mrp: 10, stock: 3, unit: 'piece' }] });
    await expect(convertProductToFbb({ productId: other._id, seller, userId: seller.userId, acceptedChargeVersion: 99 })).rejects.toMatchObject({ meta: { code: 'FBB_CHARGES_CHANGED' } });
    await Order.create({ userId: user._id, type: 'ecommerce', paymentMethod: 'online', status: 'preparing', items: [{ productId: other._id, sellerId: seller._id, qty: 1, price: 10, name: 'Fan' }], pricing: { subtotal: 10, totalAmount: 10 } });
    await expect(convertProductToFbb({ productId: other._id, seller, userId: seller.userId, acceptedChargeVersion: 1 })).rejects.toMatchObject({ meta: { code: 'FBB_ACTIVE_ORDERS' } });
  });

  test('readiness blocks conversion while FBB is off or no warehouse exists', async () => {
    setFlags({ FBB_ENABLED: undefined });
    expect((await fbbReadiness()).ready).toBe(false);
    setFlags();
    await Warehouse.updateOne({ _id: warehouse._id }, { $set: { isActive: false } });
    expect((await fbbReadiness()).blockers).toContain('No active Bulkimart warehouse is set up');
  });

  test('100 expected → 90 accepted, 5 damaged, 5 missing: only 90 become sellable; storage charged on 90 only; posting is once', async () => {
    const { receipt } = await createReceipt({ warehouseId: warehouse._id, sellerId: seller._id, idempotencyKey: 'RECEIPT-0001', adminId: admin._id,
      lines: [{ productId: product._id, variantId, expectedQty: 100, receivedQty: 95, acceptedQty: 90, damagedQty: 5 }] });
    expect(receipt.lines[0]).toMatchObject({ expectedQty: 100, receivedQty: 95, acceptedQty: 90, damagedQty: 5, rejectedQty: 0, missingQty: 5 });
    expect((await createReceipt({ warehouseId: warehouse._id, sellerId: seller._id, idempotencyKey: 'RECEIPT-0001', adminId: admin._id, lines: [] })).alreadyRecorded).toBe(true);
    expect(await mirror()).toBe(0); // a draft adds nothing
    const posted = await postReceipt({ receiptId: receipt._id, adminId: admin._id });
    expect(posted.receipt.storageCharged).toBe(true);
    expect(await stockRow()).toMatchObject({ sellable: 90, reserved: 0, damaged: 5 });
    expect(await mirror()).toBe(90);
    expect((await postReceipt({ receiptId: receipt._id, adminId: admin._id })).alreadyPosted).toBe(true);
    expect(await stockRow()).toMatchObject({ sellable: 90 });
    const storage = await FbbCharge.find({ type: 'storage' }).lean();
    expect(storage.map((c) => [c.qty, c.amountPaise])).toEqual([[90, 18000]]);
    expect((await fbbObligationSummary(seller._id)).outstanding).toBe(180);
    await expect(WarehouseReceipt.updateOne({ _id: receipt._id }, { $set: { 'lines.0.acceptedQty': 100 } })).rejects.toThrow(/draft/);
  });

  test('received must equal accepted + damaged + rejected; wrong seller or non-FBB products are refused', async () => {
    await expect(createReceipt({ warehouseId: warehouse._id, sellerId: seller._id, idempotencyKey: 'RECEIPT-0002', adminId: admin._id,
      lines: [{ productId: product._id, variantId, receivedQty: 10, acceptedQty: 8 }] })).rejects.toMatchObject({ status: 400 });
    await expect(createReceipt({ warehouseId: warehouse._id, sellerId: id(), idempotencyKey: 'RECEIPT-0003', adminId: admin._id,
      lines: [{ productId: product._id, variantId, acceptedQty: 1 }] })).rejects.toMatchObject({ status: 400 });
  });

  test('receiving is refused while warehouse operations are switched off', async () => {
    setFlags({ WAREHOUSE_OPERATIONS_ENABLED: undefined });
    await expect(receive()).rejects.toMatchObject({ status: 503 });
  });

  test('adjustments need a second admin; approval changes stock once, rejection never', async () => {
    await receive();
    const adj = await requestAdjustment({ warehouseId: warehouse._id, productId: product._id, variantId, bucket: 'sellable', delta: -4, reason: 'Cycle count found 4 fewer', adminId: admin._id });
    await expect(decideAdjustment({ adjustmentId: adj._id, adminId: admin._id, approve: true })).rejects.toMatchObject({ status: 403 });
    await decideAdjustment({ adjustmentId: adj._id, adminId: admin2._id, approve: true });
    await expect(decideAdjustment({ adjustmentId: adj._id, adminId: admin2._id, approve: true })).rejects.toMatchObject({ status: 409 });
    expect(await stockRow()).toMatchObject({ sellable: 86 });
    expect(await mirror()).toBe(86);
    const rejected = await requestAdjustment({ warehouseId: warehouse._id, productId: product._id, variantId, bucket: 'sellable', delta: 50, reason: 'Mistaken request', adminId: admin._id });
    await decideAdjustment({ adjustmentId: rejected._id, adminId: admin2._id, approve: false });
    expect(await mirror()).toBe(86);
    expect((await inventoryReconciliation()).mismatches).toBe(0);
  });
});

describe('B. reservations and restores', () => {
  test('concurrent buyers cannot take more than the warehouse holds; mirror stays exact', async () => {
    await receive(3);
    const results = await Promise.allSettled([1, 2, 3, 4, 5].map(() => fbbOrder({ qty: 1 })));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(3);
    expect(await stockRow()).toMatchObject({ sellable: 0, reserved: 3 });
    expect(await mirror()).toBe(0);
    expect((await inventoryReconciliation()).mismatches).toBe(0);
  });

  test('cancellation before hand-off releases reserved units back on sale', async () => {
    await receive(10);
    const order = await fbbOrder({ qty: 4 });
    expect(await stockRow()).toMatchObject({ sellable: 6, reserved: 4 });
    await cancelFbbOrder({ orderId: order._id, adminId: admin._id, reason: 'Customer asked to cancel' });
    expect(await stockRow()).toMatchObject({ sellable: 10, reserved: 0 });
    expect(await mirror()).toBe(10);
  });

  test('a line sold by the seller before conversion never adds to warehouse stock when restored', async () => {
    await receive(10);
    await mutateInventory({ productId: product._id, variantId, quantity: 2, restore: true, deliveryMethod: 'easy_ship' });
    expect(await mirror()).toBe(10);
    await expect(mutateInventory({ productId: product._id, variantId, quantity: 1, deliveryMethod: 'easy_ship' })).rejects.toMatchObject({ status: 409 });
  });
});

describe('C+D. warehouse fulfilment and FBB charges', () => {
  test('accept → pick → pack (packaging charged once) → hand-off (stock leaves, fulfilment charged once)', async () => {
    await receive(10);
    const order = await fbbOrder({ qty: 2 });
    expect(order.fbb.chargeTerms).toMatchObject({ configVersion: 1, packaging: { amountPaise: 500, basis: 'per_order' }, fulfillment: { amountPaise: 300, basis: 'per_unit' } });
    await acceptFbbOrder({ orderId: order._id, adminId: admin._id });
    await startFbbPicking({ orderId: order._id, adminId: admin._id });
    await markFbbPacked({ orderId: order._id, adminId: admin._id });
    await markFbbPacked({ orderId: order._id, adminId: admin._id });
    await expect(recordFbbHandoff(order._id, 'test')).rejects.toMatchObject({ status: 409 }); // not with a provider yet
    await Order.updateOne({ _id: order._id }, { $set: { status: 'dispatched', deliveryType: 'internal' } });
    await recordFbbHandoff(order._id, 'rider_pickup');
    expect((await recordFbbHandoff(order._id, 'courier_scan')).alreadyRecorded).toBe(true);
    expect(await stockRow()).toMatchObject({ sellable: 8, reserved: 0 });
    const charges = await FbbCharge.find({ orderId: order._id }).sort({ type: 1 }).lean();
    expect(charges.map((c) => [c.type, c.amountPaise])).toEqual([['fulfillment', 600], ['packaging', 500]]);
    // New rates never change an order already placed.
    await saveChargeConfig({ input: { storage: { amount: 9 }, packaging: { amount: 9, basis: 'per_order' }, fulfillment: { amount: 9, basis: 'per_unit' }, reason: 'Rate rise' }, adminId: admin._id });
    expect((await Order.findById(order._id).lean()).fbb.chargeTerms.configVersion).toBe(1);
    expect((await chargeReconciliation()).problems).toEqual([]);
  });

  test('cancelled after packing keeps the packaging charge only; before packing nothing is charged', async () => {
    await receive(10);
    const early = await fbbOrder({ qty: 1 });
    await acceptFbbOrder({ orderId: early._id, adminId: admin._id });
    await cancelFbbOrder({ orderId: early._id, adminId: admin._id, reason: 'Customer cancelled early' });
    expect(await FbbCharge.countDocuments({ orderId: early._id })).toBe(0);
    const late = await fbbOrder({ qty: 1 });
    await acceptFbbOrder({ orderId: late._id, adminId: admin._id });
    await startFbbPicking({ orderId: late._id, adminId: admin._id });
    await markFbbPacked({ orderId: late._id, adminId: admin._id });
    await cancelFbbOrder({ orderId: late._id, adminId: admin._id, reason: 'Customer cancelled after packing' });
    expect((await FbbCharge.find({ orderId: late._id }).lean()).map((c) => c.type)).toEqual(['packaging']);
    expect(await stockRow()).toMatchObject({ sellable: 10, reserved: 0 });
  });

  test('charges settle from eligible earnings without overdrawing; the rest stays outstanding; reversal credits once', async () => {
    await receive(90); // ₹180 storage
    await postLedgerEntry({ idempotencyKey: `TEST-EARN-${id()}`, sellerId: seller._id, account: 'seller_payable', type: 'order_earning', direction: 'credit', bucket: 'eligible', amount: 100, description: 'Fixture earning' });
    const first = await settleFbbObligations({ sellerId: seller._id });
    expect(first).toMatchObject({ settled: 100, outstanding: 80 });
    const second = await settleFbbObligations({ sellerId: seller._id });
    expect(second.settled).toBe(0); // nothing eligible left; never negative
    expect(await fbbObligationSummary(seller._id)).toMatchObject({ outstanding: 80, settledFromEarnings: 100 });
    const charge = await FbbCharge.findOne({ type: 'storage' }).lean();
    await reverseCharge({ chargeId: charge._id, adminId: admin._id, reason: 'Wrong storage rate applied' });
    await expect(reverseCharge({ chargeId: charge._id, adminId: admin._id, reason: 'Again by mistake' })).rejects.toMatchObject({ status: 409 });
    const summary = await fbbObligationSummary(seller._id);
    expect(summary).toMatchObject({ reversed: 180, outstanding: 0, advanceCredit: 100 });
  });

  // Phase 4 (F9): FBB is paid, so with charging off a receipt is not posted without its storage charge; the draft waits.
  test('switching FBB charging off pauses receipt posting instead of skipping storage, and existing charges stay', async () => {
    await receive(10);
    setFlags({ FBB_CHARGES_ENABLED: undefined });
    await expect(receive(5)).rejects.toThrow('Posting receipts is paused');
    expect(await FbbCharge.countDocuments({ type: 'storage' })).toBe(1);
    expect(await stockRow()).toMatchObject({ sellable: 10 });
  });
});

describe('E. returns and RTO', () => {
  const deliveredOrderWithReturn = async (status = 'RETURN_RECEIVED') => {
    await receive(10);
    const order = await fbbOrder({ qty: 2 });
    await Order.updateOne({ _id: order._id }, { $set: { status: 'delivered', deliveryType: 'internal', 'fbb.handedOverAt': new Date(), 'fbb.status': 'handed_over' } });
    await warehouseStockOp({ op: 'dispatch', productId: product._id, variantId, qty: 2, warehouseId: order.origin.warehouseId });
    const ret = await Return.collection.insertOne({ returnNumber: `RET-${id().toString().slice(-6)}`, orderId: order._id, orderItemId: order.items[0]._id, customerId: user._id, sellerId: seller._id,
      productId: product._id, variantId, productName: 'Lamp', unitPriceSnapshot: 50, quantity: 2, reason: 'DAMAGED', status: 'AWAITING_RETURN', restockStatus: 'NOT_PROCESSED',
      pickup: { status: 'DELIVERED_TO_SELLER', sellerConfirmedReceivedAt: new Date() }, history: [], requestedAt: new Date() });
    return { order, returnId: ret.insertedId, status };
  };

  test('a resellable FBB return goes back on sale at the warehouse, once', async () => {
    const { returnId } = await deliveredOrderWithReturn();
    expect(await stockRow()).toMatchObject({ sellable: 8, reserved: 0 });
    await transitionReturnStatus({ returnId, toStatus: 'RETURN_RECEIVED', adminId: admin._id, restockDecision: 'RESTOCKABLE' });
    expect(await stockRow()).toMatchObject({ sellable: 10 });
    expect(await mirror()).toBe(10);
    await expect(transitionReturnStatus({ returnId, toStatus: 'RETURN_RECEIVED', adminId: admin._id, restockDecision: 'RESTOCKABLE' })).rejects.toBeTruthy();
    expect(await stockRow()).toMatchObject({ sellable: 10 });
    expect(await FbbCharge.countDocuments({ type: 'storage' })).toBe(1); // no second storage charge
  });

  test('a damaged FBB return is held as damaged stock, not put on sale', async () => {
    const { returnId } = await deliveredOrderWithReturn();
    await transitionReturnStatus({ returnId, toStatus: 'RETURN_RECEIVED', adminId: admin._id, restockDecision: 'NON_RESTOCKABLE' });
    expect(await stockRow()).toMatchObject({ sellable: 8, damaged: 7 });
    expect(await mirror()).toBe(8);
  });
});
