// Port of frontend/src/modules/Seller/utils/sellerAuth.js. Keep the two identical.
export const normalizePhoneInput = (value) => {
  let digits = String(value ?? '').replace(/\D/g, '');
  if (digits.startsWith('0091') && digits.length >= 14) digits = digits.slice(4);
  else if (digits.startsWith('91') && digits.length >= 12) digits = digits.slice(2);
  else if (digits.startsWith('0') && digits.length >= 11) digits = digits.slice(1);
  return digits.slice(0, 10);
};

export const normalizeSellerIntent = (value) => (value === 'register' ? 'register' : 'login');

export const sellerOtpPayload = (phone, intent, otp) => ({
  phone: normalizePhoneInput(phone),
  ...(otp === undefined ? {} : { otp: String(otp) }),
  intent: normalizeSellerIntent(intent),
});

export const isValidIndianMobile = (digits) => /^[6-9]\d{9}$/.test(digits);
