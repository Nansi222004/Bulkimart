import { unlink } from 'node:fs/promises';
import mongoose from 'mongoose';
import { asyncHandler } from '../middlewares/error.middleware.js';
import { ok, created, httpError } from '../utils/response.js';
import Media from '../models/Media.js';
import TrainingVideo, { TRAINING_AUDIENCES } from '../models/TrainingVideo.js';
import { keyFromPublicUrl, mediaContext, removeByReference, storeUpload } from '../services/media.service.js';

/**
 * Training videos ("how to use the app") for sellers and delivery partners.
 * Admin: upload an MP4 to our server or paste a YouTube link, then publish it for one audience.
 * Apps: GET /api/training/:audience lists the published ones for the signed-in seller or rider.
 */

export const TRAINING_VIDEO_CATEGORY = 'admin.trainingvideo';

/** YouTube video id from the link formats people paste (watch, youtu.be, shorts, embed, live), else ''. */
export function youtubeIdFrom(input) {
  const text = String(input || '').trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(text)) return text;
  let url;
  try { url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`); } catch { return ''; }
  const host = url.hostname.replace(/^(www\.|m\.|music\.)/, '');
  let id = '';
  if (host === 'youtu.be') id = url.pathname.split('/')[1] || '';
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    id = url.searchParams.get('v') || '';
    const [, kind, rest] = url.pathname.split('/');
    if (!id && ['shorts', 'embed', 'live', 'v'].includes(kind)) id = rest || '';
  }
  return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : '';
}

const view = (v) => ({
  _id: v._id,
  audience: v.audience,
  title: v.title,
  description: v.description || '',
  topic: v.topic || 'General',
  source: v.source,
  videoUrl: v.source === 'upload' ? v.videoUrl : '',
  youtubeId: v.source === 'youtube' ? v.youtubeId : '',
  // Opened in the YouTube app or the phone's video player.
  watchUrl: v.source === 'youtube' ? `https://www.youtube.com/watch?v=${v.youtubeId}` : v.videoUrl,
  thumbnailUrl: v.source === 'youtube' ? `https://img.youtube.com/vi/${v.youtubeId}/hqdefault.jpg` : '',
  durationSec: v.durationSec || null,
  sortOrder: v.sortOrder || 0,
  isPublished: v.isPublished !== false,
  updatedAt: v.updatedAt,
});

const text = (value, max, label, { required = false } = {}) => {
  if (value === undefined) return undefined;
  const s = String(value ?? '').trim();
  if (required && !s) throw httpError(400, `${label} is required`);
  if (s.length > max) throw httpError(400, `${label} must be ${max} characters or fewer`);
  return s;
};

/** Validated fields from an admin form. `existing` is the saved video when editing. */
async function fieldsFrom(body = {}, existing = null) {
  const out = {};
  const audience = body.audience ?? existing?.audience;
  if (!TRAINING_AUDIENCES.includes(audience)) throw httpError(400, 'Choose who the video is for: seller or delivery');
  out.audience = audience;
  const title = text(body.title, 120, 'Title', { required: !existing });
  if (title !== undefined) { if (!title) throw httpError(400, 'Title is required'); out.title = title; }
  const description = text(body.description, 1000, 'Description');
  if (description !== undefined) out.description = description;
  const topic = text(body.topic, 60, 'Topic');
  if (topic !== undefined) out.topic = topic || 'General';
  if (body.sortOrder !== undefined) {
    const n = Number(body.sortOrder);
    if (!Number.isFinite(n)) throw httpError(400, 'Order must be a number');
    out.sortOrder = Math.round(n);
  }
  if (body.isPublished !== undefined) out.isPublished = body.isPublished === true || body.isPublished === 'true';

  const source = body.source ?? existing?.source;
  if (source === 'youtube') {
    const raw = body.youtubeUrl ?? body.youtubeId;
    if (raw !== undefined || !existing || existing.source !== 'youtube') {
      const id = youtubeIdFrom(raw);
      if (!id) throw httpError(400, 'Paste a valid YouTube video link');
      out.youtubeId = id;
    }
    out.source = 'youtube';
    out.videoUrl = '';
  } else if (source === 'upload') {
    const url = body.videoUrl !== undefined ? String(body.videoUrl || '').trim() : existing?.videoUrl;
    if (!url) throw httpError(400, 'Upload the training video first');
    if (url !== existing?.videoUrl) {
      // Only a training video this server stored is accepted, never an outside link.
      const key = keyFromPublicUrl(url);
      const media = key ? await Media.findOne({ storageKey: key }).select('category uploadStatus durationSec').lean() : null;
      if (!media || media.category !== TRAINING_VIDEO_CATEGORY || media.uploadStatus === 'deleted') {
        throw httpError(400, 'Upload the training video again — that video link was not found');
      }
      out.durationSec = media.durationSec;
    }
    out.source = 'upload';
    out.videoUrl = url;
    out.youtubeId = '';
  } else {
    throw httpError(400, 'Choose a video source: upload or YouTube');
  }
  return out;
}

