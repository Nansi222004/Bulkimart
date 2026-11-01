// Mirrors saveDeliverySession() validation in frontend/src/utils/deliverySession.js.
export const APPLICANT_STATUSES = ['incomplete', 'pending', 'under_review', 'rejected', 'suspended'];
const ALLOWED_ROLES = ['buyer', 'seller', 'shg', 'delivery'];

/**
 * A verify-otp response is accepted only when it is a 'delivery' session with a token and user,
 * every role is a known one, and the user either holds the delivery role or is an applicant.
 */
export function isValidDeliveryLogin(body, deliveryStatus) {
  const roles = body?.user?.roles;
  const applicant = APPLICANT_STATUSES.includes(deliveryStatus);
  return Boolean(body?.success && typeof body.token === 'string' && body.token && body.user?._id && body.sessionRole === 'delivery'
    && Array.isArray(roles) && roles.length && roles.every((r) => ALLOWED_ROLES.includes(r))
    && (roles.includes('delivery') || applicant));
}
