import { jest } from '@jest/globals';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// No dotenv, configured server or network provider is used. Actual Razorpay
// signature/status helpers execute against this in-process SDK replacement.
let orders = new Map(), captures = new Map(), refunds = new Map(), createError = false, refundError = false, refundState = 'processed';
const sdk = {
  orders: {
    create: jest.fn(async input => { const row = { id: `order_${orders.size + 1}`, ...input }; orders.set(row.id, row); if (createError) throw new Error('Uncertain transport'); return row; }),
    fetch: async id => orders.get(id), all: async () => ({ items: [...orders.values()] }),
    fetchPayments: async id => ({ items: [...captures.values()].filter(p => p.order_id === id) }),
  },
  payments: { fetch: async id => captures.get(id), refund: jest.fn(async (id, input) => { if (refundError) throw new Error('Uncertain refund'); const row = { id: `rfnd_${refunds.size + 1}`, payment_id: id, currency: 'INR', status: refundState, ...input }; refunds.set(row.id, row); if (refundState === 'processed') captures.get(id).amount_refunded = (captures.get(id).amount_refunded || 0) + row.amount; return row; }) },
  refunds: { fetch: async id => refunds.get(id), all: async input => ({ items: [...refunds.values()].filter(r => r.payment_id === input.payment_id) }) },
};
jest.unstable_mockModule('razorpay', () => ({ default: class { constructor() { return sdk; } } }));
const notifyUser = jest.fn(async () => {}), notifyAllAdmins = jest.fn(async () => {});
jest.unstable_mockModule('../services/notification.service.js', () => ({ notifyUser, notifyAllAdmins, notifySeller: notifyUser, notifyRider: notifyUser, notifyAdmin: notifyUser, NOTIFICATION_EVENT: {} }));
const [{ customerLegalRouter, adminLegalRouter, providerLegalRouter }, { default: Service }, { default: Application }, { default: Provider }, { default: Payment }, { default: Ledger }, { default: User }, { default: Admin }, { default: Commission }, { errorHandler }, { JWT_SECRET }, policy, workflow, payments, { razorpayWebhook }] = await Promise.all([
  import('../routes/legalServices.routes.js'), import('../models/Service.js'), import('../models/ServiceApplication.js'), import('../models/LegalProvider.js'), import('../models/Payment.js'), import('../models/SellerLedgerEntry.js'), import('../models/User.js'), import('../models/Admin.js'), import('../models/Commission.js'), import('../middlewares/error.middleware.js'), import('../config/jwt.js'), import('../services/legalPolicy.service.js'), import('../services/legalWorkflow.service.js'), import('../services/legalPayment.service.js'), import('../controllers/payment.controller.js'),
]);
const { serviceRouter } = await import('../routes/serviceManagement.routes.js');
const app = express(); app.use(express.json({ verify: (req, _res, b) => { req.rawBody = Buffer.from(b); } }));
app.use('/c', customerLegalRouter); app.use('/a', adminLegalRouter); app.use('/p', providerLegalRouter); app.use('/manage', serviceRouter(true)); app.use('/v', serviceRouter()); app.post('/webhook', razorpayWebhook); app.use(errorHandler);
let db, storage, customer, other, professional, admin, limited, service, provider;
const token = (u, type = 'user', role = 'buyer') => jwt.sign({ id: String(u._id), type, ...(type === 'user' ? { role } : {}) }, JWT_SECRET);
const auth = (r, u = customer, type = 'user', role = 'buyer') => r.set('Authorization', `Bearer ${token(u, type, role)}`);
const asAdmin = r => auth(r, admin, 'admin');
const fixturePolicy = () => ({ rate: 10, base: 'service_excluding_tax', gatewayFees: 'platform_absorbed', providerDeductions: 'none', refundAllocation: 'proportional_total', serviceTaxTreatment: 'exempt', serviceTaxRate: 0, commissionTaxTreatment: 'exempt', commissionTaxRate: 0, settlementHoldHours: 0, effectiveDate: '2020-01-01T00:00:00Z', approvalReference: 'SYNTHETIC TEST ONLY', terms: 'Synthetic terms, manual cancellation review and proportional refunds; not an active business policy.' });
const pdf = Buffer.from('%PDF-1.7\nprivate fixture\n%%EOF');
beforeAll(async () => {
  db = await MongoMemoryReplSet.create({ binary: { version: '7.0.14' }, replSet: { count: 1 } }); await mongoose.connect(db.getUri());
  await Promise.all([Service.createIndexes(), Application.createIndexes(), Provider.createIndexes(), Payment.init(), Ledger.init(), User.init(), Admin.init()]);
  storage = await mkdtemp(path.join(os.tmpdir(), 'bulkimart-legal-isolated-'));
});
afterAll(async () => { await mongoose.disconnect(); await db?.stop(); if (storage) await rm(storage, { recursive: true, force: true }); delete process.env.SERVICE_STORAGE_DIR; });
beforeEach(async () => {
  for (const c of Object.values(mongoose.connection.collections)) await c.deleteMany({});
  orders.clear(); captures.clear(); refunds.clear(); createError = refundError = false; refundState = 'processed'; jest.clearAllMocks();
  process.env.SERVICE_STORAGE_DIR = storage; process.env.PAYMENT_GATEWAY = 'razorpay'; process.env.RAZORPAY_MODE = 'test'; process.env.RAZORPAY_KEY_ID = 'rzp_test_isolated'; process.env.RAZORPAY_KEY_SECRET = 'isolated-secret'; process.env.RAZORPAY_WEBHOOK_SECRET = 'isolated-webhook-secret';
  for (const k of ['catalogue', 'submissions', 'fulfilment', 'payments', 'refunds']) delete process.env[`LEGAL_SERVICES_${k.toUpperCase()}_ENABLED`];
  delete process.env.LEGAL_SERVICES_PAYOUTS_ENABLED;
  [customer, other, professional] = await User.create([{ phone: '9876500011', roles: ['buyer'], name: 'Customer' }, { phone: '9876500012', roles: ['buyer'] }, { phone: '9876500013', roles: ['buyer'], name: 'Professional' }]);
  const ids = [new mongoose.Types.ObjectId(), new mongoose.Types.ObjectId()];
  await Admin.collection.insertMany([{ _id: ids[0], name: 'Fixture', email: 'super@example.test', password: 'not-live', role: 'superAdmin', isActive: true }, { _id: ids[1], name: 'Limited', email: 'limited@example.test', password: 'not-live', role: 'admin', isActive: true, permissions: [] }]);
  [admin, limited] = await Promise.all(ids.map(id => Admin.findById(id)));
  service = await Service.create({ name: 'Fixture legal intake', slug: 'fixture-legal', description: 'Synthetic service', instructions: 'Necessary data only', audiences: ['customer'], status: 'published', pricing: { mode: 'free', amount: 0, currency: 'INR' }, fields: [{ id: 'name', label: 'Name', type: 'text', required: true }, { id: 'proof', label: 'Proof', type: 'file', required: true, formats: ['pdf'], maxBytes: 1024 }] });
  provider = await Provider.create({ user: professional._id, displayName: 'Reviewed fixture', status: 'approved', services: [service._id], reviewReference: 'SYNTHETIC IDENTITY/ELIGIBILITY REVIEW', reviewedBy: admin._id, reviewedAt: new Date() });
});
const submit = (key = crypto.randomUUID(), who = customer, answers = { name: 'Private fixture' }) => auth(request(app).post(`/c/catalogue/${service._id}/applications`), who).set('Idempotency-Key', key).field('answers', JSON.stringify(answers)).field('formVersion', service.formVersion).field('serviceVersion', service.__v).attach('proof', pdf, { filename: 'proof.pdf', contentType: 'application/pdf' });
const getAdmin = async id => (await asAdmin(request(app).get(`/a/requests/${id}`)).expect(200)).body.data;
async function act(id, action, extra = {}) { const a = await getAdmin(id); return (await asAdmin(request(app).post(`/a/requests/${id}/actions`)).send({ action, version: a.__v, message: 'Synthetic authorized evidence', ...extra })).body; }
async function quoted() {
  const a = (await submit().expect(201)).body.data;
  await asAdmin(request(app).post('/a/policies')).send(fixturePolicy()).expect(201);
  expect((await act(a._id, 'review')).success).toBe(true); expect((await act(a._id, 'assign', { providerId: String(provider._id) })).success).toBe(true);
  const quoted = await act(a._id, 'quote', { serviceAmount: 5000, scope: 'Synthetic scope' }); expect(quoted.success).toBe(true); return quoted.data;
}
async function initiate(a, key = crypto.randomUUID()) { return (await auth(request(app).post(`/c/applications/${a._id}/payment`)).set('Idempotency-Key', key).send({ quotationVersion: 1, acceptTerms: true }).expect(200)).body.data; }
function captured(checkout, id = 'pay_fixture', amount = checkout.amountPaise) { const p = { id, order_id: checkout.razorpayOrderId, amount, currency: 'INR', status: 'captured', captured: true, amount_refunded: 0 }; captures.set(p.id, p); return p; }
async function paid() { const a = await quoted(), checkout = await initiate(a); captured(checkout); const signature = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET).update(`${checkout.razorpayOrderId}|pay_fixture`).digest('hex'); await auth(request(app).post('/c/payments/verify')).send({ orderId: a._id, razorpay_order_id: checkout.razorpayOrderId, razorpay_payment_id: 'pay_fixture', razorpay_signature: signature }).expect(200); return getAdmin(a._id); }
async function webhook(body, valid = true) { const raw = JSON.stringify(body), signature = crypto.createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET).update(raw).digest('hex'); return request(app).post('/webhook').set('x-razorpay-signature', valid ? signature : 'invalid').set('Content-Type', 'application/json').send(raw); }

