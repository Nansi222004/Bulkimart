import { isMockIntegrationEnabled } from '../config/runtime.js';

// In-memory OTP store: Map<phone, { otp, expiresAt }>
const otpStore = new Map();

export const sendOTP = async (phone) => {
  // Generate 4 digit OTP
  const isMock = isMockIntegrationEnabled('OTP_MODE');
  const otp = isMock ? '1234' : Math.floor(1000 + Math.random() * 9000).toString();
  const expiresAt = Date.now() + (parseInt(process.env.OTP_TTL_MINUTES || '5') * 60 * 1000);
  otpStore.set(phone, { otp, expiresAt });

  return { success: true, ...(isMock ? { otp } : {}) };
};

export const verifyOTP = (phone, enteredOtp) => {
  const input = enteredOtp ? enteredOtp.toString().trim() : '';

  const isMock = isMockIntegrationEnabled('OTP_MODE');

  // Fixed OTPs are accepted only in an authorized mock environment.
  if (isMock && (input === '1234' || input === '123456')) {
    return { valid: true };
  }

  const record = otpStore.get(phone);

  if (!record) {
    return { valid: false, message: 'OTP not found. Please request again.' };
  }

  if (Date.now() > record.expiresAt) {
    otpStore.delete(phone);
    return { valid: false, message: 'OTP expired.' };
  }

  if (record.otp !== input) {
    return { valid: false, message: 'Invalid OTP.' };
  }

  otpStore.delete(phone);
  return { valid: true };
};
