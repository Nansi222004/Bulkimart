import Campaign from '../models/Campaign.js';
import CampaignParticipation from '../models/CampaignParticipation.js';
import Category from '../models/Category.js';
import Product from '../models/Product.js';
import Banner from '../models/Banner.js';
import { uploadToCloudinary } from '../services/cloudinary.service.js';
import { asyncHandler } from '../middlewares/error.middleware.js';
import { ok, created, httpError } from '../utils/response.js';
import {
  campaignLifecycle, isCampaignEffectivelyActive, eligibleProductsForCampaign,
  resolveCampaignPricesForProducts,
  isEligibleProduct,
} from '../services/campaign.service.js';

const isEligibleCategory = (c) => !!c && c.isActive;

const validateCampaignInput = async ({ name, targetType, targetCategory, targetProducts, discountValue, startAt, endAt }) => {
  if (!name || !String(name).trim()) throw httpError(400, 'Campaign name is required');

  const discount = Number(discountValue);
  if (!Number.isFinite(discount) || discount <= 0 || discount > 100) {
    throw httpError(400, 'Discount must be a percentage between 1 and 100');
  }

  if (!startAt || !endAt) throw httpError(400, 'Start and end dates are required');
  if (new Date(endAt) <= new Date(startAt)) throw httpError(400, 'End date must be after the start date');

  if (targetType === 'CATEGORY') {
    if (!targetCategory) throw httpError(400, 'Choose a category to target');
    const cat = await Category.findById(targetCategory).lean();
    if (!isEligibleCategory(cat)) throw httpError(400, 'That category is not available for customers right now');
  } else if (targetType === 'PRODUCTS') {
    if (!Array.isArray(targetProducts) || !targetProducts.length) throw httpError(400, 'Select at least one product');
    const found = await Product.find({ _id: { $in: targetProducts } }).select('_id').lean();
    if (found.length !== new Set(targetProducts.map(String)).size) {
      throw httpError(400, 'One or more selected products could not be found');
    }
  } else {
    throw httpError(400, 'Target type must be CATEGORY or PRODUCTS');
  }
};

/**
 * Sync matching Banner model entry if autoCreateBanner flag is true.
 */
const syncLinkedBanner = async (campaign, imageUrl, autoCreateBanner) => {
  if (!autoCreateBanner || (autoCreateBanner !== 'true' && autoCreateBanner !== true)) return;
  if (!imageUrl) return;

  const existing = await Banner.findOne({ targetCampaign: campaign._id });
  if (existing) {
    existing.title = campaign.name;
    existing.image = imageUrl;
    existing.startDate = campaign.startAt;
    existing.endDate = campaign.endAt;
    existing.isActive = campaign.isEnabled && !campaign.isDraft;
    await existing.save();
  } else {
    await Banner.create({
      title: campaign.name,
      image: imageUrl,
      type: 'grocery',
      category: 'home',
      actionType: 'CAMPAIGN',
      targetCampaign: campaign._id,
      startDate: campaign.startAt,
      endDate: campaign.endAt,
      isActive: campaign.isEnabled && !campaign.isDraft,
      isDraft: campaign.isDraft,
    });
  }
};

/**
 * Publishing (or re-targeting while still Draft/Scheduled) generates one
 * PENDING participation row per currently-eligible product — skipping any
 * product that already has a row for this campaign, so calling this twice
 * is safe. Never touches ACCEPTED/REJECTED rows.
 */
const syncParticipationRows = async (campaign) => {
  const eligible = await eligibleProductsForCampaign(campaign);
  if (!eligible.length) return { created: 0, sellerIds: [] };

  const existing = await CampaignParticipation.find({ campaignId: campaign._id }).select('productId').lean();
  const existingIds = new Set(existing.map((r) => String(r.productId)));

  const toCreate = eligible.filter((p) => !existingIds.has(String(p._id)));
  if (!toCreate.length) return { created: 0, sellerIds: [] };

  await CampaignParticipation.insertMany(
    toCreate.map((p) => ({ campaignId: campaign._id, sellerId: p.sellerId, productId: p._id, status: 'PENDING' })),
    { ordered: false }
  ).catch((err) => {
    // Two concurrent publishes racing on the same (campaignId, productId)
    // pair — the unique index rejects the loser, which is fine: the winner
    // already created the row this call wanted.
    if (err.code !== 11000) throw err;
  });

  return { created: toCreate.length, sellerIds: [...new Set(toCreate.map((p) => String(p.sellerId)))] };
};

