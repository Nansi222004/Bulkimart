import express from 'express';
import { validateCoupon, getAvailableCoupons } from '../controllers/coupon.controller.js';
import { protect } from '../middlewares/auth.middleware.js';

const router = express.Router();

// Shopper-facing. A quote depends on the signed-in user's cart and history,
// so both of these need a session.
router.use(protect);

router.post('/validate', validateCoupon);
router.get('/available', getAvailableCoupons);

export default router;
