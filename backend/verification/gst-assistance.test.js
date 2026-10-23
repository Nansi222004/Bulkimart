import { jest } from '@jest/globals';
import mongoose from 'mongoose';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const notify = jest.fn(async () => ({}));
jest.unstable_mockModule('../services/notification.service.js', () => ({ notifyAllAdmins: notify, notifySeller: notify, notifyUser: notify, notifyRider: notify,
  registerPushToken: notify, removePushToken: notify, pushToUser: notify, NOTIFICATION_EVENT: { SYSTEM: 'SYSTEM' } }));
const originalCloudinary = await import('../services/cloudinary.service.js');
jest.unstable_mockModule('../services/cloudinary.service.js', () => ({ ...originalCloudinary, uploadToCloudinary: async () => 'https://example.test/legacy-kyc-fixture' }));
const [{ default: Seller }, { default: User }, { default: Admin }, { default: Gst }, { gstAssistanceRouter },
  { default: sellerRoutes }, { errorHandler }, { JWT_SECRET }, { gstAssistanceCapabilities }] = await Promise.all([
  import('../models/Seller.js'), import('../models/User.js'), import('../models/Admin.js'), import('../models/GstAssistanceRequest.js'),
  import('../routes/gstAssistance.routes.js'), import('../routes/seller.routes.js'), import('../middlewares/error.middleware.js'),
  import('../config/jwt.js'), import('../services/gstAssistance.service.js'),
]);
const app = express(); app.use(express.json());
app.use('/sellers/gst-assistance', gstAssistanceRouter()); app.use('/admin/gst-assistance', gstAssistanceRouter(true)); app.use('/sellers', sellerRoutes); app.use(errorHandler);
let db, root, vendor, other, admin, denied, seller;
const auth = (r, u = vendor, type = 'user', role = 'seller') => r.set('Authorization', `Bearer ${jwt.sign({ id: String(u._id), type, role }, JWT_SECRET)}`);
const detail = async () => (await auth(request(app).get('/sellers/gst-assistance/me')).expect(200)).body.data;
const payload = extra => ({ pan: 'ABCDE1234F', gstChoice: 'assistance', gstAssistanceConsent: true, gstContactName: 'Fixture Contact', gstAssistanceMessage: 'Need registration guidance', ...extra });
const submit = (body = payload()) => auth(request(app).put('/sellers/step/4')).send(body);
const adminAction = async (action, extra = {}, files = []) => {
  const row = await Gst.findById(seller._id);
  let r = auth(request(app).post(`/admin/gst-assistance/${seller._id}/actions`), admin, 'admin').field('version', row.__v).field('action', action);
  for (const [k, v] of Object.entries(extra)) r = r.field(k, String(v));
  for (const f of files) r = r.attach('documents', f.bytes, { filename: f.name, contentType: f.mime });
  return r;
};
const pdf = { bytes: Buffer.from('%PDF-1.7\nprivate synthetic GST proof\n%%EOF'), name: 'gst-proof.pdf', mime: 'application/pdf' };
beforeAll(async () => {
  delete process.env.MONGO_URI; delete process.env.MONGODB_URI;
  root = await mkdtemp(path.join(tmpdir(), 'bulkimart-gst-test-')); process.env.SERVICE_STORAGE_DIR = root;
  db = await MongoMemoryReplSet.create({ binary: { version: '7.0.14' }, replSet: { count: 1 } }); await mongoose.connect(db.getUri('gst-assistance-isolated'));
  for (const m of [Seller, User, Admin, Gst]) { await m.createCollection(); if (m !== Gst) await m.init(); }
});
beforeEach(async () => {
  process.env.GST_ASSISTANCE_ENABLED = 'true'; process.env.NODE_ENV = 'test'; delete process.env.DEPLOYMENT_ENV;
  for (const c of Object.values(mongoose.connection.collections)) await c.deleteMany({}); notify.mockClear();
  [vendor, other] = await User.create([{ phone: '9876500171', roles: ['buyer'] }, { phone: '9876500172', roles: ['seller'] }]);
  seller = await Seller.create({ userId: vendor._id, phone: vendor.phone, businessName: 'Synthetic GST shop', businessType: 'proprietorship', status: 'incomplete', onboardingStep: 4,
    storeDetails: { name: 'Fixture', state: 'Karnataka', pincode: '560001', phone: vendor.phone } });
  const ids = [new mongoose.Types.ObjectId(), new mongoose.Types.ObjectId()];
  await Admin.collection.insertMany(ids.map((_id, i) => ({ _id, email: `gst-${i}@example.test`, role: 'admin', isActive: true, permissions: i ? [] : ['manage_sellers'] })));
  [admin, denied] = await Promise.all(ids.map(id => Admin.findById(id)));
});
afterAll(async () => {
  await mongoose.disconnect(); await db?.stop(); delete process.env.SERVICE_STORAGE_DIR; delete process.env.GST_ASSISTANCE_ENABLED;
  assert.equal(path.dirname(path.resolve(root)), path.resolve(tmpdir())); assert.ok(path.basename(root).startsWith('bulkimart-gst-test-')); await rm(root, { recursive: true, force: true });
});

