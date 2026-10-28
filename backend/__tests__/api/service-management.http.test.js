import { jest } from '@jest/globals';
import express from 'express';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import request from 'supertest';
import { MongoMemoryServer, MongoMemoryReplSet } from 'mongodb-memory-server';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import { SERVICE_ANSWER_BYTES, SERVICE_MULTIPART_FIELD_BYTES, SERVICE_REQUEST_BYTES, serializedAnswerBytes } from '../../../shared/serviceLimits.mjs';
import { transition, TRANSITIONS } from '../../services/serviceWorkflow.service.js';

const id = () => new mongoose.Types.ObjectId();
const users = { vendor: { _id: id(), roles: ['seller'], isActive: true }, other: { _id: id(), roles: ['seller'], isActive: true }, buyer: { _id: id(), roles: ['buyer'], isActive: true }, pending: { _id: id(), roles: ['seller'], isActive: true } };
const admins = { admin: { _id: id(), role: 'superAdmin', isActive: true }, limited: { _id: id(), role: 'moderator', permissions: [], isActive: true }, permitted: { _id: id(), role: 'admin', permissions: ['manage_services'], isActive: true } };
const sellers = Object.fromEntries(Object.entries(users).filter(([k]) => k !== 'buyer').map(([k, u]) => [String(u._id), { _id: id(), userId: u._id, status: k === 'pending' ? 'pending' : 'approved' }]));
jest.unstable_mockModule('../../models/User.js', () => ({ default: { findById: x => ({ select: async () => Object.values(users).find(u => String(u._id) === String(x)) }) } }));
jest.unstable_mockModule('../../models/Admin.js', () => ({ default: { findById: x => ({ select: async () => Object.values(admins).find(u => String(u._id) === String(x)) }) } }));
jest.unstable_mockModule('../../models/Seller.js', () => ({ default: { findOne: async q => sellers[String(q.userId)] } }));
const notifyUser = jest.fn(), notifyAllAdmins = jest.fn();
jest.unstable_mockModule('../../services/notification.service.js', () => ({ notifyUser, notifySeller: notifyUser, notifyAllAdmins }));
const [{ serviceRouter }, { errorHandler }, { JWT_SECRET }, { default: Service }, { default: Application }, { validateDefinition, validateAnswers }, { validateServiceFile, storageRoot }] = await Promise.all([
  import('../../routes/serviceManagement.routes.js'), import('../../middlewares/error.middleware.js'), import('../../config/jwt.js'), import('../../models/Service.js'), import('../../models/ServiceApplication.js'), import('../../services/serviceForms.service.js'), import('../../services/serviceStorage.service.js'),
]);
const app = express(); app.use(express.json()); app.use('/admin', serviceRouter(true)); app.use('/vendor', serviceRouter()); app.use(errorHandler);
const { serviceUploadControls, createServiceUploadControls } = await import('../../middlewares/serviceUpload.middleware.js');
const auth = (req, who = 'vendor') => req.set('Authorization', `Bearer ${jwt.sign({ id: String((users[who] || admins[who])._id), ...(admins[who] ? { type: 'admin' } : {}) }, JWT_SECRET)}`);
const pdf = Buffer.from('%PDF-1.7\nservice document fixture\n%%EOF');
const definition = () => ({ name: 'Registration support', slug: 'registration', description: 'Admin-managed registration', instructions: 'Upload proof', pricing: { mode: 'fixed', amount: 125.50, currency: 'INR' }, fields: [{ id: 'name', type: 'text', label: 'Business name', required: true, minLength: 2 }, { id: 'proof', type: 'file', label: 'Proof', required: true, formats: ['pdf'], maxBytes: 1024 }] });
let db, storage;
beforeAll(async () => {
  db = process.env.SERVICE_TEST_REPLICA === '1' ? await MongoMemoryReplSet.create({ replSet: { count: 1 } }) : await MongoMemoryServer.create(); await mongoose.connect(db.getUri());
  await Promise.all([Service.init(), Application.init()]);
  storage = await mkdtemp(path.join(os.tmpdir(), 'bulkimart-services-')); process.env.SERVICE_STORAGE_DIR = storage;
});
afterAll(async () => { await mongoose.disconnect(); if (db) await db.stop(); if (storage) await rm(storage, { recursive: true, force: true }); delete process.env.SERVICE_STORAGE_DIR; });
beforeEach(async () => { await Promise.all([Service.deleteMany({}), Application.deleteMany({})]); jest.clearAllMocks(); for (const u of Object.values(users)) serviceUploadControls.limiter.resetKey(`user:${u._id}`); for (const a of Object.values(admins)) serviceUploadControls.limiter.resetKey(`admin:${a._id}`); });
async function published(overrides = {}) {
  const created = await auth(request(app).post('/admin'), 'admin').send({ ...definition(), ...overrides }).expect(201);
  return (await auth(request(app).post(`/admin/${created.body.data._id}/publication`), 'admin').send({ status: 'published', version: 0 }).expect(200)).body.data;
}
function submit(service, who = 'vendor', key = randomUUID(), answers = { name: 'My shop' }, buffer = pdf) {
  return auth(request(app).post(`/vendor/${service._id}/applications`), who).set('Idempotency-Key', key).field('answers', JSON.stringify(answers)).field('formVersion', service.formVersion).field('serviceVersion', service.__v).attach('proof', buffer, { filename: 'proof.pdf', contentType: 'application/pdf' });
}
async function action(a, status, message = '') { return (await auth(request(app).post(`/admin/applications/${a._id}/transition`), 'admin').field('status', status).field('message', message).field('version', a.__v).expect(200)).body.data; }

