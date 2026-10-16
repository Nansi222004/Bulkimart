import crypto from 'crypto';
import Razorpay from 'razorpay';
import { MAX_CHECKOUT_PAISE } from '../utils/money.js';

let cachedClient = null;
let cachedKeyId = null;

export const validateRazorpayConfig = (env = process.env) => {
  const required = ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET']
    .filter((key) => !env[key]);
  if (required.length) throw new Error(`Razorpay configuration is incomplete: ${required.join(', ')}`);

  const expectedPrefix = env.RAZORPAY_MODE === 'test' ? 'rzp_test_' : 'rzp_live_';
  if (!env.RAZORPAY_KEY_ID.startsWith(expectedPrefix)) {
    throw new Error(`RAZORPAY_KEY_ID does not match RAZORPAY_MODE=${env.RAZORPAY_MODE}`);
  }
  return true;
};

export const getRazorpayClient = (env = process.env) => {
  validateRazorpayConfig(env);
  if (!cachedClient || cachedKeyId !== env.RAZORPAY_KEY_ID) {
    cachedClient = new Razorpay({ key_id: env.RAZORPAY_KEY_ID, key_secret: env.RAZORPAY_KEY_SECRET });
    cachedKeyId = env.RAZORPAY_KEY_ID;
  }
  return cachedClient;
};

const safeEqualHex = (expected, received) => {
  const a = Buffer.from(expected || '', 'utf8');
  const b = Buffer.from(received || '', 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

export const verifyRazorpayPaymentSignature = ({ orderId, paymentId, signature }, env = process.env) => {
  if (!orderId || !paymentId || !signature || !env.RAZORPAY_KEY_SECRET) return false;
  const expected = crypto.createHmac('sha256', env.RAZORPAY_KEY_SECRET)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');
  return safeEqualHex(expected, String(signature).trim());
};

export const verifyRazorpayWebhookSignature = (rawBody, signature, env = process.env) => {
  if (!rawBody || !signature || !env.RAZORPAY_WEBHOOK_SECRET) return false;
  const expected = crypto.createHmac('sha256', env.RAZORPAY_WEBHOOK_SECRET)
    .update(rawBody)
    .digest('hex');
  return safeEqualHex(expected, String(signature).trim());
};

export const normalizeRazorpayPaymentState = (status) => {
  if (status === 'captured') return 'COMPLETED';
  if (['failed', 'cancelled'].includes(status)) return 'FAILED';
  return 'PENDING';
};

export const createRazorpayOrder = async (
  { merchantOrderId, amountPaise, notes = {} },
  client = getRazorpayClient(),
) => {
  if (!Number.isSafeInteger(amountPaise) || amountPaise <= 0 || amountPaise > MAX_CHECKOUT_PAISE) {
    throw Object.assign(new Error('Invalid payment amount'), { status: 400 });
  }
  const order = await client.orders.create({
    amount: amountPaise,
    currency: 'INR',
    receipt: String(merchantOrderId).slice(0, 40),
    notes: { ...notes, merchantOrderId: String(merchantOrderId) },
  });
  if (!order?.id) throw new Error('Razorpay did not return an order id');
  return {
    orderId: order.id,
    amountPaise: Number(order.amount),
    currency: order.currency || 'INR',
    status: order.status,
    keyId: process.env.RAZORPAY_KEY_ID,
  };
};

export const getRazorpayPaymentStatus = async (
  { orderId, paymentId },
  client = getRazorpayClient(),
) => {
  let payment;
  if (paymentId) {
    payment = await client.payments.fetch(paymentId);
  } else {
    const collection = await client.orders.fetchPayments(orderId);
    const items = collection?.items || [];
    payment = items.find((item) => item.status === 'captured')
      || items.find((item) => item.status === 'failed')
      || items[0];
  }
  if (!payment) return { state: 'PENDING', orderId, paymentId: null, paymentDetails: [] };
  return {
    state: normalizeRazorpayPaymentState(payment.status),
    orderId: payment.order_id || orderId,
    paymentId: payment.id,
    amountPaise: Number(payment.amount),
    currency: payment.currency,
    errorCode: payment.error_code,
    paymentDetails: [{
      id: payment.id,
      status: payment.status,
      method: payment.method,
      captured: payment.captured,
    }],
  };
};

export const createRazorpayRefund = async (
  { paymentId, amountPaise, receipt, notes = {} },
  client = getRazorpayClient(),
) => {
  if (!paymentId) throw new Error('Razorpay payment id is required for a refund');
  const refund = await client.payments.refund(paymentId, {
    amount: amountPaise,
    receipt: String(receipt).slice(0, 40),
    notes,
  });
  return {
    refundId: refund.id,
    state: refund.status === 'processed' ? 'COMPLETED' : (refund.status === 'failed' ? 'FAILED' : 'PENDING'),
    raw: { id: refund.id, status: refund.status, amount: refund.amount },
  };
};

export const parseRazorpayWebhookEvent = (body = {}) => {
  const event = body.event;
  const payment = body.payload?.payment?.entity;
  const refund = body.payload?.refund?.entity;
  const kind = {
    'payment.captured': 'payment_completed',
    'order.paid': 'payment_completed',
    'payment.failed': 'payment_failed',
    'refund.processed': 'refund_completed',
    'refund.failed': 'refund_failed',
  }[event] || 'unknown';

  return {
    kind,
    event,
    eventId: body.id || `${event || 'unknown'}:${payment?.id || refund?.id || 'unknown'}`,
    gatewayOrderId: payment?.order_id || body.payload?.order?.entity?.id,
    paymentId: payment?.id,
    refundId: refund?.id,
    refundPaymentId: refund?.payment_id,
    refundReceipt: refund?.receipt,
    refundNotes: refund?.notes,
    amountPaise: payment?.amount || refund?.amount,
    currency: payment?.currency || refund?.currency,
    errorCode: payment?.error_code || refund?.error_code,
    paymentDetails: payment ? [{
      id: payment.id,
      status: payment.status,
      method: payment.method,
      captured: payment.captured,
    }] : [],
  };
};

export const rupeesToPaise = (rupees) => Math.round(Number(rupees) * 100);

