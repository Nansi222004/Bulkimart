import crypto from 'node:crypto';
import Application from '../models/ServiceApplication.js';
import Service from '../models/Service.js';
import Provider from '../models/LegalProvider.js';
import User from '../models/User.js';
import Commission from '../models/Commission.js';
import Payment from '../models/Payment.js';
import { fail, text, validateAnswers } from '../services/serviceForms.service.js';
import { storeServiceFiles, validateServiceFile, readServiceFile } from '../services/serviceStorage.service.js';
import { cleanupUnreferenced } from './serviceManagement.controller.js';
import { financialTransaction } from '../services/financeSafety.service.js';
import { legalFlags, requireLegalFlag, requireLegalGateway, validateLegalPolicy, currentQuote, quotePayable } from '../services/legalPolicy.service.js';
import { mutateLegal, adminAction, approvedProvider, oid, event, notifyLegal, submissionHash, legalReconciliation } from '../services/legalWorkflow.service.js';
import { initiateLegalPayment, verifyLegalPayment, approveLegalRefund, executeLegalRefund } from '../services/legalPayment.service.js';
import { SERVICE_ANSWER_BYTES } from '../shared/serviceLimits.mjs';
import { reconcileCreationAttempt } from '../services/paymentRecovery.service.js';

export const send = (res, data, meta = {}) => res.json({ success: true, data, meta });
const visibility = { status: 'published', audiences: 'customer' };
const publicService = s => ({ _id: s._id, name: s.name, slug: s.slug, description: s.description, instructions: s.instructions,
  legalCategory: s.legalCategory || '', fields: s.fields, formVersion: s.formVersion, version: s.__v,
  startingPrice: s.pricing?.mode === 'fixed' ? { amount: s.pricing.amount, currency: s.pricing.currency } : null });
