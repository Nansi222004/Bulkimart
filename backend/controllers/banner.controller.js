import { retailAllowed } from '../utils/productChannels.js';
import { mediaUrl, videoUrl, validateEffect } from '../services/storefrontPolicy.service.js';
import { effectActive } from '../shared/celebration.mjs';
import sharp from 'sharp';
const uploadArtwork = async file => {
  let buffer;
  try { buffer = await sharp(file.buffer, { limitInputPixels: 25000000 }).rotate().webp().toBuffer(); }
  catch { throw httpError(400, 'Invalid or oversized banner image'); }
  return uploadToCloudinary(buffer, 'banners', { resource_type: 'image' });
};
import Banner from '../models/Banner.js';
import Category from '../models/Category.js';
import Product from '../models/Product.js';
import Campaign from '../models/Campaign.js';
import { uploadToCloudinary } from '../services/cloudinary.service.js';
import { asyncHandler } from '../middlewares/error.middleware.js';
import { httpError } from '../utils/response.js';
import { isCampaignEffectivelyActive } from '../services/campaign.service.js';

const mapLegacyType = (type) => (type === 'quick' ? 'grocery' : type === 'shop-all' ? 'ecommerce' : type);

const isEligibleProduct = (p) => !!p && retailAllowed(p) && !p.isDeleted && p.isActive && p.status === 'approved';
const isEligibleCategory = (c) => !!c && c.isActive;

/**
 * Only http/https survive — `javascript:`, `data:`, etc. are how a stored
 * XSS payload turns into "click this banner" for every shopper who sees
 * it. Checked here, not just in the admin form, because the frontend's
 * opinion is never trusted for anything that becomes a live link.
 */
const isSafeExternalUrl = (url) => {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && !u.username && !u.password;
  } catch {
    return false;
  }
};

/**
 * Validates actionType against its target, and throws a 400 naming
 * exactly what's wrong — used for both create and publish-time update.
 * Draft saves skip this entirely (see createBanner/updateBanner).
 */
const validateAction = async ({ actionType, targetCategory, targetProduct, targetCampaign, externalUrl }) => {
  if (actionType === 'CATEGORY') {
    if (!targetCategory) throw httpError(400, 'Choose a category for this banner');
    const cat = await Category.findById(targetCategory).lean();
    if (!isEligibleCategory(cat)) throw httpError(400, 'That category is not available for customers right now');
  } else if (actionType === 'PRODUCT') {
    if (!targetProduct) throw httpError(400, 'Choose a product for this banner');
    const prod = await Product.findById(targetProduct).select('isActive isDeleted status sellingChannels').lean();
    if (!isEligibleProduct(prod)) throw httpError(400, 'That product is not available for customers right now');
  } else if (actionType === 'CAMPAIGN') {
    if (!targetCampaign) throw httpError(400, 'Choose a campaign for this banner');
    const campaign = await Campaign.findById(targetCampaign).lean();
    if (!campaign) throw httpError(400, 'That campaign could not be found');
    // A banner may be published ahead of a scheduled campaign going live —
    // only reject a campaign that can never become active again.
    if (!campaign.isEnabled) throw httpError(400, 'That campaign is disabled');
  } else if (actionType === 'EXTERNAL_URL') {
    if (!externalUrl || !isSafeExternalUrl(externalUrl)) {
      throw httpError(400, 'Enter an approved HTTPS URL without credentials');
    }
  }
  // NONE — nothing to validate.
};

/**
 * @desc    Banners for the customer Home carousel, or (with ?all=true) the
 *          full list for the admin Banners page.
 * @route   GET /api/banners
 * @access  Public (customer read); ?all=true is only ever called by the
 *          admin panel, which is itself behind the admin login, but the
 *          route stays public-shaped to match how it already worked.
 */