test.each([undefined, 'false'])('legal capabilities ignore legacy switches %s and enforce the matching configured gateway mode', value => {
  for (const k of ['submissions', 'fulfilment', 'payments', 'refunds']) {
    const name = `LEGAL_SERVICES_${k.toUpperCase()}_ENABLED`;
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
    expect(() => policy.requireLegalFlag(k)).not.toThrow();
  }
  expect(() => policy.requireLegalGateway()).not.toThrow();
  expect(policy.legalFlags().payouts).toBe(false);
  process.env.RAZORPAY_KEY_ID = 'rzp_live_isolated'; expect(() => policy.requireLegalGateway()).toThrow(/not configured/);
  process.env.DEPLOYMENT_ENV = 'production'; expect(() => policy.requireLegalFlag('submissions')).not.toThrow();
  expect(() => policy.requireLegalGateway()).toThrow(/live mode/);
  process.env.RAZORPAY_MODE = 'live'; expect(() => policy.requireLegalGateway()).not.toThrow();
  delete process.env.DEPLOYMENT_ENV;
});
test('legacy defaults and drafts are excluded; customer DTO contains no administrative metadata', async () => {
  await Service.create({ name: 'Legacy', slug: 'legacy', status: 'published' });
  await Service.create({ name: 'Draft', slug: 'draft', audiences: ['customer'], status: 'draft' });
  const r = await request(app).get('/c').expect(200); expect(r.body.data).toHaveLength(1); expect(JSON.stringify(r.body)).not.toMatch(/createdBy|updatedBy|submissionCount|__v/);
});

