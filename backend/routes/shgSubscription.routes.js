import express from 'express';
import {
  getActivePlans, getMySubscription, purchaseSubscription,
  subscriptionPaymentReturn, getSubscriptionPaymentStatus,
} from '../controllers/shgSubscription.controller.js';
import { protect } from '../middlewares/auth.middleware.js';
import { requireApprovedSHG } from '../middlewares/vendor.middleware.js';

const router = express.Router();

// PhonePe's redirect lands here with no Authorization header — must stay
// public, exactly like payment.routes.js's own /return/:merchantOrderId.
router.get('/return/:merchantOrderId', subscriptionPaymentReturn);

router.use(protect, requireApprovedSHG);

router.get('/plans', getActivePlans);
router.get('/me', getMySubscription);
router.post('/purchase', purchaseSubscription);
router.get('/payment-status/:merchantOrderId', getSubscriptionPaymentStatus);

export default router;
