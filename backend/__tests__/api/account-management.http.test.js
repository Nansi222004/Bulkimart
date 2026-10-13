import { jest } from '@jest/globals';
import express from 'express';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import request from 'supertest';

process.env.JWT_SECRET = 'account-management-test-secret';

const adminId = new mongoose.Types.ObjectId();
const executeAccountAction = jest.fn();
const Admin = {
  findById: jest.fn(() => ({ select: async () => ({ _id: adminId, role: 'admin', isActive: true }) })),
};
const User = { findById: jest.fn(() => ({ select: async () => null })) };

jest.unstable_mockModule('../../models/Admin.js', () => ({ default: Admin }));
jest.unstable_mockModule('../../models/User.js', () => ({ default: User }));
jest.unstable_mockModule('../../services/accountLifecycle.service.js', () => ({ executeAccountAction }));

const [{ deleteCustomerAccount, deleteSellerAccount, deleteDeliveryAccount }, { protect, requireAdmin }, { errorHandler }, { JWT_SECRET }] = await Promise.all([
  import('../../controllers/accountManagement.controller.js'),
  import('../../middlewares/auth.middleware.js'),
  import('../../middlewares/error.middleware.js'),
  import('../../config/jwt.js'),
]);

const app = express();
app.use(express.json());
app.delete('/customers/:id', protect, requireAdmin, deleteCustomerAccount);
app.delete('/sellers/:id', protect, requireAdmin, deleteSellerAccount);
app.delete('/delivery/:id', protect, requireAdmin, deleteDeliveryAccount);
app.use(errorHandler);

const token = jwt.sign({ id: String(adminId), type: 'admin' }, JWT_SECRET);
const targetId = String(new mongoose.Types.ObjectId());

beforeEach(() => jest.clearAllMocks());

test('all account-removal routes require an authenticated administrator', async () => {
  await request(app).delete(`/customers/${targetId}`).expect(401);
  await request(app).delete(`/sellers/${targetId}`).expect(401);
  await request(app).delete(`/delivery/${targetId}`).expect(401);
  expect(executeAccountAction).not.toHaveBeenCalled();
});

test.each([
  ['/customers/', 'customer', 'deleted'],
  ['/sellers/', 'seller', 'deactivated'],
  ['/delivery/', 'delivery', 'deactivated'],
])('returns the explicit permanent-delete/deactivation result for %s', async (path, category, outcome) => {
  executeAccountAction.mockResolvedValue({ outcome, reasonCodes: outcome === 'deactivated' ? ['ORDER_HISTORY'] : [] });

  const response = await request(app).delete(`${path}${targetId}`).set('Authorization', `Bearer ${token}`);

  expect(response.status).toBe(200);
  expect(response.body.data.action).toBe(outcome);
  expect(executeAccountAction).toHaveBeenCalledWith(expect.objectContaining({ category, targetId, actorAdminId: adminId }));
});

test('active fulfillment and protected identities are blocked with reason codes', async () => {
  executeAccountAction.mockResolvedValue({ outcome: 'skipped', reasonCodes: ['ACTIVE_ORDERS', 'PROTECTED_ADMIN_IDENTITY'] });

  const response = await request(app).delete(`/customers/${targetId}`).set('Authorization', `Bearer ${token}`);

  expect(response.status).toBe(409);
  expect(response.body.meta).toEqual({ action: 'blocked', reasonCodes: ['ACTIVE_ORDERS', 'PROTECTED_ADMIN_IDENTITY'] });
});

test('malformed identifiers are rejected before lifecycle analysis', async () => {
  await request(app).delete('/customers/not-an-object-id').set('Authorization', `Bearer ${token}`).expect(400);
  expect(executeAccountAction).not.toHaveBeenCalled();
});
