import express from 'express';
import {
  getActivePromotionsPublic, getPromotionPublic, promotionPaymentReturn,
} from '../controllers/sellerPromotion.controller.js';

const router = express.Router();

/**
 * Where PhonePe sends the seller back — before any auth, same placement
 * premium.routes.js uses for its own return URL: the browser returns
 * without the app's Authorization header, and the real state is re-checked
 * against PhonePe itself, never trusted from the redirect alone.
 */
router.get('/payment/return/:merchantOrderId', promotionPaymentReturn);

router.get('/', getActivePromotionsPublic);
router.get('/:id', getPromotionPublic);

export default router;