test('admin permissions and approved seller gate apply to all entry points', async () => {
  await request(app).post('/admin').send(definition()).expect(401);
  await auth(request(app).post('/admin')).send(definition()).expect(403);
  await auth(request(app).post('/admin'), 'limited').send(definition()).expect(403);
  await auth(request(app).post('/admin'), 'permitted').send(definition()).expect(201);
  await auth(request(app).get('/vendor'), 'buyer').expect(403);
  await auth(request(app).get('/vendor'), 'pending').expect(403);
  await auth(request(app).get('/vendor'), 'admin').expect(403);
});
test('drafts are hidden and reject applications; identifiers and pricing are validated', async () => {
  const response = await auth(request(app).post('/admin'), 'admin').send(definition()).expect(201);
  expect((await auth(request(app).get('/vendor')).expect(200)).body.data).toHaveLength(0);
  await submit(response.body.data).expect(404);
  await auth(request(app).post('/admin'), 'admin').send(definition()).expect(409);
  await auth(request(app).post('/admin'), 'admin').send({ ...definition(), pricing: { mode: 'fixed', amount: -1, currency: 'INR' } }).expect(400);
});
test('independent repeat applications and concurrent retry deduplication', async () => {
  const service = await published();
  const key = randomUUID();
  const responses = await Promise.all([submit(service, 'vendor', key), submit(service, 'vendor', key)]);
  expect(responses.every(r => [200, 201].includes(r.status))).toBe(true);
  expect(responses[0].body.data._id).toBe(responses[1].body.data._id);
  const repeat = await submit(service).expect(201);
  expect(repeat.body.data._id).not.toBe(responses[0].body.data._id);
  expect(await Application.countDocuments()).toBe(2);
  const files = await readdir(storage);
  // Earlier tests do not upload valid documents; no losing concurrent files remain.
  expect(files.length).toBe(2);
});
test('private documents require authentication and exact ownership', async () => {
  const a = (await submit(await published()).expect(201)).body.data;
  const url = `/vendor/applications/${a._id}/files/${a.files[0].fileId}`;
  expect(JSON.stringify(a)).not.toMatch(/sha256|private-data|https?:\/\//);
  await request(app).get(url).expect(401);
  await auth(request(app).get(url), 'other').expect(404);
  await auth(request(app).get(`/vendor/applications/${a._id}`), 'other').expect(404);
  await auth(request(app).post(`/vendor/applications/${a._id}/respond`), 'other').field('version', 0).field('message', 'attack').expect(404);
  const response = await auth(request(app).get(url)).expect(200);
  expect(response.headers['cache-control']).toBe('private, no-store'); expect(response.body).toEqual(pdf);
  await auth(request(app).get(`/admin/applications/${a._id}/files/${a.files[0].fileId}`), 'limited').expect(403);
  await auth(request(app).get(`/admin/applications/${a._id}/files/${a.files[0].fileId}`), 'admin').expect(200);
});
test('schema and price snapshots survive edits and unpublication', async () => {
  const s = await published(); const a = (await submit(s).expect(201)).body.data;
  const changed = { ...definition(), version: s.__v, pricing: { mode: 'free', amount: 0, currency: 'INR' }, fields: [] };
  const edit = (await auth(request(app).put(`/admin/${s._id}`), 'admin').send(changed).expect(200)).body.data;
  expect(edit.formVersion).toBe(2);
  await submit(s).expect(409);
  await auth(request(app).post(`/admin/${s._id}/publication`), 'admin').send({ status: 'unpublished', version: edit.__v }).expect(200);
  await submit({ ...edit }).expect(404);
  const saved = (await auth(request(app).get(`/vendor/applications/${a._id}`)).expect(200)).body.data;
  expect(saved.snapshot.pricing.amount).toBe(125.50); expect(saved.snapshot.fields).toHaveLength(2); expect(saved.events).toHaveLength(1);
});
test('full review, information response, processing and deliverable completion lifecycle', async () => {
  let a = (await submit(await published({ pricing: { mode: 'free', amount: 0, currency: 'INR' } })).expect(201)).body.data;
  a = await action(a, 'under_review');
  a = await action(a, 'information_required', 'Please provide the updated certificate');
  a = (await auth(request(app).post(`/vendor/applications/${a._id}/respond`)).field('version', a.__v).field('message', 'Updated certificate attached').attach('files', pdf, 'certificate.pdf').expect(200)).body.data;
  expect(a.status).toBe('under_review'); expect(a.files).toHaveLength(2);
  a = await action(a, 'in_progress');
  a = (await auth(request(app).post(`/admin/applications/${a._id}/transition`), 'admin').field('version', a.__v).field('status', 'completed').attach('files', pdf, 'result.pdf').expect(200)).body.data;
  expect(a.status).toBe('completed'); expect(a.completedAt).toBeTruthy(); expect(a.files[2].kind).toBe('deliverable');
  await auth(request(app).get(`/vendor/applications/${a._id}/files/${a.files[2].fileId}`)).expect(200);
  expect(a.events.map(e => e.action)).toEqual(['submitted', 'under_review', 'information_required', 'vendor_response', 'response_documents_added', 'in_progress', 'completed', 'deliverables_added']);
  expect(notifyUser).toHaveBeenCalled(); expect(notifyAllAdmins).toHaveBeenCalled();
  await auth(request(app).post(`/admin/applications/${a._id}/transition`), 'admin').field('version', a.__v).field('status', 'under_review').expect(409);
});
test('invalid transitions, empty reasons, early vendor responses and stale updates fail without events', async () => {
  const a = (await submit(await published()).expect(201)).body.data;
  for (const status of ['completed', 'arbitrary']) await auth(request(app).post(`/admin/applications/${a._id}/transition`), 'admin').field('version', 0).field('status', status).expect(409);
  await auth(request(app).post(`/admin/applications/${a._id}/transition`), 'admin').field('version', 0).field('status', 'rejected').expect(400);
  await auth(request(app).post(`/vendor/applications/${a._id}/respond`)).field('version', 0).field('message', 'premature').expect(403);
  expect((await Application.findById(a._id)).events).toHaveLength(1);
  const rejected = await action(a, 'rejected', 'Documents do not meet requirements'); expect(rejected.rejectionReason).toBeTruthy();
  await auth(request(app).post(`/admin/applications/${a._id}/transition`), 'admin').field('version', 0).field('status', 'under_review').expect(409);
});
test('invalid answers, forged files and oversized uploads are rejected without applications', async () => {
  const service = await published();
  const invalid = await submit(service, 'vendor', randomUUID(), { name: '' }).expect(400); expect(invalid.body.meta.fields.name).toBeTruthy();
  await submit(service, 'vendor', randomUUID(), { name: 'Test', injected: 'x' }).expect(400);
  await submit(service, 'vendor', randomUUID(), { name: 'Test' }, Buffer.from('executable')).expect(400);
  await submit(service, 'vendor', randomUUID(), { name: 'Test' }, Buffer.alloc(5 * 1024 * 1024 + 1)).expect(413);
  expect(await Application.countDocuments()).toBe(0);
});
test('pagination, dates and IDs validate without exposing other vendor records', async () => {
  await submit(await published()).expect(201);
  expect((await auth(request(app).get('/vendor/applications'), 'other').expect(200)).body.meta.total).toBe(0);
  await auth(request(app).get('/vendor/applications?page=-1')).expect(400);
  await auth(request(app).get('/vendor/applications?status=bogus')).expect(400);
  await auth(request(app).get('/vendor/applications?from=invalid')).expect(400);
  await auth(request(app).get('/vendor/applications/not-an-id')).expect(400);
});
test('concurrent status actions commit a single transition and reject the losing edit', async () => {
  const a = (await submit(await published()).expect(201)).body.data;
  const responses = await Promise.all(['under_review', 'rejected'].map(status => auth(request(app).post(`/admin/applications/${a._id}/transition`), 'admin').field('version', a.__v).field('status', status).field('message', 'Review decision')));
  expect(responses.map(r => r.status).sort()).toEqual([200, 409]);
  expect((await Application.findById(a._id)).events).toHaveLength(2);
  expect(notifyUser).toHaveBeenCalledTimes(1);
});
test('file-only responses work and malformed response files cannot change status or history', async () => {
  let a = (await submit(await published()).expect(201)).body.data;
  a = await action(a, 'under_review'); a = await action(a, 'information_required', 'Please provide proof');
  const before = (await readdir(storage)).length;
  await auth(request(app).post(`/vendor/applications/${a._id}/respond`)).field('version', a.__v).attach('files', Buffer.from('invalid'), 'proof.pdf').expect(400);
  expect((await readdir(storage)).length).toBe(before);
  expect((await Application.findById(a._id)).status).toBe('information_required');
  const response = await auth(request(app).post(`/vendor/applications/${a._id}/respond`)).field('version', a.__v).attach('files', pdf, 'proof.pdf').expect(200);
  expect(response.body.data.status).toBe('under_review');
});
test('missing required files and file requirements are validated independently', async () => {
  const s = await published();
  const missing = await auth(request(app).post(`/vendor/${s._id}/applications`)).set('Idempotency-Key', randomUUID()).field('answers', JSON.stringify({ name: 'Shop' })).field('formVersion', s.formVersion).field('serviceVersion', s.__v).expect(400);
  expect(missing.body.meta.fields.proof).toBeTruthy();
  const hugeForField = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(2048), Buffer.from('%%EOF')]);
  const response = await submit(s, 'vendor', randomUUID(), { name: 'Shop' }, hugeForField).expect(400);
  expect(response.body.meta.fields.proof).toBeTruthy();
  expect(await Application.countDocuments()).toBe(0);
});
test.each([
  d => { d.fields.push(d.fields[0]); }, d => { d.fields[0].type = 'script'; }, d => { d.fields[0].id = '__proto__'; },
  d => { d.fields[0] = { ...d.fields[0], type: 'select', options: ['same', 'same'] }; }, d => { d.fields[1].formats = ['exe']; },
  d => { d.fields[0].minLength = -1; }, d => { d.fields[1].maxBytes = 0; }, d => { d.pricing.currency = 'XYZ'; },
])('rejects malformed dynamic schema %#', mutate => { const d = definition(); mutate(d); expect(() => validateDefinition(d)).toThrow(); });
test('all dynamic field types enforce server-side validation', () => {
  const fields = validateDefinition({ ...definition(), fields: [
    { id: 'email', label: 'Email', type: 'email', required: true }, { id: 'phone', label: 'Phone', type: 'phone', required: true },
    { id: 'date', label: 'Date', type: 'date', required: true }, { id: 'n', label: 'Number', type: 'number', required: true, min: 1, max: 10 },
    { id: 'choice', label: 'Choice', type: 'radio', options: ['A', 'B'], required: true }, { id: 'consent', label: 'Consent', type: 'checkbox', required: true },
  ] }).fields;
  expect(() => validateAnswers(fields, { email: 'bad', phone: 'bad', date: '2026-02-30', n: 11, choice: 'C', consent: false })).toThrow();
  expect(validateAnswers(fields, { email: 'a@b.test', phone: '+919876543210', date: '2026-10-14', n: 5, choice: 'A', consent: true })).toBeTruthy();
});
test('storage fails closed in production and rejects public directories', async () => {
  const old = process.env.NODE_ENV; delete process.env.SERVICE_STORAGE_DIR; process.env.NODE_ENV = 'production';
  try { await expect(storageRoot()).rejects.toThrow('not configured'); process.env.SERVICE_STORAGE_DIR = path.resolve('../forntend/public/services'); await expect(storageRoot()).rejects.toThrow('outside public'); }
  finally { process.env.NODE_ENV = old; process.env.SERVICE_STORAGE_DIR = storage; }
  expect(() => validateServiceFile({ originalname: 'attack.exe', mimetype: 'application/pdf', buffer: pdf })).toThrow();
});

