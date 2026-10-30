import { publishEligibleSellerOrder } from '../services/sellerOrderNotification.service.js';
import { buildCustomerBasket } from '../services/customerBasket.service.js';
import { channelAllowed } from '../utils/productChannels.js';
import mongoose from 'mongoose';
import { createHash } from 'node:crypto';
import Order from '../models/Order.js';
import CheckoutAttempt from '../models/CheckoutAttempt.js';
import { logCheckoutFailure } from '../services/checkoutDiagnostics.service.js';
import Cart from '../models/Cart.js';
import Product from '../models/Product.js';
import Payment from '../models/Payment.js';
import Seller from '../models/Seller.js';
import User from '../models/User.js';
import { coordinateOnlineCancellation } from '../services/paymentObligations.service.js';
import { fenceCheckoutSellers } from '../services/sellerCheckout.service.js';
import { assertWholesaleBuyer } from '../services/wholesaleEligibility.service.js';
import { wholesaleQuoteHash } from '../services/wholesaleQuote.service.js';
import Delivery from '../models/Delivery.js';
import DeliveryPartner from '../models/DeliveryPartner.js';
import { asyncHandler } from '../middlewares/error.middleware.js';
import { ok, created, paginated, getPagination, httpError } from '../utils/response.js';
import { resolveProductGst, calculateProductGst } from '../services/productGst.service.js';
import { priceOrder, resolveDeliveryType } from '../services/pricing.service.js';
import { applyCouponCode, redeemCoupon, releaseCoupon } from '../services/coupon.service.js';
import { resolveTip } from '../services/tip.service.js';
import { resolveCampaignPricesForProducts } from '../services/campaign.service.js';
import { isWithinRadius } from '../services/radius.service.js';
import { forwardGeocode } from '../services/geocode.service.js';
import { notifyUser, NOTIFICATION_EVENT } from '../services/notification.service.js';
import { debitWallet, refundToWallet } from '../services/wallet.service.js';
import { WALLET_TRANSACTION_TYPE, WALLET_REFERENCE_TYPE } from '../models/WalletLedger.js';
import { buildReturnPolicySnapshotsFor } from '../services/returnPolicy.service.js';
import { applyProductReturnSettings } from '../services/productReturns.service.js';
import {
  ORDER_STATUS,
  CANCELLABLE_STATUSES,
  PAYMENT_METHOD,
  PAYMENT_STATUS,
  CHANNEL,
  CHANNELS,
  DELIVERY_MODE,
  DELIVERY_MODES,
} from '../constants/enums.js';
import { checkCartSameDayEligibility } from '../services/sameDay.service.js';
import { buildFulfilmentGroups } from '../services/fulfilmentGroups.service.js';
import { distanceKm } from '../utils/geo.js';
import { mutateInventory, resolveInventoryItem } from '../services/inventory.service.js';
import { orderHistoryPaymentStages } from '../services/orderPaymentEligibility.service.js';
import {
  createOrdersFromGroups,
  validateGroupsStock,
  buildDeliverySnapshot,
} from '../services/fulfilmentOrders.service.js';

const canonicalJson = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
};

const checkoutIdentity = async (req, operation) => {
  const key = req.get('Idempotency-Key');
  if (typeof key !== 'string' || !/^[A-Za-z0-9._:-]{16,128}$/.test(key)) {
    throw httpError(400, 'A valid Idempotency-Key header is required', { code: 'IDEMPOTENCY_KEY_REQUIRED' });
  }
  const requestHash = createHash('sha256')
    .update(`${operation}\n${canonicalJson(req.body || {})}`)
    .digest('hex');
  const filter = { userId: req.user._id, key };
  const previous = await CheckoutAttempt.findOne(filter).lean();
  if (previous) {
    if (previous.requestHash !== requestHash || previous.operation !== operation) {
      throw httpError(409, 'This checkout key was already used for different checkout details', { code: 'IDEMPOTENCY_KEY_REUSED' });
    }
    if (previous.status !== 'completed') {
      throw httpError(409, 'This checkout is still being processed. Please retry shortly.', { code: 'CHECKOUT_IN_PROGRESS' });
    }
    const orders = await Promise.all((previous.orderIds || []).map((id) => Order.findById(id)));
    if (!orders.length || orders.some((order) => !order || String(order.userId) !== String(req.user._id))) {
      throw httpError(409, 'The previous checkout result is unavailable. Please contact support.', { code: 'CHECKOUT_RESULT_UNAVAILABLE' });
    }
    return { key, requestHash, replay: previous, replayOrders: orders };
  }
  return { key, requestHash, replay: null, replayOrders: [] };
};

const isTransactionUnavailable = (err) =>
  /Transaction numbers are only allowed|replica set|does not support transactions/i.test(err?.message || '');

const findClaimedCheckout = async ({ userId, key, requestHash, operation }) => {
  // A duplicate-key error can be the second half of two requests which both
  // passed the initial lookup. Give the request which won the unique claim a
  // brief chance to finish, then replay its result instead of showing a false
  // "different details" error to the customer.
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const checkout = await CheckoutAttempt.findOne({ userId, key }).lean();
    if (!checkout) return null;
    if (checkout.requestHash !== requestHash || checkout.operation !== operation) return checkout;
    if (checkout.status === 'completed') return checkout;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return CheckoutAttempt.findOne({ userId, key }).lean();
};

const checkoutClaimError = (checkout, requestHash, operation) => {
  if (!checkout) return httpError(409, 'We could not confirm the order because of a data conflict. Check My Orders before trying again. Contact support if this continues.', { code: 'CHECKOUT_DATA_CONFLICT' });
  if (checkout?.requestHash === requestHash && checkout.operation === operation) {
    return httpError(409, 'Your order is still being processed. Please wait a moment and try again.', { code: 'CHECKOUT_IN_PROGRESS' });
  }
  return httpError(409, 'This checkout session is no longer valid for the current order details. Refresh checkout and try again.', { code: 'IDEMPOTENCY_KEY_REUSED' });
};

// Read-only recovery: never creates an order, changes a payment or rotates a
// key. The authenticated owner is part of every lookup.
export const getCheckoutStatus = asyncHandler(async (req, res) => {
  const { operation } = req.body || {};
  const key = req.get('Idempotency-Key');
  if (!['single', 'unified', 'digital'].includes(operation) || typeof key !== 'string' || !/^[A-Za-z0-9._:-]{16,128}$/.test(key)) {
    throw httpError(400, 'A valid checkout session is required', { code: 'INVALID_CHECKOUT_SESSION' });
  }
  const attempt = await CheckoutAttempt.findOne({ userId: req.user._id, key }).lean();
  if (!attempt) return ok(res, { state: 'not_found', canRetrySameKey: true }, 'No committed checkout was found for this session.');
  if (attempt.operation !== operation) throw httpError(409, 'This checkout session belongs to different order details.', { code: 'IDEMPOTENCY_KEY_REUSED' });
  if (attempt.status !== 'completed') return ok(res, { state: 'processing', canRetrySameKey: false }, 'Your checkout is still processing. Check again shortly.');
  const [orders, payment] = await Promise.all([
    Promise.all((attempt.orderIds || []).map(id => Order.findById(id))),
    Payment.findById(attempt.paymentId),
  ]);
  if (!orders.length || orders.some(order => !order || String(order.userId) !== String(req.user._id)) || !payment || String(payment.userId) !== String(req.user._id)) {
    return ok(res, { state: 'unavailable', canRetrySameKey: false }, 'The checkout result needs support review. Do not submit another order.');
  }
  return ok(res, { state: 'completed', canRetrySameKey: false, orders: orders.map(order => ({ _id: order._id, orderNo: order.orderNo, status: order.status })), payment: { id: payment._id, status: payment.status } }, 'Your order already exists. Open My Orders to continue.');
});

