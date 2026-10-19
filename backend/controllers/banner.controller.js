import { retailAllowed } from '../utils/productChannels.js';
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
    return u.protocol === 'http:' || u.protocol === 'https:';
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
      throw httpError(400, 'Enter a valid http:// or https:// URL');
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
    .sort({ priority: -1, createdAt: -1 })
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
      .sort({ priority: -1, createdAt: -1 })
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

  res.status(200).json(banners);
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
  if (req.file) {
    imageUrl = await uploadToCloudinary(req.file.buffer, 'banners');
  }

  const banner = await Banner.create({
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
  if (banner.actionType === 'SELLER_PROMOTION' || banner.targetPromotion || req.body.actionType === 'SELLER_PROMOTION' || req.body.targetPromotion) throw httpError(410, 'Seller promotions have been removed.');

  const {
    title, subtitle, targetRoute, type, category, priority, startDate, endDate, isActive,
    actionType, targetCategory, targetProduct, targetCampaign, externalUrl, isDraft,
  } = req.body;

  if (req.file) {
    banner.image = await uploadToCloudinary(req.file.buffer, 'banners');
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

  await banner.deleteOne();
  res.status(200).json({ message: 'Banner deleted successfully' });
});
