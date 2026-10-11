import crypto from 'crypto';
import Cart from '../models/Cart.js';
import Order from '../models/Order.js';
import Payment from '../models/Payment.js';
import Product from '../models/Product.js';
import { httpError } from '../utils/response.js';
import {
  ORDER_STATUS,
  PAYMENT_STATUS,
  PAYMENT_METHOD,
  CHANNEL,
  DELIVERY_MODE,
} from '../constants/enums.js';
import { buildReturnPolicySnapshotsFor } from './returnPolicy.service.js';
import { debitWallet } from './wallet.service.js';
import { recordDonationTransaction } from './donation.service.js';
import { WALLET_TRANSACTION_TYPE, WALLET_REFERENCE_TYPE } from '../models/WalletLedger.js';
import { mutateInventory } from './inventory.service.js';

/**
 * One basket becomes several deliveries; one payment covers them all.
 *
 * A shopper filling a single cart from two shops in two modes is buying three
 * journeys, and each journey has its own seller, its own carrier, its own
 * delivery charge and its own lifecycle. Forcing them into one Order would mean
 * one status for three things that finish at different times, and one rider for
 * a parcel a courier is carrying.
 *
 * So checkout produces N Orders and ONE Payment, tied together by `groupRef`.
 * The grouping itself is not decided here — it comes from
 * fulfilmentGroups.service.js, the same function the cart preview uses, so what
 * the customer agreed to and what gets created cannot drift apart.
 *
 * This module owns exactly one thing: turning approved groups into persisted
 * orders inside a single transaction.
 */

/** A checkout's identity: shared by every order it creates and by the payment. */
export const newGroupRef = () => `grp_${crypto.randomUUID()}`;

/**
 * Order lines, from a group's items.
 *
 * The grouping service already loaded every product and priced every group, so
 * nothing is queried again here — the shape it hands over is the shape an Order
 * stores.
 */
const linesOf = (group) => group.items.map((i) => ({
  productId: i.productId,
  variantId: i.variantId || null,
  sku: i.sku,
  variantName: i.variantName,
  variantAttributes: i.variantAttributes || [],
  unitSnapshot: i.unitSnapshot,
  weightSnapshot: i.weightSnapshot,
  name: i.name,
  image: i.image || '',
  qty: i.qty,
  price: i.price,
  campaignId: i.campaignId,
  type: i.type,
  sellerId: i.sellerId,
  shgStoreId: i.shgStoreId,
  additionalMessage: i.additionalMessage || '',
}));

/**
 * Everything must be buyable before anything is bought.
 *
 * Checked across all groups up front so a basket cannot half-succeed: three
 * orders created and the fourth group found to be out of stock is a customer
 * charged for a delivery that will never leave. This is the cheap read-only
 * pass; the authoritative one is the conditional decrement below, which is what
 * actually settles a race between two shoppers reaching for the last unit.
 */
export const validateGroupsStock = (groups) => {
  for (const g of groups) {
    for (const item of g.items) {
      if (item.available === false) {
        throw httpError(409, `"${item.name}" is no longer available. Please review your cart.`);
      }
      if (item.stock !== undefined && item.stock < item.qty) {
        throw httpError(409, `Only ${item.stock} left of "${item.name}". Please review your cart.`);
      }
    }
  }
};

/**
 * The delivery snapshot, frozen at placement.
 *
 * ONE definition, used by both checkouts. The single-storefront path wrote this
 * only for Same-Day, so the same Scheduled product bought through the two paths
 * came out labelled two different ways — the unified one said "Scheduled
 * Delivery" and the legacy one said nothing at all. A rule copied into two
 * checkouts is exactly how that happens, so there is now only one copy and both
 * call it.
 *
 * A Shop All order records its mode either way, because choosing Scheduled is a
 * decision the customer made and the order list reads this field to say so. A
 * Quick order still stores nothing: it has no mode to offer and no premium to
 * break down.
 *
 * Every figure is stored rather than recomputed, so reopening an old receipt
 * shows what was charged then and not what the rules say today.
 *
 * @param {string}  channel  the storefront the order belongs to
 * @param {string?} mode     the chosen delivery mode, if any
 * @param {object}  fees     { standardFee, sameDayFee, sellerIncentive }
 * @param {object?} verdict  the Same-Day eligibility result, when Same-Day
 */