/**
 * Checkout.
 *
 * Two things make this different from a naive implementation:
 *
 * 1. Stock is decremented inside a TRANSACTION with a conditional update
 *    (`stock: { $gte: qty }`). Two people checking out the last unit at the same
 *    moment would otherwise both succeed and the seller would owe stock they do
 *    not have. If any line fails the whole order rolls back.
 *
 * 2. Totals come from services/pricing.service.js — the same function the cart
 *    preview uses — so the customer is never charged something other than what
 *    the cart showed.
 *
 * Checkout is per storefront. Quick and Shop All have their own carts because
 * they are fulfilled differently, so each produces its own order with its own
 * delivery fee.
 *
 * Within one storefront a cart may still hold items from several sellers. That
 * stays ONE order with mixed items, each carrying its own sellerId — splitting
 * per vendor cascades into payouts, partial cancellation and per-vendor
 * tracking, which is a v2 decision.
 */

const pushTimeline = (order, status, note) => {
  order.timeline.push({ status, timestamp: new Date(), note });
};

const claimCancellation = async (order, reason, session, extraSet = {}) => {
  const result = await Order.updateOne(
    { _id: order._id, status: { $in: CANCELLABLE_STATUSES },
      'shiprocket.orderId': { $exists: false },
      'shiprocket.status': { $nin: ['creating', 'assigning', 'reconciliation_required'] } },
    { $set: { status: ORDER_STATUS.CANCELLED, cancelReason: reason, ...extraSet }, $push: { timeline: { status: ORDER_STATUS.CANCELLED, timestamp: new Date(), note: reason } } },
    { session }
  );
  if (result.modifiedCount !== 1) throw httpError(409, 'This order has already changed and cannot be cancelled again');
};

/**
 * Turn whatever the client sent into a delivery address with a point on it.
 *
 * Shared by both checkouts. The rules here — a saved address is read from the
 * user rather than trusted from the request, the required fields, and the
 * geocode fallback with its deliberate non-fatal miss — are the same rules
 * whether one order comes out or three, and a second copy of them would be a
 * second place for them to drift.
 *
 * Extracted verbatim from createOrder; behaviour is unchanged.
 */
export const resolveShippingAddress = async ({ user, addressId, shippingAddress }) => {
  let address = shippingAddress;

  const profileName = user?.name != null ? String(user.name).trim() : '';
  const profilePhone = user?.phone != null ? String(user.phone).trim() : '';

  const cleanAddressId = (addressId && addressId !== 'undefined' && addressId !== 'null') ? String(addressId) : null;

  if (cleanAddressId) {
    const saved = user?.addresses?.id?.(cleanAddressId)
      || user?.addresses?.find?.((a) => String(a?._id || a?.id) === cleanAddressId);

    if (saved) {
      const savedName = saved.name != null ? String(saved.name).trim() : '';
      const savedPhone = saved.phone != null ? String(saved.phone).trim() : '';
      address = {
        name: profileName || savedName,
        phone: profilePhone || savedPhone,
        line1: saved.line1,
        line2: saved.line2,
        city: saved.city,
        state: saved.state,
        pincode: saved.pincode,
        lat: saved.lat,
        lng: saved.lng,
        landmarkImage: saved.landmarkImage || null,
        locationSource: saved.locationSource,
      };
    } else if (!address || !address.line1) {
      throw httpError(400, 'That saved address was not found');
    }
  }

  if (address) {
    const rawName = address.name != null ? String(address.name).trim() : '';
    const rawPhone = address.phone != null ? String(address.phone).trim() : '';
    address = {
      ...address,
      name: profileName || rawName,
      phone: profilePhone || rawPhone,
    };
  }

  const resolvedName = address?.name != null ? String(address.name).trim() : '';
  const resolvedPhone = address?.phone != null ? String(address.phone).trim() : '';

  if (!resolvedName) {
    throw httpError(400, 'Please complete your profile name to place an order');
  }

  if (!resolvedPhone) {
    throw httpError(400, 'Please complete your profile mobile number to place an order');
  }

  if (!address?.line1 || !address?.city || !address?.pincode) {
    throw httpError(400, 'A delivery address with phone, address line, city and pincode is required');
  }

  address.name = resolvedName;
  address.phone = resolvedPhone;

  if (address.lat === undefined || address.lng === undefined) {
    const hit = await forwardGeocode([
      address.line1, address.line2, address.city, address.state, address.pincode, 'India',
    ]);

    if (hit.ok) {
      address = { ...address, lat: hit.lat, lng: hit.lng, locationSource: 'geocoded', geocodePrecision: hit.precision };
      // Keep the point on the saved address, so the next cart quote prices
      // delivery from the same place this order does.
      if (cleanAddressId && user?._id) {
        await User.updateOne({ _id: user._id, addresses: { $elemMatch: { _id: cleanAddressId, lat: null } } },
          { $set: { 'addresses.$.lat': hit.lat, 'addresses.$.lng': hit.lng, 'addresses.$.locationSource': 'geocoded' } })
          .catch(err => console.warn('[CHECKOUT] could not save address pin:', err.message));
      }
      if (hit.precision !== 'ROOFTOP' && hit.precision !== 'RANGE_INTERPOLATED') {
        // Log only the precision and pincode — never the full matched address
        // or line1 — to avoid exposing customer details in routine logs.
        console.warn(`[CHECKOUT] address resolved only to ${hit.precision} (pincode ${address.pincode})`);
      }
    } else {
      console.warn(`[CHECKOUT] could not locate delivery address (pincode ${address.pincode})`);
    }
  }

  // Resolve landmark image from input, saved address ID, or user's saved addresses
  let resolvedLandmarkImg = address.landmarkImage || address.locationReferenceImage || null;
  if (!resolvedLandmarkImg && user?.addresses?.length) {
    const matched = user.addresses.find((a) =>
      a.landmarkImage &&
      String(a.pincode) === String(address.pincode) &&
      (String(a.line1 || '').toLowerCase().includes(String(address.line1 || '').toLowerCase()) ||
       String(address.line1 || '').toLowerCase().includes(String(a.line1 || '').toLowerCase()))
    ) || user.addresses.find((a) => a.landmarkImage && a.isDefault) || user.addresses.find((a) => a.landmarkImage);

    if (matched) {
      resolvedLandmarkImg = matched.landmarkImage;
    }
  }

  return {
    ...address,
    landmarkImage: resolvedLandmarkImg || null,
  };
};

