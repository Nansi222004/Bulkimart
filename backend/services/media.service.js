import Media from '../models/Media.js';
import { getCategoryPolicy } from './mediaPolicy.service.js';
import { validateUpload } from './mediaValidation.service.js';
import { buildStorageKey, filesystemProvider as storage, isValidStorageKey } from './mediaStorage.service.js';
import { parsePrivateRef, referenceFor } from './mediaUrl.service.js';
import { getStorageConfig } from '../config/storage.js';

const unavailable = () => Object.assign(new Error('Media storage is unavailable. Please try again later.'), { status: 503, code: 'MEDIA_STORAGE_UNAVAILABLE' });

/** Owner and client-declared file details, derived from the authenticated request only. */
export const mediaContext = (req, file = null) => {
  const id = req?.user?._id || null;
  const role = !id ? null
    : req.userType === 'admin' ? 'admin'
      : req.tokenRole === 'seller' ? 'seller'
        : req.tokenRole === 'delivery' ? 'delivery' : 'customer';
  return {
    owner: id ? { id, role } : null,
    ...(file ? { originalName: file.originalname, declaredMime: file.mimetype } : {}),
  };
};

const safeDisplayName = (name) => {
  const base = String(name || '').replaceAll('\\', '/').split('/').pop();
  return base.replace(/[^a-zA-Z0-9._ -]/g, '_').slice(0, 150) || undefined;
};

/**
 * Validate, store and register one upload.
 * source: { buffer } or { filePath, size }.
 * Returns { media, reference } where reference is the string to save on the
 * business record (public URL, or `media:<id>` for private categories).
 * Nothing is registered unless the durable file was written and verified.
 */
export const storeUpload = async ({ source, category, owner = null, originalName, declaredMime, output } = {}) => {
  const policy = getCategoryPolicy(category);
  const file = await validateUpload({ ...source, originalName, declaredMime }, policy, { output });

  // No content de-duplication for uploads: each upload owns its file, so the
  // failed-upload cleanup (removeByReference) can never delete a file that
  // another record shares. Migration de-duplicates by legacy URL instead.
  const key = buildStorageKey({ area: policy.visibility === 'public' ? 'public' : 'private', dir: policy.dir, ext: file.ext });
  const stored = await storage.put({ key, source: file.buffer ? { buffer: file.buffer } : { filePath: file.filePath }, visibility: policy.visibility });

  let media;
  try {
    media = await Media.create({
      storageKey: key,
      category,
      visibility: policy.visibility,
      mimeType: file.mimeType,
      extension: file.ext,
      sizeBytes: stored.sizeBytes,
      sha256: stored.sha256,
      width: file.width,
      height: file.height,
      durationSec: file.durationSec,
      originalName: safeDisplayName(originalName),
      ownerId: owner?.id || null,
      ownerRole: owner?.role || null,
    });
  } catch {
    await storage.remove(key).catch(() => {});
    throw unavailable();
  }
  return { media, reference: referenceFor(media, key) };
};

/** The storage key behind a public media URL produced by this server, else null. */
export const keyFromPublicUrl = (url) => {
  const { publicBaseUrl } = getStorageConfig();
  if (!publicBaseUrl || typeof url !== 'string' || !url.startsWith(`${publicBaseUrl}/media/`)) return null;
  const key = `public/${url.slice(`${publicBaseUrl}/media/`.length)}`;
  return isValidStorageKey(key) ? key : null;
};

/**
 * Soft-delete a server-stored item by the reference saved on a record and
 * remove its file. Only for files that are not referenced anywhere (e.g. a
 * just-uploaded image whose product failed to save). Unknown references are ignored.
 */
export const removeByReference = async (reference) => {
  const id = parsePrivateRef(reference);
  const key = id ? null : keyFromPublicUrl(reference);
  if (!id && !key) return false;
  const media = await Media.findOne(id ? { _id: id } : { storageKey: key }).select('+storageKey');
  if (!media || media.uploadStatus === 'deleted') return false;
  await storage.remove(media.storageKey);
  media.uploadStatus = 'deleted';
  media.deletedAt = new Date();
  await media.save();
  return true;
};