export const getBanners = asyncHandler(async (req, res) => {
  const { type, category, all } = req.query;

  const filter = { actionType: { $ne: 'SELLER_PROMOTION' }, targetPromotion: null };

  if (all !== 'true') {
    const now = new Date();
    filter.isActive = true;
    filter.isArchived = { $ne: true };
    filter.isDraft = { $ne: true };
    filter.$and = [
      // `placement` was added after the original Banner records had already
      // been created. Those legacy records were all homepage banners (the
      // homepage was the only consumer), so treat a missing/null placement
      // as HOME_HERO while continuing to exclude any explicitly different
      // placement. New admin uploads receive HOME_HERO from the schema default.
      { $or: [{ placement: 'HOME_HERO' }, { placement: { $exists: false } }, { placement: null }] },
      { $or: [{ startDate: { $exists: false } }, { startDate: null }, { startDate: { $lte: now } }] },
      { $or: [{ endDate: { $exists: false } }, { endDate: null }, { endDate: { $gt: now } }] },
    ];
  }

  if (type) {
    filter.type = { $in: [mapLegacyType(type), 'general'] };
  }
  if (category) {
    const rawCat = String(category).toLowerCase();
    const cleanCat = rawCat.replace(/^(grocery|ecommerce|shg)--/, '');
    if (['home', 'smart-buy', 'grocery--home', 'ecommerce--smart-buy'].includes(rawCat)) {
      filter.category = { $in: ['home', 'smart-buy', 'grocery--home', 'ecommerce--smart-buy'] };
    } else {
      filter.category = { $in: [rawCat, cleanCat] };
    }
  }

  let banners = await Banner.find(filter)
    .sort({ priority: -1, createdAt: -1, _id: 1 })
    .populate('targetCategory', 'name slug type isActive')
    .populate('targetProduct', 'name images price mrp discountPercent stock type isActive isDeleted status sellingChannels')
    .populate('targetCampaign', 'name discountValue startAt endAt isEnabled isDraft')
    .lean();

  // If a home-scoped carousel query yielded 0 banners, fall back to active eligible banners for this storefront
  // so banners configured in the admin still discoverably populate the main homepage carousel
  const isHomeScope = !category || ['home', 'smart-buy', 'grocery--home', 'ecommerce--smart-buy'].includes(String(category).toLowerCase());
  if (all !== 'true' && banners.length === 0 && isHomeScope) {
    const fallbackFilter = { ...filter };
    delete fallbackFilter.category;
    banners = await Banner.find(fallbackFilter)
      .sort({ priority: -1, createdAt: -1, _id: 1 })
      .populate('targetCategory', 'name slug type isActive')
      .populate('targetProduct', 'name images price mrp discountPercent stock type isActive isDeleted status sellingChannels')
      .populate('targetCampaign', 'name discountValue startAt endAt isEnabled isDraft')
      .lean();
  }

  // Stale-target banners are dropped from the CUSTOMER feed only — the
  // admin list (all=true) still shows them so the banner can be found and
  // fixed rather than silently vanishing.
  if (all !== 'true') {
    banners = banners.filter((b) => {
      if (b.actionType === 'CATEGORY') return isEligibleCategory(b.targetCategory);
      if (b.actionType === 'PRODUCT') return isEligibleProduct(b.targetProduct);
      if (b.actionType === 'CAMPAIGN') return isCampaignEffectivelyActive(b.targetCampaign || {});
      return true;
    });
  }

  res.set('Cache-Control', 'no-store');
  res.status(200).json(all === 'true' ? banners : banners.map(banner => {
    const dto = Object.fromEntries(['_id', 'title', 'subtitle', 'image', 'mobileImage', 'video', 'mobileVideo', 'mediaType', 'autoplay', 'muted', 'loop', 'playsInline', 'cta', 'type', 'category', 'placement', 'actionType', 'targetCategory', 'targetProduct', 'targetCampaign', 'targetRoute', 'externalUrl', 'priority', 'startDate', 'endDate', 'isActive', 'isDraft'].map(key => [key, banner[key]]));
    try { dto.animation = effectActive(banner.animation) ? validateEffect(banner.animation, ['banner']) : null; } catch { dto.animation = null; }
    return dto;
  }));
});

/**
 * @desc    Record a banner click — fixes a call the frontend already made
 *          to a route that never existed (clickCount was tracked in the
 *          schema but nothing ever incremented it).
 * @route   POST /api/banners/:id/click
 * @access  Public
 */
export const clickBanner = asyncHandler(async (req, res) => {
  await Banner.updateOne({ _id: req.params.id, actionType: { $ne: 'SELLER_PROMOTION' }, targetPromotion: null }, { $inc: { clickCount: 1 } });
  res.status(200).json({ success: true });
});

/**
 * @desc    Create a banner
 * @route   POST /api/banners
 * @access  Private/Admin
 */