// @desc    Place an order from the cart
// @route   POST /api/orders
// @access  Private
export const createOrder = asyncHandler(async (req, res) => {
  if (req.body.purchaseMode === 'wholesale' || req.body.channel === 'wholesale') throw httpError(400, 'Use Wholesale grouped checkout');
  const idempotency = await checkoutIdentity(req, 'single');
  if (idempotency.replay) {
    const order = idempotency.replayOrders[0];
    return created(res, {
      order,
      payment: { id: idempotency.replay.paymentId, method: idempotency.replay.paymentMethod, amount: idempotency.replay.amount },
      coinsUsed: idempotency.replay.coinsUsed || 0,
      coinDiscount: idempotency.replay.coinDiscount || 0,
      nextStep: idempotency.replay.nextStep,
    }, `Order ${order.orderNo} placed`);
  }
  const { addressId, shippingAddress, paymentMethod = PAYMENT_METHOD.COD, notes } = req.body;
  const channel = req.body.channel || CHANNEL.ECOM;

  if (!Object.values(PAYMENT_METHOD).includes(paymentMethod)) {
    throw httpError(400, 'Invalid payment method');
  }
  if (!CHANNELS.includes(channel)) {
    throw httpError(400, `Unknown storefront "${channel}"`);
  }

  /**
   * An unrecognised delivery mode is refused, not quietly reinterpreted.
   *
   * This used to fall through: anything that was not `same_day` — a typo, a
   * stale client, or a carrier name like `internal` sent where a mode belongs —
   * resolved to `shiprocket` and the order was created as Scheduled. It never
   * corrupted anything, because Scheduled is the safe side to fail towards. But
   * the customer asked for one thing and silently got another, and nothing in
   * the response said so.
   *
   * Checked here with the other request validations so a malformed order is
   * rejected before it geocodes an address or touches the cart. Absent stays
   * legal: Quick orders have no mode, and neither did anything placed before
   * Same-Day existed.
   */
  const requestedMode = req.body.deliveryMode ?? null;
  if (requestedMode !== null && channel !== CHANNEL.ECOM) throw httpError(400, 'Quick Commerce does not accept a customer-selected delivery mode');
  if (requestedMode !== null && !DELIVERY_MODES.includes(requestedMode)) {
    throw httpError(
      400,
      `Unknown delivery mode "${requestedMode}" — expected ${DELIVERY_MODES.join(' or ')}`
    );
  }

  // ---- delivery address ---------------------------------------------------
  const address = await resolveShippingAddress({ user: req.user, addressId, shippingAddress });

  // ---- cart ---------------------------------------------------------------
  // Each storefront checks out on its own — Quick and Shop All are fulfilled
  // separately, so they become separate orders with their own delivery fee.
  const cart = await Cart.findOne({ userId: req.user._id, channel });
  if (!cart || cart.items.length === 0) throw httpError(400, 'Your cart is empty');

  const products = await Product.find({ _id: { $in: cart.items.map((i) => i.productId) } });
  const byId = new Map(products.map((p) => [String(p._id), p]));
  // Re-resolved here independently of whatever the cart preview showed —
  // a campaign can expire between "add to cart" and "place order", and
  // checkout must charge what's true right now, never a cached deal.
  const campaignPrices = await resolveCampaignPricesForProducts(products.map((p) => p._id));

  // One batched seller lookup for every seller in this cart, not one per
  // line — checkout re-checks radius against the address actually being
  // shipped to, since it may differ from whatever was current at add-to-cart.
  const customerLoc = address?.lat !== undefined && address?.lng !== undefined
    ? { lat: address.lat, lng: address.lng } : undefined;
  const sellerIdsInCart = [...new Set(products.map((p) => p.sellerId).filter(Boolean).map(String))];
  const sellersById = new Map(
    (await Seller.find({ _id: { $in: sellerIdsInCart } }).select('storeDetails serviceRadiusKm status').lean())
      .map((s) => [String(s._id), s])
  );

  // ---- revalidate every line before touching money ------------------------
  const lines = [];
  for (const line of cart.items) {
    const p = byId.get(String(line.productId));

    if (!p || !channelAllowed(p, channel) || p.type !== channel || p.fulfillmentType === 'digital' || p.isDeleted || !p.isActive || p.status !== 'approved') {
      throw httpError(409, `"${line.name}" is no longer available. Please review your cart.`);
    }
    const inventory = resolveInventoryItem(p, line.variantId, { allowLegacyPrimary: !line.variantId });
    if (inventory.stock < line.qty) throw httpError(409, `Only ${inventory.stock} left of "${p.name}". Please review your cart.`);
    /**
     * A suspended cooperative must not take an order, and the feed filter
     * cannot enforce that on its own — this item may have been added to the
     * cart before the suspension, or posted straight to the API. Checked here,
     * with the rest of the line revalidation, before any money moves.
     */
    if (!p.sellerId || !sellersById.has(String(p.sellerId)) || sellersById.get(String(p.sellerId)).status !== 'approved') {
      throw httpError(409, 'A store in your basket is unavailable. Please review your cart.');
    }
    if (p.sellerId) {
      const seller = sellersById.get(String(p.sellerId));
      if (seller?.serviceRadiusKm !== undefined && seller?.serviceRadiusKm !== null
        && !isWithinRadius(seller.storeDetails, customerLoc, seller.serviceRadiusKm)) {
        throw httpError(409, `"${p.name}" is outside this seller's ${seller.serviceRadiusKm}km delivery area for your address. Please review your cart.`);
      }
    }

    const deal = campaignPrices.get(String(p._id));

    lines.push({
      productId: p._id,
      variantId: inventory.variantId,
      sku: inventory.sku,
      variantName: inventory.variantName,
      variantAttributes: inventory.attributes,
      unitSnapshot: inventory.unit,
      weightSnapshot: inventory.weight,
      name: p.name,
      image: p.images?.[0] || '',
      qty: line.qty,
      price: deal ? Number((inventory.price * (1 - Number(deal.discountValue || 0) / 100)).toFixed(2)) : inventory.price,
      ...resolveProductGst(p),
      originalPrice: inventory.price,
      campaignId: deal ? deal.campaignId : undefined,
      type: p.type,
      sellerId: p.sellerId,
      categoryId: p.category,
      shgStoreId: p.shgStoreId,
      additionalMessage: line.additionalMessage || '',
      _returnCategoryId: p.category, // resolved into `returnPolicy` below, never persisted itself
      _returnProduct: p,
      _returnableSnapshot: p.returnable, // QUICK COMMERCE only — see below; never persisted itself
    });
  }

  /**
   * Return & Refund — Phase 3: the category return-window policy, resolved
   * ONCE, right now, and frozen onto each item. Never re-read from
   * CategoryReturnPolicy again after this — see returnPolicy.service.js's
   * buildReturnPolicySnapshot for why "no policy configured" (null) and "an
   * admin's own explicit 0-day policy" are kept distinguishable even though
   * both mean not-returnable today.
   *
   * QUICK COMMERCE ONLY: the seller's own `Product.returnable` opt-out is
   * folded into `returnEligible` right here too, same as
   * fulfilmentOrders.service.js's grouped path — a Quick line's eligibility
   * is `categoryEligible && sellerReturnable`, never wider than the
   * category window. E-commerce/SHG lines are untouched.
   */
  {
    const returnPolicyByCategory = await buildReturnPolicySnapshotsFor(lines.map((l) => l._returnCategoryId));
    for (const l of lines) {
      const catPolicy = returnPolicyByCategory.get(String(l._returnCategoryId)) || {
        headerCategoryId: null, headerCategoryName: null, returnEligible: false, returnWindowDays: null,
      };
      l.returnPolicy = applyProductReturnSettings(l._returnProduct, catPolicy);
      delete l._returnProduct;
      delete l._returnCategoryId;
      delete l._returnableSnapshot;
    }
  }

  /**
   * The distance this order's delivery charge is priced against.
   *
   * Grocery is always our own rider, so it's measured now, independent of
   * Same-Day (which only applies to Shop All) — the same "first line's
   * seller is the pickup" convention `cart.controller.js`'s `shape()` uses,
   * so a cart preview and the order it becomes always agree. Ecommerce
   * Same-Day's own distance (computed by the eligibility check below, once
   * it runs) takes over below if that branch applies.
   */
  let orderDistanceKm;
  if (channel === CHANNEL.GROCERY && lines.length > 0 && address?.lat !== undefined && address?.lng !== undefined) {
    const firstSeller = await Seller.findById(lines[0].sellerId).select('storeDetails').lean();
    orderDistanceKm = distanceKm(firstSeller?.storeDetails, address);
  }

  // The coupon is re-evaluated here from the code alone. The client sends a
  // CODE, never an amount — the discount is always computed server-side against
  // the live cart, so a tampered request cannot manufacture a bigger saving.
  const base = priceOrder(lines, req.user, null, null, orderDistanceKm);
  let applied = null;
  if (req.body.coupon) {
    applied = await applyCouponCode(req.body.coupon, {
      items: lines,
      subtotal: base.subtotal, user: req.user, deliveryCharge: base.deliveryCharge,
    });
    if (!applied.ok) throw httpError(400, applied.reason);
  }

  /**
   * Same-Day is re-checked here, not trusted from the request.
   *
   * The client sends the mode it was offered, and by the time the customer taps
   * Place Order that offer may already be stale — the cut-off can pass while
   * they type an address, the last nearby rider can go offline, the stock can be
   * taken by somebody else. Accepting the client's word would mean promising a
   * delivery this system already knows it cannot make.
   *
   * So the same service the listing and the cart asked runs once more, against
   * the address actually being shipped to, and a Same-Day order is refused
   * outright rather than downgraded. Silently shipping it Scheduled would charge
   * for one thing and deliver another.
   */
  let sameDay = null;

  if (requestedMode === DELIVERY_MODE.SAME_DAY) {
    if (channel !== CHANNEL.ECOM) {
      throw httpError(400, 'Same-day delivery applies to Shop All orders');
    }

    const sellerCache = new Map();
    const eligLines = [];
    for (const l of lines) {
      const key = String(l.sellerId);
      if (!sellerCache.has(key)) sellerCache.set(key, await Seller.findById(l.sellerId).lean());
      eligLines.push({ product: byId.get(String(l.productId)), seller: sellerCache.get(key), qty: l.qty });
    }

    const verdict = await checkCartSameDayEligibility({ lines: eligLines, destination: address });
    if (!verdict.available) throw httpError(409, verdict.reason);
    sameDay = verdict;
    orderDistanceKm = verdict.distanceKm;
  }

  // The client names a tip, and it is accepted only
  // if it is one of the fixed presets the tip UI actually offers.
  const tip = resolveTip(req.body.tipAmount);

  const pricing = priceOrder(lines, req.user, applied, sameDay, orderDistanceKm, tip);
  const deliveryType = resolveDeliveryType(lines, requestedMode);
  if (new Set(lines.map(line => String(line.sellerId))).size > 1) {
    throw httpError(409, 'Items from multiple stores require the grouped checkout. Please refresh your basket.');
  }

  // A cart only ever holds one channel now, so the order type is unambiguous.
  const orderType = channel;

  // Coins are retired: nothing is redeemed or discounted. The order keeps
  // coinsUsed/coinDiscount at 0 so its stored shape stays unchanged.
  const coinsToUse = 0;
  const coinDiscount = 0;
  const payableAmount = Math.round(pricing.totalAmount * 100) / 100;

  // Generated up front so the Coin reservation (made inside the transaction,
  // before the Order document exists) can reference the exact order it
  // belongs to — Order.create below is told to use this same id.
  const orderId = new mongoose.Types.ObjectId();

  // ---- commit -------------------------------------------------------------
  const session = await mongoose.startSession();
  let order;
  let writeStage = 'checkout_attempt.create';

  const executeOrderCommit = async (txnSession = null) => {
    const opts = txnSession ? { session: txnSession } : {};
    await fenceCheckoutSellers(lines.map(line => line.sellerId), txnSession);
    writeStage = 'checkout_attempt.create';
    await CheckoutAttempt.create([{
      userId: req.user._id,
      key: idempotency.key,
      requestHash: idempotency.requestHash,
      operation: 'single',
      status: 'processing',
    }], opts);
    for (const l of lines) {
      writeStage = 'inventory.update';
      await mutateInventory({ productId: l.productId, variantId: l.variantId, quantity: l.qty, session: txnSession });
    }

    if (paymentMethod === PAYMENT_METHOD.WALLET) {
      writeStage = 'wallet.debit';
      await debitWallet({
        userId: req.user._id,
        amount: payableAmount,
        type: WALLET_TRANSACTION_TYPE.ORDER_PAYMENT,
        referenceType: WALLET_REFERENCE_TYPE.ORDER,
        referenceId: String(orderId),
        description: `Order payment for #${orderId}`,
        idempotencyKey: `ORDER_PAYMENT:${orderId}`,
        session: txnSession,
      });
    }

    writeStage = 'payment.create';
    const [payment] = await Payment.create([{
      userId: req.user._id,
      amount: payableAmount,
      method: paymentMethod,
      status: paymentMethod === PAYMENT_METHOD.WALLET ? PAYMENT_STATUS.PAID : PAYMENT_STATUS.PENDING,
      paidAt: paymentMethod === PAYMENT_METHOD.WALLET ? new Date() : undefined,
      coinsUsed: coinsToUse,
      coinDiscount,
    }], opts);

    writeStage = 'order.create';
    const [doc] = await Order.create([{
      _id: orderId,
      userId: req.user._id,
      type: orderType,
      items: lines,
      productTax: calculateProductGst(lines, { ...pricing, coinDiscount, totalAmount: payableAmount }),
      shippingAddress: address,
      pricing: {
        subtotal: pricing.subtotal,
        discountRepresentation: 'components-v1',
        discount: pricing.discount,
        couponDiscount: pricing.couponDiscount,
        couponCode: pricing.couponCode,
        cdsDiscount: pricing.cdsDiscount,
        deliveryCharge: pricing.deliveryCharge,
        tipAmount: pricing.tipAmount,
        coinsUsed: coinsToUse,
        coinDiscount,
        totalAmount: payableAmount,
      },
      coupon: applied?.ok ? applied.coupon._id : undefined,
      paymentMethod,
      paymentId: payment._id,
      deliveryType,
      fulfillment: orderType === CHANNEL.ECOM && requestedMode !== DELIVERY_MODE.SAME_DAY
        ? { assignmentPolicy: 'seller_after_acceptance' } : undefined,
      delivery: buildDeliverySnapshot({
        channel: orderType,
        mode: sameDay ? DELIVERY_MODE.SAME_DAY : (orderType === CHANNEL.ECOM ? DELIVERY_MODE.SCHEDULED : null),
        fees: {
          standardFee: pricing.standardFee,
          sameDayFee: pricing.sameDayFee,
          sellerIncentive: pricing.sameDayIncentive,
        },
        verdict: sameDay,
      }),
      status: ORDER_STATUS.PLACED,
      timeline: [{ status: ORDER_STATUS.PLACED, timestamp: new Date(), note: 'Order placed' }],
      notes,
    }], opts);

    writeStage = 'payment.link_order';
    await Payment.updateOne({ _id: payment._id }, { $set: { orderId: doc._id } }, opts);

    if (applied?.ok) {
      writeStage = 'coupon.redeem';
      await redeemCoupon({
        coupon: applied.coupon,
        userId: req.user._id,
        orderId: doc._id,
        discountAmount: pricing.couponDiscount,
        orderTotal: pricing.totalAmount,
      }, txnSession);
    }
    writeStage = 'cart.clear';
    await Cart.updateOne({ userId: req.user._id, channel }, { $set: { items: [] }, $inc: { __v: 1 } }, opts);

    writeStage = 'checkout_attempt.complete';
    await CheckoutAttempt.updateOne(
      { userId: req.user._id, key: idempotency.key },
      { $set: {
        status: 'completed', orderIds: [doc._id], paymentId: payment._id,
        paymentMethod, amount: payableAmount, coinsUsed: coinsToUse,
        coinDiscount, nextStep: paymentMethod === PAYMENT_METHOD.COD
          ? 'Order confirmed. Pay on delivery.'
          : 'Create a payment to confirm this order.',
      } },
      opts
    );

    return doc;
  };

  try {
    await session.withTransaction(async () => {
      order = await executeOrderCommit(session);
    });
  } catch (txnErr) {
    logCheckoutFailure(txnErr, { requestId: req.requestId, operation: 'single', stage: writeStage, session });
    if (txnErr?.code === 11000) {
      const retry = await findClaimedCheckout({ userId: req.user._id, key: idempotency.key, requestHash: idempotency.requestHash, operation: 'single' });
      if (retry?.requestHash === idempotency.requestHash && retry.operation === 'single' && retry.status === 'completed') {
        const [existingOrder] = await Promise.all((retry.orderIds || []).map((id) => Order.findById(id)));
        if (existingOrder && String(existingOrder.userId) === String(req.user._id)) {
          return created(res, {
            order: existingOrder,
            payment: { id: retry.paymentId, method: retry.paymentMethod, amount: retry.amount },
            coinsUsed: retry.coinsUsed || 0, coinDiscount: retry.coinDiscount || 0, nextStep: retry.nextStep,
          }, `Order ${existingOrder.orderNo} placed`);
        }
      }
      throw checkoutClaimError(retry, idempotency.requestHash, 'single');
    }
    if (isTransactionUnavailable(txnErr)) {
      throw httpError(503, 'Checkout requires database transaction support. Please retry later.', { code: 'CHECKOUT_TRANSACTIONS_UNAVAILABLE' });
    }
    if (['ValidationError', 'CastError'].includes(txnErr.name)) throw httpError(400, 'The order details could not be validated. Review your basket and address.', { code: 'CHECKOUT_VALIDATION_FAILED' });
    if (txnErr.hasErrorLabel?.('UnknownTransactionCommitResult') || txnErr.errorLabels?.includes('UnknownTransactionCommitResult')) {
      throw httpError(503, 'The checkout result is not confirmed yet. Check the order status before trying again.', { code: 'CHECKOUT_OUTCOME_UNCERTAIN' });
    }
    if (!txnErr.status && !txnErr.statusCode) throw httpError(500, 'The order could not be saved. Check the order status before trying again.', { code: 'CHECKOUT_SAVE_FAILED' });
    throw txnErr;
  } finally {
    await session.endSession();
  }

  // Notify buyer and all sellers who have items in this order.
  try {
    const { emitToSeller, emitToUser } = await import('../socket/rooms.js');
    emitToUser(req.user._id, 'order_created', { orderId: order._id, orderNo: order.orderNo });
    if (paymentMethod !== 'online') {
      notifyUser(req.user._id, {
        event: NOTIFICATION_EVENT.ORDER_CREATED,
        dedupeKey: `buyer-order-${order._id}`,
        title: 'Order Placed Successfully!',
        message: `Order #${order.orderNo} has been placed.`,
        metadata: { orderId: order._id },
        route: '/orders',
      }).catch((e) => console.error('[NOTIFICATION] notifyUser (new order) failed:', e.message));
    }

    await publishEligibleSellerOrder(order._id);
    if (paymentMethod !== 'online' && order.deliveryType !== 'shiprocket' && order.type === CHANNEL.GROCERY) {
      const { broadcastNewOrderToRiders } = await import('./deliveryPartner.controller.js');
      broadcastNewOrderToRiders(order._id).catch(console.error);
    }
  } catch {
    console.warn('[NOTIFICATION] Eligible order notification reconciliation will retry.');
  }

  // No timer is armed here on purpose. An in-process setTimeout does not survive
  // a restart, and every order it was holding would have been stranded. The
  // acceptance deadline is enforced by services/orderSweeper.service.js, which
  // asks the database what is overdue instead of trying to remember.

  return created(res, {
    order,
    payment: { id: order.paymentId, method: paymentMethod, amount: payableAmount },
    coinsUsed: coinsToUse,
    coinDiscount,
    nextStep: paymentMethod === PAYMENT_METHOD.COD
      ? 'Order confirmed. Pay on delivery.'
      : 'Create a payment to confirm this order.',
  }, `Order ${order.orderNo} placed`);
});

