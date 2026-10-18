import Seller from '../models/Seller.js';
import { httpError } from '../utils/response.js';

// GeoJSON is [longitude, latitude]. It is the indexed store pin; flat fields
// remain supported for older records. Never substitute a rider or customer pin.
export const pickupCoordinates = (location) => {
  const point = location?.point;
  const lat = point ? point.coordinates?.[1] : location?.lat;
  const lng = point ? point.coordinates?.[0] : location?.lng;
  if (point && (point.type !== 'Point' || point.coordinates?.length !== 2)) return null;
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
};

export const storePickup = seller => {
  const coordinates = pickupCoordinates(seller?.storeDetails);
  return coordinates ? { ...(seller.storeDetails.toObject?.() || seller.storeDetails), ...coordinates } : null;
};

export const orderStoreId = order => {
  const ids = [...new Set((order.items || []).map(item => String(item.sellerId?._id || item.sellerId || '')).filter(Boolean))];
  if (ids.length !== 1 || order.items.some(item => !item.sellerId)) throw httpError(409, 'This order needs a single identified pickup store; contact platform support before assignment');
  return ids[0];
};

export const pickupLocationError = seller => httpError(409,
  `Pickup location for ${seller?.storeDetails?.name || seller?.businessName || 'the order store'} is missing or invalid. Save its actual map pin in the store profile before assigning or accepting delivery.`,
  { code: 'STORE_PICKUP_LOCATION_REQUIRED', sellerId: seller?._id, editorPath: '/seller/profile' });

export const requireOrderPickup = async order => {
  const seller = await Seller.findById(orderStoreId(order)).select('businessName storeDetails');
  if (!seller) throw httpError(409, 'The order pickup store no longer exists; contact platform support');
  const shop = storePickup(seller);
  if (!shop) throw pickupLocationError(seller);
  return { seller, shop };
};
