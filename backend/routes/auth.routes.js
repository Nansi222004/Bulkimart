import express from 'express';
import { requestOTP, verifyAndLogin, adminLogin, getMe, requestSellerOTP, verifySellerOTP, requestDeliveryOTP, verifyDeliveryOTP, customerSession, logout } from '../controllers/auth.controller.js';
import { protect } from '../middlewares/auth.middleware.js';
import { otpLimiter, authLimiter, adminLoginLimiter } from '../middlewares/rateLimit.middleware.js';

const router = express.Router();

  router.post('/send-otp', otpLimiter, requestOTP);
router.post('/verify-otp', authLimiter, verifyAndLogin);
router.post('/logout', logout);
router.post('/delivery/send-otp', otpLimiter, requestDeliveryOTP);
router.post('/delivery/verify-otp', authLimiter, verifyDeliveryOTP);
router.post('/seller/send-otp', otpLimiter, requestSellerOTP);
router.post('/seller/verify-otp', authLimiter, verifySellerOTP);
router.post('/admin/login', adminLoginLimiter, adminLogin);
router.get('/me', protect, getMe);
router.post('/customer-session', protect, customerSession);

export default router;
