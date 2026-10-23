import GstRequest from '../models/GstAssistanceRequest.js';
import { httpError } from '../utils/response.js';
import { currentGstFee } from './gstFee.service.js';
export const gstAssistanceCapabilities = () => {
  const production = ['NODE_ENV', 'DEPLOYMENT_ENV', 'APP_ENV', 'VERCEL_ENV', 'RENDER_ENV'].some(k =>
    ['prod', 'production', 'deployment-production'].includes(String(process.env[k] || '').trim().toLowerCase()));
  const productionBlocked = production && process.env.GST_ASSISTANCE_PRODUCTION_ENABLED !== 'true';
  return { enabled: process.env.GST_ASSISTANCE_ENABLED === 'true' && !productionBlocked, productionBlocked };
};
export function requireGstAssistance() {
  if (!gstAssistanceCapabilities().enabled) throw httpError(503, 'GST assistance is not enabled for this environment');
}
export const GSTIN_FORMAT = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
export function boundedText(value, name, max = 2000, required = false) {
  if (value == null && !required) return '';
  if (typeof value !== 'string' || value.trim().length > max || (required && !value.trim())) throw httpError(400, `${name} is required and must be at most ${max} characters`);
  return value.trim();
}
export function parseGstChoice(body) {
  if (body.gstChoice === undefined) return null; // legacy callers retain their existing optional GSTIN behavior
  if (!['has_gstin', 'assistance', 'without_gstin'].includes(body.gstChoice)) throw httpError(400, 'Choose a GSTIN path');
  const gstin = boundedText(body.gstin, 'GSTIN', 15);
  if (body.gstChoice === 'has_gstin' && !GSTIN_FORMAT.test(gstin)) throw httpError(400, 'Enter a valid 15-character GSTIN format; verification remains separate');
  if (body.gstChoice !== 'has_gstin' && gstin) throw httpError(400, 'The no-GSTIN path cannot include a GSTIN');
  if (body.gstChoice === 'assistance') {
    requireGstAssistance();
    if (![true, 'true'].includes(body.gstAssistanceConsent)) throw httpError(400, 'Explicit GST assistance consent is required');
    return { choice: body.gstChoice, gstin: '', contactName: boundedText(body.gstContactName, 'Contact name', 100, true),
      message: boundedText(body.gstAssistanceMessage, 'Assistance message') };
  }
  return { choice: body.gstChoice, gstin };
}
export async function createGstRequest(seller, choice, session) {
  const existing = await GstRequest.findById(seller._id).session(session);
  if (existing) {
    if (['cancelled', 'rejected', 'completed'].includes(existing.status)) throw httpError(409, 'A GST assistance request already exists. Contact support before submitting another.');
    if (existing.details.contactName !== choice.contactName || existing.details.message !== choice.message) throw httpError(409, 'An active GST assistance request already exists. Use its requested-information response.');
    return { row: existing, created: false };
  }
  if (!seller.businessName || !seller.storeDetails?.state || !seller.storeDetails?.pincode) throw httpError(400, 'Complete business details, state and pincode before requesting assistance');
  const now = new Date();
  const fee = await currentGstFee(session);
  const [created] = await GstRequest.create([{ _id: seller._id, vendorId: seller._id, userId: seller.userId,
    gstinStatusAtSubmission: 'not_provided', gstinAtSubmission: '',
    details: { contactName: choice.contactName, contactPhone: choice.contactPhone, message: choice.message, businessName: seller.businessName,
      businessType: seller.businessType, state: seller.storeDetails.state, pincode: seller.storeDetails.pincode },
    consent: { accepted: true, version: 'gst-assistance-v1', acceptedAt: now }, submittedAt: now,
    ...(fee ? { billing: { ...fee, status: 'unpaid' } } : {}),
    events: [{ action: 'submitted', to: 'pending', actorType: 'vendor', actorId: seller.userId, at: now }],
  }], { session });
  return { row: created, created: true };
}
export function gstRequestDTO(row, admin = false) {
  const r = row.toObject ? row.toObject() : row;
  const dto = { _id: r._id, vendorId: r.vendorId, status: r.status, version: r.__v, details: r.details,
    consent: r.consent, submittedAt: r.submittedAt, updatedAt: r.updatedAt, gstinStatusAtSubmission: r.gstinStatusAtSubmission,
    requestedCorrections: r.requestedCorrections, verification: r.verification ? { gstin: r.verification.gstin, verifiedAt: r.verification.verifiedAt } : undefined,
    files: r.files.filter(f => admin || f.kind !== 'verification_evidence').map(f => ({ fileId: f.fileId, name: f.name, sizeBytes: f.sizeBytes, kind: f.kind, uploadedAt: f.uploadedAt })),
    events: r.events.map(e => admin ? e : { action: e.action, from: e.from, to: e.to, at: e.at, vendorMessage: e.vendorMessage }) };
  if (r.billing) dto.billing = { amountPaise: r.billing.amountPaise, currency: r.billing.currency, terms: r.billing.terms, version: r.billing.version, status: r.billing.status, reviewRequired: r.billing.reviewRequired };
  if (admin) Object.assign(dto, { userId: r.userId, reviewerId: r.reviewerId, verification: r.verification });
  return dto;
}
