import { httpError } from '../utils/response.js';
import { DEFAULT_TOKENS, PRESETS, SCOPES, FREQUENCIES, SOURCES } from '../shared/storefront.mjs';
const fail = message => { throw httpError(400, message); };
const one = (value, choices, label) => choices.includes(value) ? value : fail(`Invalid ${label}`);
const str = (value, max, label) => typeof value === 'string' && value.length <= max ? value.trim() : fail(`Invalid ${label}`);
const integer = (value, min, max, label) => Number.isInteger(value) && value >= min && value <= max ? value : fail(`${label} must be ${min}–${max}`);
export const objectId = value => /^[a-f\d]{24}$/i.test(String(value || ''));
export function mediaUrl(value) {
  if (!value) return '';
  if (typeof value !== 'string' || value.length > 2048) fail('Invalid media URL');
  if (/^\/uploads\/[a-zA-Z0-9/_-]+\.(jpg|jpeg|png|webp|mp4|webm)$/.test(value)) return value;
  try { const u = new URL(value); if (u.protocol === 'https:' && !u.username && !u.password) return value; } catch { /* reject below */ }
  fail('Media must use HTTPS or the local uploads directory');
}
const luminance = color => { const rgb = color.slice(1).match(/../g).map(x => parseInt(x, 16) / 255).map(x => x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4); return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722; };
export const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + .05) / (Math.min(luminance(a), luminance(b)) + .05);
export function validateTokens(input) {
  const t = { ...DEFAULT_TOKENS, ...input };
  for (const key of Object.keys(t)) if (!(key in DEFAULT_TOKENS)) fail(`Unsupported theme token: ${key}`);
  for (const key of ['primary', 'secondary', 'accent', 'background', 'surface', 'text', 'muted', 'border']) if (!/^#[a-f\d]{6}$/i.test(t[key])) fail(`${key} must be a six-digit hex color`);
  one(t.font, ['system', 'sans', 'serif'], 'font'); one(t.card, ['rounded', 'square'], 'card style');
  one(t.button, ['rounded', 'pill'], 'button style'); one(t.gradient, ['none', 'soft'], 'gradient');
  one(t.decoration, ['none', 'dots', 'confetti'], 'decoration'); one(t.motion, ['none', 'gentle'], 'motion');
  for (const bg of ['background', 'surface']) for (const fg of ['text', 'muted']) if (contrast(t[bg], t[fg]) < 4.5) fail(`${fg} needs at least 4.5:1 contrast on ${bg}`);
  if (contrast(t.primary, '#ffffff') < 4.5 || contrast(t.secondary, '#ffffff') < 4.5) fail('Primary and secondary colors need 4.5:1 contrast with white button text');
  return t;
}
export function validateExperience(input, kind) {
  one(kind, ['theme', 'campaign', 'section'], 'record type');
  const row = { name: str(input.name, 100, 'name'), description: str(input.description ?? '', 2000, 'description'),
    scope: one(input.scope ?? 'global', SCOPES, 'scope'), device: one(input.device ?? 'all', ['all', 'mobile', 'desktop'], 'device'),
    priority: integer(input.priority ?? 0, 0, 1000, 'Priority'), order: integer(input.order ?? 0, 0, 1000, 'Order'), timezone: 'Asia/Kolkata' };
  if (!row.name) fail('Name is required');
  for (const key of ['startAt', 'endAt']) {
    row[key] = input[key] ? new Date(input[key]) : null;
    if (input[key] && (typeof input[key] !== 'string' || !/(Z|[+-]\d{2}:\d{2})$/.test(input[key]) || !Number.isFinite(row[key].getTime()))) fail(`${key} must include a valid timezone offset`);
  }
  if (row.startAt && row.endAt && row.startAt >= row.endAt) fail('End time must be after start time');
  const c = input.config;
  if (!c || typeof c !== 'object' || Array.isArray(c)) fail('Configuration is required');
  const ref = key => { if (c[key] && !objectId(c[key])) fail(`Invalid ${key}`); return c[key] || ''; };
  if (kind === 'theme') row.config = { preset: one(c.preset || 'Custom Admin Theme', Object.keys(PRESETS), 'preset'), tokens: validateTokens(c.tokens) };
  if (kind === 'campaign') row.config = {
    placement: one(c.placement || 'hero', ['hero', 'splash', 'announcement'], 'placement'), bannerId: ref('bannerId'), themeId: ref('themeId'),
    frequency: one(c.frequency || 'session', FREQUENCIES, 'frequency'), duration: integer(c.duration ?? 5, 2, 15, 'Splash duration'),
    countdown: c.countdown === true,
  };
  if (kind === 'section') row.config = { title: str(c.title || row.name, 100, 'section title'), source: one(c.source || 'recent', SOURCES, 'product source'),
    categoryId: ref('categoryId'), campaignId: ref('campaignId'), bannerId: ref('bannerId'),
    maxPrice: integer(c.maxPrice ?? 99, 1, 1000000, 'Maximum price'), limit: integer(c.limit ?? 8, 1, 24, 'Product limit'),
    variant: one(c.variant || 'plain', ['plain', 'accent', 'soft'], 'section appearance') };
  return row;
}
export function marketingPermission(req, _res, next) {
  if (req.userType !== 'admin' || (req.user?.role !== 'superAdmin' && !req.user?.permissions?.includes('manage_marketing'))) throw httpError(403, 'Marketing management permission is required');
  next();
}
