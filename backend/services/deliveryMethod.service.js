import { CHANNEL, DELIVERY_METHOD, DELIVERY_METHODS } from '../constants/enums.js';
import { httpError } from '../utils/response.js';

/**
 * Product delivery methods (Easy Ship / Self Delivery / FBB) — the one place their rules live.
 *
 * A delivery method belongs to a physical Shop All product. Quick Commerce and e-books never
 * have one. An absent value means Easy Ship, so every product and order that existed before
 * this feature keeps exactly its current behaviour without a data migration.
 *
 * The whole feature is switched off unless DELIVERY_METHODS_ENABLED=true. While it is off a
 * seller cannot choose anything other than Easy Ship, and nothing is written to products.
 */

export const LABELS = {
  [DELIVERY_METHOD.EASY_SHIP]: 'Easy Ship',
  [DELIVERY_METHOD.SELF_DELIVERY]: 'Self Delivery',
  [DELIVERY_METHOD.FBB]: 'Fulfilled by Bulkimart',
};

export const deliveryMethodsEnabled = () => String(process.env.DELIVERY_METHODS_ENABLED || '').trim().toLowerCase() === 'true';

/**
 * Credit the customer's delivery charge to the seller when the seller arranged and paid the courier
 * (Self Delivery, own courier). Business direction approved 2026-11-25; GST treatment awaits accountant
 * review, so SELF_DELIVERY_FEE_CREDIT_ENABLED stays off until then. Read once per order at hand-off.
 */
export const selfDeliveryFeeCreditEnabled = () => String(process.env.SELF_DELIVERY_FEE_CREDIT_ENABLED || '').trim().toLowerCase() === 'true';

const flag = (name) => String(process.env[name] || '').trim().toLowerCase() === 'true';
/**
 * FBB switches, all off by default and independent:
 *   FBB_ENABLED                    sellers may choose/convert to FBB and customers may buy FBB stock
 *   WAREHOUSE_OPERATIONS_ENABLED   admins may receive stock and approve adjustments (fulfilment, returns and
 *                                  cancellations of orders that already exist never depend on a switch)
 *   FBB_CHARGES_ENABLED            new FBB service charges are booked (existing obligations always settle)
 * FBB is offered only when delivery methods are on too. Conversion additionally checks real readiness
 * (an active warehouse, a charge version when charging is on): services/warehouse.service.js::fbbReadiness.
 */
export const fbbEnabled = () => flag('FBB_ENABLED');
export const warehouseOperationsEnabled = () => flag('WAREHOUSE_OPERATIONS_ENABLED');
export const fbbChargesEnabled = () => flag('FBB_CHARGES_ENABLED');
export const fbbAvailable = () => deliveryMethodsEnabled() && fbbEnabled();
/**
 * Customers can buy FBB stock only when FBB is open AND charging is on: FBB is a paid service, and an order
 * placed without frozen charge terms could never be billed. Placement also refuses when no rates are in force.
 * Switching any of these off stops new FBB sales only; existing orders, stock, returns and charges carry on.
 */
export const fbbSellable = () => fbbAvailable() && fbbChargesEnabled();

/**
 * Seller-level FBB eligibility (pilot). The switches above are global; on top of them FBB is open only to
 * sellers an admin enabled (Seller.fbbPilot.enabled, set through /api/admin/fbb/pilot-sellers), unless
 * FBB_ALL_SELLERS_ENABLED=true opens it to every seller (general rollout). Both default to closed.
 * It gates NEW activity only: listing or converting to FBB, receiving new stock, and customers buying FBB
 * stock. Orders already placed, their charges, returns, refunds and obligations never depend on it.
 */
export const fbbAllSellersEnabled = () => flag('FBB_ALL_SELLERS_ENABLED');
export const FBB_SELLER_NOT_ENABLED = 'FBB_SELLER_NOT_ENABLED';
export const fbbSellerEligible = (seller) => fbbAllSellersEnabled() || seller?.fbbPilot?.enabled === true;
export const fbbSellableFor = (seller) => fbbSellable() && fbbSellerEligible(seller);
export const assertFbbSellerEligible = (seller) => {
  if (!fbbSellerEligible(seller)) throw httpError(403, 'Fulfilled by Bulkimart is not enabled for this store yet. Contact Bulkimart to join the FBB programme.', { code: FBB_SELLER_NOT_ENABLED });
};

