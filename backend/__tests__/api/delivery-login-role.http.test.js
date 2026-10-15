import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
process.env.JWT_SECRET = 'isolated-delivery-role-test-secret';
process.env.OTP_MODE = 'live';
let user, partner;
const createUser = jest.fn(async data => (user = { _id: '507f1f77bcf86cd799439012', isActive: true, ...data }));
const upsertPartner = jest.fn(async () => (partner = { _id: '507f1f77bcf86cd799439022', status: 'incomplete', onboardingStep: 1 }));
const sendOTP = jest.fn(async () => ({}));
const verifyOTP = jest.fn(() => ({ valid: true }));
jest.unstable_mockModule('../../models/User.js', () => ({ default: {
  findOne: jest.fn(async () => user), create: createUser, updateOne: jest.fn(async () => ({})),
  findById: jest.fn(() => ({ select: async () => user })),
} }));
jest.unstable_mockModule('../../models/Admin.js', () => ({ default: { findById: jest.fn(() => ({ select: async () => null })) } }));
jest.unstable_mockModule('../../models/DeliveryPartner.js', () => ({ default: { findOne: jest.fn(async () => partner), findOneAndUpdate: upsertPartner } }));
jest.unstable_mockModule('../../models/Seller.js', () => ({ default: { findOne: jest.fn() } }));
jest.unstable_mockModule('../../services/sms.service.js', () => ({ sendOTP, verifyOTP }));
const pass = (_req, _res, next) => next();
jest.unstable_mockModule('../../middlewares/rateLimit.middleware.js', () => ({ otpLimiter: pass, authLimiter: pass, adminLoginLimiter: pass }));
const [{ default: routes }, { protect, requireRole }, { requireApprovedPartner }, { errorHandler }, { JWT_SECRET }] = await Promise.all([
  import('../../routes/auth.routes.js'), import('../../middlewares/auth.middleware.js'),
  import('../../middlewares/vendor.middleware.js'), import('../../middlewares/error.middleware.js'), import('../../config/jwt.js'),
]);
const app = express(); app.use(express.json()); app.use('/api/auth', routes);
const { resolveRequester } = await import('../../services/ticket.service.js');
app.get('/rider', protect, requireApprovedPartner, (_req, res) => res.json({ success: true }));
app.get('/buyer', protect, requireRole('buyer'), (_req, res) => res.json({ success: true }));
app.use(errorHandler);
const token = (claims = {}, options = {}) => jwt.sign({ id: user._id, type: 'user', ...claims }, JWT_SECRET, { expiresIn: '1h', ...options });
const login = (path = '/verify-otp', extra = {}) => request(app).post('/api/auth' + path).send({ phone: '9876500000', otp: '1234', isLogin: true, ...extra });
beforeEach(() => {
  jest.clearAllMocks(); verifyOTP.mockReturnValue({ valid: true });
  user = { _id: '507f1f77bcf86cd799439012', phone: '9876500000', name: 'Fixture', roles: ['buyer'], isActive: true }; partner = null;
});
test('shared buyer login returns buyer claim and existing storefront route', async () => {
  const res = await login(); expect(res.status).toBe(200); expect(res.body.sessionRole).toBe('buyer'); expect(res.body.dashboard).toBe('/');
  expect(jwt.verify(res.body.token, JWT_SECRET).role).toBe('buyer');
});
test('shared Delivery login returns Delivery claim and existing dashboard', async () => {
  user.roles.push('delivery'); partner = { status: 'approved', onboardingStep: 4 };
  const res = await login(); expect(res.status).toBe(200); expect(res.body.sessionRole).toBe('delivery'); expect(res.body.dashboard).toBe('/delivery/dashboard');
  expect(jwt.verify(res.body.token, JWT_SECRET).role).toBe('delivery');
});
test.each(['approved', 'incomplete', 'pending', 'rejected', 'suspended'])('Delivery sign-in preserves %s profile without creating an application', async status => {
  if (status === 'approved') user.roles.push('delivery'); partner = { status, onboardingStep: 2 };
  const res = await login('/delivery/verify-otp', { intent: 'login' });
  expect(res.status).toBe(200); expect(res.body.sessionRole).toBe('delivery'); expect(res.body.deliveryState.status).toBe(status);
  expect(createUser).not.toHaveBeenCalled(); expect(upsertPartner).not.toHaveBeenCalled();
});
test('buyer cannot sign in as Delivery without an application or obtain rider access', async () => {
  await login('/delivery/verify-otp', { intent: 'login', role: 'delivery' }).expect(404);
  await request(app).get('/rider').set('Authorization', `Bearer ${token({ role: 'buyer' })}`).expect(403);
  expect(upsertPartner).not.toHaveBeenCalled();
});
test('explicit registration creates an incomplete application without granting approval', async () => {
  user = null;
  const res = await login('/delivery/verify-otp', { intent: 'register' }); expect(res.status).toBe(200);
  expect(createUser).toHaveBeenCalledWith(expect.objectContaining({ roles: ['buyer'] })); expect(upsertPartner).toHaveBeenCalledTimes(1);
  await request(app).get('/rider').set('Authorization', `Bearer ${res.body.token}`).expect(403);
});
test('register cannot overwrite a rider and missing intent fails safely', async () => {
  partner = { status: 'approved' };
  await login('/delivery/verify-otp', { intent: 'register' }).expect(409);
  await login('/delivery/verify-otp').expect(400); expect(upsertPartner).not.toHaveBeenCalled();
});
test('invalid OTP creates no account, application or token', async () => {
  verifyOTP.mockReturnValue({ valid: false, message: 'Invalid OTP' });
  const res = await login('/delivery/verify-otp', { intent: 'register' }); expect(res.status).toBe(400); expect(res.body.token).toBeUndefined();
  expect(createUser).not.toHaveBeenCalled(); expect(upsertPartner).not.toHaveBeenCalled();
});
test.each([undefined, [], ['Delivery'], ['user'], ['buyer', 'unsupported']])('malformed membership %j cannot default to buyer', async roles => {
  user.roles = roles; await login().expect(403);
});
test('client role cannot grant Delivery and inconsistent approval is rejected', async () => {
  const res = await login('/verify-otp', { role: 'delivery' }); expect(res.body.sessionRole).toBe('buyer');
  partner = { status: 'approved' }; await login('/delivery/verify-otp', { intent: 'login' }).expect(403);
});
test('refresh resolves signed Delivery and legacy unscoped sessions from live records', async () => {
  user.roles.push('delivery'); partner = { status: 'approved', onboardingStep: 4 };
  for (const claims of [{ role: 'delivery' }, {}]) {
    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token(claims)}`);
    expect(res.status).toBe(200); expect(res.body.sessionRole).toBe('delivery'); expect(res.body.profile._id).toBe(user._id);
  }
  const legacy = jwt.sign({ id: user._id }, JWT_SECRET);
  const restored = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${legacy}`).expect(200);
  expect(restored.body.sessionRole).toBe('delivery');
});
test('buyer session keeps customer support identity even for a dual-role account', async () => {
  user.roles.push('delivery'); partner = { status: 'approved' };
  expect((await resolveRequester(user, 'buyer')).role).toBe('customer');
});
test('wrong role, expired, forged and unsupported tokens fail safely', async () => {
  await request(app).get('/api/auth/me').expect(401);
  for (const bad of [token({ role: 'Delivery' }), token({ type: 'alien' }), token({}, { expiresIn: -1 }), 'invalid-token']) {
    await request(app).get('/api/auth/me').set('Authorization', `Bearer ${bad}`).expect(401);
  }
  await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token({ role: 'delivery' })}`).expect(403);
});
test('rider operations require session context and live approval; existing dual-role buyer policy is preserved', async () => {
  partner = { status: 'approved' }; user.roles = ['delivery'];
  await request(app).get('/rider').set('Authorization', `Bearer ${token({ role: 'delivery' })}`).expect(200);
  await request(app).get('/buyer').set('Authorization', `Bearer ${token({ role: 'delivery' })}`).expect(403);
  user.roles.push('buyer'); await request(app).get('/buyer').set('Authorization', `Bearer ${token({ role: 'delivery' })}`).expect(200);
  await request(app).get('/rider').set('Authorization', `Bearer ${token({ role: 'buyer' })}`).expect(403);
  partner.status = 'suspended'; await request(app).get('/rider').set('Authorization', `Bearer ${token({ role: 'delivery' })}`).expect(403);
});
test('logout then another account login returns the new identity and role', async () => {
  user.roles.push('delivery'); partner = { status: 'approved' };
  const first = await login(); await request(app).post('/api/auth/logout').expect(200);
  user = { ...user, _id: '507f1f77bcf86cd799439099', roles: ['buyer'] }; partner = null;
  const second = await login(); expect(second.body.sessionRole).toBe('buyer'); expect(first.body.user._id).not.toBe(second.body.user._id);
  const restored = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${second.body.token}`); expect(restored.body.sessionRole).toBe('buyer');
});
test('explicit customer session requires live buyer membership and preserves shared identity', async () => {
  user.roles.push('delivery'); partner = { status: 'approved' };
  const res = await request(app).post('/api/auth/customer-session').set('Authorization', `Bearer ${token({ role: 'delivery' })}`).send({ role: 'admin' }).expect(200);
  expect(res.body.sessionRole).toBe('buyer'); expect(res.body.user._id).toBe(user._id); expect(jwt.verify(res.body.token, JWT_SECRET).role).toBe('buyer');
  const restored = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${res.body.token}`).expect(200); expect(restored.body.sessionRole).toBe('buyer');
});
test('anonymous and delivery-only accounts cannot obtain a customer session', async () => {
  await request(app).post('/api/auth/customer-session').expect(401);
  user.roles = ['delivery']; partner = { status: 'approved' };
  await request(app).post('/api/auth/customer-session').set('Authorization', `Bearer ${token({ role: 'delivery' })}`).expect(403);
});
test('Delivery OTP send checks login membership and forwards the entered canonical phone', async () => {
  await request(app).post('/api/auth/delivery/send-otp').send({ phone: '+91 98765 00000', intent: 'login' }).expect(404);
  expect(sendOTP).not.toHaveBeenCalled(); partner = { status: 'pending' };
  await request(app).post('/api/auth/delivery/send-otp').send({ phone: '+91 98765 00000', intent: 'login' }).expect(200);
  expect(sendOTP).toHaveBeenCalledWith('9876500000');
});
test('deactivated Delivery account receives neither OTP nor login token', async () => {
  user.isActive = false; partner = { status: 'approved' };
  await request(app).post('/api/auth/delivery/send-otp').send({ phone: user.phone, intent: 'login' }).expect(403);
  await login('/delivery/verify-otp', { intent: 'login' }).expect(403);
  expect(sendOTP).not.toHaveBeenCalled();
});
