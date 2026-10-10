import express from 'express';
import {
  getMyBaskets,
  upsertBasketItem,
  clearBasket,
} from '../controllers/subscriptionBasket.controller.js';
import { protect } from '../middlewares/auth.middleware.js';

const router = express.Router();

// A basket belongs to a signed-in account — there is no guest basket.
router.use(protect);

router.get('/', getMyBaskets);
router.post('/items', upsertBasketItem);
router.delete('/:sellerId', clearBasket);

export default router;
