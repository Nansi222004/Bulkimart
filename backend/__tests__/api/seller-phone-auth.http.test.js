import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';

process.env.JWT_SECRET = 'seller-phone-test-secret-that-is-not-used-outside-tests';
process.env.OTP_MODE = 'live';

const findUser = jest.fn();
const sendOTP = jest.fn();
const verifyOTP = jest.fn();

jest.unstable_mockModule('../../models/User.js', () => ({
  default: {
    findOne: findUser,
    findById: jest.fn(),
    create: jest.fn(),
  },
}));

jest.unstable_mockModule('../../models/Admin.js', () => ({
  default: { findOne: jest.fn(), findById: jest.fn() },
}));

jest.unstable_mockModule('../../services/sms.service.js', () => ({ sendOTP, verifyOTP }));
const [{ requestSellerOTP, verifySellerOTP }, { errorHandler }] = await Promise.all([
  import('../../controllers/auth.controller.js'),
  import('../../middlewares/error.middleware.js'),
]);

const app = express();
app.use(express.json());
app.post('/send', requestSellerOTP);
app.post('/verify', verifySellerOTP);
app.use(errorHandler);

const registeredUser = (phone = '9876543210') => ({
  _id: '507f1f77bcf86cd799439013',
  phone,
  name: 'Seller Applicant',
  roles: ['buyer'],
  addresses: [],
  wallet: { balance: 0 },
  isActive: true,
});

beforeEach(() => {
  jest.clearAllMocks();
});

test('OTP is sent to the number entered by the seller', async () => {
  findUser.mockResolvedValue(registeredUser());
  sendOTP.mockResolvedValue({});

  const response = await request(app).post('/send').send({ phone: '9876543210' });

  expect(response.status).toBe(200);
  expect(findUser).toHaveBeenCalledWith({ phone: '9876543210' });
  expect(sendOTP).toHaveBeenCalledWith('9876543210');
});

test('unregistered phone is rejected before an OTP is sent', async () => {
  findUser.mockResolvedValue(null);

  const response = await request(app).post('/send').send({ phone: '9000000000' });

  expect(response.status).toBe(404);
  expect(response.body.meta.code).toBe('NOT_A_MEMBER');
  expect(sendOTP).not.toHaveBeenCalled();
});

test('OTP verification is bound to the submitted phone and returns that verified profile', async () => {
  const user = registeredUser('9876543210');
  findUser.mockResolvedValue(user);
  verifyOTP.mockReturnValue({ valid: true });

  const response = await request(app).post('/verify').send({ phone: '9876543210', otp: '123456' });

  expect(response.status).toBe(200);
  expect(verifyOTP).toHaveBeenCalledWith('9876543210', '123456');
  expect(response.body.user.phone).toBe('9876543210');
  expect(response.body.token).toBeTruthy();
});

test('failed OTP verification returns no session token', async () => {
  findUser.mockResolvedValue(registeredUser());
  verifyOTP.mockReturnValue({ valid: false, message: 'Invalid OTP' });

  const response = await request(app).post('/verify').send({ phone: '9876543210', otp: '000000' });

  expect(response.status).toBe(400);
  expect(response.body.token).toBeUndefined();
});

test('changing the submitted number requires that new number to be registered and verified', async () => {
  findUser.mockResolvedValue(registeredUser('9123456789'));
  verifyOTP.mockReturnValue({ valid: true });

  await request(app).post('/verify').send({ phone: '9123456789', otp: '654321' }).expect(200);

  expect(findUser).toHaveBeenCalledWith({ phone: '9123456789' });
  expect(verifyOTP).toHaveBeenCalledWith('9123456789', '654321');
});
