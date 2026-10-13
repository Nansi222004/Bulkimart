import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { v2 as cloudinary } from 'cloudinary';
import { getCloudinaryConfig } from '../config/cloudinary.js';

/**
 * Saves a buffer to local disk storage as a resilient fallback
 * when remote Cloudinary is unavailable or rejected.
 */
export const saveLocally = (buffer, folder) => {
  const uploadsDir = path.resolve(import.meta.dirname, '../uploads');
  const cleanFolder = String(folder || 'general').replace(/[^a-zA-Z0-9_\-\/]/g, '_');
  const targetDir = path.join(uploadsDir, cleanFolder);
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  let ext = 'jpg';
  if (Buffer.isBuffer(buffer) && buffer.length >= 4) {
    const magic4 = buffer.slice(0, 4).toString('hex').toLowerCase();
    if (magic4 === '89504e47') ext = 'png';
    else if (magic4 === '25504446') ext = 'pdf';
    else if (magic4 === '52494646') ext = 'webp';
  }

  const filename = `${crypto.randomUUID()}.${ext}`;
  const filePath = path.join(targetDir, filename);
  fs.writeFileSync(filePath, buffer);

  const baseUrl = (process.env.PUBLIC_API_URL || process.env.BACKEND_URL || process.env.API_BASE_URL || '').replace(/\/$/, '');
  const relativePath = `/uploads/${cleanFolder}/${filename}`.replace(/\\/g, '/');
  return baseUrl ? `${baseUrl}${relativePath}` : relativePath;
};

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
 * Folders containing identity/KYC documents that must NEVER be stored
 * on the local filesystem where they could be exposed without authorization.
 * These paths must only go through Cloudinary (or an equivalent secured store).
 */
const SENSITIVE_FOLDER_PREFIXES = [
  'seller-kyc', 'seller-bank', 'delivery-kyc', 'driver-',
];
export const isSensitiveFolder = (folder) =>
  SENSITIVE_FOLDER_PREFIXES.some((prefix) => String(folder || '').startsWith(prefix));

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
export const uploadToCloudinary = async (buffer, folder, options = {}) => {
  if (process.env.NODE_ENV === 'test') {
    assertCloudinaryConfigured();
    return new Promise((resolve, reject) => {
      cloudinary.uploader
        .upload_stream({ folder: `nhcone/${folder}`, resource_type: 'auto', ...options }, (error, result) => {
          if (error) return reject(safeCloudinaryUploadError(error));
          resolve(result.secure_url);
        })
        .end(buffer);
    });
  }

  // Runtime (development & production): try Cloudinary first if configured
  if (isCloudinaryConfigured()) {
    try {
      const url = await new Promise((resolve, reject) => {
        cloudinary.uploader
          .upload_stream({ folder: `nhcone/${folder}`, resource_type: 'auto', ...options }, (error, result) => {
            if (error) return reject(safeCloudinaryUploadError(error));
            resolve(result.secure_url);
          })
          .end(buffer);
      });
      return url;
    } catch (err) {
      // KYC/identity documents must NEVER fall back to unsecured local disk.
      // Only non-sensitive uploads (product images, banners) may use the fallback.
      if (isSensitiveFolder(folder)) {
        throw err;
      }
      console.warn(`[UPLOAD] Cloudinary rejected (${err.message}). Using local storage fallback.`);
    }
  } else if (isSensitiveFolder(folder)) {
    // Cloudinary not configured at all — refuse KYC uploads until it is.
    assertCloudinaryConfigured();
  }

  // Resilient fallback to local disk storage (non-sensitive files only)
  return saveLocally(buffer, folder);
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
  if (process.env.NODE_ENV === 'test') {
    assertCloudinaryConfigured();
    return new Promise((resolve, reject) => {
      cloudinary.uploader
        .upload_stream({ folder: `nhcone/${folder}`, resource_type: 'auto', ...options }, (error, result) => {
          if (error) return reject(safeCloudinaryUploadError(error, 'Attachment'));
          resolve({
            url: result.secure_url,
            publicId: result.public_id,
            resourceType: result.resource_type,
            size: result.bytes,
            format: result.format,
          });
        })
        .end(buffer);
    });
  }

  if (isCloudinaryConfigured()) {
    try {
      return await new Promise((resolve, reject) => {
        cloudinary.uploader
          .upload_stream({ folder: `nhcone/${folder}`, resource_type: 'auto', ...options }, (error, result) => {
            if (error) return reject(safeCloudinaryUploadError(error, 'Attachment'));
            resolve({
              url: result.secure_url,
              publicId: result.public_id,
              resourceType: result.resource_type,
              size: result.bytes,
              format: result.format,
            });
          })
          .end(buffer);
      });
    } catch (err) {
      if (isSensitiveFolder(folder)) {
        throw err;
      }
      console.warn(`[UPLOAD] Cloudinary attachment rejected (${err.message}). Using local storage fallback.`);
    }
  } else if (isSensitiveFolder(folder)) {
    assertCloudinaryConfigured();
  }

  const localUrl = saveLocally(buffer, folder);
  return {
    url: localUrl,
    publicId: path.basename(localUrl),
    resourceType: 'auto',
    size: buffer?.length || 0,
    format: path.extname(localUrl).slice(1) || 'jpg',
  };
};
