import express from 'express';
import { ipKeyGenerator } from 'express-rate-limit';
import { protect } from '../middlewares/auth.middleware.js';
import { errorHandler } from '../middlewares/error.middleware.js';
import { createServiceUploadControls } from '../middlewares/serviceUpload.middleware.js';
import { httpError, ok } from '../utils/response.js';
import { fingerprintImage, imageSearchEnabled, imageSearchMaxBytes } from '../services/imageFingerprint.service.js';
import { searchImageIndex } from '../services/imageSearch.service.js';

export function imageSearchRouter() {
  const router = express.Router(), maxBytes = imageSearchMaxBytes();
  const uploads = createServiceUploadControls({ maxRequests: 10, windowMs: 60000, maxActive: 2, maxPerAccount: 1, maxRequestBytes: maxBytes + 16384,
    fileBytes: maxBytes, fileCount: 1, fieldBytes: 100, textFields: 0, parts: 1, uploadLabel: 'Image search',
    keyGenerator: req => req.user?._id ? `image-user:${req.user._id}` : `image-ip:${ipKeyGenerator(req.ip)}` });
  router.get('/config', (_req, res) => ok(res, { enabled: imageSearchEnabled(), maxBytes, mode: 'visual-fingerprint-v1' }));
  // Search remains public, just like text search. Supplied sessions must be valid.
  router.post('/', (req, res, next) => req.headers.authorization ? protect(req, res, next) : next(), uploads.limiter,
    uploads.handle(async (req, res) => {
      if (req.files.length !== 1 || req.files[0].fieldname !== 'image') throw httpError(400, 'Choose one image to search.');
      const type = req.query.type || 'grocery', page = Number(req.query.page || 1), limit = Number(req.query.limit || 20);
      if (!['grocery', 'ecommerce'].includes(type) || !Number.isInteger(page) || page < 1 || page > Math.ceil(100 / limit) || !Number.isInteger(limit) || limit < 1 || limit > 20) throw httpError(400, 'Invalid image search filters or page.');
      const file = req.files[0], fingerprint = await fingerprintImage(file.buffer, file);
      if (req.aborted || res.destroyed) return;
      const result = await searchImageIndex(fingerprint, { type, page, limit });
      res.set('Cache-Control', 'no-store'); ok(res, result.data, '', result.meta);
    }));
  router.use((failure, req, res, next) => {
    if (res.headersSent) return next(failure);
    const status = failure.status || (res.statusCode >= 400 ? res.statusCode : 503);
    const exposeMessage = status < 500 || (status === 503 && failure.status === 503);
    const safe = httpError(status, exposeMessage ? failure.message : 'Image search is temporarily unavailable. Please try again.');
    // Preserve the existing error envelope, but never expose decoder/DB stacks,
    // including when this public upload endpoint is used in development.
    safe.stack = undefined;
    errorHandler(safe, req, res, next);
  });
  return router;
}
