import express from 'express';
import {
  initiatePayment, razorpayWebhook, verifyRazorpayPayment, getPaymentStatus,
} from '../controllers/payment.controller.js';
import { protect } from '../middlewares/auth.middleware.js';

const router = express.Router();

router.post('/razorpay/webhook', razorpayWebhook);

// Everything below belongs to a signed-in shopper.
router.use(protect);
router.post('/initiate', initiatePayment);
router.post('/razorpay/verify', verifyRazorpayPayment);
router.get('/:orderId/status', getPaymentStatus);

export default router;
