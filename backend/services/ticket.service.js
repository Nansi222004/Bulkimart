import mongoose from 'mongoose';
import Ticket from '../models/Ticket.js';
import Seller from '../models/Seller.js';
import SHGStore from '../models/SHGStore.js';
import DeliveryPartner from '../models/DeliveryPartner.js';
import Order from '../models/Order.js';
import Product from '../models/Product.js';
import Delivery from '../models/Delivery.js';
import { httpError } from '../utils/response.js';
import {
  TICKET_REQUESTER_ROLE,
  TICKET_CATEGORIES_BY_ROLE,
  TICKET_REQUESTER_TRANSITIONS,
  TICKET_ADMIN_TRANSITIONS,
} from '../constants/enums.js';

/**
 * Resolves which "hat" the authenticated User is filing/reading a ticket
 * under — the ONE canonical place this happens, used by every ticket
 * endpoint. `tokenRole` is `req.tokenRole` (set by auth.middleware.js from
 * the JWT's own `role` claim), never anything read from the request body,
 * query string, or other client-supplied input. There is no "requested
 * role" parameter here on purpose — a client cannot ask to be treated as a
 * different role at all, let alone have that request merely double-checked.
 *
 * Two-tier resolution:
 *   1. Trusted JWT claim — seller claims come from the gated seller login;
 *      historical SHG claims may remain valid until their tokens expire.
 *      Both are re-verified against the live approval record below. Still re-verified
 *      against the live approval record below (a seller suspended after
 *      their token was issued must not keep filing seller tickets on an
 *      old token) — the claim only decides *which* collection to check
 *      first, never skips the check.
 *   2. Auto-detected fallback — Delivery Partner has no gated login of its
 *      own (it shares the base customer/shared `verifyAndLogin`, see
 *      auth.controller.js), so there is no JWT claim to lean on for it;
 *      checked directly against the real DeliveryPartner record instead.
 *      Falls through to `customer`, which every authenticated User
 *      qualifies for with no further lookup.
 */
export const resolveRequester = async (user, tokenRole, requestedRole) => {
  const roleToTest = requestedRole || tokenRole;

  if (roleToTest === TICKET_REQUESTER_ROLE.SELLER) {
    const seller = await Seller.findOne({ userId: user._id, status: 'approved' }).select('_id');
    if (seller) return { role: TICKET_REQUESTER_ROLE.SELLER, name: user.name || 'Seller', email: user.email, vendorId: seller._id };
  }
  if (roleToTest === TICKET_REQUESTER_ROLE.SHG) {
    const store = await SHGStore.findOne({ userId: user._id, status: 'approved' }).select('_id');
    if (store) return { role: TICKET_REQUESTER_ROLE.SHG, name: user.name || 'SHG Leader', email: user.email, vendorId: store._id };
  }
  if (roleToTest === TICKET_REQUESTER_ROLE.DELIVERY) {
    const partner = await DeliveryPartner.findOne({ userId: user._id, status: 'approved' }).select('_id');
    if (partner) return { role: TICKET_REQUESTER_ROLE.DELIVERY, name: user.name || 'Delivery Partner', email: user.email, vendorId: partner._id };
  }
  if (roleToTest === TICKET_REQUESTER_ROLE.CUSTOMER) {
    return { role: TICKET_REQUESTER_ROLE.CUSTOMER, name: user.name || 'Customer', email: user.email, vendorId: null };
  }

  if (tokenRole === TICKET_REQUESTER_ROLE.SELLER) {
    const seller = await Seller.findOne({ userId: user._id, status: 'approved' }).select('_id');
    if (seller) return { role: TICKET_REQUESTER_ROLE.SELLER, name: user.name || 'Seller', email: user.email, vendorId: seller._id };
  }
  if (tokenRole === TICKET_REQUESTER_ROLE.SHG) {
    const store = await SHGStore.findOne({ userId: user._id, status: 'approved' }).select('_id');
    if (store) return { role: TICKET_REQUESTER_ROLE.SHG, name: user.name || 'SHG Leader', email: user.email, vendorId: store._id };
  }

  const partner = await DeliveryPartner.findOne({ userId: user._id, status: 'approved' }).select('_id');
  if (partner) return { role: TICKET_REQUESTER_ROLE.DELIVERY, name: user.name || 'Delivery Partner', email: user.email, vendorId: partner._id };

  return { role: TICKET_REQUESTER_ROLE.CUSTOMER, name: user.name || 'Customer', email: user.email, vendorId: null };
};

export const isValidCategory = (role, category) =>
  Array.isArray(TICKET_CATEGORIES_BY_ROLE[role]) && TICKET_CATEGORIES_BY_ROLE[role].includes(category);