/**
 * Unified checkout: one basket, one payment, several deliveries.
 *
 * Kept apart from createOrder rather than folded into it. The single-storefront
 * checkout above is hard-wired to one cart, one channel, one mode and one order,
 * and every existing client depends on that shape; branching it in two would put
 * two different checkouts inside one transaction body, which is exactly the kind
 * of function nobody can safely change later.
 *
 * What it does NOT do is decide anything. The groups, their prices, their
 * carriers and their Same-Day verdicts all come from the same
 * buildFulfilmentGroups() the cart preview calls, so what the customer saw and
 * what gets created are the same computation, not two that agree by luck.
 *
 * @route POST /api/orders/unified
 */
export const createUnifiedOrder = asyncHandler(async (req, res) => {
  const purchaseMode = req.body.purchaseMode ?? 'retail';
  if (!['retail', 'wholesale', 'basket'].includes(purchaseMode)) throw httpError(400, 'Invalid purchase mode');
  if (purchaseMode === 'basket') {
    assertWholesaleBuyer(req);
    if (req.body.channel !== undefined || req.body.useCoins) throw httpError(400, 'Basket checkout does not support channel overrides or Coins');
  }
  if (purchaseMode === 'wholesale') {
    assertWholesaleBuyer(req);
    if (req.body.channel !== undefined && req.body.channel !== 'wholesale') throw httpError(400, 'Retail and Wholesale checkout cannot be mixed');
    if (req.body.useCoins) throw httpError(400, 'Coins are not supported in grouped checkout');
  } else if (req.body.channel === 'wholesale') throw httpError(400, 'Select Wholesale checkout explicitly');
  const idempotency = await checkoutIdentity(req, 'unified');
  if (idempotency.replay) {
    const { replay } = idempotency;
    const orders = idempotency.replayOrders;
    return created(res, {
      groupRef: replay.groupRef,
      orders: orders.map((o) => ({
        _id: o._id, orderNo: o.orderNo, type: o.type, salesChannel: o.salesChannel, deliveryType: o.deliveryType,
        deliveryMode: o.delivery?.mode || null, delivery: o.delivery,
        shippingAddress: o.shippingAddress, paymentMethod: o.paymentMethod,
        timeline: o.timeline, createdAt: o.createdAt, items: o.items,
        pricing: o.pricing, productTax: o.productTax, status: o.status,
      })),
      payment: { id: replay.paymentId, method: replay.paymentMethod, amount: replay.amount, groupRef: replay.groupRef },
      totals: replay.totals,
      nextStep: replay.nextStep,
    }, `${orders.length} order${orders.length > 1 ? 's' : ''} placed`);
  }
  const { addressId, shippingAddress, paymentMethod = PAYMENT_METHOD.COD, notes } = req.body;

  if (!Object.values(PAYMENT_METHOD).includes(paymentMethod)) {
    throw httpError(400, 'Invalid payment method');
  }

  /**
   * Coupons are refused here rather than dropped.
   *
   * The coupon engine is order-based: one subtotal, one delivery charge, one
   * orderId to redeem against. Across several fulfilment orders there is no
   * approved answer for which of them a discount belongs to — and free shipping
   * especially, which must waive an ordinary delivery fee but never the Same-Day
   * premium. Silently ignoring the code would charge a customer full price on a
   * basket they believed was discounted, so the checkout stops and says so.
   */
  if (req.body.coupon) {
    throw httpError(
      400,
      'Coupons cannot be used when your basket is arriving as separate deliveries. '
      + 'Remove the coupon to continue, or order the items separately.'
    );
  }

  const address = await resolveShippingAddress({ user: req.user, addressId, shippingAddress });

  // The same grouping the cart showed, re-run against the address being shipped
  // to — an offer made against a different destination is not this order's offer.
  const compose = purchaseMode === 'basket' ? buildCustomerBasket : buildFulfilmentGroups;
  let composed = await compose({
    purchaseMode,
    userId: req.user._id,
    destination: address.lat !== undefined && address.lng !== undefined
      ? { lat: address.lat, lng: address.lng }
      : undefined,
    user: req.user,
  });

  let { groups } = composed;
  if (purchaseMode === 'wholesale' && req.body.quoteHash !== wholesaleQuoteHash(composed)) throw httpError(409, 'Wholesale prices or delivery charges changed. Refresh and review your cart.', { code: 'WHOLESALE_QUOTE_CHANGED' });
  if (purchaseMode === 'basket' && (req.body.basketHash !== composed.basketHash || req.body.quoteHash !== composed.quoteHash)) throw httpError(409, 'Basket prices, quantities or delivery changed. Refresh and review your cart.', { code: 'BASKET_QUOTE_CHANGED' });
  if (!groups.length) throw httpError(400, 'Your cart is empty');

  // Regular e-commerce carriers are selected after seller acceptance. Explicit
  // Same-Day promises are still checked below and must never be downgraded.

  /**
   * A Same-Day group whose eligibility has lapsed is refused, not downgraded.
   *
   * Grouping prices such a line as Scheduled and reports it — safe for a preview,
   * wrong for a checkout, because the customer asked for today. Shipping it
   * Scheduled instead would deliver something other than what was agreed.
   */
  for (const g of groups) {
    if (g.requestedMode === DELIVERY_MODE.SAME_DAY && g.deliveryMode !== DELIVERY_MODE.SAME_DAY) {
      throw httpError(409,
        g.sameDayOption?.reason
        || `Same-day delivery is no longer available for ${g.seller?.name || 'these items'}.`);
    }
  }

  // Read-only pass over every group before anything is written, so a basket
  // cannot half-succeed and leave the customer paying for a delivery that will
  // never leave.
  validateGroupsStock(groups);

  // One basket, one tip — attached to the first order, and paid in
  // full to the rider who carries it.
  const tip = resolveTip(req.body.tipAmount);
  if (purchaseMode === 'basket' && tip && !groups.some(group => group.salesChannel === 'retail')) throw httpError(400, 'Tips are only available for retail deliveries');

  const session = await mongoose.startSession();
  let result;
  let writeStage = 'checkout_attempt.create';

  try {
    await session.withTransaction(async () => {
      if (purchaseMode === 'wholesale' || purchaseMode === 'basket') {
        // Re-read terms/stock in the transaction. Writes to seller, buyer and
        // product documents fence concurrent suspension, deactivation and repricing.
        composed = await compose({ userId: req.user._id, user: req.user,
          destination: address.lat !== undefined && address.lng !== undefined ? { lat: address.lat, lng: address.lng } : undefined,
          purchaseMode, session });
        groups = composed.groups;
        if (purchaseMode === 'basket' && (req.body.basketHash !== composed.basketHash || req.body.quoteHash !== composed.quoteHash)) throw httpError(409, 'Basket changed. Refresh and review your cart.', { code: 'BASKET_QUOTE_CHANGED' });
        if (purchaseMode === 'wholesale' && req.body.quoteHash !== wholesaleQuoteHash(composed)) throw httpError(409, 'Wholesale terms changed. Refresh and review your cart.', { code: 'WHOLESALE_QUOTE_CHANGED' });
        validateGroupsStock(groups);
        const customer = await User.updateOne({ _id: req.user._id, isActive: true, roles: 'buyer' }, { $inc: { __v: 1 } }, { session });
        if (!customer.matchedCount) throw httpError(403, 'Customer account is unavailable');
      }
      if (purchaseMode === 'basket') {
        await fenceCheckoutSellers(groups.filter(group => group.salesChannel === 'retail').map(group => group.seller._id), session);
        await fenceCheckoutSellers(groups.filter(group => group.salesChannel === 'wholesale').map(group => group.seller._id), session, true);
      } else await fenceCheckoutSellers(groups.map(group => group.seller._id), session, purchaseMode === 'wholesale');
      writeStage = 'checkout_attempt.create';
      await CheckoutAttempt.create([{
        userId: req.user._id, key: idempotency.key, requestHash: idempotency.requestHash,
        operation: 'unified', status: 'processing',
      }], { session });
      result = await createOrdersFromGroups({
        user: req.user, address, groups, paymentMethod, notes, session, tip, purchaseMode, cartSnapshots: composed.cartSnapshots,
        beforeWrite: stage => { writeStage = stage; },
      });
      const { orders, payment, groupRef } = result;
      writeStage = 'checkout_attempt.complete';
      await CheckoutAttempt.updateOne(
        { userId: req.user._id, key: idempotency.key },
        { $set: {
          status: 'completed', orderIds: orders.map((o) => o._id), paymentId: payment._id,
          groupRef, totals: composed.totals, paymentMethod, amount: payment.amount,
          nextStep: paymentMethod === PAYMENT_METHOD.COD
            ? `${orders.length} order${orders.length > 1 ? 's' : ''} confirmed. Pay on delivery.`
            : 'Create a payment to confirm these orders.',
        } },
        { session }
      );
    });
  } catch (txnErr) {
    logCheckoutFailure(txnErr, { requestId: req.requestId, operation: 'unified', stage: writeStage, session });
    if (txnErr?.code === 11000) {
      const retry = await findClaimedCheckout({ userId: req.user._id, key: idempotency.key, requestHash: idempotency.requestHash, operation: 'unified' });
      if (retry?.requestHash === idempotency.requestHash && retry.operation === 'unified' && retry.status === 'completed') {
        const orders = await Promise.all((retry.orderIds || []).map((id) => Order.findById(id)));
        if (orders.length && orders.every((order) => order && String(order.userId) === String(req.user._id))) {
          return created(res, {
            groupRef: retry.groupRef,
            orders: orders.map((o) => ({
              _id: o._id, orderNo: o.orderNo, type: o.type, salesChannel: o.salesChannel, deliveryType: o.deliveryType,
              deliveryMode: o.delivery?.mode || null, delivery: o.delivery,
              shippingAddress: o.shippingAddress, paymentMethod: o.paymentMethod,
              timeline: o.timeline, createdAt: o.createdAt, items: o.items,
              pricing: o.pricing, productTax: o.productTax, status: o.status,
            })),
            payment: { id: retry.paymentId, method: retry.paymentMethod, amount: retry.amount, groupRef: retry.groupRef },
            totals: retry.totals, nextStep: retry.nextStep,
          }, `${orders.length} order${orders.length > 1 ? 's' : ''} placed`);
        }
      }
      throw checkoutClaimError(retry, idempotency.requestHash, 'unified');
    }
    if (isTransactionUnavailable(txnErr)) {
      throw httpError(503, 'Checkout requires database transaction support. Please retry later.', { code: 'CHECKOUT_TRANSACTIONS_UNAVAILABLE' });
    }
    if (['ValidationError', 'CastError'].includes(txnErr.name)) throw httpError(400, 'The order details could not be validated. Review your basket and address.', { code: 'CHECKOUT_VALIDATION_FAILED' });
    if (txnErr.hasErrorLabel?.('UnknownTransactionCommitResult') || txnErr.errorLabels?.includes('UnknownTransactionCommitResult')) {
      throw httpError(503, 'The checkout result is not confirmed yet. Check the order status before trying again.', { code: 'CHECKOUT_OUTCOME_UNCERTAIN' });
    }
    if (!txnErr.status && !txnErr.statusCode) throw httpError(500, 'The order could not be saved. Check the order status before trying again.', { code: 'CHECKOUT_SAVE_FAILED' });
    throw txnErr;
  } finally {
    await session.endSession();
  }

  const { orders, payment, groupRef } = result;

  try {
    const { emitToUser } = await import('../socket/rooms.js');
    for (const order of orders) {
      await publishEligibleSellerOrder(order._id);
      emitToUser(req.user._id, 'order_created', { orderId: order._id, orderNo: order.orderNo });
      if (paymentMethod !== 'online') {
        notifyUser(req.user._id, {
          event: NOTIFICATION_EVENT.ORDER_CREATED,
          dedupeKey: `buyer-order-${order._id}`,
          title: 'Order Placed Successfully!',
          message: `Order #${order.orderNo} has been placed.`,
          metadata: { orderId: order._id },
          route: '/orders',
        }).catch((e) => console.error('[NOTIFICATION] notifyUser (unified order) failed:', e.message));

        if (order.deliveryType !== 'shiprocket' && order.type === CHANNEL.GROCERY) {
          const { broadcastNewOrderToRiders } = await import('./deliveryPartner.controller.js');
          broadcastNewOrderToRiders(order._id).catch(console.error);
        }
      }
    }
  } catch { console.warn('[NOTIFICATION] Eligible seller order delivery will retry.'); }

  return created(res, {
    groupRef,
    orders: orders.map((o) => ({
      _id: o._id,
      orderNo: o.orderNo,
      type: o.type,
      salesChannel: o.salesChannel,
      deliveryType: o.deliveryType,
      deliveryMode: o.delivery?.mode || null,
      // The frozen record itself, so a row handed straight to the tracking
      // screen can label itself without another round trip.
      delivery: o.delivery,
      shippingAddress: o.shippingAddress,
      paymentMethod: o.paymentMethod,
      timeline: o.timeline,
      createdAt: o.createdAt,
      items: o.items,
      pricing: o.pricing, productTax: o.productTax,
      status: o.status,
    })),
    payment: { id: payment._id, method: paymentMethod, amount: payment.amount, groupRef },
    totals: composed.totals,
    /**
     * COD is finished here, exactly as it is for a single order — no gateway
     * step, the orders stand placed and are paid on delivery.
     */
    nextStep: paymentMethod === PAYMENT_METHOD.COD
      ? `${orders.length} order${orders.length > 1 ? 's' : ''} confirmed. Pay on delivery.`
      : 'Create a payment to confirm these orders.',
  }, `${orders.length} order${orders.length > 1 ? 's' : ''} placed`);
});

