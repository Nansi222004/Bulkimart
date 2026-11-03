import { api } from './apiClient';
import { sellerOtpPayload } from '../utils/phone';
import { getAppHash } from '../utils/otpAutofill';

// Contract: backend/controllers/auth.controller.js (requestSellerOTP / verifySellerOTP / getMe / logout).

// Returns { success, message, otpLength, expiresIn, resendAfter, sellerState?, otp? (mock only) }.
// appHash lets the server end the SMS with this app's SMS Retriever hash (OTP autofill).
export const sendSellerOtp = async (phone, intent) => {
  const appHash = await getAppHash();
  return api.post('/api/auth/seller/send-otp', { ...sellerOtpPayload(phone, intent), ...(appHash ? { appHash } : {}) }, { skipAuth: true });
};

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
