import crypto from 'crypto';
import { jest } from '@jest/globals';
import {
  createRazorpayOrder,
  createRazorpayRefund,
  getRazorpayPaymentStatus,
  normalizeRazorpayPaymentState,
  parseRazorpayWebhookEvent,
  validateRazorpayConfig,
  verifyRazorpayPaymentSignature,
  verifyRazorpayWebhookSignature,
} from '../../services/razorpay.service.js';

const env = {
  RAZORPAY_MODE: 'test',
  RAZORPAY_KEY_ID: 'rzp_test_public',
  RAZORPAY_KEY_SECRET: 'payment-secret',
  RAZORPAY_WEBHOOK_SECRET: 'webhook-secret',
};

describe('Razorpay test integration', () => {
  test('validates test credentials and rejects a live key in test mode', () => {
    expect(validateRazorpayConfig(env)).toBe(true);
    expect(() => validateRazorpayConfig({ ...env, RAZORPAY_KEY_ID: 'rzp_live_wrong' }))
      .toThrow(/does not match/);
  });

  test('creates a real Razorpay order request without returning a secret', async () => {
    const create = jest.fn(async (payload) => ({ id: 'order_test_1', ...payload, status: 'created' }));
    const previousKey = process.env.RAZORPAY_KEY_ID;
    process.env.RAZORPAY_KEY_ID = env.RAZORPAY_KEY_ID;
    try {
      const result = await createRazorpayOrder(
        { merchantOrderId: 'BM-ORDER-A1', amountPaise: 12500, notes: { orderNo: 'BM-ORDER' } },
        { orders: { create } },
      );
      expect(create).toHaveBeenCalledWith(expect.objectContaining({ amount: 12500, currency: 'INR' }));
      expect(result).toEqual(expect.objectContaining({ orderId: 'order_test_1', keyId: 'rzp_test_public' }));
      expect(result).not.toHaveProperty('keySecret');
    } finally {
      if (previousKey === undefined) delete process.env.RAZORPAY_KEY_ID;
      else process.env.RAZORPAY_KEY_ID = previousKey;
    }
  });

  test('accepts only the valid backend payment signature', () => {
    const orderId = 'order_test_1';
    const paymentId = 'pay_test_1';
    const signature = crypto.createHmac('sha256', env.RAZORPAY_KEY_SECRET)
      .update(`${orderId}|${paymentId}`).digest('hex');
    expect(verifyRazorpayPaymentSignature({ orderId, paymentId, signature }, env)).toBe(true);
    expect(verifyRazorpayPaymentSignature({ orderId, paymentId, signature: 'bad' }, env)).toBe(false);
  });

  test('verifies the exact raw webhook body and rejects altered payloads', () => {
    const raw = Buffer.from('{"event":"payment.captured"}');
    const signature = crypto.createHmac('sha256', env.RAZORPAY_WEBHOOK_SECRET).update(raw).digest('hex');
    expect(verifyRazorpayWebhookSignature(raw, signature, env)).toBe(true);
    expect(verifyRazorpayWebhookSignature(Buffer.from('{"event":"payment.failed"}'), signature, env)).toBe(false);
  });

  test.each([
    ['created', 'PENDING'],
    ['authorized', 'PENDING'],
    ['captured', 'COMPLETED'],
    ['failed', 'FAILED'],
    ['cancelled', 'FAILED'],
  ])('normalizes %s payments as %s', (status, expected) => {
    expect(normalizeRazorpayPaymentState(status)).toBe(expected);
  });

  test('fetches server-side status instead of trusting frontend success', async () => {
    const client = { payments: { fetch: jest.fn(async () => ({
      id: 'pay_test_1', order_id: 'order_test_1', status: 'captured', amount: 12500,
      currency: 'INR', method: 'upi', captured: true,
    })) } };
    await expect(getRazorpayPaymentStatus({ orderId: 'order_test_1', paymentId: 'pay_test_1' }, client))
      .resolves.toEqual(expect.objectContaining({ state: 'COMPLETED', amountPaise: 12500, currency: 'INR' }));
  });

  test('parses successful, failed and duplicate webhook payloads deterministically', () => {
    const body = { event: 'payment.captured', payload: { payment: { entity: {
      id: 'pay_test_1', order_id: 'order_test_1', amount: 12500, status: 'captured',
    } } } };
    const first = parseRazorpayWebhookEvent(body);
    const duplicate = parseRazorpayWebhookEvent(body);
    expect(first).toEqual(expect.objectContaining({ kind: 'payment_completed', gatewayOrderId: 'order_test_1' }));
    expect(duplicate.eventId).toBe(first.eventId);
    expect(parseRazorpayWebhookEvent({ event: 'payment.failed', payload: body.payload }).kind)
      .toBe('payment_failed');
    expect(parseRazorpayWebhookEvent({
      event: 'refund.processed',
      payload: { refund: { entity: { id: 'rfnd_test_1', amount: 5000, status: 'processed' } } },
    })).toEqual(expect.objectContaining({ kind: 'refund_completed', refundId: 'rfnd_test_1' }));
  });

  test('creates Razorpay refunds through the SDK and preserves pending state', async () => {
    const refund = jest.fn(async () => ({ id: 'rfnd_test_1', status: 'pending', amount: 5000 }));
    await expect(createRazorpayRefund(
      { paymentId: 'pay_test_1', amountPaise: 5000, receipt: 'RETURN-1' },
      { payments: { refund } },
    )).resolves.toEqual(expect.objectContaining({ refundId: 'rfnd_test_1', state: 'PENDING' }));
    expect(refund).toHaveBeenCalledWith('pay_test_1', expect.objectContaining({ amount: 5000 }));
  });
});