/** Does a delivery method apply to this product at all? Physical e-commerce only. */
export const deliveryMethodApplies = (product) => Boolean(product)
  && product.type === CHANNEL.ECOM && (product.fulfillmentType || 'physical') !== 'digital';

/** The method a product is sold under right now, or undefined when none applies. */
export const effectiveDeliveryMethod = (product) => (deliveryMethodApplies(product)
  ? (product.deliveryMethod || DELIVERY_METHOD.EASY_SHIP)
  : undefined);

/** The method an order (or order item) was placed under. Older e-commerce orders read as Easy Ship. */
export const orderDeliveryMethod = (order) => {
  if (order?.deliveryMethod) return order.deliveryMethod;
  if (order?.type !== CHANNEL.ECOM) return undefined;
  const physical = (order.items || []).some((item) => (item.fulfillmentType || 'physical') !== 'digital');
  return physical || !order.items?.length ? DELIVERY_METHOD.EASY_SHIP : undefined;
};

export const fulfillmentOwnerFor = (method) => (method === DELIVERY_METHOD.FBB ? 'bulkimart' : method ? 'seller' : undefined);

/**
 * Which changes a seller may make. FBB is one-way: stock sits in Bulkimart's warehouse, so a
 * product can never go back to seller fulfilment.
 */
const ALLOWED = {
  [DELIVERY_METHOD.EASY_SHIP]: [DELIVERY_METHOD.SELF_DELIVERY, DELIVERY_METHOD.FBB],
  [DELIVERY_METHOD.SELF_DELIVERY]: [DELIVERY_METHOD.EASY_SHIP, DELIVERY_METHOD.FBB],
  [DELIVERY_METHOD.FBB]: [],
};
export const canSwitchDeliveryMethod = (from, to) => from === to || Boolean(ALLOWED[from]?.includes(to));

/**
 * Validate a seller's requested delivery method for a product.
 *
 * @param {*} raw              what the request sent (undefined = not sent)
 * @param {object} product     { type, fulfillmentType, deliveryMethod? } — the product as it will be
 * @param {object} [opts]
 * @param {boolean} [opts.isNew] creating, rather than editing
 * @returns {string|undefined}   the method to store, or undefined to leave the field untouched/absent
 */
export const resolveDeliveryMethodInput = (raw, product, { isNew = false } = {}) => {
  const sent = raw !== undefined && raw !== null && String(raw).trim() !== '';
  if (!sent) return undefined;
  const requested = String(raw).trim().toLowerCase();
  if (!DELIVERY_METHODS.includes(requested)) throw httpError(400, 'Choose Easy Ship, Self Delivery or Fulfilled by Bulkimart');
  if (!deliveryMethodApplies(product)) {
    // Older clients may send the default for any product; anything else is a mistake.
    if (requested === DELIVERY_METHOD.EASY_SHIP) return undefined;
    throw httpError(400, 'Delivery methods apply only to physical E-Commerce products');
  }
  const current = isNew ? DELIVERY_METHOD.EASY_SHIP : (product.deliveryMethod || DELIVERY_METHOD.EASY_SHIP);
  // An edit that resends the current value changes nothing, whatever the switch says.
  if (requested === current) return isNew && requested !== DELIVERY_METHOD.EASY_SHIP ? requested : undefined;
  if (current === DELIVERY_METHOD.FBB) throw httpError(409, 'A Fulfilled by Bulkimart product cannot be moved back to seller delivery');
  if (!deliveryMethodsEnabled()) {
    // Switched off: only moving back to the default stays possible (a rollback path).
    if (requested === DELIVERY_METHOD.EASY_SHIP) return requested;
    throw httpError(400, 'Only Easy Ship is available right now');
  }
  if (requested === DELIVERY_METHOD.FBB) {
    if (!fbbSellable()) throw httpError(409, 'Fulfilled by Bulkimart is not available yet');
    // An existing listing moves to FBB only through the conversion, which shows the charges and keeps the
    // seller's own stock aside. A new listing may start as FBB (createProduct checks the accepted charges).
    if (!isNew) throw httpError(409, 'Use "Convert to Fulfilled by Bulkimart", which shows the charges first', { code: 'FBB_CONVERSION_REQUIRED' });
    return requested;
  }
  if (!canSwitchDeliveryMethod(current, requested)) throw httpError(409, `A product cannot change from ${LABELS[current]} to ${LABELS[requested]}`);
  return requested;
};

