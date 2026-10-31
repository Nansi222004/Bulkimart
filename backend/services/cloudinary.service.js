import { v2 as cloudinary } from 'cloudinary';
import { getCloudinaryConfig } from '../config/cloudinary.js';
import { providerFor } from '../config/storage.js';
import { categoryForFolder, isSensitiveCategory } from './mediaPolicy.service.js';
import { storeUpload } from './media.service.js';

// There is deliberately no local-disk fallback. The former one wrote into the
// backend deploy directory (lost on redeploy) and returned /uploads/... URLs
// that no route serves, so a failed upload looked successful but produced a
// broken link. A failed upload now fails visibly (see docs/STORAGE_SECURITY_REPORT.md F2/F3).

/**
 * Configuration accepts either form:
 *
 *   1. CLOUDINARY_URL=cloudinary://<api_key>:<api_secret>@<cloud_name>
 *      (copy/paste straight from the Cloudinary dashboard — preferred, since it
 *       makes the "wrong cloud_name" mistake impossible)
 *
 *   2. CLOUDINARY_CLOUD_NAME / CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET
 *
 * NOTE: the cloud name is the auto-generated identifier after the "@" in the
 * dashboard URL (e.g. "dxk3f9abc") — NOT your account name or a Media Library
 * folder name. Using the wrong one fails with 401 "cloud_name mismatch".
 */

/**
 * Identity, licence and bank document folders (Aadhaar, PAN, trade licence,
 * GST certificate, passbooks, driving licence). Classification comes from the
 * central category policy (mediaPolicy.service.js), so `seller-docs` and
 * `delivery-bank` are covered alongside seller/delivery KYC.
 */
export const isSensitiveFolder = (folder) => isSensitiveCategory(categoryForFolder(folder));

export const cloudinaryConfig = getCloudinaryConfig();

cloudinary.config(cloudinaryConfig);

export const isCloudinaryConfigured = (config = cloudinaryConfig) =>
  Boolean(config?.cloud_name && config?.api_key && config?.api_secret);

export const assertCloudinaryConfigured = (config = cloudinaryConfig) => {
  if (isCloudinaryConfigured(config)) return;
  throw Object.assign(
    new Error('Document upload is temporarily unavailable because server upload configuration is incomplete.'),
    { status: 503, code: 'UPLOAD_CONFIGURATION_MISSING' },
  );
};

/** Cloudinary authentication errors can echo a signature and timestamp. Those
 * values are useful to the provider but must never be reflected into a browser. */
export const safeCloudinaryUploadError = (error, noun = 'Document') => {
  const providerMessage = String(error?.message || error?.error?.message || '');
  const providerStatus = Number(error?.http_code || error?.error?.http_code || 0);
  const configurationRejected = providerStatus === 401
    || /invalid signature|unknown api key|cloud_name mismatch|must supply api_key/i.test(providerMessage);
  const message = configurationRejected
    ? `${noun} upload is temporarily unavailable because the upload provider rejected the server configuration.`
    : `${noun} upload failed. Please try again.`;
  return Object.assign(new Error(message), {
    status: configurationRejected ? 503 : 502,
    code: configurationRejected ? 'UPLOAD_CONFIGURATION_REJECTED' : 'UPLOAD_PROVIDER_ERROR',
  });
};

/** Read-only credential check. Creates nothing on the account. */
export const verifyCloudinary = async () => {
  if (!isCloudinaryConfigured()) {
    return {
      ok: false,
      code: 'UPLOAD_CONFIGURATION_MISSING',
      message: 'Document upload configuration is incomplete.',
    };
  }
  try {
    await cloudinary.api.ping();
    return { ok: true };
  } catch (err) {
    const safeError = safeCloudinaryUploadError(err);
    return { ok: false, code: safeError.code, message: safeError.message };
  }
};

