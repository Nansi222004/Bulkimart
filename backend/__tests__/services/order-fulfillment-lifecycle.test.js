import Order from '../../models/Order.js';
import express from 'express';
import request from 'supertest';
import { jest } from '@jest/globals';
import { shiprocketWebhook } from '../../controllers/fulfillment.controller.js';
import { errorHandler } from '../../middlewares/error.middleware.js';
import {
  ORDER_STATUS, vendorTransitions, riderClaimableStatuses,
} from '../../constants/enums.js';
import {
  getShiprocketCapabilities, checkServiceability, createShiprocketOrder, assignCourier,
} from '../../services/shiprocket.service.js';

describe('order fulfillment lifecycle safeguards', () => {
  test('vendor acceptance, preparation, and ready-for-pickup are separate server transitions', () => {
    const transitions = vendorTransitions('internal');
    expect(transitions[ORDER_STATUS.PLACED]).toContain(ORDER_STATUS.CONFIRMED);
    expect(transitions[ORDER_STATUS.CONFIRMED]).toContain(ORDER_STATUS.PREPARING);
    expect(transitions[ORDER_STATUS.PREPARING]).toContain(ORDER_STATUS.DISPATCHED);
    expect(transitions[ORDER_STATUS.CONFIRMED]).not.toContain(ORDER_STATUS.DISPATCHED);
  });

  test('rider assignment statuses differ between quick commerce and ecommerce', () => {
    expect(riderClaimableStatuses('grocery')).toContain(ORDER_STATUS.PLACED);
    expect(riderClaimableStatuses('grocery')).toContain(ORDER_STATUS.DISPATCHED);
    expect(riderClaimableStatuses('ecommerce')).toEqual([ORDER_STATUS.DISPATCHED]);
  });

  test('audit fields preserve vendor decisions, fulfillment failures, and assignment history', async () => {
    const order = new Order({
      userId: '507f1f77bcf86cd799439011', type: 'grocery', items: [],
      vendorDecision: { status: 'rejected', sellerId: '507f1f77bcf86cd799439012', reason: 'Out of stock', decidedAt: new Date() },
      fulfillment: { method: 'manual', selectedBy: 'admin', selectedAt: new Date(), chargeStatus: 'not_applicable' },
      assignmentHistory: [{ partnerId: '507f1f77bcf86cd799439013', assignedByRole: 'admin', reason: 'Manual assignment' }],
    });
    // Schema-only check: full validate() also freezes the checkout financial
    // snapshot, which reads commission rules from a database this suite has
    // not got (that path is covered by verification/finance suites).
    expect(order.validateSync()).toBeUndefined();
    expect(order.vendorDecision.reason).toBe('Out of stock');
    expect(order.assignmentHistory).toHaveLength(1);
  });

  test('Shiprocket stays unavailable when credentials or webhook authentication are incomplete', () => {
    expect(getShiprocketCapabilities({ SHIPROCKET_MODE: 'live', SHIPROCKET_EMAIL: 'seller@example.com' }).configured).toBe(false);
  });

  test('third-party calls are mock-only and deterministic enough for automated tests', async () => {
    const previous = process.env.SHIPROCKET_MODE;
    process.env.SHIPROCKET_MODE = 'mock';
    try {
      await expect(checkServiceability({ pickupPostcode: '440010', deliveryPostcode: '440012', weight: 1, cod: false }))
        .resolves.toMatchObject({ available: true });
      await expect(createShiprocketOrder({ order_id: 'TEST-ORDER' }))
        .resolves.toEqual(expect.objectContaining({ success: true, shipment_id: expect.any(String) }));
      await expect(assignCourier('TEST-SHIPMENT'))
        .resolves.toEqual(expect.objectContaining({ success: true, awb: expect.any(String) }));
    } finally {
      if (previous === undefined) delete process.env.SHIPROCKET_MODE;
      else process.env.SHIPROCKET_MODE = previous;
    }
  });

  test('tracking webhook requires x-api-key and duplicate events are idempotent', async () => {
    process.env.SHIPROCKET_MODE = 'mock';
    const previous = process.env.SHIPROCKET_WEBHOOK_SECRET;
    process.env.SHIPROCKET_WEBHOOK_SECRET = 'test-webhook-secret';
    const update = jest.spyOn(Order, 'updateOne')
      .mockResolvedValueOnce({ modifiedCount: 1 })
      .mockResolvedValueOnce({ modifiedCount: 0 });
    const app = express();
    app.use(express.json());
    app.post('/events', shiprocketWebhook);
    app.use(errorHandler);
    const payload = { event_id: 'evt-1', awb: 'AWB-1', current_status: 'In Transit' };
    try {
      await request(app).post('/events').send(payload).expect(401);
      const first = await request(app).post('/events').set('x-api-key', 'test-webhook-secret').send(payload).expect(200);
      const duplicate = await request(app).post('/events').set('x-api-key', 'test-webhook-secret').send(payload).expect(200);
      expect(first.body.data.processed).toBe(true);
      expect(duplicate.body.data.processed).toBe(false);
      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({ 'shiprocket.awb': 'AWB-1', 'shiprocket.webhookEvents.eventId': { $ne: 'evt-1' } }),
        expect.any(Object),
      );
    } finally {
      update.mockRestore();
      if (previous === undefined) delete process.env.SHIPROCKET_WEBHOOK_SECRET;
      else process.env.SHIPROCKET_WEBHOOK_SECRET = previous;
    }
  });
});