test('Admin create and publish preserves INR 100 requirements and enables only explicitly eligible customer applications', async () => {
  await Service.deleteMany({});
  process.env.LEGAL_SERVICES_CATALOGUE_ENABLED = 'false'; // Obsolete setting cannot hide Admin-published customer services.
  const definition = { name: 'Legal Services for Businesses', slug: 'legal-services', description: 'Isolated customer eligible offering', instructions: 'Provide business name and proof', audiences: ['vendor', 'customer'], pricing: { mode: 'fixed', amount: 100, currency: 'INR' }, fields: service.fields.map(f => ({ ...f })) };
  const created = (await asAdmin(request(app).post('/manage')).send(definition).expect(201)).body.data;
  expect(created.status).toBe('draft');
  expect((await request(app).get('/c/capabilities').expect(200)).body.data.catalogue).toBe(false);
  expect((await request(app).get('/c').expect(200)).body.data).toEqual([]);
  await request(app).get(`/c/catalogue/${created._id}`).expect(404);
  const published = (await asAdmin(request(app).post(`/manage/${created._id}/publication`)).send({ status: 'published', version: created.__v }).expect(200)).body.data;
  service = published;
  expect((await request(app).get('/c/capabilities').expect(200)).body.data.catalogue).toBe(true);
  const catalogue = (await request(app).get('/c?page=1&limit=1').expect(200)).body;
  expect(catalogue.meta.total).toBe(1);
  expect(catalogue.data[0]._id).toBe(created._id);
  expect(catalogue.data[0].startingPrice).toEqual({ amount: 100, currency: 'INR' });
  expect(catalogue.data[0].fields.map(f => f.id)).toEqual(['name', 'proof']);
  const detail = (await request(app).get(`/c/catalogue/${created._id}`).expect(200)).body.data;
  expect(detail.instructions).toBe(definition.instructions);
  await request(app).post(`/c/catalogue/${created._id}/applications`).expect(401);
  const application = (await submit().expect(201)).body.data;
  expect(application.serviceName).toBe(definition.name);
  expect(application.answers.name).toBe('Private fixture');
  expect(application.canPay).toBe(false);
  expect((await Service.findById(created._id)).pricing.amount).toBe(100);
  await asAdmin(request(app).post(`/manage/${created._id}/publication`)).send({ status: 'unpublished', version: published.__v }).expect(200);
  expect((await request(app).get('/c').expect(200)).body.data).toEqual([]);
  expect((await request(app).get('/c/capabilities').expect(200)).body.data.catalogue).toBe(false);
  await submit().expect(404);
});

