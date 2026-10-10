import express from 'express';
import {
  getDonationSettingPublic,
  getCustomerDonations,
  getDonationPreference,
  updateDonationPreference
} from '../controllers/donation.controller.js';
import { protect } from '../middlewares/auth.middleware.js';

const router = express.Router();

router.get('/', getDonationSettingPublic);
router.get('/my-donations', protect, getCustomerDonations);
router.get('/preference', protect, getDonationPreference);
router.patch('/preference', protect, updateDonationPreference);

export default router;

