import mongoose from 'mongoose';
import Seller from '../models/Seller.js';
import Request, { GST_ASSISTANCE_STATUSES } from '../models/GstAssistanceRequest.js';
import { boundedText, gstRequestDTO, GSTIN_FORMAT } from '../services/gstAssistance.service.js';
import { financialTransaction } from '../services/financeSafety.service.js';
import { storeServiceFiles, readServiceFile, removeServiceFiles } from '../services/serviceStorage.service.js';
import { notifySeller, notifyAllAdmins, NOTIFICATION_EVENT } from '../services/notification.service.js';
import { httpError, ok } from '../utils/response.js';
import Fee from '../models/GstAssistanceFee.js';
import { currentGstFee, validateGstFee } from '../services/gstFee.service.js';
import { initiateGstPayment, verifyGstPayment } from '../services/gstPayment.service.js';
const isAdmin = req => req.userType === 'admin';
async function identity(req) {
  if (isAdmin(req)) {
    if (!mongoose.isValidObjectId(req.params.id)) throw httpError(400, 'A valid request ID is required');
    return req.params.id;
  }
  const seller = await Seller.findOne({ userId: req.user._id }).select('_id');
  if (!seller) throw httpError(404, 'Vendor application not found');
  return seller._id;
}
async function owned(req, session = null) {
  const row = await Request.findById(await identity(req)).session(session);
  if (!row || (!isAdmin(req) && String(row.userId) !== String(req.user._id))) throw httpError(404, 'GST assistance request not found');
  return row;
}
export async function list(req, res) {
  if (req.query.status && !GST_ASSISTANCE_STATUSES.includes(req.query.status)) throw httpError(400, 'Invalid status filter');
  const page = Math.max(1, Math.min(10000, Number.parseInt(req.query.page, 10) || 1));
  const rows = await Request.find(req.query.status ? { status: req.query.status } : {}).sort({ submittedAt: -1, _id: -1 }).skip((page - 1) * 30).limit(30);
  return ok(res, { requests: rows.map(r => gstRequestDTO(r, true)), page });
}
export async function detail(req, res) {
  let row;
  if (isAdmin(req)) row = await owned(req);
  else {
    // The dashboard checks this optional resource for every seller. Absence is
    // a normal empty state; actions and downloads still require an owned row.
    const seller = await Seller.findOne({ userId: req.user._id }).select('_id');
    row = seller ? await Request.findOne({ _id: seller._id, userId: req.user._id }) : null;
    if (!row) return ok(res, null);
  }
  const dto = gstRequestDTO(row, isAdmin(req));
  if (!dto.billing) { const fee = await currentGstFee(); if (fee) dto.billing = { ...fee, status: 'unpaid' }; }
  return ok(res, dto);
}
export async function feePolicy(_req, res) { return ok(res, await currentGstFee()); }
export async function saveFeePolicy(req, res) {
  if (req.user.role !== 'superAdmin' && !req.user.permissions?.includes('manage_finance')) throw httpError(403, 'Finance permission required to change service fees');
  const config = validateGstFee(req.body);
  const fee = await financialTransaction(async session => {
    let row = await Fee.findById('gst-assistance').session(session);
    if ((row?.version || 0) !== req.body.version) throw httpError(409, 'Fee changed. Reload before saving');
    if (!row) row = new Fee({ _id: 'gst-assistance', version: 0 });
    Object.assign(row, config); row.version++; row.updatedBy = req.user._id;
    row.history.push({ version: row.version, amountPaise: row.amountPaise, terms: row.terms, by: req.user._id, at: new Date() });
    await row.save({ session }); return row;
  });
  return ok(res, { amountPaise: fee.amountPaise, currency: fee.currency, terms: fee.terms, version: fee.version });
}
export async function pay(req, res) { return ok(res, await initiateGstPayment(await identity(req), req.user._id, req.body || {}, req.get('Idempotency-Key'))); }
export async function verifyPayment(req, res) {
  if (!mongoose.isValidObjectId(req.body?.orderId)) throw httpError(400, 'A valid GST request ID is required');
  return ok(res, await verifyGstPayment(req.body.orderId, req.user._id, req.body));
}
export async function paymentStatus(req, res) { return ok(res, await verifyGstPayment(await identity(req), req.user._id, {}, true)); }
const transitions = { pending: ['under_review', 'rejected', 'cancelled'],
  under_review: ['additional_information_required', 'approved', 'rejected', 'cancelled'],
  additional_information_required: ['under_review', 'rejected', 'cancelled'],
  approved: ['additional_information_required', 'completed', 'rejected', 'cancelled'] };
