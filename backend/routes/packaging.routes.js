import express from 'express';
import { packagingPaymentReturn } from '../controllers/packaging.controller.js';

const router = express.Router();

/**
 * Where PhonePe sends the seller back — public, same placement as
 * promotion.routes.js's own return URL. The browser returns without the
 * app's Authorization header; the real state is re-checked against PhonePe
 * itself, never trusted from the redirect alone.
 */
router.get('/payment/return/:merchantOrderId', packagingPaymentReturn);

export default router;
