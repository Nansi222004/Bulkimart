import Payment from '../models/Payment.js';
import mongoose from 'mongoose';
import { asyncHandler } from '../middlewares/error.middleware.js';
import { httpError, ok } from '../utils/response.js';
import { processRefundObligation, reconcileCreationAttempt } from '../services/paymentRecovery.service.js';
import { settle } from './payment.controller.js';
import { getRazorpayPaymentStatus } from '../services/razorpay.service.js';
import { settleRazorpayRefundWebhook } from '../services/return.service.js';

const id = req => {
  if (!mongoose.isValidObjectId(req.params.paymentId)) throw httpError(400, 'Invalid payment ID');
  return req.params.paymentId;
};
const body = (req, allowed) => {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) || Object.keys(req.body).some(key => !allowed.includes(key))) throw httpError(400, 'Invalid recovery request');
  for (const key of Object.keys(req.body)) if (typeof req.body[key] !== 'string' || !req.body[key].trim() || req.body[key].length > 160) throw httpError(400, 'Invalid recovery reference');
  return req.body;
};
export const getPaymentRecovery = asyncHandler(async (req, res) => {
  const payment = await Payment.findById(id(req)).select('orderId groupRef amount status gatewayAttempts captures refundObligations refundOperation').lean();
  if (!payment) throw httpError(404, 'Payment not found');
  // Lease tokens are internal capabilities, never part of the admin response.
  delete payment.refundOperation;
  for (const attempt of payment.gatewayAttempts || []) { delete attempt.recoveryToken; delete attempt.recoveryLockedAt; }
  res.set('Cache-Control', 'private, no-store');
  return ok(res, payment);
});
export const listUnresolvedPaymentAttempts = asyncHandler(async (req, res) => {
  const page = Number(req.query.page ?? 1), limit = Number(req.query.limit ?? 24);
  if (Object.keys(req.query).some(key => !['page','limit'].includes(key)) || !Number.isSafeInteger(page) || page < 1 || page > 1000 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw httpError(400, 'Invalid payment recovery pagination');
  const states = ['initializing','creation_unknown'];
  const [result] = await Payment.aggregate([
    { $match: { 'gatewayAttempts.status': { $in: states } } }, { $unwind: '$gatewayAttempts' },
    { $match: { 'gatewayAttempts.status': { $in: states } } },
    { $sort: { 'gatewayAttempts.createdAt': 1, _id: 1 } },
    { $facet: { data: [{ $skip: (page-1)*limit }, { $limit: limit }, { $project: { paymentId:'$_id', orderId:1, status:1, attempt:{ attemptId:'$gatewayAttempts.attemptId', merchantOrderId:'$gatewayAttempts.merchantOrderId', orderId:'$gatewayAttempts.orderId', amountPaise:'$gatewayAttempts.amountPaise', currency:'$gatewayAttempts.currency', status:'$gatewayAttempts.status', createdAt:'$gatewayAttempts.createdAt', history:'$gatewayAttempts.history' } } }], count:[{ $count:'total' }] } },
  ]).option({ maxTimeMS:2000, allowDiskUse:false });
  res.set('Cache-Control','private, no-store');
  return ok(res, result?.data || [], 'Unresolved attempts block new initialization', { page,limit,total:result?.count[0]?.total || 0 });
});
export const processRefundRecovery = asyncHandler(async (req, res) => {
  const { key, providerRefundId } = body(req, ['key', 'providerRefundId']);
  const result = await processRefundObligation({ paymentId: id(req), key, actor: req.user._id, reconcile: req.path.endsWith('/reconcile'), providerRefundId });
  // Existing Return completion (including allocated Coins) remains centralized.
  if (result.providerRefundId && ['processed', 'failed'].includes(result.status)) await settleRazorpayRefundWebhook({ refundId: result.providerRefundId, state: result.status === 'processed' ? 'COMPLETED' : 'FAILED' });
  return ok(res, result, result.status === 'processed' ? 'Provider-verified refund completed' : 'Refund outcome recorded; inspect status before further action');
});
export const reconcilePaymentCreation = asyncHandler(async (req, res) => {
  const { key, gatewayOrderId } = body(req, ['key', 'gatewayOrderId']);
  const paymentId = id(req);
  const result = await reconcileCreationAttempt({ paymentId, key, gatewayOrderId, actor: req.user._id });
  const payment = await Payment.findById(paymentId);
  const live = await getRazorpayPaymentStatus({ orderId: result.gatewayOrderId });
  const attempt = payment.gatewayAttempts.find(row => row.attemptId === key);
  if (live.state !== 'PENDING' && (live.orderId !== result.gatewayOrderId || live.amountPaise !== attempt.amountPaise || live.currency !== attempt.currency)) throw httpError(400, 'Provider payment does not match the recovered attempt');
  if (live.state === 'COMPLETED' || live.state === 'FAILED') await settle({ payment, state: live.state, gatewayOrderId: result.gatewayOrderId, gatewayPaymentId: live.paymentId, amountPaise: live.amountPaise, currency: live.currency, paymentDetails: live.paymentDetails, errorCode: live.errorCode });
  return ok(res, { ...result, status: (await Payment.findById(paymentId)).status });
});