test.each(['has_gstin', 'without_gstin'])('explicit %s path preserves normal seller progression without an assistance request', async choice => {
  const gstin = choice === 'has_gstin' ? '29ABCDE1234F1Z5' : '';
  await submit({ pan: 'ABCDE1234F', gstChoice: choice, gstin }).expect(200);
  const saved = await Seller.findById(seller._id); expect(saved.gstin).toBe(gstin); expect(saved.onboardingStep).toBe(5); expect(saved.status).toBe('incomplete'); expect(await Gst.countDocuments()).toBe(0);
});
test('legacy optional GSTIN callers retain their previous behavior without inventing verification', async () => {
  await submit({ pan: 'ABCDE1234F', gstin: 'legacy-unverified-string' }).expect(200);
  expect((await Seller.findById(seller._id)).gstin).toBe('legacy-unverified-string'); expect(await Gst.countDocuments()).toBe(0);
});
test.each([{ gstChoice: 'has_gstin', gstin: 'invalid' }, { pan: '' }, { gstAssistanceConsent: false }, { gstContactName: '' }, { gstAssistanceMessage: 'a'.repeat(2001) }, { gstChoice: 'assistance', gstin: '29ABCDE1234F1Z5' }])('new decision validation rejects %j without advancing onboarding', async invalid => {
  await submit(payload(invalid)).expect(400); expect(await Gst.countDocuments()).toBe(0); expect((await Seller.findById(seller._id)).onboardingStep).toBe(4);
});
test('assistance records consent, original no-GSTIN state, identity and audit while leaving seller approval separate', async () => {
  await submit().expect(200); const d = await detail();
  expect(String(d.vendorId)).toBe(String(seller._id)); expect(d.status).toBe('pending'); expect(d.consent).toMatchObject({ accepted: true, version: 'gst-assistance-v1' }); expect(d.events[0].action).toBe('submitted');
  expect(d.gstinStatusAtSubmission).toBe('not_provided'); expect(d.files).toEqual([]); expect((await Seller.findById(seller._id)).status).toBe('incomplete'); expect(notify).toHaveBeenCalled();
});
test('duplicate and concurrent identical submissions create one request; changed active submission conflicts', async () => {
  const results = await Promise.all([submit(), submit()]); expect(results.map(r => r.status)).toEqual([200, 200]);
  expect(await Gst.countDocuments()).toBe(1); expect((await detail()).events).toHaveLength(1);
  await submit(payload({ gstContactName: 'Different Contact' })).expect(409);
});
test('vendor and admin isolation protects private request list/detail and rejects another portal', async () => {
  await submit().expect(200);
  await auth(request(app).get('/sellers/gst-assistance/me'), other).expect(404);
  await auth(request(app).get('/sellers/gst-assistance/me'), vendor, 'user', 'delivery').expect(403);
  await auth(request(app).get('/admin/gst-assistance'), vendor).expect(403);
  await auth(request(app).get('/admin/gst-assistance'), denied, 'admin').expect(403);
  await request(app).get('/admin/gst-assistance').expect(401);
  const r = await auth(request(app).get('/admin/gst-assistance?status=pending'), admin, 'admin').expect(200); expect(r.body.data.requests).toHaveLength(1); expect(r.headers['cache-control']).toBe('private, no-store');
});
test('review transitions, internal notes, self-assignment and additional-information response have an audit trail', async () => {
  await submit().expect(200);
  expect((await adminAction('assign', { reviewerId: 'self' })).status).toBe(200);
  expect((await adminAction('note', { internalNote: 'PRIVATE REVIEW NOTE' })).status).toBe(200);
  expect((await adminAction('transition', { status: 'under_review', message: 'Review started' })).status).toBe(200);
  expect((await adminAction('transition', { status: 'additional_information_required', message: 'Please provide requested business evidence' })).status).toBe(200);
  const d = await detail(); expect(JSON.stringify(d)).not.toContain('PRIVATE REVIEW NOTE'); expect(d.reviewerId).toBeUndefined();
  const r = await auth(request(app).post('/sellers/gst-assistance/me/actions')).field('version', d.version).field('action', 'respond').field('message', 'Requested evidence attached').attach('documents', pdf.bytes, { filename: pdf.name, contentType: pdf.mime }).expect(200);
  expect(r.body.data.status).toBe('under_review'); expect(r.body.data.events.at(-1).action).toBe('respond'); expect(r.body.data.files).toHaveLength(1);
});
test('private documents require ownership or authorized admin access and never return a storage URL', async () => {
  await submit().expect(200); await adminAction('transition', { status: 'under_review', message: 'Review' }); await adminAction('transition', { status: 'additional_information_required', message: 'Please attach proof' });
  const d = await detail(); const r = await auth(request(app).post('/sellers/gst-assistance/me/actions')).field('version', d.version).field('action', 'respond').field('message', 'Evidence').attach('documents', pdf.bytes, { filename: pdf.name, contentType: pdf.mime }).expect(200);
  const file = r.body.data.files[0]; expect(JSON.stringify(file)).not.toMatch(/https?:|private-data|sha256/);
  const downloaded = await auth(request(app).get(`/sellers/gst-assistance/me/files/${file.fileId}`)).expect(200); expect(downloaded.headers['content-disposition']).toContain('attachment'); expect(downloaded.headers['cache-control']).toBe('private, no-store');
  await auth(request(app).get(`/sellers/gst-assistance/me/files/${file.fileId}`), other).expect(404);
  await auth(request(app).get(`/admin/gst-assistance/${seller._id}/files/${file.fileId}`), denied, 'admin').expect(403);
  await auth(request(app).get(`/admin/gst-assistance/${seller._id}/files/${file.fileId}`), admin, 'admin').expect(200);
});
test('vendor cannot promote a request and invalid/stale transitions fail without audit mutation', async () => {
  await submit().expect(200); const d = await detail();
  await auth(request(app).post('/sellers/gst-assistance/me/actions')).field('version', d.version).field('action', 'transition').field('status', 'completed').expect(400);
  expect((await adminAction('transition', { status: 'completed', message: 'Invalid shortcut' })).status).toBe(409);
  await adminAction('transition', { status: 'under_review', message: 'Review' });
  await auth(request(app).post('/sellers/gst-assistance/me/actions')).field('version', d.version).field('action', 'cancel').expect(409);
  expect((await detail()).events).toHaveLength(2);
});
test('cancellation is pending-only; cancelled requests cannot be silently recreated', async () => {
  await submit().expect(200); const d = await detail();
  await auth(request(app).post('/sellers/gst-assistance/me/actions')).field('version', d.version).field('action', 'cancel').expect(200);
  await submit().expect(409); expect((await detail()).status).toBe('cancelled'); expect(await Gst.countDocuments()).toBe(1);
});
test('completion requires independently reviewed evidence and never sets or verifies the Seller GSTIN', async () => {
  await submit().expect(200); await adminAction('transition', { status: 'under_review', message: 'Review' }); await adminAction('transition', { status: 'approved', message: 'Assistance accepted; not government approval' });
  expect((await adminAction('transition', { status: 'completed', message: 'Complete', verifiedGstin: '29ABCDE1234F1Z5', independentlyVerified: true, verificationReference: 'SYNTHETIC VERIFICATION' })).status).toBe(400);
  const result = await adminAction('transition', { status: 'completed', message: 'Synthetic independently reviewed evidence', verifiedGstin: '29ABCDE1234F1Z5', independentlyVerified: true, verificationReference: 'SYNTHETIC ONLY — NOT A GOVERNMENT REFERENCE' }, [pdf]);
  expect(result.status).toBe(200); expect((await detail()).files).toEqual([]); expect((await Seller.findById(seller._id)).gstin).toBe('');
  const stored = await Gst.findById(seller._id); expect(stored.verification.method).toBe('admin_attested_independent_review');
  await auth(request(app).get(`/sellers/gst-assistance/me/files/${stored.files[0].fileId}`)).expect(404);
});
test('malformed files and stale writes do not leave orphan private documents', async () => {
  await submit().expect(200); await adminAction('transition', { status: 'under_review', message: 'Review' });
  const before = (await readdir(root)).length;
  expect((await adminAction('transition', { status: 'approved', message: 'Bad file' }, [{ ...pdf, bytes: Buffer.from('not a pdf') }])).status).toBe(400);
  expect((await readdir(root)).length).toBe(before);
  const version = (await detail()).version;
  await adminAction('note', { internalNote: 'New version' });
  await auth(request(app).post(`/admin/gst-assistance/${seller._id}/actions`), admin, 'admin').field('version', version).field('action', 'transition').field('status', 'approved').field('message', 'Stale').attach('documents', pdf.bytes, { filename: pdf.name, contentType: pdf.mime }).expect(409);
  expect((await readdir(root)).length).toBe(before);
});
test.each(['production', 'prod', 'deployment-production'])('production alias %s blocks assistance even with flag true', async name => {
  process.env.DEPLOYMENT_ENV = name;
  expect(gstAssistanceCapabilities().enabled).toBe(false); await submit().expect(503);
  expect(await Gst.countDocuments()).toBe(0); delete process.env.DEPLOYMENT_ENV;
});
test('disabled defaults do not block legacy optional-GST onboarding', async () => {
  delete process.env.GST_ASSISTANCE_ENABLED; expect(gstAssistanceCapabilities().enabled).toBe(false);
  await submit().expect(503); await submit({ pan: 'ABCDE1234F' }).expect(200);
});
test('failure after request creation rolls back request and seller progression, allowing a safe retry', async () => {
  const spy = jest.spyOn(Seller, 'updateOne').mockRejectedValueOnce(Error('Synthetic seller write failure'));
  try { await submit().expect(500); } finally { spy.mockRestore(); }
  expect(await Gst.countDocuments()).toBe(0); expect((await Seller.findById(seller._id)).onboardingStep).toBe(4);
  await submit().expect(200); expect(await Gst.countDocuments()).toBe(1);
});
test('concurrent review commands with the same version commit one transition and one audit event', async () => {
  await submit().expect(200); const version = (await detail()).version;
  const command = () => auth(request(app).post(`/admin/gst-assistance/${seller._id}/actions`), admin, 'admin').field('version', version).field('action', 'transition').field('status', 'under_review').field('message', 'Concurrent synthetic review');
  const results = await Promise.all([command(), command()]); expect(results.map(r => r.status).sort()).toEqual([200, 409]);
  expect((await detail()).events).toHaveLength(2);
});
test('notification outage cannot roll back a committed GST assistance request', async () => {
  notify.mockRejectedValueOnce(Error('Synthetic notification outage'));
  await submit().expect(200); expect(await Gst.countDocuments()).toBe(1);
});
