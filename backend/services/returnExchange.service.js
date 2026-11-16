import mongoose from 'mongoose';
import Order from '../models/Order.js';
import Return from '../models/Return.js';
import Payment from '../models/Payment.js';
import Product from '../models/Product.js';
import { httpError } from '../utils/response.js';
import { mutateInventory } from './inventory.service.js';
import {
  ORDER_STATUS, RETURN_STATUS, RETURN_RESOLUTION, RETURN_EXCHANGE_STATUS, PAYMENT_METHOD, PAYMENT_STATUS,
  APPROVAL, WHOLESALE_CHANNEL,
} from '../constants/enums.js';

// Error codes for "the replacement can't be sent": these turn the exchange into a refund, anything else is
// a real failure the admin retries. Codes, not message text, so rewording an error never changes the outcome.
const EXCHANGE_OUT_OF_STOCK = 'EXCHANGE_OUT_OF_STOCK';
const EXCHANGE_PRODUCT_UNAVAILABLE = 'EXCHANGE_PRODUCT_UNAVAILABLE';
const DIGITAL = 'digital';
import { notifyUser, notifySeller, notifyAllAdmins, NOTIFICATION_EVENT } from './notification.service.js';

/**
 * Exchanges — a return whose resolution is a replacement instead of money.
 *
 * Business rules (decided 2026-11-15):
 *  - Same product only: a fresh unit of the same variant, or another variant of that product at the same price.
 *  - Same eligibility as returns (window, allowed reasons, Easy Returns) and the seller approves.
 *  - Pick up first, then ship: the replacement order is created only after the old item is received and
 *    inspected (RETURN_RECEIVED), so no new unit leaves before the old one is back.
 *  - The replacement is a ₹0 prepaid order with no finance snapshot: the original sale already paid the seller,
 *    so no second earning, commission or tax is posted. Riders are still paid for carrying it.
 *  - If the replacement cannot be sent (out of stock, product withdrawn, or the replacement order is
 *    cancelled), the exchange becomes a normal refund of the original item, processed the usual way.
 */

const paise = (value) => Math.round((Number(value) || 0) * 100);
const sameId = (a, b) => String(a ?? '') === String(b ?? '');

/** The product can still be sold (and therefore sent as a replacement). */
const sellable = (product) => Boolean(product) && !product.isDeleted && product.isActive !== false && product.status === APPROVAL.APPROVED
  && product.fulfillmentType !== DIGITAL;

/**
 * The merchandise price the customer actually paid for one unit, in paise: the order line's frozen unit price
 * (which already includes any campaign deal applied at checkout) minus the per-unit Easy Returns surcharge
 * (easyReturns.service.js::priceWithReturnOption adds it into `price` and records it as `returnExtraCharge`).
 * Order-level coupons are not deducted: they are platform-funded and never reduce the seller's price (the same
 * basis GST and commission use — productGst.service.js `taxBasis`), so a replacement at this price is value-neutral
 * for the seller. Null when the line's price is not a usable amount.
 */
export const paidUnitPaise = (item) => {
  const price = Number(item?.price), surcharge = Number(item?.returnExtraCharge || 0);
  if (!Number.isFinite(price) || !Number.isFinite(surcharge) || surcharge < 0) return null;
  const value = paise(price) - paise(surcharge);
  return value > 0 ? value : null;
};

/**
 * Variants this order item may be exchanged for. The variant bought is always offered (a like-for-like
 * replacement of what the customer bought). Another variant is offered only when its current listed price equals
 * the unit price the customer actually paid (paidUnitPaise) — never the bought variant's current list price, which
 * may have risen or may not reflect a campaign price paid at checkout. "Same price only": no payment or refund
 * inside an exchange. The backend recomputes this on every request; the apps only display what it returns.
 */
export const exchangeOptionsFor = (product, item, quantity = 1) => {
  if (!sellable(product) || item.fulfillmentType === DIGITAL) return [];
  const variants = Array.isArray(product.variants) ? product.variants.filter((v) => v?._id) : [];
  if (!variants.length) {
    // A product without variants: only the same item again.
    return [{ variantId: null, name: product.name, price: product.price, weight: product.weight, stock: product.stock || 0, inStock: (product.stock || 0) >= quantity, sameAsBought: true }];
  }
  const referencePaise = paidUnitPaise(item);
  return variants
    .filter((v) => sameId(v._id, item.variantId) || paise(v.price) === referencePaise)
    .map((v) => ({
      variantId: v._id, name: v.name, price: v.price, sku: v.sku, unit: v.unit, weight: v.weight, attributes: v.attributes || [],
      stock: v.stock || 0, inStock: (v.stock || 0) >= quantity, sameAsBought: sameId(v._id, item.variantId),
    }));
};

