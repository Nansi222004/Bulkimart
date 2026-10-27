import crypto from 'node:crypto';
import Experience from '../models/StorefrontExperience.js';
import Banner from '../models/Banner.js';
import Category from '../models/Category.js';
import Product from '../models/Product.js';
import Campaign from '../models/Campaign.js';
import { DEFAULT_TOKENS, lifecycle, ranked } from '../shared/storefront.mjs';
import { effectActive } from '../shared/celebration.mjs';
import { validateExperience, validateEffect, objectId } from './storefrontPolicy.service.js';
import { retailAllowed, channelAllowed } from '../utils/productChannels.js';
import { httpError } from '../utils/response.js';

export const snapshot = row => Object.fromEntries(['name', 'description', 'scope', 'device', 'priority', 'order', 'startAt', 'endAt', 'timezone', 'config'].map(k => [k, row[k]]));
const overlap = (a, b) => (!a.endAt || !b.startAt || new Date(a.endAt) > new Date(b.startAt)) && (!b.endAt || !a.startAt || new Date(b.endAt) > new Date(a.startAt));
export async function validateReferences(row) {
  const c = row.config;
  if (c.header?.target === 'campaign' && !await Campaign.exists({ _id: c.header.campaignId, isEnabled: true, isDraft: { $ne: true }, endAt: { $gt: new Date() } })) throw httpError(400, 'Select an enabled, published campaign for the header button');
  if (c.animation?.scope === 'campaign' && !await Campaign.exists({ _id: c.animation.campaignId, isEnabled: true, isDraft: { $ne: true }, endAt: { $gt: new Date() } })) throw httpError(400, 'Select an enabled, published campaign page for the animation');
  for (const tile of c.categoryTiles || []) {
    if (!await Category.exists({ _id: tile.categoryId, isActive: true, ...(row.scope === 'global' ? { type: { $in: ['grocery', 'ecommerce'] } } : { type: row.scope === 'quick' ? 'grocery' : 'ecommerce' }) })) throw httpError(400, 'Select an active category matching the theme storefront');
    await validateReferences({ scope: row.scope, startAt: row.startAt, endAt: row.endAt, kind: 'artwork', config: { bannerId: tile.bannerId } });
  }
  if (row.kind === 'campaign' && !c.bannerId) throw httpError(400, 'Select a banner before publishing');
  if (c.bannerId) {
    const b = await Banner.findById(c.bannerId).lean();
    if (!b || b.isDraft || !b.isActive || b.isArchived || b.actionType === 'SELLER_PROMOTION' || b.targetPromotion) throw httpError(400, 'Publish and enable the selected banner first');
    const requiredType = row.scope === 'quick' ? 'grocery' : row.scope === 'shop-all' ? 'ecommerce' : 'general';
    if (b.type !== 'general' && b.type !== requiredType) throw httpError(400, 'Banner storefront must match this configuration');
    if (!overlap(row, { startAt: b.startDate, endAt: b.endDate })) throw httpError(400, 'Banner and configuration schedules do not overlap');
  }
  if (c.themeId && !await Experience.exists({ _id: c.themeId, kind: 'theme', status: 'published', scope: { $in: ['global', row.scope] } })) throw httpError(400, 'Select a published theme for this storefront');
  if (row.kind === 'section' && c.source === 'category' && (!c.categoryId || !await Category.exists({ _id: c.categoryId, isActive: true, type: row.scope === 'quick' ? 'grocery' : 'ecommerce' }))) throw httpError(400, 'Select an active category in this storefront');
  if (row.kind === 'section' && c.source === 'campaign') {
    const deal = c.campaignId && await Campaign.findById(c.campaignId).lean();
    if (!deal || deal.isDraft || !deal.isEnabled || !deal.endAt || new Date(deal.endAt) <= Date.now()) throw httpError(400, 'Select a published, enabled, unexpired deal campaign');
    if (!overlap(row, deal)) throw httpError(400, 'Deal and section schedules do not overlap');
  }
  if (row.kind === 'section' && c.source === 'wholesale' && row.scope !== 'shop-all') throw httpError(400, 'Wholesale collections require ShopAll scope');
  if (row.kind === 'section' && c.source === 'category' && row.scope === 'global') throw httpError(400, 'Category sections require a specific storefront');
}
export async function checkConflicts(row) {
  if (!['campaign', 'theme'].includes(row.kind)) return;
  if (row.kind === 'theme' && row.config.application === 'campaign') return;
  const others = await Experience.find({ kind: row.kind, status: 'published', priority: row.priority, _id: { $ne: row._id } }).lean();
  const conflict = others.find(other => !(row.kind === 'theme' && other.config.application === 'campaign') && (row.scope === 'global' || other.scope === 'global' || row.scope === other.scope)
    && (row.device === 'all' || other.device === 'all' || row.device === other.device)
    && (row.kind === 'theme' ? row.scope === other.scope : row.config.placement === other.config.placement)
    && overlap(row, other));
  if (conflict) throw httpError(409, `Schedule overlaps “${conflict.name}” at the same priority. Choose another priority or a non-overlapping schedule.`);
}
export async function saveExperience(id, input, actor) {
  const existing = id ? await Experience.findById(id) : null;
  if (id && !existing) throw httpError(404, 'Configuration not found');
  if (existing && input.revision !== existing.revision) throw httpError(409, 'This configuration changed. Reload before saving.');
  const kind = existing?.kind || input.kind;
  const values = validateExperience(input, kind);
  // A record with a live (or paused) publication keeps it: edits go to its draft copy,
  // and neither the live fields nor the public revision change until publication.
  if (existing && LIVE.includes(existing.status)) {
    checkDraft(existing, input.draftRevision);
    existing.draft = { values, revision: (existing.draft?.revision || 0) + 1, base: liveHash(existing), savedAt: new Date(), savedBy: actor };
    existing.updatedBy = actor; return existing.save();
  }
  // Never-published records are themselves the draft. Publication is a separate, validated action.
  if (existing) { Object.assign(existing, values, { status: 'draft', updatedBy: actor }); existing.revision++; return existing.save(); }
  return Experience.create({ ...values, kind, createdBy: actor, updatedBy: actor });
}
const LIVE = ['published', 'paused'];
// Identifies the live publication; pause/resume do not change it, publish and rollback do.
const liveHash = row => crypto.createHash('sha256').update(JSON.stringify(snapshot(row))).digest('hex').slice(0, 20);
function checkDraft(row, draftRevision) {
  if ((draftRevision || 0) !== (row.draft?.revision || 0)) throw httpError(409, 'This draft changed. Reload before continuing.');
}
export async function transitionExperience(id, action, revision, actor, draftRevision) {
  if (!objectId(id)) throw httpError(400, 'Invalid configuration ID');
  const row = await Experience.findById(id).select('+history');
  if (!row) throw httpError(404, 'Configuration not found');
  if (revision !== row.revision) throw httpError(409, 'This configuration changed. Reload before continuing.');
  if (!['publish', 'pause', 'archive', 'rollback', 'discard'].includes(action)) throw httpError(400, 'Unsupported action');
  if (action === 'discard') {
    if (!row.draft) throw httpError(400, 'There is no draft to discard');
    checkDraft(row, draftRevision);
    row.draft = undefined; row.updatedBy = actor; // live publication and revision are untouched
    return row.save();
  }
  if (action === 'publish' && row.draft) {
    checkDraft(row, draftRevision);
    if (row.draft.base !== liveHash(row)) throw httpError(409, 'The live version changed after this draft was saved. Open the draft, review it and save it again before publishing.');
    Object.assign(row, row.draft.values); // validated below before anything is saved
  }
  if (action === 'rollback') {
    const previous = row.history.at(-2);
    if (!previous) throw httpError(400, 'No earlier publication to restore');
    Object.assign(row, previous);
  }
  if (['publish', 'rollback'].includes(action)) {
    const input = snapshot(row);
    for (const k of ['startAt', 'endAt']) input[k] = input[k]?.toISOString?.() || input[k];
    validateExperience(input, row.kind);
    if (row.endAt && row.endAt <= new Date()) throw httpError(400, 'Update the expired end time before publishing');
    await validateReferences(row); await checkConflicts(row);
    row.status = 'published';
    row.history = [...row.history, snapshot(row)].slice(-20);
    if (action === 'publish') row.draft = undefined;
  } else row.status = action === 'pause' ? 'paused' : 'archived';
  row.updatedBy = actor; row.revision++;
  // One optimistic-concurrency save: the live swap, history and draft removal land together.
  return row.save();
}
export const adminDTO = row => {
  const { history, draft, ...rest } = row.toObject ? row.toObject() : row;
  return { ...rest, lifecycle: lifecycle(row), canRollback: (history?.length || 0) > 1,
    draft: draft ? { values: draft.values, revision: draft.revision, savedAt: draft.savedAt, stale: draft.base !== liveHash(row) } : null };
};

