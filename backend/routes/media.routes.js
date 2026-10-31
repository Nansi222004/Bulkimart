import express from 'express';
import rateLimit from 'express-rate-limit';
import Admin from '../models/Admin.js';
import Media from '../models/Media.js';
import MediaAccessAudit from '../models/MediaAccessAudit.js';
import { protect, requireAdmin } from '../middlewares/auth.middleware.js';
import { asyncHandler } from '../middlewares/error.middleware.js';
import { ok, httpError } from '../utils/response.js';
import { getStorageConfig } from '../config/storage.js';
import { PUBLIC_DIRECTORIES } from '../services/mediaPolicy.service.js';
import { filesystemProvider as storage } from '../services/mediaStorage.service.js';
import { verifySignedRequest } from '../services/mediaUrl.service.js';

// Media delivery.
//   GET /media/<dir>/<yyyy>/<mm>/<file>   public media, long-lived cache        (mediaRouter)
//   GET /media/s/<id>?e=&v=&s=            private media via short-lived signature (mediaRouter)
//   GET /api/media/<id>                   private media with bearer auth: owner or admin only
//   GET /api/admin/media/health           storage health for administrators
// Files are streamed by express/send: correct MIME type from the server-chosen
// extension, HTTP range requests (video seeking), and no directory listing.

const FILE_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(webp|jpg|png|mp4)$/;
const OBJECT_ID = /^[a-f0-9]{24}$/;

const baseHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; sandbox",
  // The storefront (bulkimart.in) and apps load media from the API origin.
  'Cross-Origin-Resource-Policy': 'cross-origin',
};

const notFound = () => httpError(404, 'Media not found');

const sendStored = (res, next, key, headers, options = {}) => {
  res.sendFile(key, { root: getStorageConfig().root, dotfiles: 'deny', headers: { ...baseHeaders, ...headers }, ...options }, (error) => {
    if (error && !res.headersSent) next(error.status === 416 ? error : notFound());
  });
};

const dispositionFor = (media) => {
  const name = (media.originalName || `document.${media.extension}`).replace(/["\\\r\n]/g, '_');
  // PDFs download instead of rendering on our origin; images display inline.
  return `${media.mimeType === 'application/pdf' ? 'attachment' : 'inline'}; filename="${name}"`;
};

const sendPrivate = async (req, res, next, media, viewer) => {
  // Refuses symlinks and anything whose real path leaves MEDIA_ROOT.
  await storage.openKey(media.storageKey);
  if (media.visibility === 'private-kyc') {
    await MediaAccessAudit.create({
      mediaId: media._id, category: media.category, viewerId: viewer.id, viewerType: viewer.type,
      requestId: req.requestId, ip: req.ip, userAgent: String(req.get('user-agent') || '').slice(0, 300),
    });
  }
  sendStored(res, next, media.storageKey, {
    'Cache-Control': 'private, no-store, max-age=0',
    'Referrer-Policy': 'no-referrer',
    'Content-Disposition': dispositionFor(media),
  }, { cacheControl: false, lastModified: false, etag: false });
};

const findPrivate = async (id) => {
  if (!OBJECT_ID.test(String(id))) throw notFound();
  const media = await Media.findOne({ _id: id, uploadStatus: 'stored', visibility: { $ne: 'public' } }).select('+storageKey').lean();
  if (!media) throw notFound();
  return media;
};

export const mediaRouter = express.Router();

mediaRouter.get('/s/:id', asyncHandler(async (req, res, next) => {
  const { e, v, s } = req.query;
  if (!verifySignedRequest({ mediaId: req.params.id, e, v, s })) throw httpError(403, 'This link has expired. Refresh the page to get a new one.');
  const media = await findPrivate(req.params.id);
  const viewerType = (await Admin.exists({ _id: v })) ? 'admin' : 'user';
  await sendPrivate(req, res, next, media, { id: v, type: viewerType });
}));

mediaRouter.get('/:dir/:yyyy/:mm/:file', asyncHandler(async (req, res, next) => {
  const { dir, yyyy, mm, file } = req.params;
  if (!PUBLIC_DIRECTORIES.has(dir) || !/^\d{4}$/.test(yyyy) || !/^\d{2}$/.test(mm) || !FILE_PATTERN.test(file)) throw notFound();
  if (!getStorageConfig().root) throw notFound();
  const key = `public/${dir}/${yyyy}/${mm}/${file}`;
  // Refuses symlinks and anything whose real path leaves MEDIA_ROOT.
  await storage.openKey(key);
  sendStored(res, next, key, {}, { maxAge: '365d', immutable: true });
}));

// Anything else under /media is a 404, never the SPA shell.
mediaRouter.use((_req, _res, next) => next(notFound()));

export const mediaApiRouter = express.Router();
const directLimiter = rateLimit({ windowMs: 60_000, max: 120, standardHeaders: true, legacyHeaders: false });

mediaApiRouter.get('/:id', directLimiter, protect, asyncHandler(async (req, res, next) => {
  const media = await findPrivate(req.params.id);
  const isAdmin = req.userType === 'admin';
  const isOwner = media.ownerId && String(media.ownerId) === String(req.user._id);
  // 404 rather than 403 so other users cannot probe which IDs exist.
  if (!isAdmin && !isOwner) throw notFound();
  await sendPrivate(req, res, next, media, { id: String(req.user._id), type: isAdmin ? 'admin' : 'user' });
}));

export const mediaAdminRouter = express.Router();
mediaAdminRouter.get('/health', protect, requireAdmin, asyncHandler(async (_req, res) => {
  const config = getStorageConfig();
  const [disk, counts] = await Promise.all([
    storage.health(),
    Media.aggregate([{ $group: { _id: { category: '$category', status: '$uploadStatus', migration: '$migrationStatus' }, files: { $sum: 1 }, bytes: { $sum: '$sizeBytes' } } }]),
  ]);
  return ok(res, {
    storage: disk,
    providers: { default: config.defaultProvider, overrides: config.providers },
    legacyReadMap: config.legacyReadMap,
    media: counts.map((row) => ({ ...row._id, files: row.files, bytes: row.bytes })),
  });
}));
