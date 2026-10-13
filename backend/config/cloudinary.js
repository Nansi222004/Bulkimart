import fs from 'node:fs';
import path from 'node:path';

export const CLOUDINARY_ENV_KEYS = [
  'CLOUDINARY_URL',
  'CLOUDINARY_CLOUD_NAME',
  'CLOUDINARY_API_KEY',
  'CLOUDINARY_API_SECRET',
];

const configurationError = (message, code) => Object.assign(new Error(message), {
  status: 503,
  code,
});

const normalizeEnvFileValue = (value) => {
  const trimmed = String(value ?? '').trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
};

/** Returns key names/counts only; credential values never leave this module. */
export const inspectCloudinaryEnvText = (source = '') => {
  const definitions = Object.fromEntries(CLOUDINARY_ENV_KEYS.map((key) => [key, []]));
  for (const line of String(source).split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match || !CLOUDINARY_ENV_KEYS.includes(match[1])) continue;
    definitions[match[1]].push(normalizeEnvFileValue(match[2]));
  }

  const duplicateKeys = CLOUDINARY_ENV_KEYS.filter((key) => definitions[key].length > 1);
  const conflictingKeys = duplicateKeys.filter((key) => (
    new Set(definitions[key].filter(Boolean)).size > 1
  ));
  return {
    duplicateKeys,
    conflictingKeys,
    counts: Object.fromEntries(CLOUDINARY_ENV_KEYS.map((key) => [key, definitions[key].length])),
  };
};

const findLoadedEnvFile = (env = process.env) => {
  const configured = env.DOTENV_CONFIG_PATH?.trim();
  const candidates = configured
    ? [path.resolve(process.cwd(), configured)]
    : [path.resolve(process.cwd(), '.env'), path.resolve(import.meta.dirname, '../.env')];
  return [...new Set(candidates)].find((candidate) => fs.existsSync(candidate));
};

/** Fail before database/network startup when a dotenv file is ambiguous. */
export const assertNoDuplicateCloudinaryEnvDefinitions = ({ env = process.env, source } = {}) => {
  let text = source;
  if (text === undefined) {
    const envPath = findLoadedEnvFile(env);
    if (!envPath) return;
    text = fs.readFileSync(envPath, 'utf8');
  }
  const inspection = inspectCloudinaryEnvText(text);
  if (!inspection.duplicateKeys.length) return;
  const conflictSuffix = inspection.conflictingKeys.length
    ? ` Conflicting values were found for: ${inspection.conflictingKeys.join(', ')}.`
    : '';
  throw configurationError(
    `Cloudinary variables must each be defined once. Duplicate keys: ${inspection.duplicateKeys.join(', ')}.${conflictSuffix}`,
    inspection.conflictingKeys.length ? 'UPLOAD_CONFIGURATION_CONFLICT' : 'UPLOAD_CONFIGURATION_DUPLICATE',
  );
};

export const parseCloudinaryUrl = (url) => {
  const value = String(url || '').trim();
  if (!value) return null;
  const match = /^cloudinary:\/\/([^:]+):([^@]+)@(.+)$/.exec(value);
  if (!match) {
    throw configurationError('CLOUDINARY_URL is malformed.', 'UPLOAD_CONFIGURATION_INVALID');
  }
  try {
    return {
      api_key: decodeURIComponent(match[1]).trim(),
      api_secret: decodeURIComponent(match[2]).trim(),
      cloud_name: decodeURIComponent(match[3]).trim(),
    };
  } catch {
    throw configurationError('CLOUDINARY_URL contains invalid encoding.', 'UPLOAD_CONFIGURATION_INVALID');
  }
};

export const getCloudinaryConfig = (env = process.env) => {
  const fromUrl = parseCloudinaryUrl(env.CLOUDINARY_URL);
  const individual = {
    cloud_name: env.CLOUDINARY_CLOUD_NAME?.trim(),
    api_key: env.CLOUDINARY_API_KEY?.trim(),
    api_secret: env.CLOUDINARY_API_SECRET?.trim(),
  };
  const hasIndividual = Object.values(individual).some(Boolean);
  if (fromUrl && hasIndividual) {
    throw configurationError(
      'Configure Cloudinary with CLOUDINARY_URL or individual variables, not both.',
      'UPLOAD_CONFIGURATION_DUPLICATE_SOURCE',
    );
  }
  return fromUrl || individual;
};

export const validateCloudinaryStartupConfig = (env = process.env) => {
  assertNoDuplicateCloudinaryEnvDefinitions({ env });
  return getCloudinaryConfig(env);
};