// Explicit projection prevents draft/audit fields and private product details leaking.
export function publicBanner(b, now = Date.now(), type) {
  if (!b || !b.isActive || b.isDraft || b.isArchived || (b.startDate && new Date(b.startDate) > now) || (b.endDate && new Date(b.endDate) <= now) || b.targetPromotion || b.actionType === 'SELLER_PROMOTION') return null;
  let destination = { type: 'NONE' };
  if (b.actionType === 'CATEGORY') {
    const c = b.targetCategory; if (!c?.isActive || (type && c.type !== type)) return null;
    destination = { type: 'CATEGORY', id: String(c._id), slug: c.slug, name: c.name };
  } else if (b.actionType === 'PRODUCT') {
    const p = b.targetProduct; if (!p?.isActive || p.isDeleted || p.status !== 'approved' || !retailAllowed(p)) return null;
    if (type && (!channelAllowed(p, type) || (p.type !== type && !p.channels?.some(c => c.type === type && c.isActive !== false)))) return null;
    destination = { type: 'PRODUCT', id: String(p._id) };
  } else if (b.actionType === 'CAMPAIGN') {
    const c = b.targetCampaign;
    if (!c || c.isDraft || !c.isEnabled || !c.startAt || !c.endAt || new Date(c.startAt) > now || new Date(c.endAt) <= now) return null;
    destination = { type: 'CAMPAIGN', id: String(c._id) };
  } else if (b.actionType === 'EXTERNAL_URL') {
    try { const u = new URL(b.externalUrl); if (u.protocol !== 'https:' || u.username || u.password) return null; destination = { type: 'EXTERNAL_URL', url: u.href }; } catch { return null; }
  } else if (b.targetRoute && /^\/(cart|categories|account|orders)$/.test(b.targetRoute)) destination = { type: 'NAV', id: b.targetRoute.slice(1) };
  else if (b.targetRoute) {
    const routes = { '/grocery': 'groceries', '/electronics': 'electronics', '/fashion': 'fashion', '/garments': 'fashion', '/smart-buy': 'smart-buy', '/hot-deals': 'hot-deals', '/products?type=ecommerce&cat=garments': 'fashion' };
    if (routes[b.targetRoute]) destination = { type: 'SUBNAV', id: routes[b.targetRoute] };
  }
  let animation = null;
  try { if (b.animation && effectActive(b.animation, now)) animation = validateEffect(b.animation, ['banner']); } catch { /* Invalid manual effects stay off. */ }
  return { id: String(b._id), title: b.title || '', subtitle: b.subtitle || '', image: b.image, mobileImage: b.mobileImage || '', video: b.video || '', mobileVideo: b.mobileVideo || '', mediaType: b.mediaType || (b.video ? 'video' : 'image'), autoplay: b.autoplay !== false, muted: b.muted !== false, loop: b.loop !== false, playsInline: b.playsInline !== false, animation, cta: b.cta || '', destination,
    endAt: [b.endDate, b.targetCampaign?.endAt].filter(Boolean).sort((a, c) => new Date(a) - new Date(c))[0] || null };
}
const populatedBanners = query => Banner.find(query).select('title subtitle image mobileImage video mobileVideo mediaType autoplay muted loop playsInline animation cta type category placement actionType targetCategory targetProduct targetCampaign targetPromotion targetRoute externalUrl isActive isDraft isArchived priority startDate endDate').populate('targetCategory', 'name slug type isActive').populate('targetProduct', 'type channels isActive isDeleted status sellingChannels').populate('targetCampaign', 'isDraft isEnabled startAt endAt').lean();
export async function resolveExperience(scope, device, category = '', now = Date.now()) {
  const type = scope === 'quick' ? 'grocery' : 'ecommerce';
  const [rows, headerCategories] = await Promise.all([
    Experience.find({ status: 'published', scope: { $in: ['global', scope] }, device: { $in: ['all', device] } })
      .select('kind name description status scope device priority order startAt endAt timezone config revision').lean(),
    Category.find({ type, parent: null, isActive: true, showInNav: true, isSystem: { $ne: true } })
      .select('name slug image icon type sortOrder').sort({ sortOrder: 1, name: 1, _id: 1 }).lean(),
  ]);
  const active = rows.flatMap(row => {
    if (lifecycle(row, now) !== 'active') return [];
    try {
      const input = { ...snapshot(row), startAt: row.startAt?.toISOString(), endAt: row.endAt?.toISOString() };
      return [{ ...row, ...validateExperience(input, row.kind) }];
    } catch { return []; } // Invalid legacy/manual configuration never breaks the public shell.
  }).sort(ranked);
  const themes = active.filter(r => r.kind === 'theme');
  const campaigns = active.filter(r => r.kind === 'campaign');
  const sections = active.filter(r => r.kind === 'section');
  const refs = [...new Set([...campaigns, ...sections].map(r => r.config.bannerId).concat(themes.flatMap(t => t.config.categoryTiles.map(tile => tile.bannerId))).filter(Boolean))];
  const dealIds = [...new Set(sections.filter(s => s.config.source === 'campaign').map(s => s.config.campaignId).filter(Boolean))];
  // Fetch all candidate tile categories in one batch; theme priority resolves below.
  const categoryIds = [...new Set(sections.filter(s => s.config.source === 'category').map(s => s.config.categoryId).concat(themes.flatMap(t => t.config.categoryTiles.map(tile => tile.categoryId))).filter(Boolean))];
  const [bannerRows, deals, categories] = await Promise.all([
    populatedBanners({ type: { $in: ['general', type] }, isActive: true, isDraft: { $ne: true }, isArchived: { $ne: true }, $or: [{ _id: { $in: refs } }, { placement: 'HOME_HERO' }, { placement: null }] }),
    dealIds.length ? Campaign.find({ _id: { $in: dealIds }, isEnabled: true, isDraft: { $ne: true }, startAt: { $lte: new Date(now) }, endAt: { $gt: new Date(now) } }).select('endAt').lean() : [],
    categoryIds.length ? Category.find({ _id: { $in: categoryIds }, isActive: true, type }).select('_id').lean() : [],
  ]);
  const bannerMap = new Map(bannerRows.map(b => [String(b._id), publicBanner(b, now, type)]));
  const dto = r => ({ id: String(r._id), revision: r.revision, name: r.name, order: r.order, priority: r.priority, startAt: r.startAt, endAt: r.endAt, config: { ...r.config, animation: effectActive(r.config.animation, now) ? r.config.animation : null } });
  const resolvedCampaigns = campaigns.flatMap(r => {
    const banner = bannerMap.get(r.config.bannerId); if (!banner) return [];
    const endAt = [r.endAt, banner.endAt].filter(Boolean).sort((a, b) => new Date(a) - new Date(b))[0] || null;
    return [{ ...dto(r), endAt, banner: r.config.animation?.scope === 'banner' && effectActive(r.config.animation, now) ? { ...banner, animation: r.config.animation } : banner }];
  });
  const override = resolvedCampaigns.map(c => themes.find(t => String(t._id) === c.config.themeId)).find(Boolean);
  const standaloneThemes = themes.filter(t => t.config.application !== 'campaign');
  const theme = override || standaloneThemes.find(t => t.scope === scope) || standaloneThemes.find(t => t.scope === 'global');
  const resolvedSections = sections.flatMap(r => {
    const deal = deals.find(d => String(d._id) === r.config.campaignId);
    if (r.config.source === 'campaign' && !deal) return [];
    if (r.config.source === 'category' && !categories.some(c => String(c._id) === r.config.categoryId)) return [];
    return [{ ...dto(r), endAt: [r.endAt, deal?.endAt].filter(Boolean).sort((a, b) => new Date(a) - new Date(b))[0] || null, banner: bannerMap.get(r.config.bannerId) || null }];
  }).sort((a, b) => a.order - b.order || ranked(a, b));
  const managedHeroes = resolvedCampaigns.filter(c => c.config.placement === 'hero');
  const legacyHeroes = bannerRows.filter(b => (!b.placement || b.placement === 'HOME_HERO') && (!category || b.category === category || b.category === category.replace(/^(grocery|ecommerce)--/, ''))).sort(ranked).map(b => bannerMap.get(String(b._id))).filter(Boolean);
  const banners = [...managedHeroes.map(c => ({ ...c.banner, endAt: c.endAt })), ...legacyHeroes].filter((b, i, all) => all.findIndex(other => other.id === b.id) === i);
  const boundary = rows.flatMap(r => [r.startAt, r.endAt, r.config.animation?.startAt, r.config.animation?.endAt]).concat(bannerRows.flatMap(b => [b.startDate, b.endDate, b.animation?.startAt, b.animation?.endAt, b.targetCampaign?.startAt, b.targetCampaign?.endAt]), deals.map(d => d.endAt)).filter(Boolean).map(d => new Date(d).getTime()).filter(t => t > now);
  const validUntil = new Date(Math.min(now + 30000, ...boundary)).toISOString();
  const categoryTiles = (theme?.config.categoryTiles || []).flatMap(tile => {
    const banner = bannerMap.get(tile.bannerId);
    return banner && categories.some(c => String(c._id) === tile.categoryId) ? [{ categoryId: tile.categoryId, badge: tile.badge, banner }] : [];
  });
  const effectRows = [...resolvedCampaigns, ...(theme ? [dto(theme)] : [])].filter(r => effectActive(r.config.animation, now) && r.config.animation.scope !== 'banner').sort(ranked);
  const effectDeals = effectRows.filter(r => r.config.animation.scope === 'campaign').map(r => r.config.animation.campaignId);
  const eligibleEffectDeals = effectDeals.length ? await Campaign.find({ _id: { $in: effectDeals }, isEnabled: true, isDraft: { $ne: true }, startAt: { $lte: new Date(now) }, endAt: { $gt: new Date(now) } }).select('_id endAt').lean() : [];
  const animations = effectRows.flatMap(r => {
    const e = r.config.animation, deal = eligibleEffectDeals.find(d => String(d._id) === e.campaignId);
    if (e.scope === 'campaign' && !deal) return [];
    return [{ id: r.id, revision: r.revision, ...e, endAt: [r.endAt, e.endAt, deal?.endAt].filter(Boolean).sort((a, b) => new Date(a) - new Date(b))[0] || null }];
  });
  // A header button never links to a deal that is not currently shoppable.
  let header = theme?.config.header || null;
  if (header?.target === 'campaign' && !await Campaign.exists({ _id: header.campaignId, isEnabled: true, isDraft: { $ne: true }, startAt: { $lte: new Date(now) }, endAt: { $gt: new Date(now) } })) header = { ...header, target: 'none', campaignId: '' };
  const data = { animations, theme: theme ? { id: String(theme._id), tokens: theme.config.tokens, categoryTiles, header, endAt: theme.endAt } : { tokens: DEFAULT_TOKENS },
    splash: resolvedCampaigns.find(c => c.config.placement === 'splash') || null,
    announcement: resolvedCampaigns.find(c => c.config.placement === 'announcement') || null, banners, headerCategories, sections: resolvedSections };
  const version = crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex').slice(0, 20);
  return { ...data, version, serverTime: new Date(now).toISOString(), validUntil, refreshMs: 30000 };
}