/**
 * What the seller panel needs to render the selector. With a seller, FBB is offered only when that seller is
 * eligible (pilot); without one (an admin view) only the global switches count.
 */
export const deliveryMethodOptions = (seller) => {
  const fbbOpen = seller === undefined ? fbbSellable() : fbbSellableFor(seller);
  return ({
  enabled: deliveryMethodsEnabled(),
  default: DELIVERY_METHOD.EASY_SHIP,
  options: DELIVERY_METHODS.map((value) => ({
    value,
    label: LABELS[value],
    available: value === DELIVERY_METHOD.EASY_SHIP || (deliveryMethodsEnabled() && (value !== DELIVERY_METHOD.FBB || fbbOpen)),
    reason: value === DELIVERY_METHOD.FBB && !fbbOpen ? 'Coming soon' : undefined,
    prepaidOnly: value === DELIVERY_METHOD.SELF_DELIVERY,
    oneWay: value === DELIVERY_METHOD.FBB,
  })),
  });
};

/* ---------------------------------------------------------------- COD ---------------------------------------- */

/**
 * Self Delivery is prepaid only (approved 2026-11-25): the seller's own rider or courier never collects
 * cash for Bulkimart. A checkout holding ANY Self Delivery item therefore cannot be Cash on Delivery —
 * there is one payment per checkout and no split payment. Read from the product's method at checkout
 * (never from a client flag), so a stale cart or an old app cannot bypass it. Independent of the
 * DELIVERY_METHODS_ENABLED switch: a product that is Self Delivery stays prepaid even if the switch is
 * later turned off.
 */
export const COD_UNAVAILABLE_SELF_DELIVERY = 'COD_UNAVAILABLE_SELF_DELIVERY';
export const SELF_DELIVERY_COD_REASON = 'Cash on Delivery is not available because your basket contains items delivered directly by the seller (Self Delivery). Pay online, or remove those items to use Cash on Delivery.';

/** { available, reason } for a list of delivery methods (one per line or group). */
export const codAvailabilityFor = (methods = []) => (methods.includes(DELIVERY_METHOD.SELF_DELIVERY)
  ? { available: false, code: COD_UNAVAILABLE_SELF_DELIVERY, reason: SELF_DELIVERY_COD_REASON }
  : { available: true });

/** Throw 409 when a COD checkout contains Self Delivery lines. */
export const assertPaymentMethodAllowed = (paymentMethod, methods = []) => {
  if (paymentMethod !== 'cod') return;
  const verdict = codAvailabilityFor(methods);
  if (!verdict.available) throw httpError(409, verdict.reason, { code: verdict.code });
};

/* ---------------------------------------------------------------- external courier ---------------------------- */