const quoteDTO = q => q ? { version: q.version, scope: q.scope, currency: q.currency, servicePaise: q.servicePaise, serviceTaxPaise: q.serviceTaxPaise, totalPaise: q.totalPaise, terms: q.policy.terms, confirmedAt: q.confirmedAt, expiresAt: q.expiresAt } : null;
export function requestDTO(a, mode = 'customer') {
  const l = a.legal || {}, q = currentQuote(a), provider = mode === 'provider';
  const files = a.files.filter(f => !provider || f.providerVisible).map(f => ({ fileId: f.fileId, name: f.name, format: f.format, sizeBytes: f.sizeBytes, kind: f.kind, uploadedAt: f.uploadedAt }));
  return { _id: a._id, version: a.__v, serviceName: a.snapshot.name, createdAt: a.createdAt, status: a.status,
    answers: provider ? Object.fromEntries(Object.entries(a.answers).filter(([id]) => l.sharedAnswerIds?.includes(id))) : a.answers,
    fields: a.snapshot.fields.filter(f => !provider || l.sharedAnswerIds?.includes(f.id)), files,
    informationRequest: provider ? undefined : a.informationRequest, rejectionReason: provider ? undefined : a.rejectionReason,
    events: a.events.filter(e => provider ? ['provider_assigned', 'work_authorized', 'progress', 'provider_information_request', 'admin_provider_message', 'acknowledged', 'completion_submitted', 'completion_verified'].includes(e.action) : !['admin_provider_message', 'provider_information_request'].includes(e.action)).map(e => ({ action: e.action, status: e.status, message: ['information_required', 'customer_response', 'progress', 'completion_submitted', 'completion_verified', 'rejected', 'cancelled', ...(provider ? ['admin_provider_message', 'provider_information_request'] : [])].includes(e.action) ? e.message : undefined, at: e.at })),
    quotation: quoteDTO(q), paymentStatus: provider ? undefined : l.paymentStatus || 'not_requested',
    receipt: provider || !l.captureId ? null : { transactionReference: l.captureId, capturedPaise: l.capturedPaise, currency: 'INR' },
    canPay: !provider && quotePayable(a) && legalFlags().payments,
    cancellation: provider ? undefined : Boolean(l.cancellation), refundedPaise: provider ? undefined : l.refundedPaise || 0,
    refunds: provider ? undefined : (l.refunds || []).map(r => ({ key: r.key, amountPaise: r.amountPaise, status: r.status })),
    financialHold: Boolean(l.hold), settlementStatus: provider ? l.payout?.status || l.payableBucket || 'not_eligible' : undefined };
}
const page = req => {
  const page = Number(req.query.page || 1), limit = Number(req.query.limit || 20);
  if (!Number.isSafeInteger(page) || page < 1 || page > 100000 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) fail('Invalid pagination');
  return { page, limit };
};
export const capabilities = (_req, res) => send(res, { catalogue: legalFlags().catalogue, submissions: legalFlags().submissions });
export async function catalogue(req, res) {
  requireLegalFlag('catalogue'); const { page: p, limit } = page(req), match = { ...visibility };
  if (req.query.q) { const q = text(req.query.q, 'Search', 100).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); match.$or = [{ name: { $regex: q, $options: 'i' } }, { description: { $regex: q, $options: 'i' } }]; }
  if (req.query.category) match.legalCategory = text(req.query.category, 'Category', 100);
  const [items, total] = await Promise.all([Service.find(match).sort({ createdAt: -1, _id: -1 }).skip((p - 1) * limit).limit(limit), Service.countDocuments(match)]);
  send(res, items.map(publicService), { total, page: p, limit });
}
export async function detail(req, res) {
  requireLegalFlag('catalogue'); const s = await Service.findOne({ _id: oid(req.params.id), ...visibility });
  if (!s) fail('Service not available', 404); send(res, publicService(s));
}
export async function submit(req, res) {
  requireLegalFlag('submissions');
  if (!await Application.collection.indexExists('legal_customer_key_unique')) fail('Legal Services indexes require approved preparation', 503);
  const key = req.get('Idempotency-Key'); if (!/^[a-zA-Z0-9-]{16,100}$/.test(key || '')) fail('Valid submission key required');
  if (typeof req.body.answers !== 'string' || Buffer.byteLength(req.body.answers) > SERVICE_ANSWER_BYTES) fail('Invalid or oversized answers');
  let answers; try { answers = JSON.parse(req.body.answers); } catch { fail('Malformed answers'); }
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) fail('Answers must be an object');
  const metadata = (req.files || []).map(validateServiceFile), hash = submissionHash(oid(req.params.id), answers, metadata);
  const customerKey = `${req.user._id}:${key}`;
  const prior = await Application.findOne({ customerKey });
  if (prior) { if (prior.requestHash !== hash) fail('Submission key reused for different content', 409); return send(res, requestDTO(prior)); }
  const s = await Service.findOne({ _id: req.params.id, ...visibility });
  if (!s) fail('Service not available', 404);
  if (Number(req.body.formVersion) !== s.formVersion || Number(req.body.serviceVersion) !== s.__v) fail('Service changed; reload requirements', 409);
  validateAnswers(s.fields, answers, metadata);
  let stored = [], a;
  try {
    if (metadata.length) stored = await storeServiceFiles(req.files, 'document');
    if (req.aborted || res.destroyed) fail('Upload interrupted');
    a = await financialTransaction(async session => {
      const accepted = await Service.updateOne({ _id: s._id, __v: s.__v, ...visibility }, { $inc: { submissionCount: 1 } }, { session, timestamps: false });
      if (!accepted.modifiedCount) fail('Service changed; reload requirements', 409);
      return (await Application.create([{ applicantType: 'customer', user: req.user._id, customerKey, submissionKey: `customer-${req.user._id}-${key}`, requestHash: hash, service: s._id,
        snapshot: { name: s.name, description: s.description, instructions: s.instructions, fields: s.fields, formVersion: s.formVersion }, answers,
        files: stored, legal: { quotes: [], paymentStatus: 'not_requested' }, events: [{ actor: req.user._id, actorType: 'customer', action: 'submitted', status: 'submitted' }] }], { session }))[0];
    });
  } catch (error) {
    await cleanupUnreferenced(stored);
    if (error.code === 11000) { const prior = await Application.findOne({ customerKey }); if (prior?.requestHash === hash) return send(res, requestDTO(prior)); }
    throw error;
  }
  await notifyLegal(a, 'submitted'); send(res.status(201), requestDTO(a));
}
export async function loadRequest(req) {
  const match = { _id: oid(req.params.id), applicantType: 'customer' };
  if (req.legalMode === 'customer') match.user = req.user._id;
  if (req.legalMode === 'provider') { match.provider = req.legalProvider._id; match.service = { $in: req.legalProvider.services }; }
  const a = await Application.findOne(match); if (!a) fail('Request not found', 404); return a;
}
export async function requests(req, res) {
  const { page: p, limit } = page(req), match = { applicantType: 'customer' };
  if (req.legalMode === 'customer') match.user = req.user._id;
  if (req.legalMode === 'provider') { match.provider = req.legalProvider._id; match.service = { $in: req.legalProvider.services }; }
  const [items, total] = await Promise.all([Application.find(match).sort({ createdAt: -1, _id: -1 }).skip((p - 1) * limit).limit(limit), Application.countDocuments(match)]);
  send(res, items.map(a => req.legalMode === 'admin' ? { ...requestDTO(a), providerId: a.provider, customerId: a.user } : requestDTO(a, req.legalMode)), { total, page: p, limit });
}
export async function requestDetail(req, res) {
  const a = await loadRequest(req);
  send(res, req.legalMode === 'admin' ? { ...a.toObject(), files: a.files.map(f => { const { sha256, ...v } = f.toObject(); return v; }), reconciliation: await legalReconciliation(a), flags: legalFlags() } : requestDTO(a, req.legalMode));
}
export async function preflight(req, _res, next) {
  const a = await loadRequest(req);
  if (['completed', 'cancelled', 'refunded', 'rejected'].includes(a.status)) fail('Request is closed', 409);
  if (req.legalMode === 'customer' && a.status !== 'information_required') fail('Information request required', 409);
  if (req.legalMode === 'provider' && !['under_review', 'awaiting_payment', 'payment_verified', 'in_progress'].includes(a.status)) fail('Assignment cannot accept updates', 409);
  next();
}
export async function uploadAction(req, res) {
  const owned = await loadRequest(req), actor = { id: req.user._id, type: req.legalMode };
  if ((req.files || []).some(f => f.fieldname !== 'files')) fail('Invalid upload field');
  let stored = [];
  try {
    stored = req.files?.length ? await storeServiceFiles(req.files, req.legalMode === 'provider' ? 'deliverable' : 'response') : [];
    const a = await mutateLegal(owned._id, req.body.version, actor, async (a, session) => {
      if (String(a.user) !== String(req.user._id) && req.legalMode === 'customer') fail('Request not found', 404);
      if (req.legalMode === 'provider' && String(a.provider) !== String(req.legalProvider._id)) fail('Request not found', 404);
      const message = text(req.body.message || (stored.length ? 'Additional documents submitted' : ''), 'Response', 2000, true);
      if (a.files.length + stored.length > 100) fail('Document limit reached');
      if (req.aborted || res.destroyed) fail('Upload interrupted');
      if (req.legalMode === 'customer') {
        if (a.status !== 'information_required') fail('Information request required', 409);
        const resume = a.legal.resumeAfterInformation || 'under_review';
        if (!['under_review', 'in_progress', 'completed_pending_admin_verification'].includes(resume)) fail('Invalid information response state', 409);
        a.legal.resumeAfterInformation = null; event(a, actor, 'customer_response', message, resume);
      } else {
        requireLegalFlag('fulfilment'); await approvedProvider(a.provider, a.service, session);
        const action = req.body.action;
        if (!['progress', 'provider_information_request', 'completion_submitted', 'acknowledged'].includes(action)) fail('Invalid provider action');
        if (a.legal.hold || a.legal.cancellation) fail('Assignment is on hold', 409);
        if (a.status !== 'in_progress' && (!['under_review', 'awaiting_payment', 'payment_verified'].includes(a.status) || !['acknowledged', 'provider_information_request'].includes(action) || stored.length)) fail('Work has not been authorized', 409);
        event(a, actor, action, message, action === 'completion_submitted' ? 'completed_pending_admin_verification' : a.status);
        stored = stored.map(f => ({ ...f, providerVisible: true }));
      }
      a.files.push(...stored);
    });
    send(res, requestDTO(a, req.legalMode));
  } catch (error) { await cleanupUnreferenced(stored); throw error; }
}
export async function download(req, res) {
  const a = await loadRequest(req), f = a.files.find(f => f.fileId === req.params.fileId && (req.legalMode !== 'provider' || f.providerVisible));
  if (!f) fail('Document not found', 404);
  const bytes = await readServiceFile(f);
  res.set({ 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "sandbox; default-src 'none'", 'Content-Type': { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg' }[f.format], 'Content-Disposition': `attachment; filename="${f.name}"` }); res.send(bytes);
}
export async function cancellation(req, res) {
  const owned = await loadRequest(req);
  const a = await mutateLegal(owned._id, req.body.version, { id: req.user._id, type: 'customer' }, async a => {
    if (String(a.user) !== String(req.user._id) || a.legal.payout || ['cancelled', 'refunded', 'rejected'].includes(a.status)) fail('Cancellation request not permitted', 409);
    if (a.legal.cancellation) fail('Cancellation already requested', 409);
    const reason = text(req.body.message, 'Cancellation reason', 2000, true);
    a.legal.cancellation = { reason, at: new Date(), state: a.status };
    event(a, { id: req.user._id, type: 'customer' }, 'cancellation_requested');
  }); send(res, requestDTO(a));
}
export async function adminAct(req, res) {
  const actor = { id: req.user._id, type: 'admin' };
  await mutateLegal(req.params.id, req.body.version, actor, (a, s) => req.body.action === 'approve_refund' ? approveLegalRefund(a, req.body, actor, s) : adminAction(a, req.body, actor, s));
  return requestDetail(req, res);
}
export async function providers(req, res) { send(res, await Provider.find().select('user displayName status services reviewReference reviewedAt reviewedBy __v').sort({ createdAt: -1 }).limit(100)); }
export async function saveProvider(req, res) {
  requireLegalFlag('fulfilment');
  const input = req.body;
  if (!['approved', 'suspended'].includes(input.status) || !Array.isArray(input.services) || input.services.length > 100 || !input.services.length) fail('Status and eligible services are required');
  if (input.identityReviewed !== true || input.credentialsReviewed !== true) fail('Explicit identity and credential review attestation is required');
  const user = await User.findOne({ _id: oid(input.user), isActive: true }); if (!user) fail('Active user not found');
  const services = [...new Set(input.services.map(oid))];
  if (await Service.countDocuments({ _id: { $in: services }, audiences: 'customer' }) !== services.length) fail('Select customer-eligible services');
  if (!await Provider.collection.indexExists('legal_provider_user_unique')) fail('Provider indexes require approved preparation', 503);
  let p = await Provider.findOne({ user: user._id });
  if (p && p.__v !== input.version) fail('Provider changed', 409);
  p ||= new Provider({ user: user._id });
  Object.assign(p, { displayName: text(input.displayName, 'Display name', 150, true), services, status: input.status, reviewReference: text(input.reviewReference, 'Identity, credentials and eligibility review reference', 500, true), reviewedBy: req.user._id, reviewedAt: new Date() });
  p.events.push({ actor: req.user._id, status: p.status, reviewReference: p.reviewReference, at: new Date() }); await p.save(); send(res, p);
}
export async function policies(_req, res) { send(res, await Commission.find({ channel: 'legal' }).sort({ createdAt: -1 }).limit(100)); }
export async function savePolicy(req, res) {
  const definition = validateLegalPolicy(req.body);
  // Every version is immutable; explicit selected rule ID is never supplied by customers.
  const p = await Commission.create({ ...definition, createdBy: req.user._id }); send(res.status(201), p);
}
export const pay = async (req, res) => send(res, await initiateLegalPayment(oid(req.params.id), req.user._id, req.body, req.get('Idempotency-Key')));
export const verify = async (req, res) => send(res, await verifyLegalPayment(oid(req.body.orderId), req.user._id, req.body));
export const paymentStatus = async (req, res) => send(res, await verifyLegalPayment(oid(req.params.id), req.user._id, {}, true));
export async function refund(req, res) { const a = await loadRequest(req); await executeLegalRefund(a, req.body.key, req.user._id, req.body.reconcile === true, req.body.providerRefundId); return requestDetail(req, res); }
export async function recoverPayment(req, res) {
  requireLegalGateway();
  const a = await loadRequest(req);
  await reconcileCreationAttempt({ paymentId: a.legal.paymentId, key: req.body.key, actor: req.user._id, gatewayOrderId: req.body.gatewayOrderId });
  return requestDetail(req, res);
}
export async function providerIdentity(req, _res, next) {
  requireLegalFlag('fulfilment');
  if (req.userType !== 'user') fail('Provider identity required', 403);
  const p = await Provider.findOne({ user: req.user._id, status: 'approved' }); if (!p) fail('Approved provider access required', 403);
  req.legalProvider = p; next();
}
export async function payout(_req, _res) {
  requireLegalFlag('payouts');
  // No linked-account/payout product or provider banking verification is established.
  // Never fake a transfer or debit shared payable balances without that contract.
  fail('External provider payout execution is blocked pending an approved payout product and banking verification', 503);
}