/**
 * Upload a buffer (from Multer memory storage) to Cloudinary.
 *
 * `options` is merged into the upload call. Pass
 * `{ resource_type: 'image', format: 'png' }` for anything Cloudinary would
 * otherwise treat as raw — an SVG buffer has no binary image signature, so
 * `resource_type: 'auto'` files it under /raw/ and serves it as
 * application/octet-stream, which no browser renders in an <img> tag.
 */
// Missing configuration or a provider failure rejects with a sanitized error
// for every folder; nothing is written anywhere else.
const streamUpload = (buffer, folder, options, noun) => {
  assertCloudinaryConfigured();
  return new Promise((resolve, reject) => {
    cloudinary.uploader
      .upload_stream({ folder: `nhcone/${folder}`, resource_type: 'auto', ...options }, (error, result) => {
        if (error) return reject(safeCloudinaryUploadError(error, noun));
        resolve(result);
      })
      .end(buffer);
  });
};

// Keys callers add for server storage; never forwarded to Cloudinary.
const MEDIA_OPTION_KEYS = ['owner', 'originalName', 'declaredMime'];
const splitOptions = (options) => {
  const media = {};
  const provider = { ...options };
  for (const key of MEDIA_OPTION_KEYS) { if (key in provider) { media[key] = provider[key]; delete provider[key]; } }
  return { media, provider };
};

export const uploadsPausedError = () => Object.assign(
  new Error('Uploads of this type are temporarily paused. Please try again later.'),
  { status: 503, code: 'MEDIA_UPLOADS_PAUSED' },
);

/**
 * The media category to store on our own server, or null to keep using
 * Cloudinary. A category set to "disabled" refuses the upload (paused).
 */
const serverCategoryFor = (folder) => {
  const category = categoryForFolder(folder);
  const provider = category ? providerFor(category) : 'cloudinary';
  if (provider === 'disabled') throw uploadsPausedError();
  return provider === 'server' ? category : null;
};

const storeOnServer = (buffer, category, media, provider) => storeUpload({
  source: { buffer },
  category,
  ...media,
  // Category icons ask Cloudinary for PNG; keep that output on the server.
  output: provider.format === 'png' ? 'png' : undefined,
});

/**
 * Central upload entry point used by every controller (historical name kept so
 * call sites stay unchanged). Routes each folder's category to server storage
 * when MEDIA_PROVIDERS / MEDIA_PROVIDER_DEFAULT says "server", else Cloudinary.
 * Returns the string to store on the record: a URL, or `media:<id>` for private media.
 */
export const uploadToCloudinary = async (buffer, folder, options = {}) => {
  const { media, provider } = splitOptions(options);
  const category = serverCategoryFor(folder);
  if (category) return (await storeOnServer(buffer, category, media, provider)).reference;
  return (await streamUpload(buffer, folder, provider)).secure_url;
};

export const deleteFromCloudinary = async (publicId) => cloudinary.uploader.destroy(publicId);

/**
 * Same upload path as `uploadToCloudinary`, but returns the full metadata a
 * caller needs to store an attachment record (url/publicId/format/bytes) —
 * `uploadToCloudinary` only ever returned the bare URL, which is all its
 * existing callers (product images, KYC docs) need, so it's left alone
 * rather than changing its return shape under those callers.
 */
export const uploadFileWithMeta = async (buffer, folder, options = {}) => {
  const { media, provider } = splitOptions(options);
  const category = serverCategoryFor(folder);
  if (category) {
    const { media: stored, reference } = await storeOnServer(buffer, category, media, provider);
    return {
      url: reference,
      publicId: String(stored._id),
      resourceType: stored.mimeType.startsWith('image/') ? 'image' : 'raw',
      size: stored.sizeBytes,
      format: stored.extension,
    };
  }
  const result = await streamUpload(buffer, folder, provider, 'Attachment');
  return {
    url: result.secure_url,
    publicId: result.public_id,
    resourceType: result.resource_type,
    size: result.bytes,
    format: result.format,
  };
};
