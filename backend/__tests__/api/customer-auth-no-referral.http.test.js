import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';

process.env.JWT_SECRET = 'customer-auth-removal-test-secret';
process.env.OTP_MODE = 'live';

const findUser = jest.fn();
const createUser = jest.fn();
const sendOTP = jest.fn();
const verifyOTP = jest.fn();

jest.unstable_mockModule('../../models/User.js', () => ({
  default: { findOne: findUser, findById: jest.fn(), create: createUser },
}));
jest.unstable_mockModule('../../models/Admin.js', () => ({
  default: { findOne: jest.fn(), findById: jest.fn() },
}));
jest.unstable_mockModule('../../services/sms.service.js', () => ({ sendOTP, verifyOTP }));

const [{ requestOTP, verifyAndLogin }, { errorHandler }] = await Promise.all([
  import('../../controllers/auth.controller.js'),
  import('../../middlewares/error.middleware.js'),
]);

const app = express();
app.use(express.json());
app.post('/send', requestOTP);
app.post('/verify', verifyAndLogin);
app.use(errorHandler);

const userRecord = (overrides = {}) => ({
  _id: '507f1f77bcf86cd799439014',
  phone: '9876500000',
  name: 'New Customer',
  email: 'customer@example.test',
  roles: ['buyer'],
  addresses: [],
  wallet: { balance: 0 },
  isActive: true,
  ...overrides,
});

beforeEach(() => jest.clearAllMocks());

test('new customer registration succeeds without any invite data', async () => {
  findUser.mockResolvedValue(null);
  verifyOTP.mockReturnValue({ valid: true });
  createUser.mockResolvedValue(userRecord());

  const response = await request(app).post('/verify').send({
    phone: '9876500000', otp: '1234', isLogin: false,
    name: 'New Customer', email: 'customer@example.test',
  });

  expect(response.status).toBe(200);
  expect(response.body.isNewUser).toBe(true);
  expect(response.body.token).toBeTruthy();
  expect(createUser).toHaveBeenCalledWith(expect.not.objectContaining({
    referralCode: expect.anything(),
    referredBy: expect.anything(),
  }));
});

test('legacy ref query or request data cannot activate attribution', async () => {
  findUser.mockResolvedValue(null);
  verifyOTP.mockReturnValue({ valid: true });
  createUser.mockResolvedValue(userRecord());

  await request(app).post('/verify?ref=LEGACY123').send({
    phone: '9876500000', otp: '1234', isLogin: false,
    name: 'New Customer', email: 'customer@example.test',
    referralCode: 'LEGACY123', referredBy: 'attacker-controlled',
  }).expect(200);

  const created = createUser.mock.calls[0][0];
  expect(created).not.toHaveProperty('referralCode');
  expect(created).not.toHaveProperty('referredBy');
});

test('failed OTP creates no account or session', async () => {
  verifyOTP.mockReturnValue({ valid: false, message: 'Invalid OTP' });

  const response = await request(app).post('/verify').send({
    phone: '9876500000', otp: '0000', isLogin: false,
  });

  expect(response.status).toBe(400);
  expect(createUser).not.toHaveBeenCalled();
  expect(response.body.token).toBeUndefined();
});

test('normal login still returns the existing customer profile', async () => {
  const existing = userRecord();
  findUser.mockResolvedValue(existing);
  verifyOTP.mockReturnValue({ valid: true });

  const response = await request(app).post('/verify').send({
    phone: existing.phone, otp: '1234', isLogin: true,
  });

  expect(response.status).toBe(200);
  expect(response.body.isNewUser).toBe(false);
  expect(response.body.user.phone).toBe(existing.phone);
});
