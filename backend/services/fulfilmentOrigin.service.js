import Warehouse from '../models/Warehouse.js';
import Seller from '../models/Seller.js';
import { httpError } from '../utils/response.js';

/**
 * Where an order's parcel is picked up — and where its returns go back to.
 *
 * Every pickup in the code was written as "the seller's shop" (seller.storeDetails, the seller's Shiprocket
 * pickup location). An FBB order leaves from a Bulkimart warehouse instead. Rather than duplicate the rider,
 * Shiprocket and return integrations, this hands those integrations a seller-shaped origin: the same seller
 * (same id, so ownership and finance are untouched) whose storeDetails and Shiprocket pickup are the warehouse's.
 * Everything that is not an FBB order gets the seller back unchanged.
 */

export const isWarehouseOrder = (order) => order?.origin?.kind === 'warehouse' && Boolean(order.origin.warehouseId);

/** The warehouse shaped like Seller.storeDetails (with a GeoJSON point, as stores have). */
export const warehouseAsStore = (warehouse) => ({
  name: warehouse.name,
  address: [warehouse.address.line1, warehouse.address.line2].filter(Boolean).join(', '),
  city: warehouse.address.city,
  state: warehouse.address.state,
  pincode: warehouse.address.pincode,
  phone: warehouse.phone,
  lat: warehouse.address.lat,
  lng: warehouse.address.lng,
  point: { type: 'Point', coordinates: [warehouse.address.lng, warehouse.address.lat] },
});

export const loadOrderWarehouse = async (order, session = null) => {
  if (!isWarehouseOrder(order)) return null;
  const query = Warehouse.findById(order.origin.warehouseId);
  if (session) query.session(session);
  const warehouse = await query.lean();
  if (!warehouse) throw httpError(409, 'The warehouse for this order no longer exists; contact platform support');
  return warehouse;
};

/**
 * The seller, or for an FBB order the seller as seen from the warehouse: storeDetails = warehouse,
 * Shiprocket pickup = warehouse's registered location, no seller pickup-sync state.
 */
export const originSeller = async (order, seller, session = null) => {
  if (!seller || !isWarehouseOrder(order)) return seller;
  const warehouse = await loadOrderWarehouse(order, session);
  const plain = seller.toObject ? seller.toObject() : { ...seller };
  delete plain.pickupSync;
  return {
    ...plain,
    businessName: warehouse.name,
    storeDetails: warehouseAsStore(warehouse),
    thirdPartyFulfillment: { enabled: Boolean(warehouse.shiprocketPickupLocation), shiprocketPickupLocation: warehouse.shiprocketPickupLocation },
    isWarehouseOrigin: true,
    warehouseId: warehouse._id,
  };
};

/** Load the order's seller and return its origin (convenience for callers that only hold a seller id). */
export const originSellerById = async (order, sellerId, session = null) => {
  const query = Seller.findById(sellerId);
  if (session) query.session(session);
  return originSeller(order, await query, session);
};