const EXTERNAL_TEXT = /^[\p{L}\p{N} .,&'()/-]+$/u;
const AWB_PATTERN = /^[A-Za-z0-9][A-Za-z0-9/_-]{2,39}$/;

/**
 * Validate the tracking a seller enters when handing a Self Delivery parcel to their own courier.
 * Every field is required (untracked local couriers are not allowed for now). The URL must be a public
 * https page, so customer and admin screens can link to it safely.
 */
export const parseExternalShipmentInput = (body = {}, { orderPlacedAt, now = new Date() } = {}) => {
  const courierName = String(body.courierName ?? '').trim().replace(/\s+/g, ' ');
  if (courierName.length < 2 || courierName.length > 60 || !EXTERNAL_TEXT.test(courierName)) throw httpError(400, 'Enter the courier company name (2–60 letters, numbers or spaces)');
  const awb = String(body.awb ?? '').trim();
  if (!AWB_PATTERN.test(awb)) throw httpError(400, 'Enter the tracking ID / AWB number (3–40 letters, numbers, - / _)');
  const rawUrl = String(body.trackingUrl ?? '').trim();
  let url;
  try { url = new URL(rawUrl); } catch { throw httpError(400, 'Enter the full tracking link, starting with https://'); }
  if (url.protocol !== 'https:' || url.username || url.password || rawUrl.length > 500 || !url.hostname.includes('.')
    || /^(localhost|127\.|10\.|192\.168\.|0\.)/i.test(url.hostname)) {
    throw httpError(400, 'The tracking link must be a public https:// web address');
  }
  const dispatchedAt = new Date(body.dispatchDate);
  if (!body.dispatchDate || Number.isNaN(dispatchedAt.getTime())) throw httpError(400, 'Enter the dispatch date');
  if (dispatchedAt.getTime() > now.getTime() + 5 * 60 * 1000) throw httpError(400, 'The dispatch date cannot be in the future');
  if (orderPlacedAt && dispatchedAt.getTime() < new Date(orderPlacedAt).getTime() - 24 * 60 * 60 * 1000) throw httpError(400, 'The dispatch date cannot be before the order was placed');
  return { courierName, awb, trackingUrl: url.toString(), dispatchedAt };
};

/** "Easy Ship" / "Self Delivery" / … from a sheet cell; empty = not given. */
export const parseDeliveryMethodText = (text) => {
  const value = String(text ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (!value) return undefined;
  if (['easy_ship', 'easyship', 'shiprocket'].includes(value)) return DELIVERY_METHOD.EASY_SHIP;
  if (['self_delivery', 'self', 'selfdelivery'].includes(value)) return DELIVERY_METHOD.SELF_DELIVERY;
  if (['fbb', 'fulfilled_by_bulkimart'].includes(value)) return DELIVERY_METHOD.FBB;
  return value; // rejected by resolveDeliveryMethodInput with a clear message
};

/**
 * The shipment, read off the fields where each provider already records it — the PDF §8 fields
 * (delivery_method, shipping_provider, shipment_id, awb_number, tracking_url, shipment_status,
 * dispatch_date, delivered_date). A view, never stored: the provider records stay the source.
 */
export const shipmentView = (order, delivery = null) => {
  if (!order) return null;
  const method = orderDeliveryMethod(order);
  const timelineAt = (status) => (order.timeline || []).find((entry) => entry.status === status)?.timestamp || null;
  const ext = order.externalShipment;
  if (order.deliveryType === 'external' && ext) {
    return {
      deliveryMethod: method || null,
      fulfillmentOwner: order.fulfillmentOwner || fulfillmentOwnerFor(method) || null,
      shippingProvider: 'external_courier',
      courierName: ext.courierName || null,
      shipmentId: null,
      awbNumber: ext.awb || null,
      trackingUrl: ext.trackingUrl || null,
      shipmentStatus: ext.status || null,
      dispatchDate: ext.dispatchedAt || timelineAt('dispatched'),
      deliveredDate: ext.deliveredAt || order.deliveredAt || timelineAt('delivered'),
    };
  }
  const sr = order.shiprocket || {};
  const viaShiprocket = order.deliveryType === 'shiprocket' || Boolean(sr.awb || sr.shipmentId);
  const viaRider = !viaShiprocket && Boolean(order.deliveryId || order.deliveryPartnerId);
  const provider = viaShiprocket ? (sr.shipmentId ? 'shiprocket' : 'courier') : viaRider ? 'bulkimart_rider' : null;
  return {
    deliveryMethod: method || null,
    fulfillmentOwner: order.fulfillmentOwner || fulfillmentOwnerFor(method) || null,
    shippingProvider: provider,
    courierName: viaShiprocket ? (sr.courier || null) : null,
    shipmentId: viaShiprocket ? (sr.shipmentId || null) : (order.deliveryId ? String(order.deliveryId) : null),
    awbNumber: viaShiprocket ? (sr.awb || null) : null,
    trackingUrl: viaShiprocket ? (sr.trackingUrl || null) : null,
    shipmentStatus: viaShiprocket ? (sr.trackingStatus || sr.status || null) : (delivery?.status || null),
    dispatchDate: timelineAt('dispatched'),
    deliveredDate: order.deliveredAt || sr.deliveredConfirmedAt || timelineAt('delivered'),
  };
};
