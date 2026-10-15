import Seller from '../models/Seller.js';
import DeliveryPartner from '../models/DeliveryPartner.js';
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

/** SHG middleware retired */

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

  if (req.tokenRole && req.tokenRole !== 'delivery') {
    return res.status(403).json({ success: false, message: 'Sign in through the Delivery panel to continue.' });
  }

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
