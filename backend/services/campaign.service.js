import Campaign from '../models/Campaign.js';
import CampaignParticipation from '../models/CampaignParticipation.js';
import Product from '../models/Product.js';
import Category from '../models/Category.js';

const round2 = (n) => Math.round(Number(n) * 100) / 100;

/** Same three flags this codebase always checks before showing a product
 *  to a customer — cart.controller.js, order.controller.js and
 *  banner.controller.js all use this exact combination. */
export const isEligibleProduct = (p) => !!p && p.fulfillmentType !== 'digital' && !p.isDeleted && p.isActive && p.status === 'approved';

/** DRAFT / SCHEDULED / ACTIVE / EXPIRED / DISABLED — never stored, always
 *  derived, same discipline as Banner.js. */
export const campaignLifecycle = (c) => {
  if (c.isDraft) return 'DRAFT';
  if (!c.isEnabled) return 'DISABLED';
  const now = Date.now();
  if (new Date(c.startAt).getTime() > now) return 'SCHEDULED';
  if (new Date(c.endAt).getTime() <= now) return 'EXPIRED';
  return 'ACTIVE';
};

export const isCampaignEffectivelyActive = (c) => campaignLifecycle(c) === 'ACTIVE';

/**
 * Every product a campaign's targeting rule currently covers, filtered to
 * the same customer-eligibility bar as everywhere else — a draft/rejected/
 * out-of-catalog product was never a candidate for a deal.
 */
export const eligibleProductsForCampaign = async (campaign) => {
  const filter = { isActive: true, isDeleted: false, status: 'approved', fulfillmentType: { $ne: 'digital' } };
  if (campaign.targetType === 'CATEGORY') {
    if (campaign.targetCategory) {
      const childCategories = await Category.find({ parent: campaign.targetCategory }).select('_id').lean();
      const catIds = [campaign.targetCategory, ...childCategories.map((c) => c._id)];
      filter.$or = [
        { category: { $in: catIds } },
        { subCategory: { $in: catIds } },
        { 'channels.category': { $in: catIds } },
      ];
    }
  } else {
    filter._id = { $in: campaign.targetProducts || [] };
  }
  return Product.find(filter).select('_id sellerId price name images stock').lean();
};

/**
 * Batched — one query regardless of how many products are asked about, so
 * a cart/order/listing read never turns into a per-item campaign lookup.
 * Returns Map<productId string, { campaignId, campaignTitle, discountValue, campaignPrice }>.
 */
export const resolveCampaignPricesForProducts = async (productIds) => {
  const ids = [...new Set(productIds.map(String))].filter(Boolean);
  const map = new Map();
  if (!ids.length) return map;

  const rows = await CampaignParticipation.find({ productId: { $in: ids }, status: 'ACCEPTED' })
    .populate('campaignId', 'isDraft isEnabled startAt endAt name')
    .lean();

  for (const row of rows) {
    const campaign = row.campaignId;
    if (!campaign || !isCampaignEffectivelyActive(campaign)) continue;
    // Accept-time conflict checking keeps this to one active row per
    // product in practice; if more than one somehow exists, the first
    // found wins rather than stacking — never add two discounts together.
    if (map.has(String(row.productId))) continue;
    map.set(String(row.productId), {
      campaignId: String(campaign._id),
      campaignTitle: campaign.name,
      discountValue: row.discountValue,
      campaignPrice: row.campaignPrice,
    });
  }
  return map;
};

export const resolveCampaignPriceForProduct = async (productId) => {
  const map = await resolveCampaignPricesForProducts([productId]);
  return map.get(String(productId)) || null;
};

export const computeCampaignPrice = (price, discountValue) => round2(Number(price) * (1 - Number(discountValue) / 100));