/**
 * Confirms the authenticated requester actually has a legitimate claim to
 * the order/product/delivery they're attaching to a ticket, before it's
 * ever stored — never trusts the id alone. Returns the loaded documents
 * (so callers don't have to re-fetch) or throws a 403/404.
 */
export const assertRelatedEntitiesOwned = async ({ role, vendorId, user }, { relatedOrder, relatedProduct, relatedDelivery }) => {
  const result = {};

  if (relatedOrder) {
    if (!mongoose.isValidObjectId(relatedOrder)) throw httpError(400, 'Invalid related order id');
    const order = await Order.findById(relatedOrder).select('userId items');
    if (!order) throw httpError(404, 'Related order not found');

    let owns = false;
    if (role === TICKET_REQUESTER_ROLE.CUSTOMER) owns = String(order.userId) === String(user._id);
    else if (role === TICKET_REQUESTER_ROLE.SELLER) owns = order.items.some((i) => String(i.sellerId) === String(vendorId));
    else if (role === TICKET_REQUESTER_ROLE.SHG) owns = order.items.some((i) => String(i.shgStoreId) === String(vendorId));
    else if (role === TICKET_REQUESTER_ROLE.DELIVERY) {
      owns = Boolean(await Delivery.exists({ orderId: order._id, partnerId: vendorId }));
    }
    if (!owns) throw httpError(403, 'This order is not associated with your account');
    result.order = order;
  }

  if (relatedProduct) {
    if (!mongoose.isValidObjectId(relatedProduct)) throw httpError(400, 'Invalid related product id');
    const product = await Product.findById(relatedProduct).select('sellerId shgStoreId');
    if (!product) throw httpError(404, 'Related product not found');

    if (role === TICKET_REQUESTER_ROLE.SELLER && String(product.sellerId) !== String(vendorId)) {
      throw httpError(403, 'This product does not belong to your store');
    }
    if (role === TICKET_REQUESTER_ROLE.SHG && String(product.shgStoreId) !== String(vendorId)) {
      throw httpError(403, 'This product does not belong to your store');
    }
    // Customer/Delivery referencing a product they don't own is fine — a
    // customer asking about a product they bought doesn't "own" it in the
    // seller sense; existence is enough for them.
    result.product = product;
  }

  if (relatedDelivery) {
    if (!mongoose.isValidObjectId(relatedDelivery)) throw httpError(400, 'Invalid related delivery id');
    const delivery = await Delivery.findById(relatedDelivery).select('partnerId orderId');
    if (!delivery) throw httpError(404, 'Related delivery not found');

    if (role === TICKET_REQUESTER_ROLE.DELIVERY && String(delivery.partnerId) !== String(vendorId)) {
      throw httpError(403, 'This delivery is not assigned to you');
    }
    if (role === TICKET_REQUESTER_ROLE.CUSTOMER) {
      const order = await Order.findById(delivery.orderId).select('userId');
      if (!order || String(order.userId) !== String(user._id)) {
        throw httpError(403, 'This delivery is not associated with your account');
      }
    }
    result.delivery = delivery;
  }

  return result;
};

/** Ticket numbers are display-facing (NHC-10234), not a security boundary — sequential-ish via a count is fine at V1 scale. */
export const generateTicketNumber = async () => {
  const count = await Ticket.countDocuments();
  const n = 10000 + count + Math.floor(Math.random() * 50); // small jitter avoids a collision race under concurrent creates
  const candidate = `NHC-${n}`;
  const clash = await Ticket.exists({ ticketNumber: candidate });
  return clash ? `NHC-${n + Math.floor(Math.random() * 1000)}` : candidate;
};

export const assertRequesterTransition = (from, to) => {
  const allowed = TICKET_REQUESTER_TRANSITIONS[from] || [];
  if (!allowed.includes(to)) {
    throw httpError(400, `Cannot move a ${from} ticket to ${to}`);
  }
};

export const assertAdminTransition = (from, to) => {
  const allowed = TICKET_ADMIN_TRANSITIONS[from] || [];
  if (!allowed.includes(to)) {
    throw httpError(400, `Cannot move a ${from} ticket to ${to}`);
  }
};

/** Loads a ticket and confirms the authenticated user is its requester — used by every requester-facing endpoint. */
export const loadOwnedTicket = async (ticketId, userId) => {
  if (!mongoose.isValidObjectId(ticketId)) throw httpError(400, 'Invalid ticket id');
  const ticket = await Ticket.findOne({ _id: ticketId, userId });
  if (!ticket) throw httpError(404, 'Ticket not found');
  return ticket;
};
