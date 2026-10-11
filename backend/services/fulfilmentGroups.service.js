import Cart from '../models/Cart.js';
import Product from '../models/Product.js';
import Seller from '../models/Seller.js';
import { priceOrder, resolveDeliveryType } from './pricing.service.js';
import { checkCartSameDayEligibility } from './sameDay.service.js';
import { applyCouponCode } from './coupon.service.js';
import { CHANNEL, CHANNELS, DELIVERY_MODE } from '../constants/enums.js';
import { distanceKm } from '../utils/geo.js';
import { resolveCampaignPricesForProducts } from './campaign.service.js';
import { resolveInventoryItem } from './inventory.service.js';

/**
 * One basket, several journeys.
 *
 * A shopper filling a unified cart does not care that groceries come by rider in
 * half an hour and a speaker comes by courier in three days. The system has to,
 * because those are different fulfilments: different pickup, different carrier,
 * different lifecycle, and — downstream — different orders. Seven places in the
 * delivery controller read "the first item with a seller" as *the* pickup, so an
 * order can only ever have one.
 *
 * This splits the basket along exactly those lines and prices each piece with
 * the functions that already price orders. It writes nothing and decides
 * nothing: checkout will create one order per group, and until then this is a
 * reading of what the basket would become.
 */

/**
 * What makes two lines the same journey.
 *
 * Seller, because pickup is per shop. Channel, because Quick and Shop All are
 * fulfilled differently and are already separate carts. Mode, because a customer
 * may want one thing today and another whenever, and those are two rider trips
 * even from the same shop.
 */
const groupKeyFor = (line) =>
  [line.channel, String(line.sellerId || line.shgStoreId || 'none'), line.deliveryMode || 'default'].join(':');

/**
 * The mode a line is grouped under.
 *
 * Quick has one way of arriving, so it never carries a mode. A Shop All line the
 * customer has not decided on groups as Scheduled — that is what it becomes if
 * nothing is chosen — but the group still reports `modeChosen: false`, so
 * checkout can tell "they picked Scheduled" from "they picked nothing" and keep
 * the choose-before-you-order rule enforceable.
 */
const modeFor = (line) => {
  if (line.channel !== CHANNEL.ECOM) return null;
  return line.deliveryMode || DELIVERY_MODE.SCHEDULED;
};

/**
 * Every line the shopper is holding, across all their carts.
 *
 * Reads the carts that already exist rather than a fourth store of its own.
 * Nothing is written, nothing is migrated, and the per-channel carts stay the
 * single place a line lives — which is what keeps add-to-cart's guarantee
 * (`channel = product.type`) meaningful.
 */
const loadLines = async (userId) => {
  const carts = await Cart.find({ userId }).lean();
  const lines = [];
  for (const cart of carts) {
    for (const item of cart.items || []) {
      lines.push({ ...item, channel: cart.channel, cartId: cart._id });
    }
  }
  return lines;
};

/**
 * Compose the basket into priced, grouped fulfilments.
 *
 * @param {object} args
 * @param {ObjectId} args.userId
 * @param {{lat,lng}} [args.destination]  where it is going; without it Same-Day
 *                                        cannot be answered and is reported as
 *                                        unknown rather than unavailable
 * @param {object} [args.user]            retained for downstream pricing context
 */
