import mongoose from 'mongoose';
import Service from '../models/Service.js';
import Application, { APPLICATION_STATUSES } from '../models/ServiceApplication.js';
import { fail, text, validateDefinition, validateAnswers } from '../services/serviceForms.service.js';
import { SERVICE_ANSWER_BYTES } from '../shared/serviceLimits.mjs';
import { transition } from '../services/serviceWorkflow.service.js';
import { validateServiceFile, storeServiceFiles, removeServiceFiles, readServiceFile } from '../services/serviceStorage.service.js';
import { notifyAllAdmins, notifyUser } from '../services/notification.service.js';
const oid = id => { if (!mongoose.isObjectIdOrHexString(id)) fail('Invalid identifier'); return id; };
const send = (res, data, meta = {}) => res.json({ success: true, data, meta });
const admin = req => req.userType === 'admin';
const actor = req => ({ id: req.user._id, type: admin(req) ? 'admin' : 'vendor' });
function pagination(req) {
  const page = Number(req.query.page ?? 1), limit = Number(req.query.limit ?? 20);
  if (!Number.isSafeInteger(page) || page < 1 || page > 100000 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) fail('Invalid pagination');
  return { page, limit };
}
const parse = value => {
  if (typeof value !== 'string') fail('Application answers must be JSON text');
  if (Buffer.byteLength(value, 'utf8') > SERVICE_ANSWER_BYTES) fail('Application answers exceed the 256 KiB total limit. Please shorten your answers.', 413);
  try { return JSON.parse(value); } catch { fail('Malformed form data'); }
};
export async function cleanupUnreferenced(files) {
  // A lost database acknowledgement must never cause deletion of a committed
  // application's files. If the database is unavailable, retain for reconciliation.
  if (!files.length) return;
  try {
    const references = await Application.find({ 'files.fileId': { $in: files.map(f => f.fileId) } }).select('files.fileId').lean();
    const retained = new Set(references.flatMap(a => a.files.map(f => f.fileId)));
    await removeServiceFiles(files.filter(f => !retained.has(f.fileId)));
  } catch { console.warn('[SERVICES] File cleanup deferred; private storage requires reconciliation.'); }
}
const publicApplication = a => {
  const value = a.toObject ? a.toObject() : a;
  return { ...value, files: value.files.map(({ sha256, ...f }) => f) };
};
export async function listServices(req, res) {
  const { page, limit } = pagination(req);
  const query = admin(req) ? {} : { status: 'published', $or: [{ audiences: 'vendor' }, { audiences: { $exists: false } }] };
  const [items, total] = await Promise.all([Service.find(query).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit), Service.countDocuments(query)]);
  send(res, items, { total, page, limit });
}
export async function getService(req, res) {
  const service = await Service.findOne({ _id: oid(req.params.id), ...(admin(req) ? {} : { status: 'published', $or: [{ audiences: 'vendor' }, { audiences: { $exists: false } }] }) });
  if (!service) fail('Service not found', 404);
  send(res, service);
}
export async function saveService(req, res) {
  const definition = validateDefinition(req.body);
  let service;
  if (req.params.id) {
    service = await Service.findById(oid(req.params.id));
    if (!service) fail('Service not found', 404);
    if (req.body.version !== service.__v) fail('Service changed. Reload before saving.', 409);
    if (JSON.stringify(service.fields) !== JSON.stringify(definition.fields)) service.formVersion++;
    Object.assign(service, definition, { updatedBy: req.user._id });
    await service.save();
  } else service = await Service.create({ ...definition, createdBy: req.user._id, updatedBy: req.user._id });
  send(res.status(req.params.id ? 200 : 201), service);
}
export async function publishService(req, res) {
  const service = await Service.findById(oid(req.params.id));
  if (!service) fail('Service not found', 404);
  if (req.body.version !== service.__v) fail('Service changed. Reload before publishing.', 409);
  if (!['published', 'unpublished'].includes(req.body.status)) fail('Invalid publication status');
  validateDefinition(service.toObject());
  service.status = req.body.status;
  service.updatedBy = req.user._id;
  if (service.status === 'published') service.publishedAt = new Date();
  await service.save(); send(res, service);
}
async function ownedApplication(req) {
  const application = await Application.findOne({ _id: oid(req.params.id), applicantType: { $ne: 'customer' }, ...(admin(req) ? {} : { vendor: req.seller._id }) });
  if (!application) fail('Application not found', 404);
  return application;
}
export async function preflightApplicationUpload(req, _res, next) {
  const application = await ownedApplication(req);
  if (['completed', 'rejected'].includes(application.status)) fail('This application is closed and cannot accept uploads.', 409);
  if (!admin(req) && application.status !== 'information_required') fail('An information request is required before responding.', 403);
  next();
}
async function notify(application, isAdmin, action) {
  const opts = { event: 'SYSTEM', title: 'Service application update', message: `Application ${application._id}: ${action}`, metadata: { applicationId: String(application._id) }, route: isAdmin ? '/seller/services' : '/admin/services' };
  if (isAdmin) await notifyUser(application.user, opts);
  else await notifyAllAdmins(opts);
}
export async function createApplication(service, payload) {
  // The conditional write is the acceptance boundary. An unpublication or
  // definition edit that wins this write prevents acceptance of a stale form.
  // Replica sets additionally commit acceptance and application atomically.
  const work = async session => {
    const accepted = await Service.updateOne({ _id: service._id, status: 'published', __v: service.__v, $or: [{ audiences: 'vendor' }, { audiences: { $exists: false } }] }, { $inc: { submissionCount: 1 } }, { session, timestamps: false });
    if (!accepted.modifiedCount) fail('Service changed. Reload the form.', 409);
    const [application] = await Application.create([payload], { session });
    return application;
  };
  const session = await mongoose.startSession();
  try {
    let application;
    await session.withTransaction(async () => { application = await work(session); });
    return application;
  } catch (error) {
    if (!/Transaction numbers are only allowed|transactions are not supported|does not support retryable writes/i.test(error.message || '')) throw error;
    return work(null);
  } finally { await session.endSession(); }
}
export async function submitApplication(req, res) {
  const submissionKey = text(req.headers['idempotency-key'] ?? '', 'Submission key', 100, true);
  if (!/^[a-zA-Z0-9-]{16,100}$/.test(submissionKey)) fail('Invalid submission key');
  const existing = await Application.findOne({ vendor: req.seller._id, submissionKey });
  if (existing) { if (String(existing.service) !== req.params.id) fail('Submission key already used', 409); return send(res, publicApplication(existing)); }
  const service = await Service.findOne({ _id: oid(req.params.id), status: 'published', $or: [{ audiences: 'vendor' }, { audiences: { $exists: false } }] });
  if (!service) fail('Service not available', 404);
  if (Number(req.body.formVersion) !== service.formVersion || Number(req.body.serviceVersion) !== service.__v) fail('Service has changed. Reload the form and review the current price.', 409);
  const files = req.files || [];
  const metadata = files.map(validateServiceFile);
  const answers = validateAnswers(service.fields, parse(req.body.answers), metadata);
  let stored = [];
  let application;
  try {
    if (files.length) stored = await storeServiceFiles(files, 'document');
    if (req.aborted || res.destroyed) fail('Service upload interrupted. Please retry.', 400);
    application = await createApplication(service, { service: service._id, vendor: req.seller._id, user: req.user._id, submissionKey,
      snapshot: { name: service.name, instructions: service.instructions, formVersion: service.formVersion, fields: service.fields, pricing: service.pricing.toObject() }, answers, files: stored,
      events: [{ action: 'submitted', status: 'submitted', actor: req.user._id, actorType: 'vendor' }],
    });
  } catch (error) {
    await cleanupUnreferenced(stored);
    if (error.code === 11000) {
      const prior = await Application.findOne({ vendor: req.seller._id, submissionKey });
      if (prior && String(prior.service) === req.params.id) return send(res, publicApplication(prior));
    }
    throw error;
  }
  await notify(application, false, 'submitted'); send(res.status(201), publicApplication(application));
}
export async function listApplications(req, res) {
  const { page, limit } = pagination(req);
  const query = { applicantType: { $ne: 'customer' }, ...(admin(req) ? {} : { vendor: req.seller._id }) };
  if (req.query.status) { if (!APPLICATION_STATUSES.includes(req.query.status)) fail('Invalid status'); query.status = req.query.status; }
  if (req.query.service) query.service = oid(req.query.service);
  for (const key of ['from', 'to']) if (req.query[key] && (!/^\d{4}-\d{2}-\d{2}$/.test(req.query[key]) || !Number.isFinite(Date.parse(req.query[key])))) fail('Invalid date filter');
  if (req.query.from || req.query.to) query.createdAt = { ...(req.query.from ? { $gte: new Date(req.query.from) } : {}), ...(req.query.to ? { $lt: new Date(Date.parse(req.query.to) + 86400000) } : {}) };
  const [items, total] = await Promise.all([Application.find(query).select('snapshot.name snapshot.pricing status createdAt vendor service').sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit), Application.countDocuments(query)]);
  send(res, items, { total, page, limit });
}
export async function getApplication(req, res) { send(res, publicApplication(await ownedApplication(req))); }
export async function actOnApplication(req, res) {
  const application = await ownedApplication(req);
  if (Number(req.body.version) !== application.__v) fail('Application changed. Reload before continuing.', 409);
  const isAdmin = admin(req);
  const target = isAdmin ? req.body.status : 'under_review';
  const files = req.files || [];
  let message = req.body.message ?? '';
  if (!isAdmin && files.length && typeof message === 'string' && !message.trim()) message = 'Additional documents submitted';
  transition(application, target, actor(req), message);
  if (files.length && isAdmin && target !== 'completed') fail('Deliverables can only be added when completing an application');
  if (files.some(f => f.fieldname !== 'files')) fail('Invalid upload field');
  let stored = [];
  try {
    if (files.length) stored = await storeServiceFiles(files, isAdmin ? 'deliverable' : 'response');
    if (req.aborted || res.destroyed) fail('Service upload interrupted. Please retry.', 400);
    if (application.files.length + stored.length > 100) fail('Application document limit reached');
    application.files.push(...stored);
    if (stored.length) application.events.push({ action: isAdmin ? 'deliverables_added' : 'response_documents_added', actor: req.user._id, actorType: actor(req).type });
    await application.save();
  } catch (error) { await cleanupUnreferenced(stored); if (error.name === 'VersionError') fail('Application changed. Reload before continuing.', 409); throw error; }
  await notify(application, isAdmin, target); send(res, publicApplication(application));
}
export async function downloadFile(req, res) {
  const application = await ownedApplication(req);
  const file = application.files.find(f => f.fileId === req.params.fileId);
  if (!file) fail('Document not found', 404);
  const buffer = await readServiceFile(file);
  res.set({ 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "sandbox; default-src 'none'", 'Content-Type': { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg' }[file.format], 'Content-Disposition': `attachment; filename="${file.name}"` });
  res.send(buffer);
}