/**
 * Validates the customer's exchange choice at request time and returns the snapshot stored on the Return.
 * `variantId` empty means "the same variant I bought".
 */
export const resolveExchangeChoice = async ({ order, item, variantId, quantity }) => {
  if (order.salesChannel === WHOLESALE_CHANNEL) throw httpError(400, 'Wholesale orders cannot be exchanged', { code: 'EXCHANGE_NOT_AVAILABLE' });
  if (item.fulfillmentType === DIGITAL) throw httpError(400, 'Digital products cannot be exchanged', { code: 'EXCHANGE_NOT_AVAILABLE' });
  const product = await Product.findById(item.productId).select('name price stock weight variants status isActive isDeleted fulfillmentType');
  const options = exchangeOptionsFor(product, item, quantity);
  if (!options.length) throw httpError(400, 'This product is no longer available for exchange. You can request a refund instead.', { code: 'EXCHANGE_NOT_AVAILABLE' });
  const wanted = variantId ? String(variantId) : String(item.variantId ?? '');
  const choice = options.find((o) => sameId(o.variantId, wanted || null));
  if (!choice) throw httpError(400, 'You can exchange only for the same item, or another option of this product at the same price', { code: 'EXCHANGE_VARIANT_NOT_ALLOWED' });
  if (!choice.inStock) throw httpError(409, 'That option is out of stock right now. Choose another option or request a refund.', { code: EXCHANGE_OUT_OF_STOCK });
  return {
    status: RETURN_EXCHANGE_STATUS.REQUESTED,
    variantId: choice.variantId || undefined,
    variantName: choice.name,
    sku: choice.sku,
    variantAttributes: choice.attributes || [],
    unitSnapshot: choice.unit,
    // Grams per unit of the option being sent: the courier package weight for the replacement.
    weightSnapshot: Number.isFinite(Number(choice.weight)) && Number(choice.weight) > 0 ? Number(choice.weight) : undefined,
  };
};

/** The order line for the replacement: the bought line with the chosen variant swapped in. */
const replacementLine = (item, ret) => {
  const ex = ret.exchange;
  const swapped = !sameId(ex.variantId, item.variantId);
  return {
    productId: item.productId,
    variantId: ex.variantId ?? item.variantId,
    sku: swapped ? ex.sku : item.sku,
    variantName: swapped ? ex.variantName : item.variantName,
    variantAttributes: swapped ? (ex.variantAttributes || []) : (item.variantAttributes || []),
    unitSnapshot: swapped ? ex.unitSnapshot : item.unitSnapshot,
    weightSnapshot: swapped ? (ex.weightSnapshot ?? item.weightSnapshot) : item.weightSnapshot,
    name: item.name,
    image: item.image,
    qty: ret.quantity,
    // The value of the goods (for the courier's declared value and receipts); the order total is ₹0.
    price: item.price,
    sellerId: item.sellerId,
    shgStoreId: item.shgStoreId,
    type: item.type,
    fulfillmentType: 'physical',
    stockReserved: true,
    // Same return terms as the original item; a replacement can be exchanged again but not refunded
    // (it was never paid for), which createReturnRequest enforces.
    returnOption: item.returnOption,
    returnPolicySnapshot: item.returnPolicySnapshot,
    returnEligibilityDays: item.returnEligibilityDays,
    returnExtraCharge: item.returnExtraCharge,
    finalItemPrice: item.finalItemPrice,
    returnPolicy: item.returnPolicy,
  };
};

const notifyConversion = (ret, reason) => {
  notifyUser(ret.customerId, {
    event: NOTIFICATION_EVENT.RETURN_RECEIVED,
    title: 'Exchange changed to a refund',
    message: `We couldn't send a replacement for ${ret.returnNumber} (${reason}). You'll get a refund for ${ret.productName} instead.`,
    metadata: { returnId: ret._id, returnNumber: ret.returnNumber },
    route: `/orders/${ret.orderId}`,
  }).catch(() => {});
  notifyAllAdmins({
    event: NOTIFICATION_EVENT.RETURN_RECEIVED,
    title: 'Exchange needs a refund',
    message: `${ret.returnNumber} — the replacement could not be sent (${reason}). Process the refund from Returns.`,
    metadata: { returnId: ret._id, returnNumber: ret.returnNumber },
    route: `/admin/returns/${ret._id}`,
  }).catch(() => {});
};

