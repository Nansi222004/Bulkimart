import express from 'express';
import {
  createSubscription,
  getMySubscriptions,
  getSubscriptionById,
  getSubscriptionsForSeller,
  getSubscriptionForSeller,
  getSubscriptionsForShgStore,
  getSubscriptionForShgStore,
  updateSubscriptionStatus,
  calculateSubscriptionBasket,
  sellerAcceptSubscription,
  sellerDeclineSubscription,
  packSubscriptionDelivery,
} from '../controllers/subscription.controller.js';
import { protect } from '../middlewares/auth.middleware.js';

const router = express.Router();

// A subscription belongs to a signed-in account — every route, including the
// reads, which return an address and a payment.
router.use(protect);

router.post('/basket', calculateSubscriptionBasket);

router.route('/')
  .post(createSubscription)
  .get(getMySubscriptions);

// Registered before "/:id" — Express matches routes in registration order,
// and "/:id" would otherwise swallow "/seller"/"/shg" as if they were ids.
router.get('/seller', getSubscriptionsForSeller);
router.get('/shg', getSubscriptionsForShgStore);

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
router.get('/:id/shg-view', getSubscriptionForShgStore);
router.post('/:id/seller-accept', sellerAcceptSubscription);
router.post('/:id/seller-decline', sellerDeclineSubscription);
router.post('/:id/deliveries/:entryId/pack', packSubscriptionDelivery);

export default router;
