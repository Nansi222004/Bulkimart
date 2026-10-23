import express from 'express';
import rateLimit from 'express-rate-limit';
import { protect, requireAdmin, requireSellerSession } from '../middlewares/auth.middleware.js';
import { asyncHandler } from '../middlewares/error.middleware.js';
import { createServiceUploadControls } from '../middlewares/serviceUpload.middleware.js';
import { gstAssistanceCapabilities, requireGstAssistance } from '../services/gstAssistance.service.js';
import { httpError } from '../utils/response.js';
import * as c from '../controllers/gstAssistance.controller.js';
const uploads = createServiceUploadControls({ fileCount: 3, parts: 18, textFields: 14, uploadLabel: 'GST assistance' });
export function gstAssistanceRouter(admin = false) {
  const r = express.Router();
  if (!admin) r.get('/capabilities', (_req, res) => res.json({ success: true, data: gstAssistanceCapabilities() }));
  r.use(protect);
  if (admin) r.use(requireAdmin, (req, _res, next) => {
    if (req.user.role !== 'superAdmin' && !req.user.permissions?.includes('manage_sellers')) throw httpError(403, 'Vendor management permission required'); next();
  });
  else r.use(requireSellerSession, (req, _res, next) => { if (req.userType !== 'user') throw httpError(403, 'Vendor session required'); next(); });
  r.use((_req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); });
  r.use(rateLimit({ windowMs: 60000, max: 100, standardHeaders: true, legacyHeaders: false }));
  if (admin) r.get('/', asyncHandler(c.list));
  const base = admin ? '/:id' : '/me';
  r.get(base, asyncHandler(c.detail));
  r.get(`${base}/files/:fileId`, asyncHandler(c.download));
  r.post(`${base}/actions`, (_req, _res, next) => { requireGstAssistance(); next(); }, c.preflight, uploads.limiter, uploads.handle(c.act));
  r.use((e, _req, _res, next) => { if (e.name === 'VersionError' || e.code === 11000) { e.status = 409; e.message = 'Request changed. Refresh before continuing.'; } next(e); });
  return r;
}
