import { createHmac, timingSafeEqual } from 'node:crypto';
import Media from '../models/Media.js';
import { assertServerStorageConfig, getStorageConfig } from '../config/storage.js';

// Media references stored in business records:
//   public media   → absolute URL  `${MEDIA_PUBLIC_BASE_URL}/media/<dir>/<yyyy>/<mm>/<file>`
//   private media  → opaque string `media:<mediaId>` (not fetchable)
//
// API responses pass through resolveResponseText (middlewares/mediaResponse.middleware.js),
// which turns private references into short-lived signed URLs for viewers who
// may see them. The endpoint that produced the response has already applied
// its own business authorisation (this customer's return, this rider's order,
// an admin's seller dossier), so a private reference is signed for any
// authenticated viewer of that response — except identity/bank documents
// (private-kyc), which are signed only for an admin or the document owner.
//
// With MEDIA_LEGACY_READ_MAP=on, exact Cloudinary URLs that have a verified
// migrated copy are replaced the same way at read time. Stored records —
// including historical orders and returns — are never rewritten by this.

export const MEDIA_REF_PREFIX = 'media:';
const REF_PATTERN = /"media:([a-f0-9]{24})"/g;
const LEGACY_PATTERN = /"(https:\/\/res\.cloudinary\.com\/[^"\\\s]{1,1000})"/g;

export const privateRef = (mediaId) => `${MEDIA_REF_PREFIX}${mediaId}`;
export const parsePrivateRef = (value) => {
  const match = /^media:([a-f0-9]{24})$/.exec(String(value || ''));
  return match ? match[1] : null;
};

export const publicUrlForKey = (key) => {
  const { publicBaseUrl } = assertServerStorageConfig(getStorageConfig());
  const [area, ...rest] = String(key).split('/');
  if (area !== 'public') throw new Error('Only public keys have public URLs');
  return `${publicBaseUrl}/media/${rest.join('/')}`;
};

/** Reference string to store in a business record for a newly stored media item. */
export const referenceFor = (media, key) => (media.visibility === 'public' ? publicUrlForKey(key) : privateRef(media._id));

// ---------------------------------------------------------------- signing

const signature = (mediaId, expires, viewerId) => createHmac('sha256', getStorageConfig().signingSecret)
  .update(`${mediaId}.${expires}.${viewerId}`)
  .digest('base64url');

export const signedUrl = (mediaId, viewerId, now = Date.now()) => {
  const config = assertServerStorageConfig(getStorageConfig());
  const expires = Math.floor(now / 1000) + config.signedUrlTtlSeconds;
  const sig = signature(String(mediaId), expires, String(viewerId));
  return `${config.publicBaseUrl}/media/s/${mediaId}?e=${expires}&v=${viewerId}&s=${sig}`;
};

export const verifySignedRequest = ({ mediaId, e, v, s }, now = Date.now(), { ignoreExpiry = false } = {}) => {
  if (!/^[a-f0-9]{24}$/.test(String(mediaId)) || !/^\d{1,12}$/.test(String(e)) || !/^[a-f0-9]{24}$/.test(String(v)) || typeof s !== 'string') return false;
  if (!ignoreExpiry && Number(e) < Math.floor(now / 1000)) return false;
  if (Number(e) > Math.floor(now / 1000) + 3600) return false;
  const expected = Buffer.from(signature(mediaId, Number(e), v));
  const actual = Buffer.from(s);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
};

// ---------------------------------------------------------------- viewers

export const viewerFromRequest = (req) => (req?.user?._id ? { id: String(req.user._id), isAdmin: req.userType === 'admin' } : null);

export const mayViewPrivate = (media, viewer) => {
  if (!viewer) return false;
  if (media.visibility !== 'private-kyc') return true;
  return viewer.isAdmin || (media.ownerId && String(media.ownerId) === viewer.id);
};

// ---------------------------------------------------------------- response resolution

const cache = new Map();
const CACHE_TTL_MS = 60_000;
const CACHE_MAX = 5000;
const cached = (key) => {
  const hit = cache.get(key);
  if (hit && hit.at > Date.now() - CACHE_TTL_MS) return hit.value;
  cache.delete(key);
  return undefined;
};
const remember = (key, value) => {
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(key, { at: Date.now(), value });
};