/**
 * Products no longer covered by a (still Draft/Scheduled) campaign's
 * target lose their PENDING row — never an ACCEPTED/REJECTED one, which
 * is a seller decision already made and stays on the books.
 */
const cancelStaleParticipation = async (campaign) => {
  const eligible = await eligibleProductsForCampaign(campaign);
  const eligibleIds = eligible.map((p) => String(p._id));
  await CampaignParticipation.updateMany(
    { campaignId: campaign._id, status: 'PENDING', productId: { $nin: eligibleIds } },
    { $set: { status: 'CANCELLED' } }
  );
};

// ============================================================
// ADMIN
// ============================================================

/** @route GET /api/admin/campaigns */
export const listCampaignsForAdmin = asyncHandler(async (req, res) => {
  const { search, status } = req.query;
  const filter = {};
  if (search) filter.name = new RegExp(search, 'i');

  let campaigns = await Campaign.find(filter).sort({ createdAt: -1 })
    .populate('targetCategory', 'name').lean();

  if (status && status !== 'All') {
    campaigns = campaigns.filter((c) => campaignLifecycle(c) === status);
  }

  const counts = await CampaignParticipation.aggregate([
    { $match: { campaignId: { $in: campaigns.map((c) => c._id) } } },
    { $group: { _id: { campaignId: '$campaignId', status: '$status' }, n: { $sum: 1 } } },
  ]);
  const countMap = new Map();
  for (const row of counts) {
    const key = String(row._id.campaignId);
    if (!countMap.has(key)) countMap.set(key, {});
    countMap.get(key)[row._id.status] = row.n;
  }

  const shaped = campaigns.map((c) => {
    const rowCounts = countMap.get(String(c._id)) || {};
    const totalSellers = 0; // computed below only in detail view — keeps the list query light
    return {
      ...c,
      lifecycle: campaignLifecycle(c),
      participationCounts: {
        pending: rowCounts.PENDING || 0,
        accepted: rowCounts.ACCEPTED || 0,
        rejected: rowCounts.REJECTED || 0,
        cancelled: rowCounts.CANCELLED || 0,
      },
    };
  });

  return ok(res, shaped, 'Campaigns');
});

/** @route GET /api/admin/campaigns/:id */
export const getCampaignForAdmin = asyncHandler(async (req, res) => {
  const campaign = await Campaign.findById(req.params.id).populate('targetCategory', 'name').lean();
  if (!campaign) throw httpError(404, 'Campaign not found');

  const rows = await CampaignParticipation.find({ campaignId: campaign._id })
    .populate('sellerId', 'businessName storeDetails.name')
    .populate('productId', 'name images price')
    .sort({ createdAt: -1 })
    .lean();

  const sellerIds = new Set(rows.map((r) => String(r.sellerId?._id || r.sellerId)));
  const summary = {
    eligibleSellers: sellerIds.size,
    eligibleProducts: rows.length,
    pending: rows.filter((r) => r.status === 'PENDING').length,
    accepted: rows.filter((r) => r.status === 'ACCEPTED').length,
    rejected: rows.filter((r) => r.status === 'REJECTED').length,
    cancelled: rows.filter((r) => r.status === 'CANCELLED').length,
  };

  return ok(res, { ...campaign, lifecycle: campaignLifecycle(campaign), participation: rows, summary }, 'Campaign');
});