test('legacy published business service is seller-only; customer capability reflects published customer records', async () => {
  await Service.deleteMany({});
  customer.roles.push('seller'); await customer.save();
  await mongoose.connection.collection('sellers').insertOne({ userId: customer._id, status: 'approved' });
  const legacy = { _id: new mongoose.Types.ObjectId(), name: 'Legal Services for Businesses', slug: 'legacy-business', status: 'published', pricing: { mode: 'fixed', amount: 100, currency: 'INR' }, fields: [], formVersion: 1, __v: 1 };
  await Service.collection.insertOne(legacy); // Deliberately absent audiences, like the verified live record.
  const seller = (await auth(request(app).get('/v?page=1&limit=20'), customer, 'user', 'seller').expect(200)).body.data;
  expect(seller).toHaveLength(1); expect(seller[0]._id).toBe(String(legacy._id)); expect(seller[0].pricing.amount).toBe(100);
  expect((await request(app).get('/c').expect(200)).body.data).toEqual([]);
  await request(app).get(`/c/catalogue/${legacy._id}`).expect(404);
  await auth(request(app).get('/v'), other).expect(403);
  process.env.LEGAL_SERVICES_CATALOGUE_ENABLED = 'false';
  expect((await request(app).get('/c/capabilities').expect(200)).body.data.catalogue).toBe(false);
  expect((await request(app).get('/c').expect(200)).body.data).toEqual([]);
  // Customer eligibility never disables the approved seller catalogue.
  await auth(request(app).get('/v'), customer, 'user', 'seller').expect(200);
});