export async function preflight(req, _res, next) { try { await owned(req); next(); } catch (e) { next(e); } }
export async function act(req, res) {
  const admin = isAdmin(req), body = req.body || {};
  const version = Number(body.version);
  if (!Number.isSafeInteger(version) || version < 0 || body.version === '') throw httpError(400, 'An integer request version is required');
  const action = body.action;
  const allowed = admin ? ['transition'] : ['respond', 'cancel'];
  if (!allowed.includes(action)) throw httpError(400, 'Unsupported GST assistance action');
  // Approving or completing needs no write-up: a short default message is used when none is typed.
  const defaultMessage = admin && action === 'transition' ? { completed: 'GST registration assistance completed.', approved: 'Your GST assistance request is approved. We have started the work and will update you here.' }[body.status] : undefined;
  const message = boundedText(body.message, 'Vendor-visible next steps', 2000, action === 'respond' || (action === 'transition' && !defaultMessage)) || defaultMessage || '';
  const files = req.files || [];
  if (files.some(f => f.fieldname !== 'documents') || files.length > 3) throw httpError(400, 'Upload at most three documents');
  if ((!admin && action !== 'respond') || (admin && action !== 'transition')) {
    if (files.length) throw httpError(400, 'Documents are not accepted for this action');
  }
  let stored = [], committed = false, saved;
  try {
    // Authorization and existence were checked before buffering multipart data.
    if (files.length) stored = await storeServiceFiles(files, admin ? 'verification_evidence' : 'vendor_response');
    saved = await financialTransaction(async session => {
      const row = await owned(req, session);
      if (row.__v !== version) throw httpError(409, 'Request changed. Refresh before continuing.');
      if (row.files.length + stored.length > 30 || row.events.length >= 500) throw httpError(409, 'Request review limit reached; contact support');
      const from = row.status;
      if (!admin && action === 'cancel' && row.billing?.paymentId) throw httpError(409, 'A payment has been started. Contact Bulkimart for cancellation and refund review');
      if (!admin) {
        if (action === 'cancel' && row.status !== 'pending') throw httpError(409, 'Only a pending request can be cancelled by the vendor');
        if (action === 'respond' && row.status !== 'additional_information_required') throw httpError(409, 'Additional information has not been requested');
        row.status = action === 'cancel' ? 'cancelled' : 'under_review';
        if (action === 'respond') row.requestedCorrections = '';
      } else {
        if (!transitions[row.status]?.includes(body.status)) throw httpError(409, 'This assistance status transition is not allowed');
        if (['approved','completed'].includes(body.status) && (row.billing || await currentGstFee(session)) && (row.billing?.status !== 'paid' || row.billing?.reviewRequired)) throw httpError(409, 'Verified service payment without financial holds is required before starting or completing GST assistance');
        row.status = body.status;
        if (body.status === 'additional_information_required') row.requestedCorrections = message;
        if (body.status === 'completed') {
          if (row.billing && (row.billing.status !== 'paid' || row.billing.reviewRequired)) throw httpError(409, 'Verified service payment without financial holds is required before completion');
          const gstin = boundedText(body.verifiedGstin, 'Independently verified GSTIN', 15, true);
          const evidence = [...row.files, ...stored].find(f => f.fileId === body.evidenceFileId || (stored.length === 1 && !body.evidenceFileId && f.fileId === stored[0].fileId));
          if (!GSTIN_FORMAT.test(gstin) || body.independentlyVerified !== 'true' || evidence?.kind !== 'verification_evidence') throw httpError(400, 'Completion requires GSTIN format, private verification evidence and explicit independent-verification attestation');
          row.verification = { gstin, source: 'GST portal taxpayer search', reference: boundedText(body.verificationReference, 'Verification evidence reference', 500) || `Uploaded evidence: ${evidence.name}`,
            evidenceFileId: evidence.fileId, verifiedBy: req.user._id, verifiedAt: new Date(), method: 'admin_attested_independent_review' };
        }
      }
      if (admin && ['rejected','cancelled'].includes(row.status) && row.billing?.paymentId) row.billing.reviewRequired = true;
      row.files.push(...stored);
      row.events.push({ action, from, to: row.status, actorType: admin ? 'admin' : 'vendor', actorId: req.user._id,
        at: new Date(), vendorMessage: message, 
        fileIds: stored.map(f => f.fileId) });
      row.markModified('files'); row.markModified('events'); await row.save({ session }); return row;
    });
    committed = true;
  } finally { if (!committed && stored.length) await removeServiceFiles(stored); }
  const notification = { event: NOTIFICATION_EVENT.SYSTEM, title: 'GST assistance update',
    message: 'Your GST assistance request has an update. Open your vendor application for details.',
    route: '/seller', dedupeKey: `gst-assistance:${saved._id}:${saved.__v}` };
  try { if (admin) await notifySeller(saved.vendorId, notification);
    else if (!admin) await notifyAllAdmins({ ...notification, message: 'A GST assistance request needs review.', route: '/admin' });
  } catch { /* committed state is authoritative; notifications are best effort */ }
  return ok(res, gstRequestDTO(saved, admin));
}
export async function download(req, res) {
  const row = await owned(req), file = row.files.find(f => f.fileId === req.params.fileId);
  if (!file) throw httpError(404, 'Document not found');
  const bytes = await readServiceFile(file);
  res.set({ 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "sandbox; default-src 'none'",
    'Content-Type': { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg' }[file.format],
    'Content-Disposition': `attachment; filename="${file.name}"` }); res.send(bytes);
}
