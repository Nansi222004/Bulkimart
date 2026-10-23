import crypto from 'crypto';
import { sumMoney } from '../utils/money.js';
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
  wholesaleSnapshot: i.wholesaleSnapshot,
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
  user, address, groups, paymentMethod, notes, session, groupRef = newGroupRef(), tip = 0, purchaseMode = 'retail', cartSnapshots, beforeWrite = () => {},
}) => {
  if (!groups?.length) throw httpError(400, 'There is nothing in your basket to order');
  // Reject before any inventory mutation, including basket-level tips.
  const payable = sumMoney(...groups.map(group => group.total), Math.max(0, Math.round(Number(tip) || 0)));

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
   * E-commerce lines are untouched: same `catPolicy` object as before
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
      beforeWrite('inventory.update');
      await mutateInventory({ productId: l.productId, variantId: l.variantId, quantity: l.qty, session });
    }
  }

  /**
   * One tip for the basket, paid to one rider.
   *
   * The checkout offers a single tip, but a basket can split into several
   * deliveries with a different rider on each — so "the delivery partner" the
   * customer tipped is genuinely ambiguous here. It rides on the first order,
   * and is paid in full to whoever carries that one rather than being divided
   * into fractions nobody was promised.
   */
  const tipAmount = Math.max(0, Math.round(Number(tip) || 0));

  // ---- one payment for the whole basket ---------------------------------

  if (paymentMethod === PAYMENT_METHOD.WALLET) {
    beforeWrite('wallet.debit');
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

  beforeWrite('payment.create');
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
  let tipAttached = false;
  for (const g of groups) {
    // Attached to the first order only — one basket-level choice, recorded
    // once, so a refund or a per-order view never double-counts it across
    // however many deliveries the checkout split into.
    const thisOrdersTip = !tipAttached && tipAmount > 0 && (purchaseMode !== 'basket' || g.salesChannel === 'retail') ? tipAmount : 0;
    if (thisOrdersTip > 0) tipAttached = true;

    beforeWrite('order.create');
    const [doc] = await Order.create([{
      userId: user._id,
      type: g.channel,
      salesChannel: g.salesChannel || purchaseMode,
      items: withReturnPolicy(linesOf(g)),
      shippingAddress: address,
      /**
       * This group's money only.
       *
       * Each order carries what its own delivery costs — never the basket total
       * — so a cancellation, a seller payout or a refund reads one order and
       * gets a figure that means something on its own.
       */
      pricing: {
        subtotal: g.subtotal,
        discountRepresentation: 'components-v1',
        discount: 0,
        couponDiscount: 0,
        cdsDiscount: 0,
        deliveryCharge: g.deliveryCharge,
        tipAmount: thisOrdersTip,
        totalAmount: sumMoney(g.total, thisOrdersTip),
      },
      paymentMethod,
      paymentId: payment._id,
      groupRef,
      deliveryType: g.deliveryType,
      fulfillment: g.channel === CHANNEL.ECOM && g.deliveryMode !== DELIVERY_MODE.SAME_DAY
        ? { assignmentPolicy: 'seller_after_acceptance' } : undefined,
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
  beforeWrite('payment.link_order');
  await Payment.updateOne({ _id: payment._id }, { $set: { orderId: orders[0]._id } }, { session });



  // Only the storefronts that were actually ordered from are emptied.
  const channels = [...new Set(groups.map((g) => g.channel))];
  beforeWrite('cart.clear');
  if (purchaseMode === 'basket') {
    for (const cart of cartSnapshots || []) {
      const cleared = await Cart.updateOne({ _id: cart.id, userId: user._id, channel: cart.channel, __v: cart.version },
        { $set: { items: [] }, $inc: { __v: 1 } }, { session });
      if (cleared.modifiedCount !== 1) throw httpError(409, 'Your basket changed during checkout. Refresh and review it.');
    }
  } else {
    await Cart.updateMany({ userId: user._id, channel: purchaseMode === 'wholesale' ? 'wholesale' : { $in: channels } },
      { $set: { items: [] }, $inc: { __v: 1 } }, { session });
  }

  return { orders, payment, groupRef };
};

export default createOrdersFromGroups;
