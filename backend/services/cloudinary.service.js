import { v2 as cloudinary } from 'cloudinary';

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

const parseCloudinaryUrl = (url) => {
  const m = /^cloudinary:\/\/([^:]+):([^@]+)@(.+)$/.exec((url || '').trim());
  if (!m) return null;
  return { api_key: m[1], api_secret: m[2], cloud_name: m[3] };
};

const fromUrl = parseCloudinaryUrl(process.env.CLOUDINARY_URL);

export const cloudinaryConfig = fromUrl || {
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
};

cloudinary.config(cloudinaryConfig);

export const isCloudinaryConfigured = () =>
  Boolean(cloudinaryConfig.cloud_name && cloudinaryConfig.api_key && cloudinaryConfig.api_secret);

/** Read-only credential check. Creates nothing on the account. */
export const verifyCloudinary = async () => {
  if (!isCloudinaryConfigured()) {
    return { ok: false, message: 'Cloudinary credentials are missing from .env' };
  }
  try {
    await cloudinary.api.ping();
    return { ok: true, cloudName: cloudinaryConfig.cloud_name };
  } catch (err) {
    const message = err?.error?.message || err.message || 'Unknown Cloudinary error';
    return { ok: false, cloudName: cloudinaryConfig.cloud_name, message };
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
  if (!isCloudinaryConfigured()) {
    throw Object.assign(
      new Error('File upload is unavailable — Cloudinary is not configured on the server.'),
      { status: 503 }
    );
  }

  return new Promise((resolve, reject) => {
    cloudinary.uploader
      .upload_stream({ folder: `nhcone/${folder}`, resource_type: 'auto', ...options }, (error, result) => {
        if (error) {
          // Surface the real cause instead of a generic 500 — the most common
          // failure here is an incorrect cloud_name.
          const msg = error.message || 'Cloudinary upload failed';
          return reject(
            Object.assign(new Error(`Document upload failed: ${msg}`), { status: 502 })
          );
        }
        resolve(result.secure_url);
      })
      .end(buffer);
  });
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
  if (!isCloudinaryConfigured()) {
    throw Object.assign(
      new Error('File upload is unavailable — Cloudinary is not configured on the server.'),
      { status: 503 }
    );
  }

  return new Promise((resolve, reject) => {
    cloudinary.uploader
      .upload_stream({ folder: `nhcone/${folder}`, resource_type: 'auto', ...options }, (error, result) => {
        if (error) {
          const msg = error.message || 'Cloudinary upload failed';
          return reject(Object.assign(new Error(`Attachment upload failed: ${msg}`), { status: 502 }));
        }
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
};
