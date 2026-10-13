export const normalizePhoneInput = (value) => {
  let digits = String(value ?? '').replace(/\D/g, '');
  if (digits.startsWith('0091') && digits.length >= 14) digits = digits.slice(4);
  else if (digits.startsWith('91') && digits.length >= 12) digits = digits.slice(2);
  else if (digits.startsWith('0') && digits.length >= 11) digits = digits.slice(1);
  return digits.slice(0, 10);
};

export const normalizeSellerIntent = (value) => (value === 'register' ? 'register' : 'login');

/** Produces a JSON-safe payload even when a React click event is passed by mistake. */
export const sellerOtpPayload = (phone, intent, otp) => ({
  phone: normalizePhoneInput(phone),
  ...(otp === undefined ? {} : { otp: String(otp) }),
  intent: normalizeSellerIntent(intent),
});

export const safeErrorMessage = (error, fallback) => (
  typeof error?.message === 'string' && error.message.trim() ? error.message : fallback
);
