import express from 'express';
import { getMyWallet, getMyCoinHistory, getPublicCoinConfig } from '../controllers/coin.controller.js';
import { protect } from '../middlewares/auth.middleware.js';

const router = express.Router();

router.use(protect);

router.get('/', getMyWallet);
router.get('/history', getMyCoinHistory);
router.get('/config', getPublicCoinConfig);

export default router;
