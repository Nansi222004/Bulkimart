/** Canonical Indian mobile identity used by OTP storage and new User records. */
export const normalizePhone = (value) => {
  let digits = String(value ?? '').replace(/\D/g, '');
  if (digits.startsWith('0091') && digits.length === 14) digits = digits.slice(4);
  else if (digits.startsWith('91') && digits.length === 12) digits = digits.slice(2);
  else if (digits.startsWith('0') && digits.length === 11) digits = digits.slice(1);
  return /^\d{10}$/.test(digits) ? digits : '';
};

/**
 * Existing databases can contain pre-normalization values. Looking up the
 * canonical value plus the accepted legacy forms fixes identity detection
 * without rewriting production data or indexes during authentication.
 */
export const phoneLookupCandidates = (value) => {
  const normalized = normalizePhone(value);
  if (!normalized) return [];
  return [...new Set([
    normalized,
    `+91${normalized}`,
    `91${normalized}`,
    `0${normalized}`,
    String(value ?? '').trim(),
  ].filter(Boolean))];
};

export const phoneLookup = (value) => {
  const candidates = phoneLookupCandidates(value);
  return candidates.length === 1 ? candidates[0] : { $in: candidates };
};