/** @route POST /api/admin/campaigns */
export const createCampaign = asyncHandler(async (req, res) => {
  let {
    name, description, targetType, targetCategory, targetProducts,
    discountValue, startAt, endAt, isDraft, isEnabled, autoCreateBanner, bannerImage,
  } = req.body;

  if (typeof targetProducts === 'string') {
    try { targetProducts = JSON.parse(targetProducts); } catch { targetProducts = [targetProducts]; }
  }

  if (req.file) {
    bannerImage = await uploadToCloudinary(req.file.buffer, 'campaigns');
  }

  const draft = isDraft === true || isDraft === 'true';
  if (!draft) {
    await validateCampaignInput({ name, targetType, targetCategory, targetProducts, discountValue, startAt, endAt });
  } else if (!name || !String(name).trim()) {
    throw httpError(400, 'Give the draft a name so it can be found later');
  }

  const campaign = await Campaign.create({
    name, description, bannerImage,
    targetType, targetCategory: targetType === 'CATEGORY' ? targetCategory : undefined,
    targetProducts: targetType === 'PRODUCTS' ? targetProducts : undefined,
    discountValue: discountValue ? Number(discountValue) : undefined,
    startAt: startAt ? new Date(startAt) : undefined,
    endAt: endAt ? new Date(endAt) : undefined,
    isDraft: draft,
    isEnabled: isEnabled === undefined ? true : (isEnabled === true || isEnabled === 'true'),
    createdBy: req.user?._id,
    updatedBy: req.user?._id,
  });

  if (!draft) {
    await syncParticipationRows(campaign);
  }

  if (bannerImage) {
    await syncLinkedBanner(campaign, bannerImage, autoCreateBanner);
  }

  return created(res, campaign, draft ? 'Campaign saved as draft' : 'Campaign published');
});

/** @route PATCH /api/admin/campaigns/:id */
export const updateCampaign = asyncHandler(async (req, res) => {
  const campaign = await Campaign.findById(req.params.id);
  if (!campaign) throw httpError(404, 'Campaign not found');

  const lifecycle = campaignLifecycle(campaign);
  let {
    name, description, targetType, targetCategory, targetProducts,
    discountValue, startAt, endAt, isDraft, isEnabled, autoCreateBanner, bannerImage,
  } = req.body;

  if (typeof targetProducts === 'string') {
    try { targetProducts = JSON.parse(targetProducts); } catch { targetProducts = [targetProducts]; }
  }

  if (req.file) {
    bannerImage = await uploadToCloudinary(req.file.buffer, 'campaigns');
  }

  const changingCoreTerms = [targetType, targetCategory, targetProducts, discountValue, startAt, endAt]
    .some((v) => v !== undefined);
  if (changingCoreTerms && (lifecycle === 'ACTIVE' || lifecycle === 'EXPIRED')) {
    throw httpError(400, 'This campaign is already live — disable it and create a new one instead of changing its terms.');
  }

  const draft = isDraft !== undefined ? (isDraft === true || isDraft === 'true') : campaign.isDraft;
  const nextTargetType = targetType !== undefined ? targetType : campaign.targetType;
  const nextTargetCategory = targetCategory !== undefined ? targetCategory : campaign.targetCategory;
  const nextTargetProducts = targetProducts !== undefined ? targetProducts : campaign.targetProducts;
  const nextDiscountValue = discountValue !== undefined ? discountValue : campaign.discountValue;
  const nextStartAt = startAt !== undefined ? startAt : campaign.startAt;
  const nextEndAt = endAt !== undefined ? endAt : campaign.endAt;

  if (!draft) {
    await validateCampaignInput({
      name: name !== undefined ? name : campaign.name,
      targetType: nextTargetType, targetCategory: nextTargetCategory, targetProducts: nextTargetProducts,
      discountValue: nextDiscountValue, startAt: nextStartAt, endAt: nextEndAt,
    });
  }

  const targetChanged = (targetType !== undefined && targetType !== campaign.targetType)
    || (targetCategory !== undefined && String(targetCategory) !== String(campaign.targetCategory))
    || (targetProducts !== undefined && JSON.stringify([...targetProducts].sort()) !== JSON.stringify([...(campaign.targetProducts || [])].map(String).sort()));

  if (name !== undefined) campaign.name = name;
  if (description !== undefined) campaign.description = description;
  if (bannerImage !== undefined) campaign.bannerImage = bannerImage;
  if (targetType !== undefined) campaign.targetType = targetType;
  if (targetCategory !== undefined) campaign.targetCategory = nextTargetType === 'CATEGORY' ? targetCategory : undefined;
  if (targetProducts !== undefined) campaign.targetProducts = nextTargetType === 'PRODUCTS' ? targetProducts : undefined;
  if (discountValue !== undefined) campaign.discountValue = Number(discountValue);
  if (startAt !== undefined) campaign.startAt = new Date(startAt);
  if (endAt !== undefined) campaign.endAt = new Date(endAt);
  if (isEnabled !== undefined) campaign.isEnabled = isEnabled === true || isEnabled === 'true';
  if (isDraft !== undefined) campaign.isDraft = draft;
  campaign.updatedBy = req.user?._id;

  await campaign.save();

  if (!draft) {
    if (targetChanged) await cancelStaleParticipation(campaign);
    await syncParticipationRows(campaign);
  }

  const effectiveBannerImage = campaign.bannerImage;
  if (effectiveBannerImage) {
    await syncLinkedBanner(campaign, effectiveBannerImage, autoCreateBanner);
  }

  return ok(res, campaign, 'Campaign updated');
});