/**
 * Turn an exchange into a normal refund, inside the caller's transaction. The return goes back to
 * RETURN_RECEIVED (the old item is already back and inspected) so the admin's usual refund action pays it.
 * Returns the updated Return, or null when there was nothing to convert. Call `notifyConversion` after commit.
 */
export const convertExchangeToRefundInSession = async ({ returnId, reason, session }) => {
  const ret = await Return.findById(returnId).session(session);
  if (!ret || ret.resolution !== RETURN_RESOLUTION.EXCHANGE) return null;
  if (ret.exchange?.status === RETURN_EXCHANGE_STATUS.CONVERTED_TO_REFUND) return null;
  const now = new Date();
  const fromStatus = ret.status;
  ret.resolution = RETURN_RESOLUTION.REFUND;
  ret.exchange.status = RETURN_EXCHANGE_STATUS.CONVERTED_TO_REFUND;
  ret.exchange.convertedAt = now;
  ret.exchange.convertedReason = reason;
  if (ret.status === RETURN_STATUS.EXCHANGED) ret.status = RETURN_STATUS.RETURN_RECEIVED;
  ret.history.push({ fromStatus, toStatus: ret.status, changedByRole: 'system', comment: `Exchange changed to a refund: ${reason}`, timestamp: now });
  await ret.save({ session });
  return ret;
};

/** Standalone conversion (own transaction) with notifications. */
export const convertExchangeToRefund = async ({ returnId, reason }) => {
  const session = await mongoose.startSession();
  let ret;
  try {
    await session.withTransaction(async () => { ret = await convertExchangeToRefundInSession({ returnId, reason, session }); });
  } finally {
    await session.endSession();
  }
  if (ret) notifyConversion(ret, reason);
  return ret;
};

/** Errors that mean "the replacement can't be sent", as opposed to a transient failure worth retrying. */
const UNAVAILABLE_REASON = {
  [EXCHANGE_OUT_OF_STOCK]: 'the chosen option is out of stock',
  [EXCHANGE_PRODUCT_UNAVAILABLE]: 'the product is no longer available',
};

/**
 * Create the replacement order for an exchange whose old item has been received and inspected.
 * Idempotent: a second call returns the existing replacement. When the replacement cannot be sent
 * (stock, product withdrawn) the exchange is converted to a refund instead and `{ converted: true }` returned.
 */
