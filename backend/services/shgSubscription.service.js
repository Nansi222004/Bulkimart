import SHGSubscription from '../models/SHGSubscription.js';
import SHGStore from '../models/SHGStore.js';
import { VENDOR_STATUS } from '../constants/enums.js';
import { httpError } from '../utils/response.js';

/**
 * The one place "is this SHG store's subscription actually usable right now"
 * gets decided. Never trust a stored `status: 'active'` alone — the sweeper
 * that flips it to `expired` runs on a timer and can lag behind the real
 * clock, so every caller (the access middleware, the inline product-write
 * checks, the /me endpoint) re-derives this from status + endDate.
 */
export const getActiveShgSubscription = async (shgStoreId) => {
  const now = new Date();
  return SHGSubscription.findOne({
    shgStoreId,
    status: 'active',
    endDate: { $gte: now },
  }).sort({ endDate: -1 });
};

/** Throws the same 403 shape the frontend's SubscriptionRequiredModal keys off. */
export const assertActiveShgSubscription = async (shgStoreId) => {
  const sub = await getActiveShgSubscription(shgStoreId);
  if (!sub) {
    throw httpError(403, 'An active subscription is required for this action.', { code: 'SUBSCRIPTION_REQUIRED' });
  }
  return sub;
};

/** Set of shgStoreIds with a currently-usable subscription — for feed filtering. */
export const getSubscribedShgStoreIds = async () => {
  const now = new Date();
  const rows = await SHGSubscription.find({ status: 'active', endDate: { $gte: now } }).select('shgStoreId').lean();
  return new Set(rows.map((r) => String(r.shgStoreId)));
};

/**
 * Stores that may actually take an order right now.
 *
 * Two independent conditions, and both have to hold: the cooperative pays for
 * a live subscription, AND an admin has not suspended them. Subscription
 * alone was the only test before, which meant a group suspended for a quality
 * or compliance problem kept selling for as long as their subscription ran —
 * the suspension showed in the admin panel and nowhere else.
 *
 * Non-destructive, like the subscription rule it extends: no product is
 * deactivated and no stock is touched, so lifting a suspension puts the
 * catalogue back exactly as it was.
 */
export const getOrderableShgStoreIds = async () => {
  const subscribed = await getSubscribedShgStoreIds();
  if (subscribed.size === 0) return subscribed;

  const approved = await SHGStore.find({
    _id: { $in: [...subscribed] },
    status: VENDOR_STATUS.APPROVED,
  }).select('_id').lean();

  return new Set(approved.map((s) => String(s._id)));
};

/**
 * Throws when a cooperative cannot currently sell — used on the write side,
 * where a stale cart or a direct API call would otherwise slip past the feed
 * filter above. Suspension is reported separately from an expired
 * subscription because they are different problems with different fixes.
 */
export const assertShgStoreOrderable = async (shgStoreId, productName = 'This item') => {
  const store = await SHGStore.findById(shgStoreId).select('status groupName').lean();
  if (!store) return;

  if (store.status === VENDOR_STATUS.SUSPENDED) {
    throw httpError(409, `"${productName}" is unavailable — ${store.groupName || 'this cooperative'} is currently suspended.`);
  }
  if (store.status !== VENDOR_STATUS.APPROVED) {
    throw httpError(409, `"${productName}" is not available for ordering right now.`);
  }
};
