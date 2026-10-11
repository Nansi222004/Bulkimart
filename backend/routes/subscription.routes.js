import express from 'express';
import {
  getMySubscriptions,
  getSubscriptionById,
  getSubscriptionsForSeller,
  getSubscriptionForSeller,
  updateSubscriptionStatus,
  sellerAcceptSubscription,
  sellerDeclineSubscription,
  packSubscriptionDelivery,
} from '../controllers/subscription.controller.js';
import { protect } from '../middlewares/auth.middleware.js';

const router = express.Router();

// A subscription belongs to a signed-in account — every route, including the
// reads, which return an address and a payment.
router.use(protect);

// New subscription creation has been retired. GET remains for historical
// customer records; the remaining seller actions support already-created
// subscriptions that still need to be fulfilled.
router.get('/', getMySubscriptions);

// Registered before "/:id" so the seller list path is explicit and readable.
router.get('/seller', getSubscriptionsForSeller);

router.get('/:id', getSubscriptionById);
router.patch('/:id/status', updateSubscriptionStatus);

/**
 * Vendor-side actions. Ownership is checked inside each controller
 * (requireOwningVendor) against the authenticated vendor, not this route's
 * middleware — same shape as every other vendor-scoped write in this app.
 *
 * The accept/decline/pack routes keep their original "seller-" names and
 * serve BOTH a Seller and an SHG store: the subscription itself says which
 * kind of vendor owns it, so there is one implementation rather than two
 * that would drift. Only the read-views differ per vendor, because each
 * panel loads its own list.
 */
router.get('/:id/seller-view', getSubscriptionForSeller);
router.post('/:id/seller-accept', sellerAcceptSubscription);
router.post('/:id/seller-decline', sellerDeclineSubscription);
router.post('/:id/deliveries/:entryId/pack', packSubscriptionDelivery);

export default router;
