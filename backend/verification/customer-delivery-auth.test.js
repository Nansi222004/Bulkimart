import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

let user, partner;
const createUser = jest.fn(async data => (user = { _id: '507f1f77bcf86cd799439012', isActive: true, ...data }));
const registerCustomer = jest.fn(async (_filter, update) => (user = {
  ...user, ...update.$set, roles: [...new Set([...user.roles, update.$addToSet.roles])],
}));
const upsertPartner = jest.fn(async () => (partner = { _id: '507f1f77bcf86cd799439022', status: 'incomplete', onboardingStep: 1 }));
const sendOTP = jest.fn(async () => ({}));
const verifyOTP = jest.fn(() => ({ valid: true }));
jest.unstable_mockModule('../models/User.js', () => ({ default: {
  findOne: jest.fn(async () => user), create: createUser,
  findOneAndUpdate: registerCustomer, updateOne: jest.fn(async () => ({})),
} }));
jest.unstable_mockModule('../models/DeliveryPartner.js', () => ({ default: {
  findOne: jest.fn(async () => partner), findOneAndUpdate: upsertPartner,
} }));
jest.unstable_mockModule('../services/sms.service.js', () => ({ sendOTP, verifyOTP }));
const { requestOTP, verifyAndLogin, verifyDeliveryOTP, customerSession } = await import('../controllers/auth.controller.js');
const { errorHandler } = await import('../middlewares/error.middleware.js');
const { JWT_SECRET } = await import('../config/jwt.js');
const app = express();
app.use(express.json());
app.post('/customer/send', requestOTP);
app.post('/customer/verify', verifyAndLogin);
app.post('/delivery/verify', verifyDeliveryOTP);
app.post('/customer/switch', (req, _res, next) => { req.userType = 'user'; req.user = user; next(); }, customerSession);
app.use(errorHandler);
const customer = (extra = {}) => request(app).post('/customer/verify').send({ phone: '9876500000', otp: '1234', isLogin: true, ...extra });
beforeEach(() => {
  jest.clearAllMocks(); verifyOTP.mockReturnValue({ valid: true });
  user = { _id: '507f1f77bcf86cd799439012', phone: '9876500000', roles: ['buyer'], isActive: true };
  partner = null;
});

test('customer login selects a buyer JWT even when delivery is approved', async () => {
  user.roles.push('delivery'); partner = { status: 'approved' };
  const res = await customer().expect(200);
  expect(res.body.sessionRole).toBe('buyer'); expect(res.body.dashboard).toBe('/');
  expect(jwt.verify(res.body.token, JWT_SECRET).role).toBe('buyer');
  expect(res.body.deliveryState).toBeUndefined();
});

test('new delivery signup does not register a customer or silently switch into shopping', async () => {
  user = null;
  await request(app).post('/delivery/verify').send({ phone: '9876500000', otp: '1234', intent: 'register' }).expect(200);
  expect(createUser).toHaveBeenCalledWith(expect.objectContaining({ customerRegistered: false }));
  await request(app).post('/customer/send').send({ phone: user.phone, isLogin: true }).expect(404);
  const res = await customer().expect(404);
  expect(res.body.meta.code).toBe('NOT_REGISTERED'); expect(res.body.token).toBeUndefined();
  await request(app).post('/customer/switch').expect(403);
  expect(sendOTP).not.toHaveBeenCalled();
});

test.each([
  { roles: ['delivery'] },
  { roles: ['buyer', 'delivery'], customerRegistered: false },
  { roles: ['buyer', 'delivery'] },
  { roles: ['buyer'], deliveryPartnerId: '507f1f77bcf86cd799439022' },
])('delivery identity can register as customer with the same canonical phone: %j', async fields => {
  Object.assign(user, fields, { wallet: { balance: 250 }, addresses: [{ city: 'Indore' }] });
  partner = { status: fields.roles.includes('delivery') ? 'approved' : 'pending', onboardingStep: 4 };
  const original = { ...user }; const originalPartner = partner;
  await request(app).post('/customer/send').send({ phone: '+91 98765 00000', isLogin: false }).expect(200);
  expect(sendOTP).toHaveBeenCalledWith('9876500000'); expect(registerCustomer).not.toHaveBeenCalled();
  const res = await customer({ phone: '+91 98765 00000', isLogin: false, name: ' Customer ', email: ' CUSTOMER@example.test ' }).expect(200);
  expect(res.body.user._id).toBe(original._id); expect(res.body.sessionRole).toBe('buyer'); expect(res.body.isNewUser).toBe(true);
  expect(user.customerRegistered).toBe(true); expect(user.roles).toEqual([...new Set([...fields.roles, 'buyer'])]);
  expect(user.wallet).toBe(original.wallet); expect(user.addresses).toBe(original.addresses); expect(partner).toBe(originalPartner);
  expect(registerCustomer).toHaveBeenCalledWith(
    { _id: original._id, customerRegistered: { $ne: true } },
    { $set: { customerRegistered: true, name: 'Customer', email: 'customer@example.test' }, $addToSet: { roles: 'buyer' } },
    { new: true, runValidators: true },
  );
  expect(createUser).not.toHaveBeenCalled(); expect(upsertPartner).not.toHaveBeenCalled();
  await request(app).post('/customer/send').send({ phone: user.phone, isLogin: false }).expect(400);
  await customer({ isLogin: false }).expect(400);
  expect((await customer().expect(200)).body.sessionRole).toBe('buyer');
  const delivery = await request(app).post('/delivery/verify').send({ phone: user.phone, otp: '1234', intent: 'login' }).expect(200);
  expect(delivery.body.sessionRole).toBe('delivery'); expect(delivery.body.user._id).toBe(original._id);
});

test('invalid OTP cannot enroll an existing delivery identity', async () => {
  user.roles = ['delivery']; verifyOTP.mockReturnValue({ valid: false, message: 'Invalid OTP' });
  await customer({ isLogin: false }).expect(400);
  expect(registerCustomer).not.toHaveBeenCalled(); expect(createUser).not.toHaveBeenCalled();
});

test.each([{ roles: ['buyer'] }, { roles: ['buyer', 'delivery'], customerRegistered: true }])('an existing customer must sign in: %j', async fields => {
  Object.assign(user, fields);
  await request(app).post('/customer/send').send({ phone: user.phone, isLogin: false }).expect(400);
  await customer({ isLogin: false }).expect(400);
  expect(sendOTP).not.toHaveBeenCalled(); expect(registerCustomer).not.toHaveBeenCalled();
});

test('a concurrent completed registration cannot be overwritten', async () => {
  user.roles = ['delivery']; registerCustomer.mockResolvedValueOnce(null);
  const res = await customer({ isLogin: false }).expect(400);
  expect(res.body.token).toBeUndefined(); expect(res.body.meta.code).toBe('ALREADY_REGISTERED');
});

test('deactivated delivery identities cannot register as customers', async () => {
  user.roles = ['delivery']; user.isActive = false;
  await request(app).post('/customer/send').send({ phone: user.phone, isLogin: false }).expect(403);
  await customer({ isLogin: false }).expect(403);
  expect(sendOTP).not.toHaveBeenCalled(); expect(registerCustomer).not.toHaveBeenCalled();
});

test('new customer registration records customer membership', async () => {
  user = null;
  const res = await customer({ isLogin: false, name: 'New Customer' }).expect(200);
  expect(res.body.sessionRole).toBe('buyer'); expect(user.customerRegistered).toBe(true);
});
