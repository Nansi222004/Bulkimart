import { httpError } from '../utils/response.js';
import { DEFAULT_EFFECT, EFFECT_PRESETS } from '../shared/celebration.mjs';
import { DEFAULT_TOKENS, COLOR_KEYS, resolveTokens, PRESETS, SCOPES, FREQUENCIES, SOURCES } from '../shared/storefront.mjs';
const fail = message => { throw httpError(400, message); };
const one = (value, choices, label) => choices.includes(value) ? value : fail(`Invalid ${label}`);
const str = (value, max, label) => typeof value === 'string' && value.length <= max ? value.trim() : fail(`Invalid ${label}`);
const integer = (value, min, max, label) => Number.isInteger(value) && value >= min && value <= max ? value : fail(`${label} must be ${min}–${max}`);
export const objectId = value => /^[a-f\d]{24}$/i.test(String(value || ''));
export function validateEffect(value, scopes = ['storefront', 'homepage', 'campaign', 'banner']) {
  if (value == null) return { ...DEFAULT_EFFECT };
  if (typeof value !== 'object' || Array.isArray(value)) fail('Animation must be an object');
  for (const key of Object.keys(value)) if (!Object.hasOwn(DEFAULT_EFFECT, key)) fail(`Unsupported animation setting: ${key}`);
  const e = { ...DEFAULT_EFFECT, ...value };
  if (typeof e.enabled !== 'boolean') fail('Animation enabled must be boolean');
  one(e.preset, EFFECT_PRESETS, 'animation preset'); one(e.scope, scopes, 'animation scope');
  if (!Array.isArray(e.colors) || !e.colors.length || e.colors.length > 6 || e.colors.some(c => typeof c !== 'string' || !/^#[a-f\d]{6}$/i.test(c))) fail('Use 1–6 hex animation colors');
  for (const [key, min, max] of [['speed', 0.2, 3], ['opacity', 0.05, 0.8]]) if (typeof e[key] !== 'number' || !Number.isFinite(e[key]) || e[key] < min || e[key] > max) fail(`Animation ${key} must be ${min}–${max}`);
  integer(e.density, 1, 100, 'Particle density'); integer(e.duration, 1, 120, 'Animation duration');
  if (e.campaignId && !objectId(e.campaignId)) fail('Invalid animation campaign');
  if (e.scope === 'campaign' && !e.campaignId) fail('Select an animation campaign page');
  for (const key of ['startAt', 'endAt']) {
    if (e[key] && (typeof e[key] !== 'string' || !/(Z|[+-]\d{2}:\d{2})$/.test(e[key]) || !Number.isFinite(Date.parse(e[key])))) fail('Animation dates require a timezone');
    e[key] = e[key] || null;
  }
  if (e.startAt && e.endAt && Date.parse(e.endAt) <= Date.parse(e.startAt)) fail('Animation end must follow start');
  return e;
}
export function videoUrl(value) {
  const url = mediaUrl(value);
  if (url && !/\.(mp4|webm)$/i.test(new URL(url, 'https://local.test').pathname)) fail('Video URL must identify an MP4 or WebM file');
  return url;
}
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
  if (input != null && (typeof input !== 'object' || Array.isArray(input))) fail('Theme tokens must be an object');
  const t = resolveTokens(input || {});
  for (const key of Object.keys(t)) if (!(key in DEFAULT_TOKENS)) fail(`Unsupported theme token: ${key}`);
  for (const key of COLOR_KEYS) if (!/^#[a-f\d]{6}$/i.test(t[key])) fail(`${key} must be a six-digit hex color`);
  one(t.font, ['system', 'sans', 'serif'], 'font'); one(t.card, ['rounded', 'square'], 'card style');
  one(t.button, ['rounded', 'pill'], 'button style'); one(t.gradient, ['none', 'soft'], 'gradient');
  one(t.category, ['framed', 'minimal'], 'category style'); one(t.product, ['elevated', 'flat'], 'product style');
  one(t.decoration, ['none', 'dots', 'confetti', 'lights'], 'decoration'); one(t.motion, ['none', 'gentle'], 'motion');
  for (const bg of ['background', 'surface']) for (const fg of ['text', 'muted']) if (contrast(t[bg], t[fg]) < 4.5) fail(`${fg} needs at least 4.5:1 contrast on ${bg}`);
  if (contrast(t.primary, '#ffffff') < 4.5 || contrast(t.secondary, '#ffffff') < 4.5) fail('Primary and secondary colors need 4.5:1 contrast with white button text');
  for (const [bg, fg] of [['header', 'headerText'], ['search', 'searchText'], ['action', 'actionText'], ['actionHover', 'actionText'], ['badge', 'badgeText'], ['highlight', 'highlightText'], ['promotion', 'promotionText'], ['navSurface', 'navText'], ['navSurface', 'navActive']]) {
    if (contrast(t[bg], t[fg]) < 4.5) fail(`${fg} needs at least 4.5:1 contrast on ${bg}`);
  }
  return t;
}
export function validateSectionAppearance(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('Section appearance must be an object');
  const result = {};
  for (const key of Object.keys(input)) {
    if (!['background', 'text', 'accent'].includes(key) || !/^#[a-f\d]{6}$/i.test(input[key])) fail('Section colors must be supported six-digit hex colors');
    result[key] = input[key];
  }
  if (Object.keys(result).length && (!result.background || !result.text || contrast(result.background, result.text) < 4.5)) fail('Section text and background need 4.5:1 contrast');
  return result;
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
  if (kind === 'theme') {
    if (c.categoryTiles != null && (!Array.isArray(c.categoryTiles) || c.categoryTiles.length > 24)) fail('At most 24 category tiles are supported');
    const categoryTiles = (c.categoryTiles || []).map(tile => {
      if (!objectId(tile?.categoryId) || !objectId(tile?.bannerId)) fail('Select a category and banner for each tile');
      return { categoryId: String(tile.categoryId), bannerId: String(tile.bannerId), badge: str(tile.badge || '', 24, 'category badge') };
    });
    if (new Set(categoryTiles.map(tile => tile.categoryId)).size !== categoryTiles.length) fail('Each category can have only one artwork override');
    row.config = { preset: one(c.preset || 'Custom Admin Theme', Object.keys(PRESETS), 'preset'), application: one(c.application || 'storefront', ['storefront', 'campaign'], 'theme application'), tokens: validateTokens(c.tokens), categoryTiles };
  }
  if (kind === 'campaign') row.config = {
    placement: one(c.placement || 'hero', ['hero', 'splash', 'announcement'], 'placement'), bannerId: ref('bannerId'), themeId: ref('themeId'),
    frequency: one(c.frequency || 'session', FREQUENCIES, 'frequency'), duration: integer(c.duration ?? 5, 2, 15, 'Splash duration'),
    countdown: c.countdown === true,
  };
  if (kind === 'section') row.config = { title: str(c.title || row.name, 100, 'section title'), source: one(c.source || 'recent', SOURCES, 'product source'),
    categoryId: ref('categoryId'), campaignId: ref('campaignId'), bannerId: ref('bannerId'),
    maxPrice: integer(c.maxPrice ?? 99, 1, 1000000, 'Maximum price'), limit: integer(c.limit ?? 8, 1, 24, 'Product limit'),
    variant: one(c.variant || 'plain', ['plain', 'accent', 'soft'], 'section appearance'),
    layout: one(c.layout || 'rail', ['rail', 'grid'], 'section layout'), appearance: validateSectionAppearance(c.appearance) };
  if (kind === 'theme' || kind === 'campaign') row.config.animation = validateEffect(c.animation, kind === 'theme' ? ['storefront', 'homepage', 'campaign'] : ['storefront', 'homepage', 'campaign', 'banner']);
  if (kind === 'campaign' && row.config.placement === 'announcement' && row.config.animation.enabled && row.config.animation.scope === 'banner') fail('Announcement text has no banner canvas; choose homepage or storefront animation scope');
  return row;
}
export function marketingPermission(req, _res, next) {
  if (req.userType !== 'admin' || (req.user?.role !== 'superAdmin' && !req.user?.permissions?.includes('manage_marketing'))) throw httpError(403, 'Marketing management permission is required');
  next();
}