async function formService(count) {
  const body = { ...definition(), fields: Array.from({ length: count }, (_, i) => ({ id: `answer_${i}`, label: `Answer ${i}`, type: 'textarea', required: true, maxLength: 10000 })) };
  const s = (await auth(request(app).post('/admin'), 'admin').send(body).expect(201)).body.data;
  return (await auth(request(app).post(`/admin/${s._id}/publication`), 'admin').send({ status: 'published', version: 0 }).expect(200)).body.data;
}
const answerRequest = (s, raw) => auth(request(app).post(`/vendor/${s._id}/applications`)).set('Idempotency-Key', randomUUID()).field('answers', raw).field('formVersion', s.formVersion).field('serviceVersion', s.__v);

test('twenty valid 10000-character answers reach application validation and submit', async () => {
  const s = await formService(20);
  const answers = Object.fromEntries(s.fields.map(f => [f.id, 'x'.repeat(10000)]));
  expect(serializedAnswerBytes(answers)).toBe(200291);
  await answerRequest(s, JSON.stringify(answers)).expect(201);
});
test('serialized UTF-8 aggregate limits include JSON overhead and reject over-limit answers predictably', async () => {
  const s = await formService(27);
  const answers = Object.fromEntries(s.fields.map((f, i) => [f.id, i < 26 ? 'x'.repeat(10000) : '']));
  const padding = SERVICE_ANSWER_BYTES - 1 - serializedAnswerBytes(answers);
  answers.answer_26 = 'x'.repeat(padding);
  expect(serializedAnswerBytes(answers)).toBe(SERVICE_ANSWER_BYTES - 1);
  await answerRequest(s, JSON.stringify(answers)).expect(201);
  answers.answer_26 += 'xx';
  const failure = await answerRequest(s, JSON.stringify(answers)).expect(413);
  expect(failure.body.message).toContain('256 KiB');
  expect(() => validateAnswers(s.fields, answers)).toThrow('256 KiB');
});
test('individual text limits and Unicode multiline answers agree with the transport', async () => {
  const s = await formService(1);
  await answerRequest(s, JSON.stringify({ answer_0: 'x'.repeat(10000) })).expect(201);
  await answerRequest(s, JSON.stringify({ answer_0: 'x'.repeat(10001) })).expect(400);
  const unicode = 'नमस्ते\n世界\n'.repeat(500);
  expect(Buffer.byteLength(unicode)).toBeGreaterThan(unicode.length);
  await answerRequest(s, JSON.stringify({ answer_0: unicode })).expect(201);
});
test('malformed JSON and oversized multipart fields have safe errors and no stored application', async () => {
  const s = await formService(1);
  await answerRequest(s, '{malformed').expect(400);
  const response = await answerRequest(s, 'x'.repeat(SERVICE_MULTIPART_FIELD_BYTES + 1)).expect(413);
  expect(response.body).toMatchObject({ success: false, data: null });
  expect(response.body.message).toContain('limits');
  expect(await Application.countDocuments()).toBe(0);
  await auth(request(app).post(`/vendor/${s._id}/applications`)).set('Content-Type', 'multipart/form-data').send('missing boundary').expect(400);
});
test('response authorization and terminal checks reject malformed uploads before parsing', async () => {
  const a = (await submit(await published()).expect(201)).body.data;
  const before = await readdir(storage);
  const malformed = req => req.set('Content-Type', 'multipart/form-data; boundary=broken').send('not multipart');
  await malformed(request(app).post(`/vendor/applications/${a._id}/respond`)).expect(401);
  await malformed(auth(request(app).post(`/vendor/applications/${a._id}/respond`), 'pending')).expect(403);
  await malformed(auth(request(app).post(`/vendor/applications/${a._id}/respond`), 'other')).expect(404);
  for (const status of ['completed', 'rejected']) {
    await Application.updateOne({ _id: a._id }, { $set: { status } });
    await malformed(auth(request(app).post(`/vendor/applications/${a._id}/respond`))).expect(409);
    await malformed(auth(request(app).post(`/admin/applications/${a._id}/transition`), 'admin')).expect(409);
  }
  expect(await readdir(storage)).toEqual(before);
});
test('file count and multipart part limits reject uploads without persisting files', async () => {
  const s = await published(), before = await readdir(storage);
  let req = auth(request(app).post(`/vendor/${s._id}/applications`)).set('Idempotency-Key', randomUUID());
  for (let i = 0; i < 11; i++) req = req.attach(`file_${i}`, pdf, 'proof.pdf');
  await req.expect(413);
  expect(await readdir(storage)).toEqual(before); expect(await Application.countDocuments()).toBe(0);
});
test('account rate limits apply before parsing, are independent between accounts, and preserve authentication', async () => {
  const uploads = createServiceUploadControls({ maxRequests: 2 });
  const local = express(); local.use('/vendor', serviceRouter(false, uploads)); local.use(errorHandler);
  const attempt = who => auth(request(local).post('/vendor/not-an-id/applications'), who).field('answers', '{}').set('Idempotency-Key', randomUUID());
  await attempt('vendor').expect(400); await attempt('vendor').expect(400);
  await attempt('vendor').expect(429); await attempt('other').expect(400);
  await request(local).post('/vendor/not-an-id/applications').expect(401);
});
test('global and account concurrency budgets release slots and buffers after success and failure', async () => {
  const uploads = createServiceUploadControls({ maxPerAccount: 1, maxActive: 2 });
  const local = express(); let release; const hold = new Promise(resolve => { release = resolve; });
  const entered = [], captured = [];
  local.post('/', (req, _res, next) => { req.user = { _id: req.headers['x-account'] }; req.userType = 'user'; next(); }, uploads.handle(async (req, res) => { entered.push(req.user._id); captured.push(req.files[0]); await hold; res.sendStatus(200); })); local.use(errorHandler);
  const send = account => request(local).post('/').set('x-account', account).attach('files', pdf, 'proof.pdf');
  const first = send('one').then(r => r);
  while (entered.length < 1) await new Promise(resolve => setTimeout(resolve, 5));
  try {
    await send('one').expect(429);
    const second = send('two').then(r => r);
    while (entered.length < 2) await new Promise(resolve => setTimeout(resolve, 5));
    await send('three').expect(429); release();
    expect((await first).status).toBe(200); expect((await second).status).toBe(200);
    expect(captured.every(file => file.buffer === undefined)).toBe(true);
    await send('three').expect(200);
    await request(local).post('/').set('x-account', 'three').set('Content-Type', 'multipart/form-data; boundary=bad').send('invalid').expect(400);
    await send('three').expect(200);
  } finally { release(); await first; }
});
test('aggregate cap rejects declared and chunked bodies and recovers upload capacity', async () => {
  expect(SERVICE_REQUEST_BYTES).toBe(10 * 5 * 1024 * 1024 + SERVICE_ANSWER_BYTES + 64 * 1024);
  const uploads = createServiceUploadControls({ maxRequestBytes: 1024, maxPerAccount: 1 });
  const local = express(); local.post('/', (req, _res, next) => { req.user = { _id: 'fixture' }; req.userType = 'user'; next(); }, uploads.handle(async (_req, res) => res.sendStatus(200))); local.use(errorHandler);
  await request(local).post('/').field('answers', 'x'.repeat(2000)).expect(413);
  const server = local.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const status = await new Promise((resolve, reject) => {
      const req = http.request({ hostname: '127.0.0.1', port: server.address().port, method: 'POST', headers: { 'Content-Type': 'multipart/form-data; boundary=fixture', 'Transfer-Encoding': 'chunked' } }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
      req.on('error', reject); req.end(`--fixture\r\nContent-Disposition: form-data; name="answers"\r\n\r\n${'x'.repeat(2000)}\r\n--fixture--\r\n`);
    });
    expect(status).toBe(413);
    await request(local).post('/').field('answers', '{}').expect(200);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
test('all role/state/target combinations preserve the centralized lifecycle with a verified fee', () => {
  const states = Object.keys(TRANSITIONS); let allowed = 0, denied = 0;
  for (const type of ['admin', 'vendor']) for (const from of states) for (const target of states) {
    const a = { status: from, events: [], snapshot: { pricing: { mode: 'fixed', amount: 100, currency: 'INR' } }, billing: { status: 'paid' } }, before = structuredClone(a), permitted = TRANSITIONS[from].includes(target) && (type === 'admin' || (from === 'information_required' && target === 'under_review'));
    if (permitted) { transition(a, target, { type, id: id() }, 'Fixture message'); expect(a.events).toHaveLength(1); allowed++; }
    else { expect(() => transition(a, target, { type, id: id() }, 'Fixture message')).toThrow(); expect(a).toEqual(before); denied++; }
  }
  expect([allowed, denied]).toEqual([15, 113]);
});
test('disconnects and upload timeouts release capacity without invoking the controller', async () => {
  const uploads = createServiceUploadControls({ maxPerAccount: 1, timeoutMs: 50 });
  let processed = 0;
  const local = express(); local.post('/', (req, _res, next) => { req.user = { _id: 'fixture' }; req.userType = 'user'; next(); }, uploads.handle(async (_req, res) => { processed++; res.sendStatus(200); })); local.use(errorHandler);
  const server = local.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const options = () => ({ hostname: '127.0.0.1', port: server.address().port, method: 'POST', headers: { 'Content-Type': 'multipart/form-data; boundary=fixture', 'Transfer-Encoding': 'chunked' } });
  const partial = '--fixture\r\nContent-Disposition: form-data; name="files"; filename="proof.pdf"\r\nContent-Type: application/pdf\r\n\r\n%PDF-';
  try {
    await new Promise(resolve => { const req = http.request(options()); req.on('error', () => {}); req.on('close', resolve); req.write(partial); setTimeout(() => req.destroy(), 15); });
    await new Promise(resolve => setTimeout(resolve, 30));
    await request(local).post('/').field('answers', '{}').expect(200);
    const status = await new Promise((resolve, reject) => { const req = http.request(options(), res => { res.resume(); res.on('end', () => { resolve(res.statusCode); req.destroy(); }); }); req.on('error', reject); req.write(partial); });
    expect(status).toBe(400); expect(processed).toBe(1);
    await request(local).post('/').field('answers', '{}').expect(200);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
