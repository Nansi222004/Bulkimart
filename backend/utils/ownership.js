import Seller from '../models/Seller.js';
import SHGStore from '../models/SHGStore.js';
import { ROLE, VENDOR_STATUS } from '../constants/enums.js';
import { httpError } from './response.js';

/**
 * Resolve the caller's vendor profile (SHG takes precedence over Seller).
 *
 * Returns { kind, doc, filter } where `filter` is a ready-to-use Mongo query
 * fragment for scoping Product/Order lookups to this vendor.
 *
 * Replaces the same block copy-pasted four times in product.controller.js.
 */
export const resolveVendor = async (user) => {
  if (user?.roles?.includes(ROLE.SHG)) {
    const doc = await SHGStore.findOne({ userId: user._id });
    if (doc) return { kind: ROLE.SHG, doc, filter: { shgStoreId: doc._id } };
  }

  if (user?.roles?.includes(ROLE.SELLER)) {
    const doc = await Seller.findOne({ userId: user._id });
    if (doc) return { kind: ROLE.SELLER, doc, filter: { sellerId: doc._id } };
  }

  return null;
};

/** Same as resolveVendor but throws 404/403 instead of returning null. */
export const requireApprovedVendor = async (user) => {
  const vendor = await resolveVendor(user);
  if (!vendor) throw httpError(404, 'Vendor profile not found');
  if (vendor.doc.status !== VENDOR_STATUS.APPROVED) {
    throw httpError(403, 'Vendor account is not approved yet');
  }
  return vendor;
};

/**
 * True when the caller owns the product, or is an admin.
 * @param {object} product  a Product document
 * @param {object} req      the express request (needs req.user, req.userType)
 */
export const canManageProduct = async (product, req) => {
  if (req.userType === 'admin') return true;

  const vendor = await resolveVendor(req.user);
  if (!vendor) return false;

  if (vendor.kind === ROLE.SHG) {
    return product.shgStoreId?.toString() === vendor.doc._id.toString();
  }
  return product.sellerId?.toString() === vendor.doc._id.toString();
};

/**
 * Strip a mixed-vendor order down to only the items belonging to this vendor.
 * Prevents seller A from reading what seller B sold to the same buyer.
 */
export const scopeOrderToVendor = (order, vendor) => {
  const key = vendor.kind === ROLE.SHG ? 'shgStoreId' : 'sellerId';
  const mine = order.items.filter((i) => i[key]?.toString() === vendor.doc._id.toString());
  const subtotal = mine.reduce((sum, i) => sum + i.price * i.qty, 0);

  return {
    _id: order._id,
    orderNo: order.orderNo,
    type: order.type,
    status: order.status,
    createdAt: order.createdAt,
    shippingAddress: order.shippingAddress,
    paymentMethod: order.paymentMethod,
    timeline: order.timeline,
    items: mine,
    vendorSubtotal: Number(subtotal.toFixed(2)),
  };
};