// @desc    My orders
// @route   GET /api/orders
// @access  Private
export const getMyOrders = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);
  const filter = { userId: req.user._id };
  if (req.query.status) filter.status = req.query.status;
  // Optional, unlike the product listing: a history holding every storefront is
  // genuinely useful, and each row already carries a badge saying where it came
  // from. This is here for when a per-storefront view is wanted.
  if (CHANNELS.includes(req.query.type)) filter.type = req.query.type;
  // Optional, unlike the product listing: an order history with everything in it
  // is genuinely useful, and the badge on each row already says which storefront
  // it came from. The filter is here for a per-storefront view when one is wanted.
  if (CHANNELS.includes(req.query.type)) filter.type = req.query.type;

  const [history] = await Order.aggregate([{ $match: filter }, ...orderHistoryPaymentStages(),
    { $facet: { rows: [{ $sort: { createdAt: -1 } }, { $skip: skip }, { $limit: limit }], count: [{ $count: 'total' }] } }]);
  const orders = history?.rows || [];
  const total = history?.count?.[0]?.total || 0;

  return paginated(res, orders, { page, limit, total });
});

// @desc    One order
// @route   GET /api/orders/:id
// @access  Private
export const getOrderById = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id).populate('paymentId', 'status method paidAt refund');
  if (!order) throw httpError(404, 'Order not found');

  // An order is only ever visible to the buyer who placed it, or an admin.
  if (req.userType !== 'admin' && String(order.userId) !== String(req.user._id)) {
    throw httpError(403, 'This is not your order');
  }

  return ok(res, order);
});

