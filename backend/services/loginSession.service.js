import DeliveryPartner from '../models/DeliveryPartner.js';
import { httpError } from '../utils/response.js';
import { VENDOR_STATUSES } from '../constants/enums.js';

// Membership comes from live records, never from a role selected in the browser.
export async function resolveLoginSession(user, claimedRole) {
  if (!Array.isArray(user.roles) || !user.roles.length || user.roles.some(role => !['buyer', 'seller', 'shg', 'delivery'].includes(role))) {
    throw httpError(403, 'Account has no supported login role. Please contact support.');
  }
  const role = claimedRole || (user.roles.includes('delivery') ? 'delivery' : user.roles.includes('buyer') ? 'buyer' : null);
  if (role === 'delivery') {
    const partner = await DeliveryPartner.findOne({ userId: user._id });
    if (!partner || !VENDOR_STATUSES.includes(partner.status) || (partner.status === 'approved' && !user.roles.includes('delivery'))) {
      throw httpError(403, 'Delivery membership could not be verified. Please sign in again or contact support.');
    }
    return { sessionRole: role, dashboard: '/delivery/dashboard', deliveryState: { status: partner.status, onboardingStep: partner.onboardingStep } };
  }
  if (!['buyer', 'seller'].includes(role) || !user.roles.includes(role)) {
    throw httpError(403, 'Account role is not authorized for this session. Please sign in again.');
  }
  return { sessionRole: role, dashboard: role === 'seller' ? '/seller' : '/' };
}