export const buildDeliverySnapshot = ({ channel, mode, fees = {}, verdict = null }) => {
  if (channel !== CHANNEL.ECOM || !mode) return undefined;

  if (mode !== DELIVERY_MODE.SAME_DAY) {
    // Scheduled: a mode and the ordinary fee, no premium.
    return { mode, standardFee: fees.standardFee };
  }

  return {
    mode: DELIVERY_MODE.SAME_DAY,
    // standardFee + fee + sellerIncentive === pricing.deliveryCharge
    standardFee: fees.standardFee,
    fee: fees.sameDayFee,
    sellerIncentive: fees.sellerIncentive,
    riderPayoutQuoted: verdict?.riderPayoutQuoted,
    distanceKm: verdict?.distanceKm,
    promisedBy: verdict?.promisedBy,
  };
};

/** The same rule, read off a priced fulfilment group. */
const deliverySnapshotOf = (group) => buildDeliverySnapshot({
  channel: group.channel,
  mode: group.deliveryMode,
  fees: {
    standardFee: group.standardFee,
    sameDayFee: group.sameDayFee,
    sellerIncentive: group.sellerIncentive,
  },
  verdict: group.sameDayOption,
});

/**
 * Create one Order per group plus the single Payment that covers them.
 *
 * Runs entirely inside the caller's transaction. Stock is decremented with the
 * same conditional update the existing checkout uses — `stock: { $gte: qty }`
 * matches nothing if somebody else got there first, and the whole checkout
 * aborts rather than overselling one line of it.
 *
 * @returns {{ orders: Order[], payment: Payment, groupRef: string }}
 */
