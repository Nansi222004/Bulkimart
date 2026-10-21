import mongoose from 'mongoose';
import Payment from '../models/Payment.js';
import Snapshot from '../models/QuickCommerceFinancialSnapshot.js';
import { sellerAndOrder } from './fulfillment.controller.js';
import { getQuickCommerceConfig, recordQuickCommerceObligation, validateServiceFeeConfiguration } from '../services/quickCommerceFinance.service.js';
import { checkServiceability, verifyPickupLocation } from '../services/shiprocket.service.js';
import { pickupReadyForShipping, pickupDefinition } from '../services/sellerPickupSync.service.js';
import { storePickup } from '../services/storePickup.service.js';
import { orderPaymentReady } from '../services/orderPaymentEligibility.service.js';
import { createRazorpayOrder, getRazorpayPaymentStatus, verifyRazorpayPaymentSignature } from '../services/razorpay.service.js';
import { settleQuickShiprocketCollection } from '../services/quickShiprocketCollection.service.js';
import { getPaymentGateway } from '../config/runtime.js';
import { shiprocketEnvironment } from '../config/shiprocketEnvironment.js';
import { asyncHandler } from '../middlewares/error.middleware.js';
import { httpError, ok } from '../utils/response.js';

const eligible = async (req) => {
  const context = await sellerAndOrder(req);
  const { order } = context;
  if (order.type !== 'grocery' || order.delivery?.mode === 'same_day' || order.status !== 'preparing' || order.vendorDecision?.status !== 'accepted' || !order.fulfillment?.readyAt || order.fulfillment?.method === 'manual' || order.deliveryId || order.deliveryPartnerId || order.shiprocket?.orderId) throw httpError(409, 'A ready, accepted Quick Commerce order with no existing fulfillment is required');
  if (!await orderPaymentReady(order)) throw httpError(409, 'Customer payment is not verified');
  return context;
};

const checkout = (payment) => ({ keyId: process.env.RAZORPAY_KEY_ID, razorpayOrderId: payment.gateway.orderId,
  amountPaise: Math.round(payment.amount * 100), currency: 'INR', orderId: String(payment._id),
  verificationPath: '/api/sellers/shiprocket-fees/verify', name: 'Bulkimart', description: 'Quick Commerce Shiprocket seller fee' });