// @desc    Tracking view
// @route   GET /api/orders/:id/track
// @access  Private
export const trackOrder = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id).lean();
  if (!order) throw httpError(404, 'Order not found');
  if (req.userType !== 'admin' && String(order.userId) !== String(req.user._id)) {
    throw httpError(403, 'This is not your order');
  }

  /**
   * Everything the live tracking map needs.
   *
   * The shop's coordinates are included from the moment the order exists, not
   * only once a rider is assigned. That is what lets the map appear as soon as
   * the shop accepts, showing the pickup and the destination with an
   * "assigning a partner" state between them, instead of a blank panel until
   * somebody happens to accept.
   *
   * The rider's position comes from the Delivery record and is only present
   * once there is one — a missing marker is the honest representation of
   * "nobody is carrying this yet".
   */
  const sellerItem = order.items?.find((i) => i.sellerId);
  const seller = sellerItem
    ? await Seller.findById(sellerItem.sellerId).select('businessName storeDetails').lean()
    : null;

  const shop = seller?.storeDetails;
  const delivery = order.deliveryId
    ? await Delivery.findById(order.deliveryId)
        .select('status orderId partnerId direction customerRating partnerLocation route pickupLocation dropLocation otp otpIssuedAt')
        .lean()
    : null;

  const rider = order.deliveryPartnerId
    ? await DeliveryPartner.findById(order.deliveryPartnerId)
        .select('vehicleType vehicleNo userId rating')
        .populate('userId', 'name phone')
        .lean()
    : null;

  return ok(res, {
    orderNo: order.orderNo,
    status: order.status,
    // Which storefront this came from. Live tracking is a Quick Commerce idea —
    // a Shop All parcel travels by courier for days and has no rider to follow —
    // so the client needs this to decide whether a map means anything.
    channel: order.type,
    deliveryType: order.deliveryType,
    /**
     * What was promised when this order was placed.
     *
     * Sent so the tracking screen can name the delivery the customer actually
     * bought, rather than working it out from the shop's settings as they stand
     * today. A shop that turns Same-Day off next week must not retitle an order
     * that already went out same-day — the promise was made, and the record of
     * it is here, frozen at placement.
     */
    delivery: order.delivery,
    timeline: order.timeline,
    shiprocket: order.deliveryType === 'shiprocket' ? order.shiprocket : undefined,
    placedAt: order.createdAt,

    pickup: shop
      ? {
          name: shop.name || seller?.businessName,
          address: [shop.address, shop.city].filter(Boolean).join(', '),
          // lat/lng are present only when the seller saved their location via GPS
          // or the map picker. When absent the frontend geocodes the address text.
          lat: shop.lat,
          lng: shop.lng,
        }
      : null,

    // drop is always returned even when the order predates coordinate capture,
    // so the frontend geocoding fallback has an address string to work with.
    drop: {
      name: order.shippingAddress?.name,
      address: [order.shippingAddress?.line1, order.shippingAddress?.line2,
                order.shippingAddress?.city, order.shippingAddress?.pincode]
               .filter(Boolean).join(', '),
      lat: order.shippingAddress?.lat,
      lng: order.shippingAddress?.lng,
    },

    // Null until somebody accepts — the map shows "assigning" in that gap.
    rider: rider
      ? {
          name: rider.userId?.name,
          phone: rider.userId?.phone,
          vehicleType: rider.vehicleType,
          vehicleNo: rider.vehicleNo,
          rating: rider.rating,
          // Last known position. Absent until the first ping arrives.
          location: delivery?.partnerLocation?.lat !== undefined
            ? {
                lat: delivery.partnerLocation.lat,
                lng: delivery.partnerLocation.lng,
                updatedAt: delivery.partnerLocation.updatedAt,
              }
            : null,
          // Which leg they are on decides what the map should be pointing at.
          leg: ['picked_up', 'in_transit', 'arrived_at_customer'].includes(delivery?.status)
            ? 'to_customer'
            : 'to_store',
        }
      : null,

    /**
     * The stage inside "out for delivery".
     *
     * The order's own status sits at `out_for_delivery` from the moment a rider
     * accepts until the parcel is handed over — which to a customer is a single
     * unchanging line for the most interesting hour of the order. This is the
     * detail underneath it.
     */
    stage: delivery?.status || null,
    deliveryRating: {
      eligible: order.status === 'delivered' && delivery?.status === 'delivered'
        && delivery.direction !== 'return_pickup' && Boolean(rider)
        && String(delivery.orderId) === String(order._id)
        && String(delivery.partnerId) === String(order.deliveryPartnerId),
      rating: delivery?.customerRating?.rating || null,
    },

    /**
     * The delivery code, for the person it belongs to.
     *
     * Sent here as well as over the socket because socket state does not
     * survive a refresh: a customer who reloaded the page lost the code and
     * could no longer tell the rider what it was, leaving a delivery that
     * literally could not be completed. Ownership is already checked at the top
     * of this handler, and the rider's own endpoints never return it.
     */
    deliveryOtp: delivery?.otp || null,
    otpIssuedAt: delivery?.otpIssuedAt || null,

    route: delivery?.route || null,
  });
});

