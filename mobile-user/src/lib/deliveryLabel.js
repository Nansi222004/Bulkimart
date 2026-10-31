/**
 * What to call the delivery on an order that has already been placed.
 *
 * Read from the order's own persisted record, never from how the shop or the
 * product is configured right now. Those change: a seller can switch Same-Day
 * off next week, and an order that genuinely went out same-day last week must
 * still say so. The promise was made at checkout and frozen onto the order, and
 * this reads that frozen copy.
 *
 * One helper because three screens ask the same question — the order list, the
 * order details and the tracking page. Three copies of this rule would be three
 * places for it to drift apart, which in this codebase has already happened with
 * claimable statuses, the payout formula, the DNS fix and address parsing.
 */

export const DELIVERY_LABEL = {
  same_day: { icon: '⚡', text: 'Same-Day Delivery', tone: 'sameday' },
  scheduled: { icon: '📦', text: 'Scheduled Delivery', tone: 'scheduled' },
};

/**
 * @param {object} order  an order, or a tracking payload — both carry `delivery`
 * @returns {{icon, text, tone}|null}  null when the order predates delivery
 *                                     modes, or is a Quick order that has none
 */
export const deliveryLabelFor = (order) => {
  const mode = order?.delivery?.mode;
  return mode ? (DELIVERY_LABEL[mode] || null) : null;
};

/**
 * Does one of our own riders carry this parcel?
 *
 * The question every tracking screen actually needs, and the reason it is asked
 * of the carrier rather than the storefront: a Same-Day order is Shop All but is
 * collected by a rider exactly like a Quick order, so it gets the same live map,
 * the same moving pin and the same OTP. Asking "is this Quick?" would have hidden
 * all of that from a customer who is entitled to it.
 *
 * Falls back to the channel for orders placed before `deliveryType` was stored.
 */
export const hasLiveRider = (track, order) => {
  const carrier = track?.deliveryType || order?.deliveryType;
  if (carrier) return carrier === 'internal';
  return (track?.channel || order?.type) === 'grocery';
};

/** The opposite: a courier has it, and there is nothing live to follow. */
export const goesByCourier = (track, order) =>
  (track?.deliveryType || order?.deliveryType) === 'shiprocket';