export const createExchangeReplacement = async (returnId) => {
  const session = await mongoose.startSession();
  let outcome;
  try {
    await session.withTransaction(async () => {
      outcome = undefined;
      const ret = await Return.findById(returnId).session(session);
      if (!ret) throw httpError(404, 'Return not found');
      if (ret.resolution !== RETURN_RESOLUTION.EXCHANGE) throw httpError(409, 'This return is not an exchange');
      if (ret.exchange?.status === RETURN_EXCHANGE_STATUS.REPLACEMENT_CREATED) {
        outcome = { ret, replacementOrderId: ret.exchange.replacementOrderId, alreadyCreated: true };
        return;
      }
      if (ret.status !== RETURN_STATUS.RETURN_RECEIVED) throw httpError(409, 'The returned item must be received and inspected before the replacement is sent');

      const order = await Order.findById(ret.orderId).session(session);
      const item = order?.items.id(ret.orderItemId);
      if (!order || !item) throw httpError(409, 'The original order item is missing');
      const product = await Product.findById(ret.productId).select('status isActive isDeleted fulfillmentType').session(session);
      if (!sellable(product)) throw httpError(409, 'The product is no longer available', { code: EXCHANGE_PRODUCT_UNAVAILABLE });

      // A stock refusal (409 from the atomic decrement) is tagged so it converts to a refund below.
      try {
        await mutateInventory({ productId: ret.productId, variantId: ret.exchange.variantId || null, quantity: ret.quantity, session });
      } catch (err) {
        if (err?.status === 409) throw httpError(409, err.message, { code: EXCHANGE_OUT_OF_STOCK });
        throw err;
      }

      const now = new Date();
      const orderId = new mongoose.Types.ObjectId();
      const [payment] = await Payment.create([{
        userId: ret.customerId, amount: 0, method: PAYMENT_METHOD.WALLET, status: PAYMENT_STATUS.PAID, paidAt: now,
        orderId, exchangeReturnId: ret._id,
      }], { session });

      const line = replacementLine(item, ret);
      const value = Math.round(line.price * line.qty * 100) / 100;
      const [replacement] = await Order.create([{
        _id: orderId,
        userId: order.userId,
        type: order.type,
        salesChannel: 'retail', // Order.salesChannel: replacements are retail (wholesale orders can't be exchanged)
        items: [line],
        shippingAddress: order.shippingAddress,
        // The goods' value with a 100% exchange credit: the customer pays nothing and the courier still
        // gets a real declared value.
        pricing: { subtotal: value, discountRepresentation: 'components-v1', discount: value, couponDiscount: 0, cdsDiscount: 0, deliveryCharge: 0, tipAmount: 0, totalAmount: 0 },
        paymentMethod: PAYMENT_METHOD.WALLET,
        paymentId: payment._id,
        deliveryType: order.deliveryType,
        fulfillment: order.fulfillment?.assignmentPolicy ? { assignmentPolicy: order.fulfillment.assignmentPolicy } : undefined,
        delivery: order.delivery ? { mode: order.delivery.mode, standardFee: 0, fee: 0, sellerIncentive: 0, riderPayoutQuoted: order.delivery.riderPayoutQuoted, distanceKm: order.delivery.distanceKm } : undefined,
        exchange: { returnId: ret._id, returnNumber: ret.returnNumber, originalOrderId: order._id, originalItemId: item._id },
        status: ORDER_STATUS.PLACED,
        timeline: [{ status: ORDER_STATUS.PLACED, timestamp: now, note: `Replacement for exchange ${ret.returnNumber}` }],
        notes: `Exchange replacement for ${order.orderNo} (${ret.returnNumber}). No payment to collect.`,
      }], { session });

      ret.exchange.status = RETURN_EXCHANGE_STATUS.REPLACEMENT_CREATED;
      ret.exchange.replacementOrderId = replacement._id;
      ret.exchange.replacementOrderNo = replacement.orderNo;
      ret.exchange.replacementCreatedAt = now;
      ret.history.push({ fromStatus: ret.status, toStatus: RETURN_STATUS.EXCHANGED, changedByRole: 'system', comment: `Replacement order ${replacement.orderNo || replacement._id} placed`, timestamp: now });
      ret.status = RETURN_STATUS.EXCHANGED;
      await ret.save({ session });
      outcome = { ret, replacement, replacementOrderId: replacement._id, alreadyCreated: false };
    });
  } catch (err) {
    await session.endSession();
    const reason = UNAVAILABLE_REASON[err?.meta?.code];
    if (!reason) throw err;
    const ret = await convertExchangeToRefund({ returnId, reason });
    return { converted: true, reason, ret };
  }
  await session.endSession();

  if (!outcome.alreadyCreated) {
    const { ret, replacement } = outcome;
    notifyUser(ret.customerId, {
      event: NOTIFICATION_EVENT.RETURN_RECEIVED,
      title: 'Your replacement is on its way',
      message: `We received your item for ${ret.returnNumber}. Replacement order ${replacement.orderNo} has been placed at no charge.`,
      metadata: { returnId: ret._id, returnNumber: ret.returnNumber, orderId: replacement._id },
      route: `/orders/${replacement._id}`,
    }).catch(() => {});
    if (ret.sellerId) notifySeller(ret.sellerId, {
      event: NOTIFICATION_EVENT.ORDER_CREATED,
      title: 'Exchange replacement to send',
      message: `Order ${replacement.orderNo} is a free replacement for exchange ${ret.returnNumber} (${ret.productName} × ${ret.quantity}). Accept and send it like a normal order; there is no payment to collect.`,
      metadata: { orderId: replacement._id, returnId: ret._id },
      route: `/seller/orders/${replacement._id}`,
      dedupeKey: `EXCHANGE_REPLACEMENT:${replacement._id}:seller`,
    }).catch(() => {});
  }
  return { converted: false, ...outcome };
};

export { notifyConversion };