// @desc    Cancel an order and return the stock
// @route   PATCH /api/orders/:id/cancel
// @access  Private
export const cancelOrder = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id);
  if (!order) throw httpError(404, 'Order not found');
  if (req.userType !== 'admin' && String(order.userId) !== String(req.user._id)) {
    throw httpError(403, 'This is not your order');
  }
  if (!CANCELLABLE_STATUSES.includes(order.status)) {
    throw httpError(400, `An order that is already "${order.status}" cannot be cancelled`);
  }
  if (order.shiprocket?.orderId || ['creating', 'assigning', 'reconciliation_required'].includes(order.shiprocket?.status)) {
    throw httpError(409, 'This order already has a courier shipment. Cancel it with the provider before cancelling the Bulkimart order.');
  }

  const session = await mongoose.startSession();
  const cancelReason = req.body.reason || 'Cancelled by customer';
  try {
    await session.withTransaction(async () => {
      await claimCancellation(order, cancelReason, session);
      order.cancelReason = cancelReason;
      // Put every unit back before marking it cancelled.
      for (const item of order.items) {
        // E-books only give a copy back if checkout reserved one.
        if (item.fulfillmentType !== 'digital' || item.stockReserved) await mutateInventory({ productId: item.productId, variantId: item.variantId, quantity: item.qty, session, restore: true });
      }

      // The customer should not lose a one-per-person coupon to an order they
      // cancelled before it was ever fulfilled.
      await releaseCoupon(order.coupon, order._id, session);

      // Money already taken is queued for refund rather than silently kept.
      if (order.paymentId) {
        const payment = await Payment.findById(order.paymentId).session(session);
        if (payment) await coordinateOnlineCancellation(payment, order, session);
        if (payment && payment.status === PAYMENT_STATUS.PAID) {
          const rawTotal = payment.groupRef ? (order.pricing?.totalAmount || payment.amount) : payment.amount;
          const refundAmount = rawTotal;

          if (payment.method === PAYMENT_METHOD.WALLET) {
            await refundToWallet({
              userId: order.userId,
              amount: refundAmount,
              reason: `Refund for cancelled order #${order.orderNo}`,
              referenceType: WALLET_REFERENCE_TYPE.ORDER,
              referenceId: String(order._id),
              idempotencyKey: `CANCEL_REFUND:${order._id}`,
              session,
            });

            payment.refund = {
              amount: refundAmount,
              reason: order.cancelReason,
              status: 'processed',
              processedAt: new Date(),
            };
            if (!payment.groupRef) {
              payment.status = PAYMENT_STATUS.REFUNDED;
            }
            await payment.save({ session });
          } else if (payment.groupRef) {
            /**
             * One payment, several orders — so the payment is not touched.
             *
             * Queueing a refund on it would claim the whole basket is coming
             * back, while the other fulfilment orders are still on their way to
             * the customer. Writing this order's share into the shared record
             * would be no better: a partial figure sitting in a field that means
             * "the payment is being refunded" reads as fact to whatever picks it
             * up next.
             *
             * The debt is recorded on the order that owes it instead, with the
             * amount that order was worth. Nothing acts on it yet; the refund
             * phase is separate and deliberately not started here.
             */
            order.refundPending = {
              amount: order.pricing?.totalAmount,
              reason: order.cancelReason,
              markedAt: new Date(),
            };
            await Order.updateOne({ _id: order._id, status: ORDER_STATUS.CANCELLED }, { $set: { refundPending: order.refundPending } }, { session });
          } else {
            // Ordinary single-order payment — unchanged.
            payment.refund = {
              amount: payment.amount,
              reason: order.cancelReason,
              status: 'pending',
            };
            await payment.save({ session });
          }
        }
      }
    });
  } finally {
    await session.endSession();
  }

  order.status = ORDER_STATUS.CANCELLED;

  return ok(res, { orderNo: order.orderNo, status: order.status }, 'Order cancelled and stock restored');
});

