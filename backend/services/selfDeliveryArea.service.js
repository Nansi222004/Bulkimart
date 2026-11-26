import { httpError } from '../utils/response.js';
import { resolveIndianState, INDIAN_STATE_NAMES } from '../utils/indianStates.js';

/**
 * Where a seller delivers Self Delivery products (Seller.selfDelivery).
 *
 * Self Delivery is arranged by the seller after the order is placed — a Bulkimart rider or their own
 * courier — so there is no provider to ask "can you reach this pincode?" at checkout. Instead the seller
 * declares the area once: whole states and/or individual pincodes. A customer can buy a Self Delivery
 * item only when the delivery address falls inside it. Nationwide coverage is never assumed: a seller
 * with no area cannot list Self Delivery products.
 *
 * The seller's general product radius (Seller.serviceRadiusKm) still applies on top, as it does today.
 */

export const SELF_DELIVERY_PINCODE_LIMIT = 2000;

const pincodeOf = (value) => String(value ?? '').trim();

/** Validate and normalise what the seller submitted. At least one pincode or state is required. */
export const parseSelfDeliveryArea = ({ pincodes, states } = {}) => {
  const rawPins = Array.isArray(pincodes) ? pincodes : typeof pincodes === 'string' ? pincodes.split(/[\s,;]+/) : [];
  const pins = [...new Set(rawPins.map(pincodeOf).filter(Boolean))];
  const bad = pins.find((pin) => !/^[1-9]\d{5}$/.test(pin));
  if (bad) throw httpError(400, `"${bad}" is not a valid 6-digit pincode`);
  if (pins.length > SELF_DELIVERY_PINCODE_LIMIT) throw httpError(400, `Add at most ${SELF_DELIVERY_PINCODE_LIMIT} pincodes; choose whole states for wider coverage`);
  const rawStates = Array.isArray(states) ? states : [];
  const names = [];
  for (const state of rawStates) {
    const resolved = resolveIndianState(state);
    if (!resolved) throw httpError(400, `"${String(state).slice(0, 40)}" is not a recognised Indian state or union territory`);
    if (!names.includes(resolved.name)) names.push(resolved.name);
  }
  if (!pins.length && !names.length) throw httpError(400, 'Add at least one pincode or state you deliver to');
  return { pincodes: pins.sort(), states: names, updatedAt: new Date() };
};

export const selfDeliveryAreaConfigured = (seller) => Boolean(seller?.selfDelivery?.pincodes?.length || seller?.selfDelivery?.states?.length);

/**
 * Does the seller's Self Delivery area cover this address?
 * @returns {true|false|null} null when the address carries neither a pincode nor a state (cannot say yet)
 */
export const selfDeliveryServes = (seller, address = {}) => {
  const pin = pincodeOf(address.pincode);
  const state = address.state ? resolveIndianState(address.state)?.name : null;
  if (!pin && !state) return null;
  const area = seller?.selfDelivery || {};
  return Boolean((pin && area.pincodes?.includes(pin)) || (state && area.states?.includes(state)));
};

export const selfDeliveryUnavailableMessage = (sellerName, address = {}) => `${sellerName || 'This store'} does not deliver its own (Self Delivery) items to ${address.pincode || 'this address'}. Remove those items or choose another address.`;

/** Throw 409 when the address is outside the seller's Self Delivery area (or unknown). */
export const assertSelfDeliveryServes = (seller, address, sellerName) => {
  if (selfDeliveryServes(seller, address) !== true) throw httpError(409, selfDeliveryUnavailableMessage(sellerName, address), { code: 'SELF_DELIVERY_NOT_SERVICEABLE' });
};

export const selfDeliveryAreaView = (seller) => ({
  pincodes: seller?.selfDelivery?.pincodes || [],
  states: seller?.selfDelivery?.states || [],
  updatedAt: seller?.selfDelivery?.updatedAt || null,
  configured: selfDeliveryAreaConfigured(seller),
  stateOptions: INDIAN_STATE_NAMES,
});
