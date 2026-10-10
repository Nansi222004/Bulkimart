import Order from '../models/Order.js';
import Delivery from '../models/Delivery.js';

/**
 * How many deliveries one rider may carry at once.
 *
 * A single trip at a time is the right rule for a live service: a rider holding
 * three orders delivers all three late, and the customer of the last one has no
 * idea why. But it is the wrong rule while the flow is being built — testing an
 * order end to end would mean finishing or unsticking the previous one first,
 * every single time.
 *
 * So the rule is kept and switched off rather than deleted. Set
 * RIDER_MAX_CONCURRENT_DELIVERIES=1 before launch to turn it back on.
 *
 *   unset / 0  → unlimited (development)
 *   1          → one at a time
 *   n          → n at a time
 */
export const maxConcurrentDeliveries = () => {
  const n = Number(process.env.RIDER_MAX_CONCURRENT_DELIVERIES);
  return Number.isFinite(n) && n > 0 ? n : 0;      // 0 means no limit
};

const OPEN = ['delivered', 'cancelled', 'returned', 'refunded'];

/** How many FORWARD deliveries (seller -> customer) this rider is currently holding. */
export const openDeliveryCount = (partnerId) =>
  Order.countDocuments({ deliveryPartnerId: partnerId, status: { $nin: OPEN } });

/**
 * QUICK COMMERCE ONLY — how many REVERSE pickups (customer -> seller) this
 * rider currently holds. A return pickup carries no `Order.deliveryPartnerId`
 * at all (see models/Return.js's `pickup` field comment) — the `Delivery`
 * document itself, keyed by `direction: 'return_pickup'`, is the only place
 * this is tracked, so it's queried directly rather than inventing a second
 * counter that could drift from it.
 *
 * `rejected`/`delivered`/`failed` are Delivery's own terminal states —
 * everything else (`assigned` through `arrived_at_customer`) is a trip
 * still in progress and counts against capacity.
 */
const OPEN_DELIVERY_STATUSES = ['rejected', 'delivered', 'failed'];
export const openReturnPickupCount = (partnerId) =>
  Delivery.countDocuments({ partnerId, direction: 'return_pickup', status: { $nin: OPEN_DELIVERY_STATUSES } });

/**
 * May this rider take on one more — forward delivery OR return pickup? Both
 * draw from the SAME `RIDER_MAX_CONCURRENT_DELIVERIES` limit (Section 11):
 * a rider carrying one forward order and offered a return pickup is
 * evaluated exactly as if a second forward order had been offered instead.
 * @returns {Promise<{ok: true} | {ok: false, open: number, limit: number, reason: string}>}
 */
export const canTakeAnother = async (partnerId) => {
  const limit = maxConcurrentDeliveries();
  if (limit === 0) return { ok: true };

  const [forward, returnPickups] = await Promise.all([
    openDeliveryCount(partnerId),
    openReturnPickupCount(partnerId),
  ]);
  const open = forward + returnPickups;
  if (open < limit) return { ok: true };

  return {
    ok: false,
    open,
    limit,
    reason: limit === 1
      ? 'Finish your current delivery first.'
      : `You are already carrying ${open} deliveries, which is the limit.`,
  };
};
