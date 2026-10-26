import { jest } from '@jest/globals';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import jwt from 'jsonwebtoken';
import request from 'supertest';

process.env.JWT_SECRET = 'admin-auth-test-secret-that-is-not-used-outside-tests';

const findAdmin = jest.fn();
const findAdminById = jest.fn();
const executeAccountAction = jest.fn();

jest.unstable_mockModule('../../models/Admin.js', () => ({
  default: {
    findOne: findAdmin,
    findById: findAdminById,
  },
}));

jest.unstable_mockModule('../../models/User.js', () => ({
  default: {
    findOne: jest.fn(),
    findById: jest.fn(),
    create: jest.fn(),
  },
}));

jest.unstable_mockModule('../../services/sms.service.js', () => ({
  sendOTP: jest.fn(),
  verifyOTP: jest.fn(),
}));

jest.unstable_mockModule('../../services/accountLifecycle.service.js', () => ({ executeAccountAction }));

const [{ adminLogin }, { protect, requireAdmin }, { errorHandler }, { JWT_SECRET }, { deleteCustomerAccount }] = await Promise.all([
  import('../../controllers/auth.controller.js'),
  import('../../middlewares/auth.middleware.js'),
  import('../../middlewares/error.middleware.js'),
  import('../../config/jwt.js'),
  import('../../controllers/accountManagement.controller.js'),
]);

const app = express();
app.use(express.json());
app.post('/login', adminLogin);
app.get('/protected', protect, requireAdmin, (_req, res) => res.json({ success: true }));
app.delete('/customers/:id', protect, requireAdmin, deleteCustomerAccount);
app.use(errorHandler);

const makeAdmin = ({ active = true, passwordMatches = true } = {}) => ({
  _id: '507f1f77bcf86cd799439011',
  name: 'Test Admin',
  email: 'admin@example.test',
  role: 'superAdmin',
  isActive: active,
  matchPassword: jest.fn(async () => passwordMatches),
  save: jest.fn(async function save() { return this; }),
});

beforeEach(() => {
  jest.clearAllMocks();
});

test('valid credentials return a verifiable admin token and update last login', async () => {
  const admin = makeAdmin();
  findAdmin.mockResolvedValue(admin);

  const response = await request(app)
    .post('/login')
    .send({ email: '  ADMIN@EXAMPLE.TEST ', password: 'correct test password' });

  expect(response.status).toBe(200);
  expect(findAdmin).toHaveBeenCalledWith({ email: 'admin@example.test' });
  expect(admin.matchPassword).toHaveBeenCalledWith('correct test password');
  expect(admin.lastLogin).toBeInstanceOf(Date);
  expect(admin.save).toHaveBeenCalledTimes(1);
  expect(jwt.verify(response.body.token, JWT_SECRET)).toMatchObject({
    id: admin._id,
    type: 'admin',
  });
});

test.each([
  ['unknown account', null],
  ['incorrect password', makeAdmin({ passwordMatches: false })],
])('%s receives the same non-enumerating error', async (_caseName, admin) => {
  findAdmin.mockResolvedValue(admin);

  const response = await request(app)
    .post('/login')
    .send({ email: 'admin@example.test', password: 'incorrect test password' });

  expect(response.status).toBe(401);
  expect(response.body.message).toBe('Invalid admin credentials');
  expect(response.body.token).toBeUndefined();
});

test('disabled account cannot authenticate even with the correct password', async () => {
  findAdmin.mockResolvedValue(makeAdmin({ active: false }));

  const response = await request(app)
    .post('/login')
    .send({ email: 'admin@example.test', password: 'correct test password' });

  expect(response.status).toBe(401);
  expect(response.body.message).toBe('Invalid admin credentials');
  expect(response.body.token).toBeUndefined();
});

test.each([
  {},
  { email: 'admin@example.test' },
  { email: 42, password: 'password' },
])('malformed login request is rejected without querying accounts', async (payload) => {
  const response = await request(app).post('/login').send(payload);

  expect(response.status).toBe(400);
  expect(findAdmin).not.toHaveBeenCalled();
});

test('protected admin route rejects missing tokens and accepts an active admin token', async () => {
  expect((await request(app).get('/protected')).status).toBe(401);

  const activeAdmin = makeAdmin();
  findAdminById.mockReturnValue({
    select: jest.fn(async () => activeAdmin),
  });
  const token = jwt.sign({ id: activeAdmin._id, type: 'admin' }, JWT_SECRET, { expiresIn: '5m' });

  const response = await request(app)
    .get('/protected')
    .set('Authorization', `Bearer ${token}`);

  expect(response.status).toBe(200);
  expect(response.body.success).toBe(true);
});

test('admin bootstrap has no source-controlled fallback credentials', () => {
  const source = fs.readFileSync(path.resolve(process.cwd(), 'config/db.js'), 'utf8');
  expect(source).not.toMatch(/ADMIN_EMAIL\s*\|\||ADMIN_PASSWORD\s*\|\|/);
  expect(source).not.toMatch(/admin@admin\.com|Admin!@#123/);
});

test('account deletion endpoint requires an authenticated administrator', async () => {
  const id = '507f1f77bcf86cd799439099';
  await request(app).delete(`/customers/${id}`).expect(401);
  expect(executeAccountAction).not.toHaveBeenCalled();
});

test.each([
  ['deleted', 'deleted'],
  ['deactivated', 'deactivated'],
])('administrator receives an explicit %s outcome', async (outcome, action) => {
  const id = '507f1f77bcf86cd799439099';
  const activeAdmin = makeAdmin();
  findAdminById.mockReturnValue({ select: jest.fn(async () => activeAdmin) });
  executeAccountAction.mockResolvedValue({ outcome, reasonCodes: outcome === 'deactivated' ? ['ORDER_HISTORY'] : [] });
  const token = jwt.sign({ id: activeAdmin._id, type: 'admin' }, JWT_SECRET, { expiresIn: '5m' });

  const response = await request(app).delete(`/customers/${id}`).set('Authorization', `Bearer ${token}`);

  expect(response.status).toBe(200);
  expect(response.body.data.action).toBe(action);
  expect(executeAccountAction).toHaveBeenCalledWith(expect.objectContaining({ category: 'customer', targetId: id, actorAdminId: activeAdmin._id }));
});

test('active or protected account is blocked and its preservation reason is returned', async () => {
  const id = '507f1f77bcf86cd799439099';
  const activeAdmin = makeAdmin();
  findAdminById.mockReturnValue({ select: jest.fn(async () => activeAdmin) });
  executeAccountAction.mockResolvedValue({ outcome: 'skipped', reasonCodes: ['PROTECTED_ADMIN_IDENTITY'] });
  const token = jwt.sign({ id: activeAdmin._id, type: 'admin' }, JWT_SECRET, { expiresIn: '5m' });

  const response = await request(app).delete(`/customers/${id}`).set('Authorization', `Bearer ${token}`);

  expect(response.status).toBe(409);
  expect(response.body.meta).toMatchObject({ action: 'blocked', reasonCodes: ['PROTECTED_ADMIN_IDENTITY'] });
});
