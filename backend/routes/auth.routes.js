import express from 'express';
import { requestOTP, verifyAndLogin, adminLogin, getMe, requestSellerOTP, verifySellerOTP, logout } from '../controllers/auth.controller.js';
import { protect } from '../middlewares/auth.middleware.js';
import { otpLimiter, authLimiter, adminLoginLimiter } from '../middlewares/rateLimit.middleware.js';

const router = express.Router();

router.post('/send-otp', requestOTP);
router.post('/verify-otp', verifyAndLogin);
router.post('/logout', logout);
router.post('/seller/send-otp', requestSellerOTP);
router.post('/seller/verify-otp', verifySellerOTP);
router.post('/admin/login', adminLoginLimiter, adminLogin);
router.get('/me', protect, getMe);

export default router;
