import Seller from '../models/Seller.js';
import SHGStore from '../models/SHGStore.js';
import DeliveryPartner from '../models/DeliveryPartner.js';
import { getActiveShgSubscription } from '../services/shgSubscription.service.js';
import { asyncHandler } from './error.middleware.js';
import { VENDOR_STATUS } from '../constants/enums.js';

/**
 * Gate for the SELLER PANEL (dashboard, orders, inventory, earnings, promotions).
 *
 * Registering is not the same as being allowed in. A seller may complete all five
 * onboarding steps and submit, but until an admin approves them they must not
 * reach any panel feature — they only get to see their own application status.
 *
 * Onboarding routes (/start, /step/*, /submit, /me) deliberately do NOT use this.
 *
 * Responds with a machine-readable `vendorStatus` so the app can show the right
 * screen ("under review", "rejected — here's why") instead of a generic error.
 */
export const requireApprovedSeller = asyncHandler(async (req, res, next) => {
  if (req.userType === 'admin') return next();

  const seller = await Seller.findOne({ userId: req.user._id });

  if (!seller) {
    return res.status(403).json({
      success: false,
      data: null,
      message: 'You have not registered as a seller yet.',
      meta: { vendorStatus: 'none' },
    });
  }

  if (seller.status !== VENDOR_STATUS.APPROVED) {
    const messages = {
      [VENDOR_STATUS.INCOMPLETE]: 'Please complete your seller registration first.',
      [VENDOR_STATUS.PENDING]: 'Your seller application is awaiting admin approval.',
      [VENDOR_STATUS.UNDER_REVIEW]: 'Your seller application is currently under review.',
      [VENDOR_STATUS.REJECTED]: 'Your seller application was rejected.',
      [VENDOR_STATUS.SUSPENDED]: 'Your seller account has been suspended.',
    };

    return res.status(403).json({
      success: false,
      data: null,
      message: messages[seller.status] || 'Seller account is not approved.',
      meta: {
        vendorStatus: seller.status,
        onboardingStep: seller.onboardingStep,
        rejectionReason: seller.rejectionReason,
      },
    });
  }

  req.seller = seller; // downstream handlers reuse this instead of re-querying
  next();
});

/** Same gate for the SHG vendor panel. */
export const requireApprovedSHG = asyncHandler(async (req, res, next) => {
  if (req.userType === 'admin') return next();

  const store = await SHGStore.findOne({ userId: req.user._id });

  if (!store) {
    return res.status(403).json({
      success: false,
      data: null,
      message: 'You have not registered an SHG store yet.',
      meta: { vendorStatus: 'none' },
    });
  }

  if (store.status !== VENDOR_STATUS.APPROVED) {
    const messages = {
      [VENDOR_STATUS.INCOMPLETE]: 'Please complete your SHG registration first.',
      [VENDOR_STATUS.PENDING]: 'Your SHG application is awaiting admin approval.',
      [VENDOR_STATUS.UNDER_REVIEW]: 'Your SHG application is currently under review.',
      [VENDOR_STATUS.REJECTED]: 'Your SHG application was rejected.',
    };

    return res.status(403).json({
      success: false,
      data: null,
      message: messages[store.status] || 'SHG account is not approved.',
      meta: {
        vendorStatus: store.status,
        onboardingStep: store.onboardingStep,
        rejectionReason: store.rejectionReason,
      },
    });
  }

  req.shgStore = store;
  next();
});

/**
 * Gate for SHG business-write operations (product create/edit/delete,
 * stock, channel toggles) that require a PAID, currently-unexpired
 * subscription — a step beyond mere admin approval.
 *
 * Always run AFTER `requireApprovedSHG` (reuses `req.shgStore`, never
 * re-queries it). Effective access is deliberately status + endDate, not
 * status alone — a stale "active" row past its endDate must still be
 * denied even if the expiry sweeper hasn't ticked yet (see
 * shgSubscriptionSweeper.service.js: the sweeper only refreshes the cached
 * `status` for display/admin purposes, this check is the real gate).
 *
 * NOT applied to: SHG order-status updates (existing order processing
 * continues regardless of subscription state) or member add/remove
 * (roster admin, not billed business activity) — both left ungated on
 * purpose, per the business requirement.
 */
export const requireActiveSHGSubscription = asyncHandler(async (req, res, next) => {
  if (req.userType === 'admin') return next();

  const store = req.shgStore;
  const sub = await getActiveShgSubscription(store._id);

  if (!sub) {
    return res.status(403).json({
      success: false,
      data: null,
      message: 'An active subscription is required for this action.',
      meta: { code: 'SUBSCRIPTION_REQUIRED' },
    });
  }

  req.shgSubscription = sub;
  next();
});

/**
 * Gate for the RIDER APP (availability, assignments, pickups, earnings).
 *
 * Registering is not the same as being allowed to ride. A partner may finish
 * every step and submit, but until an admin has checked the licence and Aadhaar
 * they must not receive a single assignment — they would be carrying customer
 * goods and, on COD orders, customer cash.
 *
 * Onboarding routes (/start, /step/*, /submit, /me) deliberately skip this.
 */
export const requireApprovedPartner = asyncHandler(async (req, res, next) => {
  if (req.userType === 'admin') return next();

  const partner = await DeliveryPartner.findOne({ userId: req.user._id });

  if (!partner) {
    return res.status(403).json({
      success: false,
      data: null,
      message: 'You have not registered as a delivery partner yet.',
      meta: { vendorStatus: 'none' },
    });
  }

  if (partner.status !== VENDOR_STATUS.APPROVED) {
    const messages = {
      [VENDOR_STATUS.INCOMPLETE]: 'Please complete your rider registration first.',
      [VENDOR_STATUS.PENDING]: 'Your documents are being verified by our team.',
      [VENDOR_STATUS.UNDER_REVIEW]: 'Your application is currently under review.',
      [VENDOR_STATUS.REJECTED]: 'Your rider application was rejected.',
      [VENDOR_STATUS.SUSPENDED]: 'Your rider account has been suspended.',
    };

    return res.status(403).json({
      success: false,
      data: null,
      message: messages[partner.status] || 'Rider account is not approved.',
      meta: {
        vendorStatus: partner.status,
        onboardingStep: partner.onboardingStep,
        rejectionReason: partner.rejectionReason,
      },
    });
  }

  req.partner = partner;   // downstream handlers reuse this instead of re-querying
  next();
});
