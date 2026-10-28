import { jest } from '@jest/globals';
import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, mkdirSync, writeFileSync, unlinkSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

const id = '507f1f77bcf86cd799439014';
const user = { _id: id, isActive: true, phone: '9876500000', roles: ['buyer', 'delivery'] };
const findOne = jest.fn();
const findById = jest.fn();
const partner = jest.fn();
const verifyOTP = jest.fn();
const registerPushToken = jest.fn();
const removePushToken = jest.fn();
jest.unstable_mockModule('../models/User.js', () => ({ default: { findOne, findById } }));
jest.unstable_mockModule('../models/Admin.js', () => ({ default: { findById } }));
jest.unstable_mockModule('../models/DeliveryPartner.js', () => ({ default: { findOne: partner } }));
jest.unstable_mockModule('../services/sms.service.js', () => ({ sendOTP: jest.fn(), verifyOTP }));
jest.unstable_mockModule('../services/notification.service.js', () => ({ registerPushToken, removePushToken }));
const { verifyDeliveryOTP } = await import('../controllers/auth.controller.js');
const { protect, requireSellerSession } = await import('../middlewares/auth.middleware.js');
const { errorHandler } = await import('../middlewares/error.middleware.js');
const { requestContext } = await import('../middlewares/requestContext.middleware.js');
const { default: notifications } = await import('../routes/notification.routes.js');
const { signSessionToken, verifySessionToken } = await import('../config/jwt.js');
const app = express();
app.use(express.json(), requestContext);
app.post('/api/auth/delivery/verify-otp', verifyDeliveryOTP);
app.get('/seller-only', protect, requireSellerSession, (_req, res) => res.sendStatus(200));
app.use('/api/notifications', notifications);
app.use(errorHandler);
let warnings;
beforeEach(() => {
  jest.clearAllMocks();
  warnings = jest.spyOn(console, 'warn').mockImplementation(() => {});
  user.roles = ['buyer', 'delivery']; user.isActive = true;
  findOne.mockResolvedValue(user);
  findById.mockReturnValue({ select: async () => user });
  partner.mockResolvedValue({ _id: '507f1f77bcf86cd799439015', userId: id, status: 'approved', onboardingStep: 4 });
  verifyOTP.mockReturnValue({ valid: true }); registerPushToken.mockResolvedValue('app');
});
afterEach(() => warnings.mockRestore());
const post = token => request(app).post('/api/notifications/tokens').set('Authorization', `Bearer ${token}`).send({ token: 'fixture-fcm-device-token', platform: 'app' });

test('real delivery login JWT is accepted unchanged by notification authentication', async () => {
  const login = await request(app).post('/api/auth/delivery/verify-otp').send({ phone: user.phone, otp: '1234', intent: 'login' }).expect(200);
  const claims = verifySessionToken(login.body.token);
  expect(claims).toMatchObject({ id, type: 'user', role: 'delivery' });
  expect(jwt.decode(login.body.token, { complete: true }).header.alg).toBe('HS256');
  expect(claims.exp - claims.iat).toBe(30 * 86400);
  await post(login.body.token).expect(200);
  expect(registerPushToken).toHaveBeenCalledWith(id, 'fixture-fcm-device-token', 'app', 'delivery');
});

test.each([
  ['different signing secret', () => jwt.sign({ id, type: 'user', role: 'delivery' }, 'different-test-secret'), 'AUTH_SIGNATURE_INVALID'],
  ['expired', () => jwt.sign({ id, type: 'user' }, process.env.JWT_SECRET, { expiresIn: -1 }), 'AUTH_TOKEN_EXPIRED'],
  ['malformed', () => 'not-a-jwt', 'AUTH_TOKEN_INVALID'],
  ['wrong algorithm', () => jwt.sign({ id, type: 'user' }, process.env.JWT_SECRET, { algorithm: 'HS384' }), 'AUTH_ALGORITHM_INVALID'],
  ['unsupported role', () => signSessionToken({ id, type: 'user', role: 'unknown' }), 'AUTH_CLAIMS_UNSUPPORTED'],
  ['missing identity', () => signSessionToken({ type: 'user' }), 'AUTH_CLAIMS_INVALID'],
  ['future activation', () => jwt.sign({ id, type: 'user' }, process.env.JWT_SECRET, { notBefore: 3600 }), 'AUTH_TOKEN_NOT_ACTIVE'],
])('%s JWT never reaches FCM persistence', async (_name, token, code) => {
  const credential = token();
  const res = await post(credential).expect(401);
  expect(res.body.meta.code).toBe(code);
  expect(registerPushToken).not.toHaveBeenCalled(); expect(findById).not.toHaveBeenCalled();
  const logged = JSON.stringify(warnings.mock.calls);
  expect(logged).toContain(code); expect(logged).not.toContain(credential);
  expect(logged).not.toContain(process.env.JWT_SECRET); expect(logged).not.toContain(user.phone);
});

test.each([undefined, '', 'Bearer', 'Basic abc', 'Bearer one two', 'Bearer one, Bearer two'])('missing or malformed bearer header is rejected: %s', async header => {
  let req = request(app).post('/api/notifications/tokens');
  if (header !== undefined) req = req.set('Authorization', header);
  const res = await req.send({ token: 'fixture-fcm-device-token' }).expect(401);
  expect(res.body.meta.code).toBe(header ? 'AUTH_BEARER_MALFORMED' : 'AUTH_HEADER_MISSING');
  expect(registerPushToken).not.toHaveBeenCalled();
});

