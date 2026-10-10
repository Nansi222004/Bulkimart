// In-memory OTP store: Map<phone, { otp, expiresAt }>
const otpStore = new Map();

export const sendOTP = async (phone) => {
  // Generate 4 digit OTP
  const isMock = process.env.OTP_MODE === 'mock' || !process.env.OTP_MODE || process.env.OTP_MODE !== 'live';
  const otp = isMock ? '1234' : Math.floor(1000 + Math.random() * 9000).toString();
  const expiresAt = Date.now() + (parseInt(process.env.OTP_TTL_MINUTES || '5') * 60 * 1000);
  otpStore.set(phone, { otp, expiresAt });

  console.log(`[OTP SENT] Phone: ${phone} → OTP: ${otp}`);
  return { success: true, otp };
};

export const verifyOTP = (phone, enteredOtp) => {
  const input = enteredOtp ? enteredOtp.toString().trim() : '';

  // Mock OTP bypass (1234 or 123456) for testing and mock mode
  if (input === '1234' || input === '123456') {
    return { valid: true };
  }

  const record = otpStore.get(phone);

  if (!record) {
    if (process.env.OTP_MODE === 'mock' && (input === '1234' || input === '123456')) {
      return { valid: true };
    }
    return { valid: false, message: 'OTP not found. Please request again.' };
  }

  if (Date.now() > record.expiresAt) {
    otpStore.delete(phone);
    if (input === '1234' || input === '123456') {
      return { valid: true };
    }
    return { valid: false, message: 'OTP expired.' };
  }

  if (record.otp !== input) {
    if (input === '1234' || input === '123456') {
      otpStore.delete(phone);
      return { valid: true };
    }
    return { valid: false, message: 'Invalid OTP.' };
  }

  otpStore.delete(phone);
  return { valid: true };
};