test('Admin customer checkbox alone controls visibility of an already-published service without environment configuration', async () => {
  delete process.env.LEGAL_SERVICES_CATALOGUE_ENABLED;
  const definition = { ...service.toObject(), audiences: ['vendor'], version: service.__v };
  const hidden = (await asAdmin(request(app).put(`/manage/${service._id}`)).send(definition).expect(200)).body.data;
  expect((await request(app).get('/c/capabilities').expect(200)).body.data.catalogue).toBe(false);
  await request(app).get(`/c/catalogue/${service._id}`).expect(404);
  const visible = (await asAdmin(request(app).put(`/manage/${service._id}`)).send({ ...definition, audiences: ['vendor', 'customer'], version: hidden.__v }).expect(200)).body.data;
  expect(visible.status).toBe('published');
  expect(visible.pricing.amount).toBe(service.pricing.amount);
  expect((await request(app).get('/c/capabilities').expect(200)).body.data.catalogue).toBe(true);
  await request(app).get(`/c/catalogue/${service._id}`).expect(200);
});

test('capability database failures propagate as API errors rather than catalogue:false', async () => {
  const spy = jest.spyOn(Service, 'exists').mockRejectedValue(new Error('Isolated database failure'));
  try {
    const r = await request(app).get('/c/capabilities').expect(500);
    expect(r.body.success).toBe(false);
    expect(r.body.data).toBeNull();
  } finally { spy.mockRestore(); }
});
test('customer submissions require authentication and buyer context; ordinary admin has no implicit service permission', async () => {
  await request(app).get('/c/applications').expect(401); await auth(request(app).get('/c/applications'), customer, 'user', 'seller').expect(403);
  await auth(request(app).get('/a/requests'), limited, 'admin').expect(403);
  customer.isActive = false; await customer.save(); await auth(request(app).get('/c/applications')).expect(403);
});
test('validated private submission, snapshot and cross-customer file isolation', async () => {
  const a = (await submit().expect(201)).body.data; expect(a.status).toBe('submitted'); expect(a.quotation).toBeNull(); expect(a.canPay).toBe(false);
  expect(JSON.stringify(a)).not.toMatch(/sha256|private-data|reviewReference|submissionKey/);
  await auth(request(app).get(`/c/applications/${a._id}`), other).expect(404);
  await auth(request(app).get(`/c/applications/${a._id}/files/${a.files[0].fileId}`), other).expect(404);
  const f = await auth(request(app).get(`/c/applications/${a._id}/files/${a.files[0].fileId}`)).expect(200); expect(f.headers['cache-control']).toBe('private, no-store');
});
test('concurrent retries create one request; reused key with changed payload conflicts', async () => {
  const key = crypto.randomUUID(), r = await Promise.all([submit(key), submit(key)]); expect(r.map(x => x.status).sort()).toEqual([200, 201]); expect(await Application.countDocuments()).toBe(1);
  await submit(key, customer, { name: 'Changed' }).expect(409);
});
test('unpublication and stale forms reject submission without database acceptance', async () => {
  await Service.updateOne({ _id: service._id }, { $set: { status: 'unpublished' } }); await submit().expect(404); expect(await Application.countDocuments()).toBe(0);
  await Service.updateOne({ _id: service._id }, { $set: { status: 'published' }, $inc: { __v: 1 } }); await submit().expect(409);
});
test('invalid form answers and forged documents fail validation', async () => { await submit(crypto.randomUUID(), customer, { unexpected: 'x' }).expect(400); expect(await Application.countDocuments()).toBe(0); });
test('provider needs explicit approval and sees only assigned and shared information', async () => {
  const a = await quoted(); await auth(request(app).get(`/p/${a._id}`), other).expect(403);
  const p = await auth(request(app).get(`/p/${a._id}`), professional).expect(200); expect(p.body.data.files).toHaveLength(0); expect(p.body.data.answers).toEqual({}); expect(JSON.stringify(p.body.data)).not.toMatch(/commissionPaise|customerId|captureId/);
  const full = await getAdmin(a._id); await act(a._id, 'share_documents', { fileIds: [full.files[0].fileId], fieldIds: ['name'] });
  const shared = await auth(request(app).get(`/p/${a._id}`), professional).expect(200); expect(shared.body.data.files).toHaveLength(1);
  provider = await Provider.findById(provider._id); provider.status = 'suspended'; await provider.save(); await auth(request(app).get(`/p/${a._id}`), professional).expect(403);
});
test('no approved policy or future/expired quotation cannot authorize payment', async () => {
  expect(() => policy.quotationSnapshot({ serviceAmount: 1, scope: 'x' }, null, {}, admin._id)).toThrow(/approved/);
  const a = await quoted(); await Application.updateOne({ _id: a._id }, { $set: { 'legal.quotes.0.expiresAt': new Date('2000-01-01') } });
  await auth(request(app).post(`/c/applications/${a._id}/payment`)).set('Idempotency-Key', crypto.randomUUID()).send({ quotationVersion: 1, acceptTerms: true }).expect(409);
});
test('policy requires explicit rates/base/tax/terms and conserves paise across rounding', () => {
  expect(() => policy.validateLegalPolicy({})).toThrow(); expect(() => policy.validateLegalPolicy({ ...fixturePolicy(), rate: 101 })).toThrow();
  const r = policy.validateLegalPolicy({ ...fixturePolicy(), rate: 33.33, serviceTaxTreatment: 'exclusive', serviceTaxRate: 18 });
  const q = policy.quotationSnapshot({ scope: 'Fixture', serviceAmount: 0.03 }, { ...r, _id: service._id }, { _id: service._id, service: service._id }, admin._id);
  expect(q.providerPaise + q.commissionPaise + q.commissionTaxPaise + q.serviceTaxPaise).toBe(q.totalPaise);
  expect(() => policy.quotationSnapshot({ scope: 'Over limit', serviceAmount: 100001 }, { ...r, _id: service._id }, { _id: service._id, service: service._id }, admin._id)).toThrow(/amount limit/);
});
test('assigned provider may acknowledge before payment but cannot upload completion or change prices', async () => {
  const a = await quoted();
  let p = (await auth(request(app).get(`/p/${a._id}`), professional)).body.data;
  await auth(request(app).post(`/p/${a._id}/progress`), professional).field('version', p.version).field('action', 'acknowledged').field('message', 'Assignment reviewed').expect(200);
  p = (await auth(request(app).get(`/p/${a._id}`), professional)).body.data;
  await auth(request(app).post(`/p/${a._id}/progress`), professional).field('version', p.version).field('action', 'completion_submitted').field('message', 'Premature completion').expect(409);
  const otherProvider = await Provider.create({ user: other._id, displayName: 'Other fixture', status: 'approved', services: [service._id], reviewReference: 'Synthetic evidence', reviewedBy: admin._id, reviewedAt: new Date() });
  await auth(request(app).get(`/p/${a._id}`), other).expect(404);
});
test('stale provider review cannot overwrite approval and missing attestations cannot create verification', async () => {
  await asAdmin(request(app).post('/a/providers')).send({ user: String(professional._id), status: 'approved', displayName: 'Bad review', services: [String(service._id)], reviewReference: 'No attestation' }).expect(400);
  await asAdmin(request(app).post('/a/providers')).send({ user: String(professional._id), status: 'approved', displayName: 'Stale review', services: [String(service._id)], reviewReference: 'Synthetic review', identityReviewed: true, credentialsReviewed: true, version: 99 }).expect(409);
});