export const createBanner = asyncHandler(async (req, res) => {
  const {
    title, subtitle, targetRoute, type, category, priority, startDate, endDate,
    actionType = 'NONE', targetCategory, targetProduct, targetCampaign, externalUrl,
    isDraft, isActive,
  } = req.body;

  if (!req.file && !req.body.image) {
    throw httpError(400, 'Please upload an image file or provide an image URL');
  }
  if (!type) throw httpError(400, 'Storefront type is required');
  if (startDate && endDate && new Date(endDate) <= new Date(startDate)) {
    throw httpError(400, 'End date must be after the start date');
  }

  if (actionType === 'SELLER_PROMOTION' || req.body.targetPromotion) throw httpError(410, 'Seller promotions have been removed.');
  const draft = isDraft === true || isDraft === 'true';
  // A draft can be saved incomplete on purpose — Step 29 of the plan.
  // Publishing (draft === false) must have a real, valid target.
  if (!draft) {
    await validateAction({ actionType, targetCategory, targetProduct, targetCampaign, externalUrl });
  }

  let imageUrl = req.body.image;
  if (req.file) imageUrl = await uploadArtwork(req.file);

  const presentation = bannerPresentation(req.body);
  validateVideo({ ...req.body, ...presentation });
  const banner = await Banner.create({
    ...bannerPresentation(req.body),
    title,
    subtitle,
    image: imageUrl,
    targetRoute,
    type: mapLegacyType(type),
    category: category || 'home',
    actionType,
    targetCategory: actionType === 'CATEGORY' ? targetCategory : undefined,
    targetProduct: actionType === 'PRODUCT' ? targetProduct : undefined,
    targetCampaign: actionType === 'CAMPAIGN' ? targetCampaign : undefined,
    externalUrl: actionType === 'EXTERNAL_URL' ? externalUrl : undefined,
    priority: priority ? Number(priority) : 0,
    startDate: startDate ? new Date(startDate) : undefined,
    endDate: endDate ? new Date(endDate) : undefined,
    isDraft: draft,
    isActive: isActive === undefined ? true : (isActive === true || isActive === 'true'),
    createdBy: req.user?._id,
    updatedBy: req.user?._id,
  });

  res.status(201).json(banner);
});

/**
 * @desc    Update a banner
 * @route   PUT /api/banners/:id
 * @access  Private/Admin
 */
export const updateBanner = asyncHandler(async (req, res) => {
  const banner = await Banner.findById(req.params.id);
  if (!banner) throw httpError(404, 'Banner not found');
  Object.assign(banner, bannerPresentation(req.body));
  if (banner.actionType === 'SELLER_PROMOTION' || banner.targetPromotion || req.body.actionType === 'SELLER_PROMOTION' || req.body.targetPromotion) throw httpError(410, 'Seller promotions have been removed.');

  const {
    title, subtitle, targetRoute, type, category, priority, startDate, endDate, isActive,
    actionType, targetCategory, targetProduct, targetCampaign, externalUrl, isDraft,
  } = req.body;

  if (req.file) {
    banner.image = await uploadArtwork(req.file);
  } else if (req.body.image) {
    banner.image = req.body.image;
  }

  if (title !== undefined) banner.title = title;
  if (subtitle !== undefined) banner.subtitle = subtitle;
  if (targetRoute !== undefined) banner.targetRoute = targetRoute;
  if (category !== undefined) banner.category = category;
  if (priority !== undefined) banner.priority = Number(priority);
  if (isActive !== undefined) banner.isActive = isActive === 'true' || isActive === true;
  if (type !== undefined) banner.type = mapLegacyType(type);

  const nextStartDate = startDate !== undefined ? (startDate ? new Date(startDate) : undefined) : banner.startDate;
  const nextEndDate = endDate !== undefined ? (endDate ? new Date(endDate) : undefined) : banner.endDate;
  if (nextStartDate && nextEndDate && nextEndDate <= nextStartDate) {
    throw httpError(400, 'End date must be after the start date');
  }
  if (startDate !== undefined) banner.startDate = nextStartDate;
  if (endDate !== undefined) banner.endDate = nextEndDate;

  const nextActionType = actionType !== undefined ? actionType : banner.actionType;
  const nextTargetCategory = targetCategory !== undefined ? targetCategory : banner.targetCategory;
  const nextTargetProduct = targetProduct !== undefined ? targetProduct : banner.targetProduct;
  const nextTargetCampaign = targetCampaign !== undefined ? targetCampaign : banner.targetCampaign;
  const nextExternalUrl = externalUrl !== undefined ? externalUrl : banner.externalUrl;

  const nextDraft = isDraft !== undefined ? (isDraft === true || isDraft === 'true') : banner.isDraft;
  if (!nextDraft) {
    await validateAction({
      actionType: nextActionType, targetCategory: nextTargetCategory,
      targetProduct: nextTargetProduct, targetCampaign: nextTargetCampaign, externalUrl: nextExternalUrl,
    });
  }
  if (isDraft !== undefined) banner.isDraft = nextDraft;

  if (actionType !== undefined) {
    banner.actionType = actionType;
    banner.targetCategory = actionType === 'CATEGORY' ? targetCategory : undefined;
    banner.targetProduct = actionType === 'PRODUCT' ? targetProduct : undefined;
    banner.targetCampaign = actionType === 'CAMPAIGN' ? targetCampaign : undefined;
    banner.externalUrl = actionType === 'EXTERNAL_URL' ? externalUrl : undefined;
  }

  banner.updatedBy = req.user?._id;

  validateVideo(banner);
  const updatedBanner = await banner.save();
  res.status(200).json(updatedBanner);
});

