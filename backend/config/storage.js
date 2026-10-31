import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Central media-storage configuration. Values are read on each call so tests
// and a PM2 `--update-env` restart see the current environment.
const PROJECT_ROOT = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));

const configError = (message) => Object.assign(new Error(message), { status: 503, code: 'MEDIA_STORAGE_UNAVAILABLE' });

const inside = (root, candidate) => {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
};

const parseProviders = (raw) => {
  if (!raw || !String(raw).trim()) return {};
  let parsed;
  try { parsed = JSON.parse(raw); } catch { throw configError('MEDIA_PROVIDERS must be a JSON object.'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw configError('MEDIA_PROVIDERS must be a JSON object.');
  for (const value of Object.values(parsed)) {
    if (!['server', 'cloudinary'].includes(value)) throw configError('MEDIA_PROVIDERS values must be "server" or "cloudinary".');
  }
  return parsed;
};

export const getStorageConfig = (env = process.env) => {
  const root = String(env.MEDIA_ROOT || '').trim();
  const defaultProvider = String(env.MEDIA_PROVIDER_DEFAULT || 'cloudinary').trim();
  if (!['server', 'cloudinary'].includes(defaultProvider)) throw configError('MEDIA_PROVIDER_DEFAULT must be "server" or "cloudinary".');
  const ttl = Number(env.MEDIA_SIGNED_URL_TTL_SECONDS || 900);
  const minFree = Number(env.MEDIA_MIN_FREE_BYTES || 2 * 1024 ** 3);
  return {
    root: root ? path.resolve(root) : '',
    publicBaseUrl: String(env.MEDIA_PUBLIC_BASE_URL || '').trim().replace(/\/+$/, ''),
    signingSecret: String(env.MEDIA_SIGNING_SECRET || ''),
    signedUrlTtlSeconds: Number.isSafeInteger(ttl) && ttl >= 60 && ttl <= 3600 ? ttl : 900,
    minFreeBytes: Number.isSafeInteger(minFree) && minFree >= 0 ? minFree : 2 * 1024 ** 3,
    defaultProvider,
    providers: parseProviders(env.MEDIA_PROVIDERS),
    legacyReadMap: env.MEDIA_LEGACY_READ_MAP === 'on',
  };
};

export const providerFor = (category, config = getStorageConfig()) => config.providers[category] || config.defaultProvider;

export const serverStorageRequested = (config = getStorageConfig()) =>
  config.defaultProvider === 'server' || Object.values(config.providers).includes('server');

/**
 * Throws unless server storage can be used safely: an absolute root outside the
 * repository/deploy tree, a signing secret, and an absolute public base URL.
 */
export const assertServerStorageConfig = (config = getStorageConfig()) => {
  if (!config.root) throw configError('Server media storage is not configured (MEDIA_ROOT).');
  if (inside(PROJECT_ROOT, config.root) || inside(config.root, PROJECT_ROOT)) {
    throw configError('MEDIA_ROOT must be outside the application repository and deploy directory.');
  }
  if (config.signingSecret.length < 32) throw configError('MEDIA_SIGNING_SECRET must be at least 32 characters.');
  let base;
  try { base = new URL(config.publicBaseUrl); } catch { throw configError('MEDIA_PUBLIC_BASE_URL must be an absolute https URL.'); }
  if (base.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(base.hostname)) {
    throw configError('MEDIA_PUBLIC_BASE_URL must use https.');
  }
  return config;
};

/** Startup check: only enforced when at least one category is switched to server storage. */
export const validateStorageStartupConfig = (env = process.env) => {
  const config = getStorageConfig(env);
  if (serverStorageRequested(config) || config.legacyReadMap) assertServerStorageConfig(config);
  return config;
};

export const MEDIA_PROJECT_ROOT = PROJECT_ROOT;