/** @route DELETE /api/admin/campaigns/:id
 *  Hard delete only when nothing has happened yet (no participation rows
 *  at all) — otherwise a seller's accept/reject history would vanish.
 *  Disable instead (isEnabled: false via PATCH) for anything with history. */
export const deleteCampaign = asyncHandler(async (req, res) => {
  const campaign = await Campaign.findById(req.params.id);
  if (!campaign) throw httpError(404, 'Campaign not found');

  const anyParticipation = await CampaignParticipation.exists({ campaignId: campaign._id });
  if (anyParticipation) {
    throw httpError(400, 'This campaign already has seller participation history — disable it instead of deleting.');
  }

  await campaign.deleteOne();
  return ok(res, null, 'Campaign deleted');
});

// ============================================================
// CUSTOMER — public, read-only
// ============================================================

/** @route GET /api/campaigns */
export const getActiveCampaignsPublic = asyncHandler(async (req, res) => {
  const now = new Date();
  const campaigns = await Campaign.find({
    isDraft: { $ne: true }, isEnabled: true, startAt: { $lte: now }, endAt: { $gt: now },
  }).populate('targetCategory', 'name slug').sort({ startAt: -1 }).lean();

  return ok(res, campaigns.map((c) => ({
    id: c._id, name: c.name, description: c.description, bannerImage: c.bannerImage,
    discountType: c.discountType, discountValue: c.discountValue,
    startAt: c.startAt, endAt: c.endAt,
    targetType: c.targetType,
    targetCategory: c.targetCategory ? { slug: c.targetCategory.slug, name: c.targetCategory.name } : undefined,
  })), 'Active campaigns');
});

/** @route GET /api/campaigns/:id */
export const getCampaignPublic = asyncHandler(async (req, res) => {
  const c = await Campaign.findById(req.params.id).populate('targetCategory', 'name slug').lean();
  if (!c || !isCampaignEffectivelyActive(c)) throw httpError(404, 'This campaign is not available');

  return ok(res, {
    id: c._id, name: c.name, description: c.description, bannerImage: c.bannerImage,
    discountType: c.discountType, discountValue: c.discountValue,
    startAt: c.startAt, endAt: c.endAt, targetType: c.targetType,
    targetCategory: c.targetCategory ? { slug: c.targetCategory.slug, name: c.targetCategory.name } : undefined,
  }, 'Campaign');
});

/** @route GET /api/campaigns/:id/products
 *  Only ACCEPTED participation, only while the campaign is genuinely
 *  active right now — a scheduled/expired/disabled campaign returns
 *  nothing here regardless of what participation rows exist. */
export const getCampaignProductsPublic = asyncHandler(async (req, res) => {
  const campaign = await Campaign.findById(req.params.id).lean();
  if (!campaign || !isCampaignEffectivelyActive(campaign)) return ok(res, { products: [] }, 'Campaign products');

  const rows = await CampaignParticipation.find({ campaignId: campaign._id, status: 'ACCEPTED' })
    .populate('productId', 'name images price mrp stock type isActive isDeleted status sellingChannels')
    .lean();

  const products = rows
    .filter((r) => isEligibleProduct(r.productId))
    .map((r) => ({
      id: r.productId._id, name: r.productId.name,
      image: r.productId.images?.[0] || '', images: r.productId.images || [],
      price: r.productId.price, stock: r.productId.stock, type: r.productId.type,
      campaignPrice: r.campaignPrice, discountValue: r.discountValue,
    }));

  return ok(res, { products }, 'Campaign products');
});