const lookup = async ({ ids, legacyUrls }) => {
  const byId = new Map();
  const byLegacy = new Map();
  const missingIds = ids.filter((id) => { const hit = cached(`id:${id}`); if (hit !== undefined) byId.set(id, hit); return hit === undefined; });
  const missingUrls = legacyUrls.filter((url) => { const hit = cached(`url:${url}`); if (hit !== undefined) byLegacy.set(url, hit); return hit === undefined; });
  if (missingIds.length || missingUrls.length) {
    const or = [];
    if (missingIds.length) or.push({ _id: { $in: missingIds } });
    if (missingUrls.length) or.push({ 'legacy.url': { $in: missingUrls }, migrationStatus: 'verified' });
    const rows = await Media.find({ $or: or, uploadStatus: 'stored' })
      .select('+storageKey visibility ownerId category legacy.url migrationStatus').lean();
    for (const row of rows) {
      if (missingIds.includes(String(row._id))) byId.set(String(row._id), row);
      if (row.legacy?.url && missingUrls.includes(row.legacy.url)) byLegacy.set(row.legacy.url, row);
    }
    for (const id of missingIds) { if (!byId.has(id)) byId.set(id, null); remember(`id:${id}`, byId.get(id)); }
    for (const url of missingUrls) { if (!byLegacy.has(url)) byLegacy.set(url, null); remember(`url:${url}`, byLegacy.get(url)); }
  }
  return { byId, byLegacy };
};

const resolvedValue = (media, viewer) => {
  if (media.visibility === 'public') return publicUrlForKey(media.storageKey);
  if (mayViewPrivate(media, viewer)) return signedUrl(media._id, viewer.id);
  // Not viewable here: a non-fetchable reference, so "document on file" checks
  // still work and a migrated legacy KYC URL is no longer handed out.
  return privateRef(media._id);
};

/**
 * Rewrite media references inside a serialised JSON response body.
 * Unknown references are left as they are; private references for viewers
 * who may not see them stay opaque. Never fetches any URL.
 */
export const resolveResponseText = async (text, req) => {
  const config = getStorageConfig();
  const ids = [...new Set([...text.matchAll(REF_PATTERN)].map((m) => m[1]))];
  const legacyUrls = config.legacyReadMap ? [...new Set([...text.matchAll(LEGACY_PATTERN)].map((m) => m[1]))] : [];
  if (!ids.length && !legacyUrls.length) return text;

  const viewer = viewerFromRequest(req);
  const { byId, byLegacy } = await lookup({ ids, legacyUrls });
  const replace = (match, media) => (media ? JSON.stringify(resolvedValue(media, viewer)) : match);
  let output = ids.length ? text.replace(REF_PATTERN, (match, id) => replace(match, byId.get(id))) : text;
  if (legacyUrls.length) output = output.replace(LEGACY_PATTERN, (match, url) => replace(match, byLegacy.get(url)));
  return output;
};

export const clearMediaUrlCache = () => cache.clear();

// ---------------------------------------------------------------- request normalisation

const parseSignedUrl = (value) => {
  const { publicBaseUrl } = getStorageConfig();
  if (!publicBaseUrl || !value.startsWith(`${publicBaseUrl}/media/s/`)) return null;
  let url;
  try { url = new URL(value); } catch { return null; }
  const mediaId = url.pathname.split('/').pop();
  const request = { mediaId, e: url.searchParams.get('e'), v: url.searchParams.get('v'), s: url.searchParams.get('s') };
  // Expiry is ignored: a form may be submitted long after its preview link was issued.
  return verifySignedRequest(request, Date.now(), { ignoreExpiry: true }) ? mediaId : null;
};

const collectStrings = (value, visit, depth = 0) => {
  if (depth > 10 || !value || typeof value !== 'object') return;
  for (const key of Object.keys(value)) {
    if (typeof value[key] === 'string') visit(value, key);
    else collectStrings(value[key], visit, depth + 1);
  }
};

/**
 * Normalise media values a client sends back (e.g. a landmark photo chosen
 * earlier in the form). Runs after authentication, on JSON bodies:
 *  - a signed URL this server issued       → its stable `media:<id>` reference
 *  - a raw `media:<id>` reference          → kept only if the caller owns it (or is an admin), else null
 * Prevents a client from attaching someone else's private file by guessing an ID.
 */
export const normalizeMediaInput = async (req) => {
  if (!req.body || typeof req.body !== 'object') return;
  const text = JSON.stringify(req.body);
  if (!text.includes('media:') && !text.includes('/media/s/')) return;
  const raw = [];
  collectStrings(req.body, (holder, key) => {
    const value = holder[key];
    const signedId = parseSignedUrl(value);
    if (signedId) holder[key] = privateRef(signedId);
    else if (parsePrivateRef(value)) raw.push([holder, key, parsePrivateRef(value)]);
  });
  if (!raw.length) return;
  const isAdmin = req.userType === 'admin';
  const owned = isAdmin ? null : new Set((await Media.find({ _id: { $in: raw.map(([, , id]) => id) }, ownerId: req.user?._id }).select('_id').lean()).map((m) => String(m._id)));
  for (const [holder, key, id] of raw) if (!isAdmin && !owned.has(id)) holder[key] = null;
};