test('case-insensitive Bearer with whitespace still authenticates', async () => {
  await request(app).post('/api/notifications/tokens').set('Authorization', `bearer   ${signSessionToken({ id, type: 'user', role: 'delivery' })}`).send({ token: 'fixture-fcm-device-token', platform: 'app' }).expect(200);
});
test.each(['buyer', 'seller', 'delivery', undefined])('existing %s sessions remain accepted by the shared notification route', async role => {
  await post(signSessionToken({ id, type: 'user', ...(role ? { role } : {}) })).expect(200);
});
test('existing admin sessions remain accepted', async () => { await post(signSessionToken({ id, type: 'admin' })).expect(200); });

test.each(['buyer', 'seller', 'delivery'])('%s logout can remove only its authenticated account device token', async role => {
  const credential = signSessionToken({ id, type: 'user', role });
  await request(app).delete('/api/notifications/tokens/device-fixture')
    .set('Authorization', `Bearer ${credential}`).expect(200);
  expect(removePushToken).toHaveBeenCalledWith(id, 'device-fixture', role);
});

test('unauthenticated push cleanup cannot remove another account device token', async () => {
  await request(app).delete('/api/notifications/tokens/device-fixture').expect(401);
  expect(removePushToken).not.toHaveBeenCalled();
});
test('deleted and inactive accounts cannot register an FCM token', async () => {
  findById.mockReturnValue({ select: async () => null });
  const missing = await post(signSessionToken({ id, type: 'user', role: 'delivery' })).expect(401);
  expect(missing.body.meta.code).toBe('AUTH_ACCOUNT_NOT_FOUND');
  findById.mockReturnValue({ select: async () => ({ ...user, isActive: false }) });
  const inactive = await post(signSessionToken({ id, type: 'user', role: 'delivery' })).expect(403);
  expect(inactive.body.meta.code).toBe('AUTH_ACCOUNT_INACTIVE'); expect(registerPushToken).not.toHaveBeenCalled();
});
test('valid JWT rejected by role checks has a separate diagnostic', async () => {
  const res = await request(app).get('/seller-only').set('Authorization', `Bearer ${signSessionToken({ id, type: 'user', role: 'delivery' })}`).expect(403);
  expect(res.body.meta.code).toBe('AUTH_ROLE_REQUIRED');
});
test('failed OTP or missing approved delivery membership cannot issue a login JWT', async () => {
  verifyOTP.mockReturnValue({ valid: false, message: 'Invalid OTP verification' });
  const invalid = await request(app).post('/api/auth/delivery/verify-otp').send({ phone: user.phone, otp: '0000', intent: 'login' }).expect(400);
  expect(invalid.body.token).toBeUndefined();
  verifyOTP.mockReturnValue({ valid: true }); user.roles = ['buyer'];
  await request(app).post('/api/auth/delivery/verify-otp').send({ phone: user.phone, otp: '1234', intent: 'login' }).expect(403);
  expect(registerPushToken).not.toHaveBeenCalled();
});
test('missing JWT configuration fails startup with a safe diagnostic', () => {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', "await import('./config/jwt.js')"], {
    cwd: process.cwd(), encoding: 'utf8', env: { ...process.env, NODE_ENV: 'test', JWT_SECRET: '' },
  });
  expect(result.status).not.toBe(0); expect(result.stderr).toContain('AUTH_CONFIGURATION_MISSING');
  expect(result.stderr).not.toContain(process.env.JWT_SECRET);
});
test.each([false, true])('environment initializes before JWT from another cwd; platform override=%s', platformOverride => {
  // Isolated copy with a dummy .env: never import the real developer env.
  const dir = mkdtempSync(join(process.cwd(), 'verification', '.jwt-env-'));
  const config = join(dir, 'config'); mkdirSync(config);
  try {
    copyFileSync('config/environment.js', join(config, 'environment.js'));
    copyFileSync('config/jwt.js', join(config, 'jwt.js'));
    writeFileSync(join(dir, '.env'), 'JWT_SECRET=fixture-file-secret\nJWT_EXPIRES_IN=2h\n');
    const env = { ...process.env, NODE_ENV: 'production' };
    delete env.JWT_SECRET; delete env.JWT_EXPIRES_IN;
    if (platformOverride) env.JWT_SECRET = 'fixture-platform-secret';
    const source = `const c = await import(${JSON.stringify(pathToFileURL(join(config, 'jwt.js')).href)}); console.log(JSON.stringify({ correctKey: c.JWT_SECRET === ${JSON.stringify(platformOverride ? 'fixture-platform-secret' : 'fixture-file-secret')}, expiry: c.verifySessionToken(c.signSessionToken({id:'fixture'})).exp - c.verifySessionToken(c.signSessionToken({id:'fixture'})).iat }));`;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', source], { cwd: tmpdir(), env, encoding: 'utf8' });
    expect(result.status).toBe(0); expect(JSON.parse(result.stdout.trim())).toEqual({ correctKey: true, expiry: 7200 });
  } finally {
    for (const file of ['environment.js', 'jwt.js']) unlinkSync(join(config, file));
    unlinkSync(join(dir, '.env')); rmdirSync(config); rmdirSync(dir);
  }
});
