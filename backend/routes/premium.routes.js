import express from 'express';
import {
  getMyPremiumMembership,
  premiumPaymentReturn,
  getPremiumPaymentStatus,
} from '../controllers/premium.controller.js';
import { protect } from '../middlewares/auth.middleware.js';

const router = express.Router();

/**
 * Where PhonePe sends the customer back — before `protect`, because the
 * browser returns from the gateway without the app's Authorization header.
 * It reveals nothing: the merchantOrderId only resolves a payment whose real
 * state is then read from PhonePe, and it redirects into the app.
 * Kept public because the payment provider returns without an Authorization header.
 */
router.get('/return/:merchantOrderId', premiumPaymentReturn);

// Everything below belongs to a signed-in customer.
router.use(protect);

// Plan discovery and purchase are retired with new product subscriptions.
// Keep membership reads and payment-return/status handlers for history and
// payment attempts that were already in flight at deployment.
router.get('/me', getMyPremiumMembership);
router.get('/payment-status/:merchantOrderId', getPremiumPaymentStatus);

export default router;