// @desc    Request a return on a delivered order
// @route   POST /api/orders/:id/return
// @access  Private
export const requestReturn = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id);
  if (!order || String(order.userId) !== String(req.user._id)) throw httpError(404, 'Order not found');
  throw httpError(410, 'Select an order item and submit its quantity and reason to POST /api/returns', {
    code: 'ITEM_RETURN_REQUIRED', endpoint: '/api/returns', orderId: String(order._id),
  });
});

// Auto-cancels the order if the seller does not accept it within 2 minutes
/**
 * Cancel an order and undo everything checkout did.
 *
 * Checkout is not a reservation — it decrements stock and burns the coupon
 * inside a transaction the moment the order is created. So a cancellation, from
 * any source, has to give all of it back: the units, the coupon redemption, and
 * the money if it was already taken. Missing any one of the three leaves stock
 * that nobody can buy or a coupon nobody can reuse.
 *
 * `allowedFrom` is the guard against cancelling something already in motion —
 * a rider holding the parcel is past the point where stock can simply be
 * returned to the shelf.
 *
 * @returns {Promise<{ok: boolean, reason?: string}>}
 */
export const cancelOrderAndRestore = async (orderId, { reason, allowedFrom, cancelledBy, vendorDecision, suppressNotification = false }) => {
  const order = await Order.findById(orderId);
  if (!order) return { ok: false, reason: 'Order not found' };

  if (allowedFrom && !allowedFrom.includes(order.status)) {
    return { ok: false, reason: `An order that is already ${order.status} cannot be cancelled` };
  }
  if (order.shiprocket?.orderId || ['creating', 'assigning', 'reconciliation_required'].includes(order.shiprocket?.status)) {
    return { ok: false, reason: 'A courier shipment already exists; provider cancellation must be confirmed first' };
  }

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      await claimCancellation(order, reason, session, vendorDecision ? { vendorDecision } : {});
      order.cancelReason = reason;
      // Put every unit back
      for (const item of order.items) {
        if (item.fulfillmentType !== 'digital' || item.stockReserved) await mutateInventory({ productId: item.productId, variantId: item.variantId, quantity: item.qty, session, restore: true });
      }

      if (order.coupon) {
        await releaseCoupon(order.coupon, order._id, session);
      }

      if (order.paymentId) {
        const payment = await Payment.findById(order.paymentId).session(session);
        if (payment) await coordinateOnlineCancellation(payment, order, session);
        if (payment && payment.status === PAYMENT_STATUS.PAID) {
          const refundAmount = payment.groupRef ? (order.pricing?.totalAmount || 0) : payment.amount;
          if (payment.method === PAYMENT_METHOD.WALLET) {
            await refundToWallet({
              userId: order.userId,
              amount: refundAmount,
              reason: `Refund for cancelled order #${order.orderNo}`,
              referenceType: WALLET_REFERENCE_TYPE.ORDER,
              referenceId: String(order._id),
              idempotencyKey: `CANCEL_REFUND:${order._id}`,
              session,
            });
            payment.refund = { amount: refundAmount, reason, status: 'processed', processedAt: new Date() };
            if (!payment.groupRef) payment.status = PAYMENT_STATUS.REFUNDED;
            await payment.save({ session });
          } else if (payment.groupRef) {
            /**
             * One payment, several fulfilment orders — leave the payment alone.
             *
             * Queueing a refund on it would say the whole basket is coming back
             * while the sibling orders are still on their way. The debt belongs
             * to this order, so it is recorded here, for the refund phase that
             * has not been built.
             *
             * Same reasoning as the customer-facing cancel above; this is the
             * shared undo path, used by the seller decline and the sweeper too,
             * so both had to learn it.
             */
            order.refundPending = {
              amount: order.pricing?.totalAmount,
              reason,
              markedAt: new Date(),
            };
            await Order.updateOne({ _id: order._id, status: ORDER_STATUS.CANCELLED }, { $set: { refundPending: order.refundPending } }, { session });
          } else {
            // Flagged, not executed — the gateway refund is a separate job, and
            // it must not be attempted inside this transaction.
            payment.refund = { amount: payment.amount, reason, status: 'pending' };
            await payment.save({ session });
          }
        }
      }
    });
  } catch (err) {
    console.error('Failed to cancel order:', err);
    return { ok: false, reason: 'Could not cancel this order' };
  } finally {
    await session.endSession();
  }
  order.status = ORDER_STATUS.CANCELLED;

  // Outside the transaction: a failed notification must not undo a real cancel.
  try {
    const { emitToUser, emitToSeller } = await import('../socket/rooms.js');
    emitToUser(order.userId, 'order_status_updated', {
      orderId: order._id,
      status: ORDER_STATUS.CANCELLED,
      reason,
      timeline: order.timeline,
    });
    if (!suppressNotification && !reason?.includes('Payment cancelled')) {
      notifyUser(order.userId, {
        event: NOTIFICATION_EVENT.ORDER_CANCELLED,
        title: 'Order cancelled',
        message: `Order ${order.orderNo} was cancelled. ${reason || ''}`.trim(),
        metadata: { orderId: order._id },
        route: '/orders',
      }).catch((e) => console.error('[NOTIFICATION] notifyUser (order cancelled) failed:', e.message));
    }

    // The shop stops packing something that is no longer coming.
    if (cancelledBy !== 'seller') {
      const sellerIds = [...new Set(order.items.map((i) => i.sellerId?.toString()).filter(Boolean))];
      for (const sellerId of sellerIds) {
        emitToSeller(sellerId, 'order_cancelled', { orderId: order._id, orderNo: order.orderNo, reason });
      }
    }
  } catch (e) {
    console.error('Socket emit failed on cancel:', e.message);
  }

  console.log(`[ORDER CANCELLED] ${order.orderNo} — ${reason}`);
  return { ok: true };
};

/**
 * Nobody at the shop picked the order up in time.
 *
 * A thin wrapper now — the undo logic it used to carry inline is shared with
 * seller rejection, and two copies of "put the stock back" is one copy too
 * many for something that has to be exactly right.
 */
export const cancelPlacedOrderDueToTimeout = async (orderId) => {
  await cancelOrderAndRestore(orderId, {
    reason: 'Auto-cancelled: the store did not accept this order in time',
    // Only an order still sitting unclaimed. If the shop has since confirmed
    // it, a late-firing timer must not pull it out from under them.
    allowedFrom: [ORDER_STATUS.PLACED],
    cancelledBy: 'system',
  });
};