describe('customer requests use the simple service flow', () => {
  const manage = async (id, status, message = 'Synthetic admin step', expected = 200) => {
    const a = (await asAdmin(request(app).get(`/manage/applications/${id}`)).expect(200)).body.data;
    return (await asAdmin(request(app).post(`/manage/applications/${id}/transition`)).field('version', a.__v).field('status', status).field('message', message).expect(expected)).body.data;
  };
  const customerView = async id => (await auth(request(app).get(`/c/applications/${id}`)).expect(200)).body.data;
  async function paidRequest() {
    await Service.updateOne({ _id: service._id }, { $set: { pricing: { mode: 'fixed', amount: 250, currency: 'INR' } } }); service = await Service.findById(service._id);
    const a = (await submit().expect(201)).body.data;
    expect(a).toMatchObject({ status: 'awaiting_payment', billing: { amountPaise: 25000, status: 'unpaid', version: 1 } });
    expect(notifyAllAdmins).not.toHaveBeenCalled();
    const checkout = (await auth(request(app).post(`/c/applications/${a._id}/payment`)).set('Idempotency-Key', crypto.randomUUID()).send({ feeVersion: 1, amountPaise: 25000, acceptTerms: true }).expect(200)).body.data;
    expect(checkout).toMatchObject({ amountPaise: 25000, verificationPath: '/api/customer-services/payments/verify' });
    captured(checkout);
    const signature = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET).update(`${checkout.razorpayOrderId}|pay_fixture`).digest('hex');
    await auth(request(app).post('/c/payments/verify')).send({ orderId: a._id, razorpay_order_id: checkout.razorpayOrderId, razorpay_payment_id: 'pay_fixture', razorpay_signature: signature }).expect(200);
    return a;
  }

  test('a fixed-price customer request is paid at submission, then the admin reviews, asks for information, works and completes it', async () => {
    const a = await paidRequest();
    expect(await customerView(a._id)).toMatchObject({ status: 'submitted', billing: { status: 'paid', amountPaise: 25000 } });
    expect(notifyAllAdmins.mock.calls.some(([opts]) => opts?.title === 'New paid service application')).toBe(true);
    const listed = (await asAdmin(request(app).get('/manage/applications?applicant=customer')).expect(200)).body.data.map(row => String(row._id));
    expect(listed).toEqual([String(a._id)]);
    expect((await asAdmin(request(app).get('/manage/applications')).expect(200)).body.data).toEqual([]);
    await manage(a._id, 'under_review');
    await manage(a._id, 'information_required', 'Please upload the signed form');
    expect(notifyUser.mock.calls.some(([id, opts]) => id === String(customer._id) && opts.route === `/legal-services/requests/${a._id}`)).toBe(true);
    const view = await customerView(a._id);
    await auth(request(app).post(`/c/applications/${a._id}/respond`)).field('version', view.version).field('message', 'Signed form attached').attach('files', pdf, { filename: 'signed.pdf', contentType: 'application/pdf' }).expect(200);
    expect((await customerView(a._id)).status).toBe('under_review');
    await manage(a._id, 'in_progress'); await manage(a._id, 'completed');
    expect((await customerView(a._id)).status).toBe('completed');
  });

  test('an unpaid customer request stays out of the admin queue and cannot be worked on; rejecting a paid one refunds the wallet', async () => {
    await Service.updateOne({ _id: service._id }, { $set: { pricing: { mode: 'fixed', amount: 250, currency: 'INR' } } }); service = await Service.findById(service._id);
    const unpaid = (await submit().expect(201)).body.data;
    expect((await asAdmin(request(app).get('/manage/applications?applicant=customer')).expect(200)).body.data).toEqual([]);
    await manage(unpaid._id, 'under_review', 'Too early', 409);
    const a = await paidRequest();
    const rejected = await manage(a._id, 'rejected', 'Outside our service area');
    expect(rejected).toMatchObject({ status: 'rejected', billing: { status: 'refunded', refundedToWallet: true } });
    expect((await User.findById(customer._id)).wallet.balance).toBe(250);
    expect(await customerView(a._id)).toMatchObject({ status: 'rejected', billing: { status: 'refunded', refundedToWallet: true } });
  });
});
