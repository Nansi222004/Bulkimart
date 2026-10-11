import express from 'express';
import {
  getProfile,
  updateProfile,
  getAddresses,
  addAddress,
  updateAddress,
  deleteAddress,
  setDefaultAddress,
  uploadLandmarkImage,
  getWallet,
  updateFCMToken
} from '../controllers/user.controller.js';
import { protect } from '../middlewares/auth.middleware.js';
import { uploadSingle } from '../middlewares/upload.middleware.js';

const router = express.Router();

// Apply auth guard to all user routes
router.use(protect);

router.get('/profile', getProfile);
router.put('/profile', uploadSingle('avatar'), updateProfile);

router.post('/addresses/upload-landmark', uploadSingle('image'), uploadLandmarkImage);

router.route('/addresses')
  .get(getAddresses)
  .post(addAddress);

router.route('/addresses/:addressId')
  .put(updateAddress)
  .delete(deleteAddress);

router.put('/addresses/:addressId/default', setDefaultAddress);

import { getDonationPreference, updateDonationPreference } from '../controllers/donation.controller.js';

router.get('/wallet', getWallet);
router.get('/donation-preference', getDonationPreference);
router.patch('/donation-preference', updateDonationPreference);
router.put('/fcm-token', updateFCMToken);

export default router;