/**
 * @desc    Delete a banner
 * @route   DELETE /api/banners/:id
 * @access  Private/Admin
 *
 * Hard delete — nothing in this codebase references a Banner by id yet
 * (no Campaign/Seller Promotion exists to point at one), so there is no
 * historical reference a soft-delete would need to protect. Revisit this
 * once something actually links to a Banner.
 */
export const deleteBanner = asyncHandler(async (req, res) => {
  const banner = await Banner.findById(req.params.id);
  if (!banner) throw httpError(404, 'Banner not found');

  banner.isArchived = true;
  banner.isActive = false;
  await banner.save();
  res.status(200).json({ message: 'Banner archived successfully' });
});

function bannerPresentation(body) {
  const fields = {};
  if (body.mediaType !== undefined) {
    if (!['image', 'video'].includes(body.mediaType)) throw httpError(400, 'Invalid media type');
    fields.mediaType = body.mediaType;
  }
  for (const key of ['autoplay', 'muted', 'loop', 'playsInline']) if (body[key] !== undefined) {
    if (![true, false, 'true', 'false'].includes(body[key])) throw httpError(400, `Invalid ${key}`);
    fields[key] = body[key] === true || body[key] === 'true';
  }
  if (body.animation !== undefined) {
    let value = body.animation;
    if (typeof value === 'string') { try { value = JSON.parse(value); } catch { throw httpError(400, 'Invalid animation JSON'); } }
    fields.animation = validateEffect(value == null ? { scope: 'banner' } : value, ['banner']);
  }
  if (body.isArchived !== undefined) {
    if (![true, false, 'true', 'false'].includes(body.isArchived)) throw httpError(400, 'Invalid archive flag');
    fields.isArchived = body.isArchived === true || body.isArchived === 'true';
  }
  for (const [key, max] of [['title', 150], ['subtitle', 300]]) if (body[key] !== undefined && (typeof body[key] !== 'string' || body[key].length > max)) throw httpError(400, `${key} must be under ${max} characters`);
  if (body.mobileImage !== undefined) fields.mobileImage = mediaUrl(body.mobileImage);
  for (const key of ['video', 'mobileVideo']) if (body[key] !== undefined) fields[key] = videoUrl(body[key]);
  if (body.image !== undefined) mediaUrl(body.image);
  if (body.cta !== undefined) {
    if (typeof body.cta !== 'string' || body.cta.length > 60) throw httpError(400, 'CTA must be under 60 characters');
    fields.cta = body.cta;
  }
  if (body.placement !== undefined) {
    if (!['HOME_HERO', 'STUDIO'].includes(body.placement)) throw httpError(400, 'Invalid banner placement');
    fields.placement = body.placement;
  }
  for (const key of ['startDate', 'endDate']) if (body[key] && !Number.isFinite(new Date(body[key]).getTime())) throw httpError(400, 'Invalid banner schedule');
  if (body.priority !== undefined && (!Number.isInteger(Number(body.priority)) || Math.abs(Number(body.priority)) > 1000)) throw httpError(400, 'Priority must be an integer between -1000 and 1000');
  if (body.actionType && !['NONE', 'CATEGORY', 'PRODUCT', 'CAMPAIGN', 'EXTERNAL_URL'].includes(body.actionType)) throw httpError(400, 'Invalid banner destination');
  if (body.externalUrl && !isSafeExternalUrl(body.externalUrl)) throw httpError(400, 'External destinations require HTTPS');
  if (body.targetRoute && !/^\/(cart|categories|account|orders|grocery|electronics|fashion|garments|smart-buy|hot-deals)$/.test(body.targetRoute)) throw httpError(400, 'Choose a supported internal destination');
  return fields;
}
function validateVideo(banner) {
  if ((banner.mediaType || (banner.video ? 'video' : 'image')) !== 'video') return;
  if (banner.mediaType === 'video' && !banner.video) throw httpError(400, 'Video banners require a desktop video and an image poster');
  if (banner.autoplay !== false && banner.muted === false) throw httpError(400, 'Autoplay videos must be muted');
}
