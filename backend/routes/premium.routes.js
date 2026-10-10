import express from 'express';
import {
  getActivePremiumPlans,
  getMyPremiumMembership,
  purchasePremium,
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
 * Same placement shgSubscription.routes.js uses for its own return URL.
 */
router.get('/return/:merchantOrderId', premiumPaymentReturn);

// Everything below belongs to a signed-in customer.
router.use(protect);

router.get('/plans', getActivePremiumPlans);
router.get('/me', getMyPremiumMembership);
router.post('/purchase', purchasePremium);
router.get('/payment-status/:merchantOrderId', getPremiumPaymentStatus);

export default router;