export const buildFulfilmentGroups = async ({ userId, destination, user, couponCode }) => {
  const lines = await loadLines(userId);

  if (lines.length === 0) {
    return {
      groups: [],
      items: [],
      totals: { subtotal: 0, deliveryCharge: 0, sameDayPremium: 0, totalAmount: 0, itemCount: 0 },
      needsDeliveryChoice: false,
    };
  }

  /**
   * Two queries for the whole basket, not two per line.
   *
   * A ten-item cart from three shops was otherwise ten product reads and ten
   * seller reads. The products are needed live because a cart line is a snapshot
   * — its price and stock were true when it was added and may not be now.
   */
  const productIds = [...new Set(lines.map((l) => String(l.productId)))];
  const products = new Map(
    (await Product.find({ _id: { $in: productIds } })
      .select('name price stock sku unit variants type fulfillmentType sellerId shgStoreId sameDay images isActive isDeleted status')
      .lean()).map((p) => [String(p._id), p])
  );

  // Sellers are keyed off the LIVE product's sellerId, never the cart line's
  // own stored one — a line written before the product had one, or from a
  // stale add-to-cart path, would otherwise never resolve a pickup and group
  // as if it belonged to nobody (see groupKeyFor's "none" fallback), which
  // silently drops Same-Day eligibility for that line without ever answering
  // "why" to the shopper.
  const sellerIds = [...new Set(
    [...products.values()].map((p) => String(p.sellerId)).filter((id) => id && id !== 'undefined')
  )];
  const sellers = new Map(
    (await Seller.find({ _id: { $in: sellerIds } })
      .select('businessName storeDetails status sameDay')
      .lean()).map((s) => [String(s._id), s])
  );

  // One batched lookup for the whole basket — never one per line.
  const campaignPrices = await resolveCampaignPricesForProducts(productIds);

  // ---- split -------------------------------------------------------------
  const buckets = new Map();
  for (const line of lines) {
    const product = products.get(String(line.productId));
    const deal = campaignPrices.get(String(line.productId));
    let inventory = null;
    try { if (product) inventory = resolveInventoryItem(product, line.variantId, { allowLegacyPrimary: !line.variantId }); } catch { /* rendered as unavailable below */ }
    const enriched = {
      ...line,
      // Whose pickup this actually is, per the live product — not whatever
      // was stored on the cart line when it was added. See the note above
      // sellerIds: a stale/missing stored sellerId must not silently orphan
      // the line into a seller-less group.
      sellerId: product?.sellerId ?? line.sellerId,
      shgStoreId: product?.shgStoreId ?? line.shgStoreId,
      deliveryMode: modeFor(line),
      modeChosen: line.channel !== CHANNEL.ECOM || Boolean(line.deliveryMode),
      product,
      inventory,
      // The live figures (or a live, currently-active campaign price), so
      // a group is priced on what the item is now rather than what it was
      // when it went into the basket — never a cached deal.
      price: inventory ? (deal ? Number((inventory.price * (1 - Number(deal.discountValue || 0) / 100)).toFixed(2)) : inventory.price) : line.price,
      campaignId: deal ? deal.campaignId : undefined,
      available: Boolean(product && product.fulfillmentType !== 'digital' && product.isActive && !product.isDeleted
        && product.status === 'approved' && inventory && inventory.stock >= line.qty),
    };

    const key = groupKeyFor(enriched);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(enriched);
  }

  // ---- price and check each group ----------------------------------------
  const groups = [];
  for (const [key, groupLines] of buckets) {
    const first = groupLines[0];
    const seller = sellers.get(String(first.sellerId));
    const isSameDay = first.deliveryMode === DELIVERY_MODE.SAME_DAY;

    /**
     * Same-Day is asked of the existing service, per group.
     *
     * A group is one seller by construction, so the single-seller rule that
     * service enforces can never fire here — which is the point: the rule was
     * only ever a symptom of one order having one pickup, and grouping removes
     * the conflict rather than the rule.
     *
     * Asked for any Shop All group, not only ones already marked Same-Day, so
     * checkout knows whether it can offer the switch.
     */
    let sameDay = null;
    if (first.channel === CHANNEL.ECOM && destination?.lat !== undefined && destination?.lng !== undefined) {
      sameDay = await checkCartSameDayEligibility({
        lines: groupLines.map((l) => ({ product: l.product, seller, qty: l.qty })),
        destination,
      });
    }

    // Same-Day is only priced in when it is actually on offer. A line marked
    // same_day whose eligibility has since lapsed is priced as Scheduled and
    // reported as such, rather than being charged for a promise we cannot keep.
    const sameDayApplies = isSameDay && sameDay?.available === true;

    /**
     * The distance this group's delivery charge is priced against.
     *
     * A Same-Day group already had its distance computed by the eligibility
     * check just above — reused, not recomputed. A Grocery group (always our
     * own rider) is measured fresh from this group's own seller to the
     * destination. Anything else (a non-Same-Day Ecommerce group, courier-
     * carried) is left undefined — priceOrder() falls back to the flat
     * admin fee there, since there is no rider leg to price.
     */
    const groupDistanceKm = sameDayApplies
      ? sameDay.distanceKm
      : (first.channel === CHANNEL.GROCERY ? distanceKm(seller?.storeDetails, destination) : undefined);

    let groupCoupon = null;
    if (couponCode) {
      const base = priceOrder(groupLines, user, null, null, groupDistanceKm);
      const applied = await applyCouponCode(couponCode, {
        items: groupLines.map(l => ({ ...l, type: l.channel })),
        subtotal: base.subtotal,
        user,
        deliveryCharge: base.deliveryCharge
      });
      if (applied.ok) {
        groupCoupon = applied;
      }
    }
    const pricing = priceOrder(groupLines, user, groupCoupon, sameDayApplies ? sameDay : null, groupDistanceKm);

    groups.push({
      key,
      channel: first.channel,
      seller: seller ? {
        _id: seller._id,
        name: seller.storeDetails?.name || seller.businessName,
        phone: seller.storeDetails?.phone || '',
        address: [
          seller.storeDetails?.address,
          seller.storeDetails?.city,
          seller.storeDetails?.state,
          seller.storeDetails?.pincode,
        ].filter(Boolean).join(', '),
        city: seller.storeDetails?.city,
      } : null,

      deliveryMode: sameDayApplies ? DELIVERY_MODE.SAME_DAY
        : (first.channel === CHANNEL.ECOM ? DELIVERY_MODE.SCHEDULED : null),
      // What was asked for, which is not always what can be given.
      requestedMode: first.deliveryMode,
      modeChosen: first.modeChosen,
      deliveryType: resolveDeliveryType(groupLines, sameDayApplies ? DELIVERY_MODE.SAME_DAY : null),

      /**
       * Each line already in the shape an Order stores.
       *
       * Checkout turns a group straight into an order, and the two extra fields
       * here — who sells it and which storefront it came from — are the only
       * ones an Order needs that a cart line does not already carry. Adding them
       * once, from the products already loaded above, is what lets checkout
       * create N orders without going back to the database per line.
       */
      items: groupLines.map((l) => ({
        // The cart line's own id — what PUT /api/cart/:itemId needs when the
        // shopper changes this group's delivery mode.
        itemId: l._id,
        productId: l.productId,
        variantId: l.inventory?.variantId || null,
        sku: l.inventory?.sku,
        variantName: l.inventory?.variantName,
        variantAttributes: l.inventory?.attributes || [],
        unitSnapshot: l.inventory?.unit,
        weightSnapshot: l.inventory?.weight,
        name: l.product?.name || l.name,
        image: l.product?.images?.[0] || l.image,
        qty: l.qty,
        price: l.price,
        campaignId: l.campaignId,
        lineTotal: Number((l.price * l.qty).toFixed(2)),
        available: l.available,
        stock: l.inventory?.stock,
        type: l.product?.type || l.channel,
        sellerId: l.product?.sellerId || l.sellerId,
        shgStoreId: l.shgStoreId,
        additionalMessage: l.additionalMessage || '',
      })),
      itemCount: groupLines.reduce((n, l) => n + l.qty, 0),

      subtotal: pricing.subtotal,
      couponDiscount: pricing.couponDiscount,
      standardFee: pricing.standardFee,
      sameDayFee: pricing.sameDayFee,
      sellerIncentive: pricing.sameDayIncentive,
      deliveryCharge: pricing.deliveryCharge,
      total: pricing.totalAmount,

      /**
       * Both options for this group, with the reason behind the refused one.
       * Null when there is no address yet — "we cannot say" is a different thing
       * from "not available", and a cart must not show the second when it means
       * the first.
       */
      sameDayOption: first.channel === CHANNEL.ECOM ? sameDay : null,
      scheduledAvailable: first.channel === CHANNEL.ECOM,
    });
  }

  /**
   * Charged per group, not per basket.
   *
   * Two shops are two trips, two riders and two payouts; folding them into one
   * fee would mean the platform quietly funding the second. Each group ran
   * through the same `priceOrder` an ordinary order runs through, so the
   * threshold and any coupon applied to it exactly as they would have.
   */
  const totals = groups.reduce((t, g) => ({
    subtotal: t.subtotal + g.subtotal,
    deliveryCharge: t.deliveryCharge + g.deliveryCharge,
    sameDayPremium: t.sameDayPremium + (g.sameDayFee || 0) + (g.sellerIncentive || 0),
    couponDiscount: t.couponDiscount + (g.couponDiscount || 0),
    totalAmount: t.totalAmount + g.total,
    itemCount: t.itemCount + g.itemCount,
  }), { subtotal: 0, deliveryCharge: 0, sameDayPremium: 0, couponDiscount: 0, totalAmount: 0, itemCount: 0 });

  for (const k of Object.keys(totals)) totals[k] = Number(totals[k].toFixed(2));

  return {
    groups,
    items: groups.flatMap((g) => g.items),
    totals,
    // Checkout keeps Place Order disabled while this is true.
    needsDeliveryChoice: groups.some((g) => g.channel === CHANNEL.ECOM && !g.modeChosen),
  };
};

export default buildFulfilmentGroups;
