import Banner from '../models/Banner.js';
import Product from '../models/Product.js';
import SellerPromotion from '../models/SellerPromotion.js';

/**
 * Module <-> existing-storefront mapping. QUICK is the "grocery" channel
 * everywhere else in this codebase (Product.type, Banner.type, the
 * SellerContext CHANNEL_OF_MODE table) and ECOMMERCE maps 1:1 to
 * Product.type/Banner.type's own 'ecommerce' value — nothing new invented,
 * just reused under the module vocabulary this feature's spec uses.
 */
export const MODULE_TO_CHANNEL = { QUICK: 'grocery', ECOMMERCE: 'ecommerce' };

/**
 * getBanners sorts `{ priority: -1, createdAt: -1 }` — a paid Seller
 * Advertisement must land as the first/left-most slide of its module's
 * existing Hero Banner carousel, ahead of ordinary admin banners (which are
 * created at `priority: 0` by default in BannersTab.jsx). A fixed high
 * value, not "highest + 1", so it never has to look at other banners to
 * decide where it belongs, and ties between two simultaneously-active
 * promotions just fall back to the same createdAt tiebreak every other
 * banner already uses.
 */
const SELLER_PROMOTION_BANNER_PRIORITY = 1000;

/**
 * Reuses the existing Banner engine exactly the way campaign.controller.js's
 * syncLinkedBanner() already does for Campaigns — this is the
 * SELLER_PROMOTION equivalent, kept in its own service (not duplicated
 * inline) since both the payment settlement path and the admin
 * disable/expiry paths need to call it.
 *
 * One Banner per promotion, tracked via `linkedBannerId` so a resync never
 * creates a duplicate. `type` is the module's own storefront channel (V1:
 * "one advertisement = one module" — Section 29/30 requires the banner to
 * appear ONLY in that module's customer feed, e.g. a QUICK advertisement
 * must never show on the E-commerce home carousel).
 *
 * No separate carousel, no separate fetch, no separate component: this
 * Banner document is fetched by the exact same `GET /api/banners` call
 * HeroBanner.jsx already makes, rendered by the exact same slide markup, so
 * it automatically inherits the carousel's existing auto-advance, touch,
 * and responsive behavior — and automatically disappears the moment
 * `isActive` goes false (disable/expiry below), with zero frontend change.
 */
export const syncPromotionBanner = async (promotion) => {
  // CRITICAL: 'ACTIVE' only. Visibility requires Admin approval AND
  // verified payment together (Section 28) — APPROVED alone (payment not
  // yet made, or failed) must never make this banner's isActive true. A
  // stray edit briefly included 'APPROVED' here, which put unpaid
  // promotions on the live customer storefront; do not reintroduce it.
  const isLive = promotion.status === 'ACTIVE';

  const fields = {
    title: promotion.title,
    image: promotion.bannerImage,
    type: MODULE_TO_CHANNEL[promotion.module] || 'general',
    category: 'home',
    actionType: 'SELLER_PROMOTION',
    targetPromotion: promotion._id,
    startDate: promotion.activatedAt,
    endDate: promotion.expiresAt,
    isActive: isLive,
    isDraft: false,
    priority: SELLER_PROMOTION_BANNER_PRIORITY,
  };

  if (promotion.linkedBannerId) {
    const existing = await Banner.findById(promotion.linkedBannerId);
    if (existing) {
      Object.assign(existing, fields);
      await existing.save();
      return existing;
    }
  }

  const banner = await Banner.create(fields);
  promotion.linkedBannerId = banner._id;
  await promotion.save();
  return banner;
};

/** Immediately turn off the linked banner without touching the promotion's own status. */
export const disablePromotionBanner = async (promotion) => {
  if (!promotion.linkedBannerId) return;
  await Banner.updateOne({ _id: promotion.linkedBannerId }, { $set: { isActive: false } });
};

/**
 * Premium Product Ranking — a paid promotion boosts its own products in
 * customer search, exactly the way it boosts a banner slide. Reuses
 * `Product.searchBoostRank` (see the field's own comment in Product.js):
 * `-amountSnapshot` so a seller who paid more for their package outranks
 * one who paid less, with no separate tier table to maintain. Same
 * ACTIVE-only gate as `syncPromotionBanner` — an unpaid or expired
 * promotion must never rank its products above organic ones.
 */
export const syncSearchBoost = async (promotion) => {
  if (promotion.status !== 'ACTIVE') return unsetSearchBoost(promotion);
  if (!promotion.selectedProducts?.length) return;
  await Product.updateMany(
    { _id: { $in: promotion.selectedProducts } },
    { $set: { searchBoostRank: -(promotion.amountSnapshot || 0), searchBoostUntil: promotion.expiresAt } }
  );
};

/** Clears the boost unconditionally — safe to call even if none was ever set. */
export const unsetSearchBoost = async (promotion) => {
  if (!promotion.selectedProducts?.length) return;
  await Product.updateMany(
    { _id: { $in: promotion.selectedProducts } },
    { $unset: { searchBoostRank: '', searchBoostUntil: '' } }
  );
};

/**
 * The customer-visibility gate (Section 28):
 * APPROVED alone means nothing — only ACTIVE (which by construction implies
 * verified payment — see settleSellerPromotionPayment) + not-yet-expired
 * counts. `expiresAt` itself is fixed at approval time, never at payment
 * time (Section 24-27) — see approveSellerPromotion.
 */
export const isPromotionEffectivelyActive = (promotion) =>
  !!promotion && promotion.status === 'ACTIVE' && promotion.expiresAt && new Date(promotion.expiresAt) > new Date();

/**
 * One-shot sweep. Two cases move to EXPIRED once `expiresAt` has passed:
 *  - ACTIVE (was paid and live) — the ordinary case, banner turns off.
 *  - APPROVED / PAYMENT_PENDING (never got a verified payment before its
 *    approval-based clock ran out) — Section 26/28: an unpaid approved
 *    advertisement was never publicly visible, but it must not sit in the
 *    admin/seller queues forever pretending payment is still possible.
 *
 * `disablePromotionBanner` is called unconditionally, not only when the
 * status was ACTIVE — it's a no-op when `linkedBannerId` is unset (the
 * normal case for an unpaid promotion), but it also catches the case of a
 * banner that was wrongly created early (e.g. by manual/backfilled data)
 * rather than leaving it live forever past expiry.
 */
export const expireDuePromotions = async () => {
  const now = new Date();
  const due = await SellerPromotion.find({
    status: { $in: ['ACTIVE', 'APPROVED', 'PAYMENT_PENDING'] },
    expiresAt: { $lte: now },
  });
  for (const promotion of due) {
    promotion.status = 'EXPIRED';
    await promotion.save();
    await disablePromotionBanner(promotion);
    await unsetSearchBoost(promotion);
  }
  return due.length;
};
