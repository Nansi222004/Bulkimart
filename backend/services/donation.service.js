import DonationSetting from '../models/DonationSetting.js';
import DonationTransaction, { DONATION_STATUS } from '../models/DonationTransaction.js';
import Order from '../models/Order.js';
import { notifyUser, NOTIFICATION_EVENT } from './notification.service.js';

const TTL_MS = 60_000;
let cache = null;
let cachedAt = 0;

const DEFAULTS = () => ({
  isEnabled: false, // off until an admin actually configures and saves one
  title: 'Donate & Support Transformative Social Work In India',
  subtitle: '',
  knowMoreText: '',
  options: [10, 20, 50, 80, 100],
  allowCustom: true,
  minCustomAmount: 1,
  maxCustomAmount: 10000,
});

export const loadDonationSetting = async () => {
  const row = await DonationSetting.findOne({ isActive: true }).sort({ createdAt: -1 }).lean();
  cache = row
    ? {
        _id: row._id,
        isEnabled: row.isEnabled,
        title: row.title,
        subtitle: row.subtitle,
        knowMoreText: row.knowMoreText,
        options: row.options,
        allowCustom: row.allowCustom,
        minCustomAmount: row.minCustomAmount,
        maxCustomAmount: row.maxCustomAmount,
      }
    : DEFAULTS();
  cachedAt = Date.now();
  return cache;
};

export const invalidateDonationSetting = () => { cache = null; cachedAt = 0; };

export const getDonationSetting = () => {
  if (cache && Date.now() - cachedAt < TTL_MS) return cache;
  return cache || DEFAULTS();
};

/**
 * The one place a client-sent donation amount is ever trusted — and only
 * after checking it against the live admin-configured setting. Mirrors
 * how a coupon's discount is never taken from the request body, only
 * recomputed from the server's own record (see coupon.service.js).
 *
 * Returns `{ amount: 0 }` for "no donation" (feature off, or shopper
 * opted out) — this is not an error, it's the default. Throws only when
 * the shopper opted in with a number that doesn't correspond to anything
 * the admin actually offers right now.
 *
 * @param {number|undefined} requestedAmount — what the client sent
 * @param {boolean} optedIn — whether the shopper chose to donate at all
 * @param {string} [requestedComment] — optional customer donation message/comment
 */
export const resolveDonation = (requestedAmount, optedIn, requestedComment = '') => {
  const setting = getDonationSetting();

  if (!optedIn || !setting.isEnabled) return { amount: 0, title: undefined, comment: '' };

  const amount = Number(requestedAmount);
  if (!Number.isFinite(amount) || amount <= 0) return { amount: 0, title: undefined, comment: '' };

  const isPreset = (setting.options || []).some((o) => Number(o) === amount);
  const isValidCustom = setting.allowCustom
    && amount >= (setting.minCustomAmount ?? 1)
    && amount <= (setting.maxCustomAmount ?? 10000);

  if (!isPreset && !isValidCustom) {
    const err = new Error('That donation amount is not available right now.');
    err.status = 400;
    throw err;
  }

  const cleanComment = String(requestedComment || '').trim();
  if (cleanComment.length > 250) {
    const err = new Error('Donation comment cannot exceed 250 characters.');
    err.status = 400;
    throw err;
  }

  return { amount, title: setting.title, comment: cleanComment };
};

/**
 * Validates a saved user donation preference against the current live DonationSetting.
 *
 * @param {object} [preference] - { enabled: boolean, amount: number }
 * @returns {{ enabled: boolean, amount: number, valid: boolean, reason?: string }}
 */
export const validateDonationPreference = (preference) => {
  const setting = getDonationSetting();
  
  if (!preference || !preference.enabled) {
    return { enabled: false, amount: Number(preference?.amount || 0), valid: true };
  }

  if (!setting || !setting.isEnabled) {
    return {
      enabled: true,
      amount: Number(preference.amount || 0),
      valid: false,
      reason: 'Donations are currently disabled on the platform.'
    };
  }

  const amount = Number(preference.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return {
      enabled: true,
      amount: 0,
      valid: false,
      reason: 'Invalid donation amount.'
    };
  }

  const isPreset = (setting.options || []).some((o) => Number(o) === amount);
  const isValidCustom = setting.allowCustom
    && amount >= (setting.minCustomAmount ?? 1)
    && amount <= (setting.maxCustomAmount ?? 10000);

  if (!isPreset && !isValidCustom) {
    return {
      enabled: true,
      amount,
      valid: false,
      reason: 'Saved donation amount is no longer available.'
    };
  }

  return { enabled: true, amount, valid: true };
};


