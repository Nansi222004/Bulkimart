import { api } from './apiClient';
import { sellerOtpPayload } from '../utils/phone';

// Contract: backend/controllers/auth.controller.js (requestSellerOTP / verifySellerOTP / getMe / logout).

export const sendSellerOtp = (phone, intent) =>
  api.post('/api/auth/seller/send-otp', sellerOtpPayload(phone, intent), { skipAuth: true });

// Returns { success, token, sessionRole: 'seller', user, sellerState }.
// Note: intent 'register' creates a User record on the server if the phone is new.
export const verifySellerOtp = (phone, otp, intent) =>
  api.post('/api/auth/seller/verify-otp', sellerOtpPayload(phone, intent, otp), { skipAuth: true });

export const getIdentity = () => api.get('/api/auth/me');

export const logoutSession = (token) =>
  api.post('/api/auth/logout', null, {
    skipAuth: true,
    skipUnauthorizedHandler: true,
    timeout: 5000,
    headers: { Authorization: `Bearer ${token}` },
  });