export const createOrdersFromGroups = async ({
  user, address, groups, paymentMethod, notes, session, groupRef = newGroupRef(), donation = null, tip = 0,
}) => {
  if (!groups?.length) throw httpError(400, 'There is nothing in your basket to order');

  /**
   * Return-policy snapshot (Phase 3) — this grouped/unified path builds its
   * lines from `group.items`, which (unlike the single-channel checkout's
   * own `products` lookup) never carried a product's category. One extra
   * batched lookup here, then every group's lines reuse the same resolved
   * map — never a second Category traversal for a product two groups
   * happen to share.
   */
  const allProductIds = groups.flatMap((g) => linesOf(g).map((l) => l.productId));
  const productsForPolicy = await Product.find({ _id: { $in: allProductIds } }).select('category type returnable').lean();
  const categoryByProduct = new Map(productsForPolicy.map((p) => [String(p._id), p.category]));
  const productMetaById = new Map(productsForPolicy.map((p) => [String(p._id), p]));
  const returnPolicyByCategory = await buildReturnPolicySnapshotsFor([...categoryByProduct.values()]);
  const nonReturnable = { headerCategoryId: null, headerCategoryName: null, returnEligible: false, returnWindowDays: null };
  /**
   * QUICK COMMERCE ONLY: fold the seller's `Product.returnable` opt-out
   * into the frozen `returnEligible` here, at the one place this snapshot
   * is built — the seller can never widen the category's own window, only
   * narrow (or zero out) their own product's eligibility within it.
   * E-commerce/SHG lines are untouched: same `catPolicy` object as before
   * this field existed, no `sellerReturnable` key at all.
   */
  const withReturnPolicy = (lines) => lines.map((l) => {
    const catPolicy = returnPolicyByCategory.get(String(categoryByProduct.get(String(l.productId)))) || nonReturnable;
    const meta = productMetaById.get(String(l.productId));
    if (meta?.type !== CHANNEL.GROCERY) {
      return { ...l, returnPolicy: catPolicy };
    }
    const sellerReturnable = Boolean(meta?.returnable);
    return {
      ...l,
      returnPolicy: { ...catPolicy, sellerReturnable, returnEligible: catPolicy.returnEligible && sellerReturnable },
    };
  });

  // ---- stock, all of it, before any of it -------------------------------
  for (const g of groups) {
    for (const l of linesOf(g)) {
      await mutateInventory({ productId: l.productId, variantId: l.variantId, quantity: l.qty, session });
    }
  }

  // A single basket-level choice, not one per group — added once to the
  // payment and to the first group's order below, never multiplied across
  // however many deliveries the basket happens to split into.
  const donationAmount = Math.max(0, Number(donation?.amount) || 0);

  /**
   * One tip for the basket, paid to one rider.
   *
   * The checkout offers a single tip, but a basket can split into several
   * deliveries with a different rider on each — so "the delivery partner" the
   * customer tipped is genuinely ambiguous here. It rides on the first order,
   * the same way the donation does, and is paid in full to whoever carries
   * that one rather than being divided into fractions nobody was promised.
   */
  const tipAmount = Math.max(0, Math.round(Number(tip) || 0));

  // ---- one payment for the whole basket ---------------------------------
  const payable = Number((groups.reduce((t, g) => t + g.total, 0) + donationAmount + tipAmount).toFixed(2));

  if (paymentMethod === PAYMENT_METHOD.WALLET) {
    await debitWallet({
      userId: user._id,
      amount: payable,
      type: WALLET_TRANSACTION_TYPE.ORDER_PAYMENT,
      referenceType: WALLET_REFERENCE_TYPE.ORDER,
      referenceId: groupRef,
      description: `Unified Checkout Payment (${groupRef})`,
      idempotencyKey: `ORDER_PAYMENT:${groupRef}`,
      session,
    });
  }

  const [payment] = await Payment.create([{
    userId: user._id,
    amount: payable,
    method: paymentMethod,
    status: paymentMethod === PAYMENT_METHOD.WALLET ? PAYMENT_STATUS.PAID : PAYMENT_STATUS.PENDING,
    paidAt: paymentMethod === PAYMENT_METHOD.WALLET ? new Date() : undefined,
    groupRef,
  }], { session });

  // ---- one order per group ----------------------------------------------
  const orders = [];
  let donationAttached = false;
  let tipAttached = false;
  for (const g of groups) {
    // Attached to the first order only — one basket-level choice, recorded
    // once, so a refund or a per-order view never double-counts it across
    // however many deliveries the checkout split into.
    const thisOrdersDonation = !donationAttached && donationAmount > 0 ? donationAmount : 0;
    if (thisOrdersDonation > 0) donationAttached = true;

    const thisOrdersTip = !tipAttached && tipAmount > 0 ? tipAmount : 0;
    if (thisOrdersTip > 0) tipAttached = true;

    const [doc] = await Order.create([{
      userId: user._id,
      type: g.channel,
      items: withReturnPolicy(linesOf(g)),
      shippingAddress: address,
      /**
       * This group's money only.
       *
       * Each order carries what its own delivery costs — never the basket total
       * — so a cancellation, a seller payout or a refund reads one order and
       * gets a figure that means something on its own. The donation is the one
       * deliberate exception: it isn't any group's own money, it just has to
       * live somewhere, so it rides on the first order and is added into that
       * order's own totalAmount to keep this order internally consistent.
       */
      pricing: {
        subtotal: g.subtotal,
        discount: 0,
        couponDiscount: 0,
        cdsDiscount: 0,
        deliveryCharge: g.deliveryCharge,
        donationAmount: thisOrdersDonation,
        donationTitle: thisOrdersDonation > 0 ? donation?.title : undefined,
        donationComment: thisOrdersDonation > 0 ? (donation?.comment || '') : '',
        tipAmount: thisOrdersTip,
        totalAmount: Number((g.total + thisOrdersDonation + thisOrdersTip).toFixed(2)),
      },
      paymentMethod,
      paymentId: payment._id,
      groupRef,
      deliveryType: g.deliveryType,
      delivery: deliverySnapshotOf(g),
      status: ORDER_STATUS.PLACED,
      timeline: [{ status: ORDER_STATUS.PLACED, timestamp: new Date(), note: 'Order placed' }],
      notes,
    }], { session });

    orders.push(doc);
  }

  /**
   * The payment keeps pointing at an order, as it always has.
   *
   * `groupRef` is what settle() and refunds actually work from, but a great deal
   * of existing code reads `payment.orderId` — and a payment with none would be
   * a new shape for those paths to learn. Pointing it at the first order costs
   * nothing and keeps every legacy reader working.
   */
  await Payment.updateOne({ _id: payment._id }, { $set: { orderId: orders[0]._id } }, { session });

  if (donationAmount > 0 && orders[0]) {
    await recordDonationTransaction({ order: orders[0], payment, session });
  }

  // Only the storefronts that were actually ordered from are emptied.
  const channels = [...new Set(groups.map((g) => g.channel))];
  await Cart.updateMany(
    { userId: user._id, channel: { $in: channels } },
    { $set: { items: [] } },
    { session }
  );

  return { orders, payment, groupRef };
};

export default createOrdersFromGroups;
