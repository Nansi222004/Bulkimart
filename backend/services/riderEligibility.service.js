import { distanceKm } from '../utils/geo.js';
import { CHANNEL } from '../constants/enums.js';

const position = location => location?.point?.coordinates?.length === 2
  ? { lat: location.point.coordinates[1], lng: location.point.coordinates[0] } : location;

// Order-specific operational checks shared by availability and actual offers.
// Approval grants membership; it does not turn on the rider's duty switch.
export function riderIneligibility(rider, user, order, pickup, { requireDuty = true } = {}) {
  if (rider.status !== 'approved') return 'not_approved';
  if (!user?.isActive || !user.roles?.includes('delivery')) return 'inactive_account';
  if (requireDuty && !rider.isAvailable) return 'off_duty';
  const zones = (rider.zones || []).map(String);
  if (zones.length && !zones.includes(String(pickup.pincode)) && !zones.includes(String(order.shippingAddress?.pincode))) return 'outside_coverage';
  const baseDistance = distanceKm(position(rider.baseLocation), position(pickup));
  if (order.type === CHANNEL.ECOM && (baseDistance === undefined || baseDistance > (Number(process.env.PICKUP_RADIUS_METERS) || 5000) * 3 / 1000)) return 'outside_pickup_radius';
  if (rider.deliveryRadiusKm != null) {
    const distance = distanceKm(position(rider.currentLocation?.lat !== undefined ? rider.currentLocation : rider.baseLocation), position(pickup));
    if (distance === undefined || distance > rider.deliveryRadiusKm) return 'outside_rider_radius';
  }
  return null;
}
