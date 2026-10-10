import express from 'express';
import { getMyReferral, getMyReferralsList, validateCode } from '../controllers/referral.controller.js';
import { protect } from '../middlewares/auth.middleware.js';

const router = express.Router();

// Public — the referee doesn't have an account yet at this point.
router.post('/validate', validateCode);

router.use(protect);
router.get('/me', getMyReferral);
router.get('/list', getMyReferralsList);

export default router;
