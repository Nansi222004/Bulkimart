import multer from 'multer';
import rateLimit from 'express-rate-limit';
import { Transform } from 'node:stream';
import { SERVICE_FILE_BYTES, SERVICE_FILE_COUNT, SERVICE_MULTIPART_FIELD_BYTES, SERVICE_REQUEST_BYTES } from '../shared/serviceLimits.mjs';

const error = (message, status) => Object.assign(new Error(message), { status });
const accountKey = req => `${req.userType}:${req.user._id}`;

// One shared budget for both service routers. Per-process, like existing limiters.
export function createServiceUploadControls({ maxRequests = 30, windowMs = 15 * 60 * 1000, maxActive = 4, maxPerAccount = 2, maxRequestBytes = SERVICE_REQUEST_BYTES, timeoutMs = 60000, keyGenerator = accountKey, fileBytes = SERVICE_FILE_BYTES, fileCount = SERVICE_FILE_COUNT, fieldBytes = SERVICE_MULTIPART_FIELD_BYTES, textFields = 10, parts = 20, uploadLabel = 'Service' } = {}) {
  const accounts = new Map();
  let active = 0;
  const limiter = rateLimit({ windowMs, max: maxRequests, keyGenerator, standardHeaders: true, legacyHeaders: false,
    message: { success: false, data: null, message: `Too many ${uploadLabel.toLowerCase()} submissions or uploads. Please try again later.`, meta: {} } });
  const parse = multer({ storage: multer.memoryStorage(), limits: { fileSize: fileBytes, files: fileCount, fields: textFields, fieldSize: fieldBytes, fieldNameSize: 100, parts } }).any();
  const handle = controller => (req, res, next) => {
    const key = keyGenerator(req);
    if (active >= maxActive || (accounts.get(key) || 0) >= maxPerAccount) return next(error(`${uploadLabel} upload capacity reached. Please try again shortly.`, 429));
    const length = req.headers['content-length'];
    if (length !== undefined && (!/^\d+$/.test(length) || Number(length) > maxRequestBytes)) return next(error(`${uploadLabel} request exceeds the total upload limit.`, 413));
    active++; accounts.set(key, (accounts.get(key) || 0) + 1);
    let bytes = 0, finished = false;
    const bounded = new Transform({ transform(chunk, _encoding, callback) {
      bytes += chunk.length;
      callback(bytes > maxRequestBytes ? error(`${uploadLabel} request exceeds the total upload limit.`, 413) : null, bytes > maxRequestBytes ? undefined : chunk);
    } });
    bounded.headers = req.headers;
    const abort = () => bounded.destroy(error(`${uploadLabel} upload interrupted. Please retry.`, 400));
    const timer = setTimeout(() => bounded.destroy(error(`${uploadLabel} upload timed out. Please retry.`, 400)), timeoutMs);
    timer.unref();
    req.once('aborted', abort);
    req.once('error', abort);
    const finish = async parseError => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      req.unpipe(bounded);
      req.removeListener('aborted', abort); req.removeListener('error', abort);
      if (!req.complete && !req.destroyed) req.resume();
      try {
        if (parseError) throw parseError;
        if (req.aborted || res.destroyed) throw error(`${uploadLabel} upload interrupted. Please retry.`, 400);
        req.body = bounded.body; req.files = bounded.files || [];
        await controller(req, res);
      } catch (failure) {
        if (!req.complete && !res.headersSent) res.set('Connection', 'close');
        if (failure.name === 'MulterError') {
          const status = ['LIMIT_FILE_SIZE', 'LIMIT_FILE_COUNT', 'LIMIT_FIELD_VALUE', 'LIMIT_PART_COUNT', 'LIMIT_FIELD_COUNT'].includes(failure.code) ? 413 : 400;
          failure = error(`${uploadLabel} upload exceeds the allowed file, answer or multipart limits.`, status);
        } else if (parseError && !failure.status) failure = error(`Malformed ${uploadLabel.toLowerCase()} upload. Please retry.`, 400);
        if (!res.destroyed) next(failure);
      } finally {
        for (const file of bounded.files || []) delete file.buffer;
        req.files = []; bounded.files = [];
        active--; const remaining = (accounts.get(key) || 1) - 1;
        if (remaining) accounts.set(key, remaining); else accounts.delete(key);
        bounded.destroy();
      }
    };
    if (!req.is('multipart/form-data')) { void finish(error(`Use multipart form data for ${uploadLabel.toLowerCase()} submissions and uploads.`, 400)); return; }
    parse(bounded, res, failure => { void finish(failure); });
    if (!finished) req.pipe(bounded);
  };
  return { limiter, handle };
}
export const serviceUploadControls = createServiceUploadControls();
