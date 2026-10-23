import express from 'express';
import multer from 'multer';
import sharp from 'sharp';
import { v2 as cloudinary } from 'cloudinary';
import { protect, requireAdmin } from '../middlewares/auth.middleware.js';
import { asyncHandler } from '../middlewares/error.middleware.js';
import { ok, created, httpError, paginated, getPagination } from '../utils/response.js';
import Experience from '../models/StorefrontExperience.js';
import { marketingPermission, objectId } from '../services/storefrontPolicy.service.js';
import { adminDTO, saveExperience, transitionExperience, resolveExperience } from '../services/storefront.service.js';
import { uploadToCloudinary, assertCloudinaryConfigured, safeCloudinaryUploadError } from '../services/cloudinary.service.js';
import { PRESETS, lifecycle } from '../shared/storefront.mjs';
export const storefrontRouter = express.Router();
storefrontRouter.get('/experience', asyncHandler(async (req, res) => {
  const { scope = 'quick', device = 'desktop', category = '' } = req.query;
  if (!['quick', 'shop-all'].includes(scope) || !['mobile', 'desktop'].includes(device) || typeof category !== 'string' || category.length > 120) throw httpError(400, 'Invalid storefront scope');
  const data = await resolveExperience(scope, device, category);
  // No shared stale cache: publication/pause is visible on the next 30-second client refresh.
  res.set('Cache-Control', 'no-store'); res.set('ETag', `"${data.version}"`);
  return ok(res, data);
}));
export const storefrontAdminRouter = express.Router();
storefrontAdminRouter.use(protect, requireAdmin, marketingPermission);
storefrontAdminRouter.get('/presets', (_req, res) => ok(res, PRESETS));
storefrontAdminRouter.get('/', asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);
  const query = {};
  if (req.query.kind) { if (!['theme', 'campaign', 'section'].includes(req.query.kind)) throw httpError(400, 'Invalid kind'); query.kind = req.query.kind; }
  if (req.query.search) query.name = { $regex: String(req.query.search).slice(0, 100).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
  const rows = await Experience.find(query).select('+history').sort({ order: 1, updatedAt: -1 }).lean();
  const filtered = req.query.status ? rows.filter(r => lifecycle(r) === req.query.status) : rows;
  return paginated(res, filtered.slice(skip, skip + limit).map(adminDTO), { page, limit, total: filtered.length });
}));
storefrontAdminRouter.post('/', asyncHandler(async (req, res) => created(res, adminDTO(await saveExperience(null, req.body, req.user._id)))));
storefrontAdminRouter.patch('/:id', asyncHandler(async (req, res) => {
  if (!objectId(req.params.id)) throw httpError(400, 'Invalid configuration ID');
  return ok(res, adminDTO(await saveExperience(req.params.id, req.body, req.user._id)));
}));
storefrontAdminRouter.post('/:id/actions/:action', asyncHandler(async (req, res) => ok(res, adminDTO(await transitionExperience(req.params.id, req.params.action, req.body.revision, req.user._id)))));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024, files: 1 }, fileFilter: (_req, file, cb) => {
  const extensions = { 'image/jpeg': /\.jpe?g$/i, 'image/png': /\.png$/i, 'image/webp': /\.webp$/i, 'video/mp4': /\.mp4$/i, 'video/webm': /\.webm$/i };
  cb(extensions[file.mimetype]?.test(file.originalname) ? null : httpError(400, 'Use JPEG, PNG, WebP, MP4 or WebM with a matching extension'), true);
} });
storefrontAdminRouter.post('/media', upload.single('media'), asyncHandler(async (req, res) => {
  const file = req.file; if (!file) throw httpError(400, 'Select a media file');
  if (file.mimetype.startsWith('image/')) {
    if (file.size > 5 * 1024 * 1024) throw httpError(400, 'Images must be under 5 MB');
    let data; try { data = await sharp(file.buffer, { limitInputPixels: 25000000 }).rotate().webp().toBuffer(); } catch { throw httpError(400, 'Invalid or oversized image'); }
    return created(res, { url: await uploadToCloudinary(data, 'storefront', { resource_type: 'image' }), type: 'image' });
  }
  const mp4 = file.buffer.subarray(4, 8).toString() === 'ftyp';
  const webm = file.buffer.subarray(0, 4).toString('hex') === '1a45dfa3';
  if (!(file.mimetype === 'video/mp4' ? mp4 : webm)) throw httpError(400, 'Video content does not match its file type');
  assertCloudinaryConfigured();
  const result = await new Promise((resolve, reject) => cloudinary.uploader.upload_stream({ folder: 'nhcone/storefront', resource_type: 'video', format: 'mp4', video_codec: 'h264', transformation: [{ duration: '15', width: 1280, crop: 'limit' }] }, (err, data) => err ? reject(safeCloudinaryUploadError(err, 'Video')) : resolve(data)).end(file.buffer));
  return created(res, { url: result.secure_url, type: 'video', duration: result.duration });
}));
