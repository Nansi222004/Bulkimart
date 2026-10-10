import express from 'express';
import {
  initiatePayment, phonepeWebhook, paymentReturn, getPaymentStatus, mockSetState,
} from '../controllers/payment.controller.js';
import { protect } from '../middlewares/auth.middleware.js';

const router = express.Router();

// PhonePe calls these — no session exists, so they must NOT sit behind protect.
router.post('/webhook', phonepeWebhook);
router.get('/return/:merchantOrderId', paymentReturn);
router.post('/mock-set-state', mockSetState);

// Everything below belongs to a signed-in shopper.
router.use(protect);
router.post('/initiate', initiatePayment);
router.get('/:orderId/status', getPaymentStatus);

export default router;
