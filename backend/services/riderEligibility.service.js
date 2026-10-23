import { distanceKm } from '../utils/geo.js';
import { CHANNEL } from '../constants/enums.js';

const position = location => location?.point?.coordinates?.length === 2
  ? { lat: location.point.coordinates[1], lng: location.point.coordinates[0] } : location;

const validPosition = location => Number.isFinite(location?.lat) && Number.isFinite(location?.lng)
  && Math.abs(location.lat) <= 90 && Math.abs(location.lng) <= 180;

// A rider can be on duty away from home, or have registered a base address
// without coordinates. Use the same valid position for discovery and acceptance.
export const riderPickupPosition = rider => {
  const current = position(rider.currentLocation);
  if (validPosition(current)) return current;
  const base = position(rider.baseLocation);
  return validPosition(base) ? base : undefined;
};

// Order-specific operational checks shared by availability and actual offers.
// Approval grants membership; it does not turn on the rider's duty switch.
export function riderIneligibility(rider, user, order, pickup, { requireDuty = true } = {}) {
  if (rider.parcelReservation?.bookingId) return 'parcel_reserved';
  if (rider.status !== 'approved') return 'not_approved';
  if (!user?.isActive || !user.roles?.includes('delivery')) return 'inactive_account';
  if (requireDuty && !rider.isAvailable) return 'off_duty';
  const zones = (rider.zones || []).map(String);
  if (zones.length && !zones.includes(String(pickup.pincode)) && !zones.includes(String(order.shippingAddress?.pincode))) return 'outside_coverage';
  const pickupDistance = distanceKm(riderPickupPosition(rider), position(pickup));
  if (order.type === CHANNEL.ECOM && (pickupDistance === undefined || pickupDistance > (Number(process.env.PICKUP_RADIUS_METERS) || 5000) * 3 / 1000)) return 'outside_pickup_radius';
  if (rider.deliveryRadiusKm != null) {
    if (pickupDistance === undefined || pickupDistance > rider.deliveryRadiusKm) return 'outside_rider_radius';
  }
  return null;
}