/**
 * Idempotently records a DonationTransaction once payment for an order is confirmed.
 *
 * @param {object} params
 * @param {object} params.order - Mongoose Order doc or object containing _id, userId, pricing
 * @param {object} params.payment - Mongoose Payment doc or object containing _id, method
 * @param {object} [params.session] - optional Mongo session
 */
export const recordDonationTransaction = async ({ order, payment, session = null }) => {
  const donationAmount = Number(order?.pricing?.donationAmount || 0);
  if (!order || donationAmount <= 0) return null;

  const idempotencyKey = `DONATION:${order._id}`;

  // Check for existing transaction to guarantee idempotency
  let existing = session
    ? await DonationTransaction.findOne({ idempotencyKey }).session(session)
    : await DonationTransaction.findOne({ idempotencyKey });

  if (existing) return existing;

  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  const transactionId = `DON-${timestamp}-${random}`;

  const docData = {
    transactionId,
    orderId: order._id,
    paymentId: payment?._id,
    userId: order.userId,
    amount: donationAmount,
    title: order.pricing?.donationTitle || 'Donate & Support Transformative Social Work In India',
    customerComment: order.pricing?.donationComment || '',
    status: DONATION_STATUS.COLLECTED,
    paymentMethod: payment?.method || order.paymentMethod || 'online',
    collectedAt: new Date(),
    idempotencyKey,
  };

  try {
    let created;
    if (session) {
      const [res] = await DonationTransaction.create([docData], { session });
      created = res;
    } else {
      created = await DonationTransaction.create(docData);
    }

    // Best-effort user notification
    notifyUser(order.userId, {
      title: 'Donation Contribution Recorded',
      message: `Thank you! Your donation of ₹${donationAmount} has been received.`,
      event: NOTIFICATION_EVENT.DONATION_SUCCESS,
      metadata: { donationId: created._id, orderId: order._id, amount: donationAmount },
    }).catch(() => {});

    return created;
  } catch (err) {
    // Duplicate idempotencyKey collision safeguard
    if (err.code === 11000) {
      return session
        ? await DonationTransaction.findOne({ idempotencyKey }).session(session)
        : await DonationTransaction.findOne({ idempotencyKey });
    }
    throw err;
  }
};

/**
 * Scans for existing orders with pricing.donationAmount > 0 that do not yet
 * have a DonationTransaction, and creates a DonationTransaction for each.
 * Ensures historical and newly placed orders without webhook hits are fully tracked.
 */
export const syncMissingDonationsFromOrders = async () => {
  try {
    const ordersWithDonation = await Order.find({ 'pricing.donationAmount': { $gt: 0 } }).lean();
    if (!ordersWithDonation.length) return 0;

    let syncedCount = 0;
    for (const order of ordersWithDonation) {
      const idempotencyKey = `DONATION:${order._id}`;
      const existing = await DonationTransaction.findOne({ idempotencyKey }).lean();
      if (!existing) {
        const timestamp = Date.now().toString(36).toUpperCase();
        const random = Math.random().toString(36).substring(2, 6).toUpperCase();
        const transactionId = `DON-${timestamp}-${random}`;

        await DonationTransaction.create({
          transactionId,
          orderId: order._id,
          paymentId: order.paymentId || undefined,
          userId: order.userId,
          amount: Number(order.pricing?.donationAmount || 0),
          title: order.pricing?.donationTitle || 'Donate & Support Transformative Social Work In India',
          customerComment: order.pricing?.donationComment || '',
          status: DONATION_STATUS.COLLECTED,
          paymentMethod: order.paymentMethod || 'online',
          collectedAt: order.createdAt || new Date(),
          createdAt: order.createdAt || new Date(),
          idempotencyKey,
        });
        syncedCount++;
      }
    }
    return syncedCount;
  } catch (err) {
    console.warn('[DONATION SYNC] Error syncing missing donations:', err.message);
    return 0;
  }
};
