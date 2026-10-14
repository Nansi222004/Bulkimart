import express from 'express';
import { getActivePromotionsPublic, getPromotionPublic } from '../controllers/sellerPromotion.controller.js';

const router = express.Router();

// Promotion payment callbacks are retired until seller billing is migrated to
// Razorpay. Public promotion catalogue reads remain available.
router.get('/', getActivePromotionsPublic);
router.get('/:id', getPromotionPublic);

export default router;
