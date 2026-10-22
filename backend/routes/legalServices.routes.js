import express from 'express';
import rateLimit from 'express-rate-limit';
import { protect, requireCustomerSession, requireAdmin } from '../middlewares/auth.middleware.js';
import { asyncHandler } from '../middlewares/error.middleware.js';
import { serviceUploadControls as uploads } from '../middlewares/serviceUpload.middleware.js';
import { legalAdminPermission, legalFinancePermission, requireLegalFlag } from '../services/legalPolicy.service.js';
import * as c from '../controllers/legalServices.controller.js';
const wrap = asyncHandler;
const privacy = (_req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); };
const errors = (err, _req, _res, next) => { if (err.name === 'VersionError') { err.status = 409; err.message = 'Request changed. Reload before continuing.'; } next(err); };
const mode = type => (req, _res, next) => { req.legalMode = type; next(); };
const validBody = (req, _res, next) => {
  if (req.method === 'POST' && !req.is('multipart/form-data') && (!req.body || typeof req.body !== 'object' || Array.isArray(req.body))) {
    const err = new Error('A valid request body is required'); err.status = 400; return next(err);
  }
  next();
};
export const customerLegalRouter = express.Router();
customerLegalRouter.use(privacy);
customerLegalRouter.get('/capabilities', c.capabilities);
customerLegalRouter.use(rateLimit({ windowMs: 60000, limit: 120, standardHeaders: true, legacyHeaders: false }));
customerLegalRouter.get('/', wrap(c.catalogue));
customerLegalRouter.get('/catalogue/:id', wrap(c.detail));
customerLegalRouter.use(protect, requireCustomerSession, mode('customer'), validBody);
customerLegalRouter.get('/applications', wrap(c.requests));
customerLegalRouter.get('/applications/:id', wrap(c.requestDetail));
customerLegalRouter.get('/applications/:id/files/:fileId', wrap(c.download));
customerLegalRouter.post('/applications/:id/respond', uploads.limiter, wrap(c.preflight), uploads.handle(c.uploadAction));
customerLegalRouter.post('/applications/:id/cancellation', wrap(c.cancellation));
customerLegalRouter.post('/applications/:id/payment', wrap(c.pay));
customerLegalRouter.post('/payments/verify', wrap(c.verify));
customerLegalRouter.post('/applications/:id/payment-status', wrap(c.paymentStatus));
customerLegalRouter.post('/catalogue/:id/applications', (_req, _res, next) => { requireLegalFlag('submissions'); next(); }, uploads.limiter, uploads.handle(c.submit));
customerLegalRouter.use(errors);

export const adminLegalRouter = express.Router();
adminLegalRouter.use(protect, requireAdmin, legalAdminPermission, privacy, mode('admin'), validBody);
adminLegalRouter.use((req, _res, next) => {
  if (req.method !== 'GET' && (process.env.NODE_ENV === 'production' || process.env.DEPLOYMENT_ENV === 'production')) { const err = new Error('Production Legal Services mutations are release-blocked'); err.status = 503; return next(err); }
  next();
});
adminLegalRouter.get('/requests', wrap(c.requests));
adminLegalRouter.get('/requests/:id', wrap(c.requestDetail));
adminLegalRouter.get('/requests/:id/files/:fileId', wrap(c.download));
adminLegalRouter.post('/requests/:id/actions', (req, res, next) => ['bank_reconciled', 'release', 'approve_refund', 'hold', 'resolve_hold'].includes(req.body?.action) ? legalFinancePermission(req, res, next) : next(), wrap(c.adminAct));
adminLegalRouter.get('/providers', wrap(c.providers));
adminLegalRouter.post('/providers', wrap(c.saveProvider));
adminLegalRouter.get('/policies', legalFinancePermission, wrap(c.policies));
adminLegalRouter.post('/policies', legalFinancePermission, wrap(c.savePolicy));
adminLegalRouter.post('/requests/:id/refund', legalFinancePermission, wrap(c.refund));
adminLegalRouter.post('/requests/:id/recover-payment', legalFinancePermission, wrap(c.recoverPayment));
adminLegalRouter.post('/requests/:id/payout', legalFinancePermission, wrap(c.payout));
adminLegalRouter.use(errors);

export const providerLegalRouter = express.Router();
providerLegalRouter.use(protect, wrap(c.providerIdentity), privacy, mode('provider'));
providerLegalRouter.get('/', wrap(c.requests));
providerLegalRouter.get('/:id', wrap(c.requestDetail));
providerLegalRouter.get('/:id/files/:fileId', wrap(c.download));
providerLegalRouter.post('/:id/progress', uploads.limiter, wrap(c.preflight), uploads.handle(c.uploadAction));
providerLegalRouter.use(errors);