export const initiateQuickShiprocketFee = asyncHandler(async (req, res) => {
  const { seller, order } = await eligible(req);
  const state = await getQuickCommerceConfig();
  if (!state.config.enabled || !state.activationReady || getPaymentGateway() !== 'razorpay') throw httpError(409, 'Seller charging is disabled. Platform approval and complete configuration are required.');
  validateServiceFeeConfiguration(state.config);
  if (req.body?.confirm !== true || typeof req.body.reviewedTotal !== 'number' || !Number.isFinite(req.body.reviewedTotal)) throw httpError(400, 'Review the current fee rule and confirm the payable amount');
  let snapshot = await Snapshot.findOne({ orderId: order._id, sellerId: seller._id });
  if (snapshot && (snapshot.providerEnvironment !== shiprocketEnvironment().mode || snapshot.paymentEnvironment !== process.env.RAZORPAY_MODE)) throw httpError(409, 'Fee obligation belongs to another payment or shipping environment; contact support');
  if (req.body.feeVersion !== (snapshot?.serviceFee.version || state.config.fee.version)) throw httpError(409, 'Fee rule changed; review the current breakdown');
  if (snapshot && Math.round(snapshot.vendorDeliveryFeeObligation * 100) !== Math.round(req.body.reviewedTotal * 100)) throw httpError(409, 'Review the saved fee obligation before paying');
  if (!snapshot) {
    const pickup = storePickup(seller);
    const weights = order.items.map(item => Number(item.weightSnapshot) * Number(item.qty));
    if (!pickup || !seller.thirdPartyFulfillment?.enabled || !seller.thirdPartyFulfillment?.shiprocketPickupLocation || weights.some(weight => !Number.isFinite(weight) || weight <= 0)) throw httpError(409, 'Verified pickup, shipping approval and valid item weights are required');
    if (!pickupReadyForShipping(seller, req.user)) throw httpError(409, 'Synchronize the current store pickup before paying');
    const verified = await verifyPickupLocation(seller.thirdPartyFulfillment.shiprocketPickupLocation, pickup, seller.pickupSync?.status ? { payload: pickupDefinition(seller, req.user).payload, providerId: seller.pickupSync.providerId } : undefined);
    if (!verified) throw httpError(409, 'Registered pickup could not be verified; no fee was collected');
    const service = await checkServiceability({ pickupPostcode: pickup.pincode, deliveryPostcode: order.shippingAddress?.pincode, weight: weights.reduce((a,b) => a+b,0)/1000, cod: order.paymentMethod === 'cod' });
    const quote = service.available && service.couriers?.filter(row => row.courier_company_id != null && row.freight_charge != null && row.freight_charge !== '' && Number.isFinite(Number(row.freight_charge)) && Number(row.freight_charge) >= 0).sort((a,b) => Number(a.freight_charge)-Number(b.freight_charge))[0];
    if (!quote) throw httpError(409, 'No authoritative courier freight is available; refresh delivery options');
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        // Serializes competing confirmations and manual-fulfillment selection.
        const locked = await mongoose.model('Order').updateOne({ _id: order._id, __v: order.__v, 'fulfillment.method': null, status: 'preparing' }, { $inc: { __v: 1 } }, { session });
        if (locked.modifiedCount !== 1) throw httpError(409, 'Order changed; refresh before confirming');
        const result = await recordQuickCommerceObligation({ order, sellerId: seller._id, quote, config: state.config, session });
        snapshot = result.snapshot;
        if (Math.round(snapshot.vendorDeliveryFeeObligation * 100) !== Math.round(req.body.reviewedTotal * 100) || snapshot.vendorDeliveryFeeObligation <= 0) throw httpError(409, 'Fee estimate changed or zero-payment handling needs approval; refresh the breakdown');
        await Payment.create([{ userId: req.user._id, quickFeeSnapshotId: snapshot._id, amount: snapshot.vendorDeliveryFeeObligation, method: 'online', status: 'pending' }], { session });
      });
    } finally { await session.endSession(); }
  }
  let payment = await Payment.findOne({ quickFeeSnapshotId: snapshot._id, userId: req.user._id });
  if (!payment) throw httpError(409, 'Fee obligation requires reconciliation; contact support');
  if (payment.status === 'paid') return ok(res, { status: 'paid', snapshot });
  if (payment.gateway?.orderId) return ok(res, { status: payment.status, checkout: checkout(payment), snapshot });
  const receipt = `QSF-${payment._id}`;
  const reserved = await Payment.findOneAndUpdate({ _id: payment._id, gatewayAttempts: { $size: 0 } }, { $push: { gatewayAttempts: { attemptId: receipt, merchantOrderId: receipt, provider: 'razorpay', orderId: order._id, amountPaise: Math.round(payment.amount*100), currency: 'INR', status: 'initializing', createdAt: new Date() } } }, { returnDocument: 'after' });
  if (!reserved) throw httpError(409, 'Payment creation is in progress or requires reconciliation. Check status; do not start another charge.');
  try {
    const gw = await createRazorpayOrder({ merchantOrderId: receipt, amountPaise: Math.round(payment.amount * 100), notes: { bulkimartOrderId: String(order._id), quickFeeSnapshotId: String(snapshot._id) } });
    if (gw.amountPaise !== Math.round(payment.amount*100) || gw.currency !== 'INR') throw new Error('Provider amount mismatch');
    payment = await Payment.findOneAndUpdate({ _id: payment._id, 'gatewayAttempts.attemptId': receipt }, { $set: {
      'gatewayAttempts.$.gatewayOrderId': gw.orderId, 'gatewayAttempts.$.status': 'issued',
      gateway: { provider: 'razorpay', orderId: gw.orderId, merchantOrderId: receipt, initiatedAt: new Date() },
    } }, { returnDocument: 'after' });
  } catch {
    await Payment.updateOne({ _id: payment._id, 'gatewayAttempts.attemptId': receipt }, { $set: { 'gatewayAttempts.$.status': 'creation_unknown' } });
    throw httpError(503, 'Provider creation outcome needs reconciliation; no new charge will be created');
  }
  return ok(res, { status: payment.status, checkout: checkout(payment), snapshot });
});

export const verifyQuickShiprocketFee = asyncHandler(async (req, res) => {
  const { orderId, razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
  const payment = mongoose.isValidObjectId(orderId) && await Payment.findOne({ _id: orderId, userId: req.user._id, quickFeeSnapshotId: { $exists: true } });
  if (!payment || payment.gateway?.orderId !== razorpay_order_id) throw httpError(404, 'Seller fee payment not found');
  if (!verifyRazorpayPaymentSignature({ orderId: razorpay_order_id, paymentId: razorpay_payment_id, signature: razorpay_signature })) throw httpError(401, 'Payment verification failed');
  const live = await getRazorpayPaymentStatus({ orderId: razorpay_order_id, paymentId: razorpay_payment_id });
  if (live.orderId !== razorpay_order_id || live.paymentId !== razorpay_payment_id) throw httpError(400, 'Payment association mismatch');
  return ok(res, await settleQuickShiprocketCollection({ payment, state: live.state, gatewayOrderId: live.orderId, gatewayPaymentId: live.paymentId, amountPaise: live.amountPaise, currency: live.currency }));
});

export const getQuickShiprocketFee = asyncHandler(async (req, res) => {
  const { seller, order } = await sellerAndOrder(req);
  const snapshot = await Snapshot.findOne({ orderId: order._id, sellerId: seller._id }).lean();
  const payment = snapshot && await Payment.findOne({ quickFeeSnapshotId: snapshot._id }).select('_id status gateway.orderId gateway.paymentId refundObligations.status gatewayAttempts.status').lean();
  return ok(res, { snapshot, payment });
});
