import { unlink } from 'node:fs/promises';
import Media from '../models/Media.js';
import { httpError } from '../utils/response.js';
import { keyFromPublicUrl, mediaContext, storeUpload } from './media.service.js';

/**
 * Product videos: uploaded one at a time to our own server (media category `seller.productvideo`,
 * MP4 H.264 ≤ 60 s, ≤ 1080p, ≤ 50 MB — see mediaPolicy.service.js), then attached to a product by URL.
 * A product only accepts video URLs this server stored for the same seller, so nobody can attach an
 * outside link or another seller's clip.
 */

export const MAX_PRODUCT_VIDEOS = 2;
export const PRODUCT_VIDEO_CATEGORY = 'seller.productvideo';

/** Stores the uploaded temp file; the temp file is always removed. */
export async function storeProductVideo(req) {
  const file = req.file;
  if (!file?.path) throw httpError(400, 'Choose a video to upload');
  try {
    const { media, reference } = await storeUpload({
      source: { filePath: file.path, size: file.size },
      category: PRODUCT_VIDEO_CATEGORY,
      ...mediaContext(req, file),
    });
    return { url: reference, durationSec: media.durationSec, width: media.width, height: media.height, sizeBytes: media.sizeBytes };
  } finally {
    await unlink(file.path).catch(() => {});
  }
}

/**
 * The `videos` a product form sent (JSON array or array of URLs) → clean list, or undefined when the
 * field was not sent (keep what the product has). URLs already on the product stay allowed (e.g. when
 * an admin saves it); new ones must be this seller's own uploaded product videos.
 */
export async function resolveProductVideos(raw, { ownerId, existing = [] } = {}) {
  if (raw === undefined) return undefined;
  let list = raw;
  if (typeof raw === 'string') {
    if (!raw.trim()) return [];
    try { list = JSON.parse(raw); } catch { throw httpError(400, 'Videos must be a list of uploaded video links'); }
  }
  if (!Array.isArray(list)) throw httpError(400, 'Videos must be a list of uploaded video links');
  const urls = [...new Set(list.map((u) => String(u || '').trim()).filter(Boolean))];
  if (urls.length > MAX_PRODUCT_VIDEOS) throw httpError(400, `A product can have at most ${MAX_PRODUCT_VIDEOS} videos`);
  const kept = new Set((existing || []).map(String));
  for (const url of urls) {
    if (kept.has(url)) continue;
    const key = keyFromPublicUrl(url);
    const media = key ? await Media.findOne({ storageKey: key }).select('category ownerId uploadStatus').lean() : null;
    if (!media || media.category !== PRODUCT_VIDEO_CATEGORY || media.uploadStatus === 'deleted'
      || !ownerId || String(media.ownerId) !== String(ownerId)) {
      throw httpError(400, 'Upload the product video again — that video link was not found');
    }
  }
  return urls;
}