const validId = (id) => { if (!mongoose.isValidObjectId(id)) throw httpError(404, 'Training video not found'); return id; };

// ---- Admin -------------------------------------------------------------------------------------

// POST /api/admin/training-videos/upload (multipart "video") -> { url, durationSec }
export const uploadTrainingVideo = asyncHandler(async (req, res) => {
  const file = req.file;
  if (!file?.path) throw httpError(400, 'Choose a video to upload');
  try {
    const { media, reference } = await storeUpload({ source: { filePath: file.path, size: file.size }, category: TRAINING_VIDEO_CATEGORY, ...mediaContext(req, file) });
    return created(res, { url: reference, durationSec: media.durationSec, sizeBytes: media.sizeBytes }, 'Video uploaded');
  } finally {
    await unlink(file.path).catch(() => {});
  }
});

// GET /api/admin/training-videos?audience=seller|delivery
export const adminListTrainingVideos = asyncHandler(async (req, res) => {
  const filter = TRAINING_AUDIENCES.includes(req.query.audience) ? { audience: req.query.audience } : {};
  const rows = await TrainingVideo.find(filter).sort({ audience: 1, topic: 1, sortOrder: 1, createdAt: 1 }).lean();
  return ok(res, rows.map(view));
});

// POST /api/admin/training-videos
export const createTrainingVideo = asyncHandler(async (req, res) => {
  const fields = await fieldsFrom(req.body);
  const row = await TrainingVideo.create({ ...fields, createdBy: req.user?._id });
  return created(res, view(row), 'Training video saved');
});

// PATCH /api/admin/training-videos/:id
export const updateTrainingVideo = asyncHandler(async (req, res) => {
  const row = await TrainingVideo.findById(validId(req.params.id));
  if (!row) throw httpError(404, 'Training video not found');
  const previousUrl = row.source === 'upload' ? row.videoUrl : '';
  Object.assign(row, await fieldsFrom(req.body, row));
  await row.save();
  if (previousUrl && previousUrl !== row.videoUrl) await removeByReference(previousUrl).catch(() => {});
  return ok(res, view(row), 'Training video updated');
});

// DELETE /api/admin/training-videos/:id — also removes an uploaded file from our server.
export const deleteTrainingVideo = asyncHandler(async (req, res) => {
  const row = await TrainingVideo.findByIdAndDelete(validId(req.params.id));
  if (!row) throw httpError(404, 'Training video not found');
  if (row.source === 'upload' && row.videoUrl) await removeByReference(row.videoUrl).catch(() => {});
  return ok(res, null, 'Training video deleted');
});

// ---- Seller and rider apps ---------------------------------------------------------------------

// GET /api/training/:audience — published videos for the signed-in seller ('seller') or rider ('delivery').
export const listTrainingVideos = asyncHandler(async (req, res) => {
  const { audience } = req.params;
  if (!TRAINING_AUDIENCES.includes(audience)) throw httpError(404, 'Not found');
  if (req.userType !== 'admin') {
    const roles = req.user?.roles || [];
    const allowed = audience === 'seller' ? roles.includes('seller') && req.tokenRole !== 'delivery' : roles.includes('delivery') && req.tokenRole !== 'seller';
    if (!allowed) throw httpError(403, audience === 'seller' ? 'Seller account required' : 'Delivery account required');
  }
  const rows = await TrainingVideo.find({ audience, isPublished: true }).sort({ topic: 1, sortOrder: 1, createdAt: 1 }).lean();
  return ok(res, rows.map(view));
});
