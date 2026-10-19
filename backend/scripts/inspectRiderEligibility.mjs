// Read-only diagnosis: no account, location, assignment or order changes.
import '../config/bootstrap.js';
import mongoose from 'mongoose';
import { riderIneligibility } from '../services/riderEligibility.service.js';
import { distanceKm } from '../utils/geo.js';
import { storePickup } from '../services/storePickup.service.js';

const orderId = process.argv[2];
const name = process.argv[3] || 'Ritik Tiwari';
if (!/^[a-f\d]{24}$/i.test(orderId || '')) throw new Error('Provide the order ID');
const point = location => location?.point?.coordinates?.length === 2
  ? { lat: location.point.coordinates[1], lng: location.point.coordinates[0] } : location;
try {
  await mongoose.connect(process.env.MONGO_URI, { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 10000 });
  const db = mongoose.connection.db;
  const order = await db.collection('orders').findOne({ _id: new mongoose.Types.ObjectId(orderId) });
  if (!order) throw new Error('Order not found');
  const sellerIds = [...new Set(order.items.map(item => String(item.sellerId)))];
  const seller = sellerIds.length === 1 ? await db.collection('sellers').findOne({ _id: new mongoose.Types.ObjectId(sellerIds[0]) }) : null;
  const pickup = storePickup(seller);
  const users = await db.collection('users').find({ name: { $regex: name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } }, { projection: { _id: 1, name: 1, roles: 1, isActive: 1 } }).toArray();
  const results = [];
  for (const user of users) {
    const riders = await db.collection('deliverypartners').find({ userId: user._id }).toArray();
    for (const rider of riders) {
      const [forward, returns] = await Promise.all([
        db.collection('orders').countDocuments({ deliveryPartnerId: rider._id, status: { $nin: ['delivered', 'cancelled', 'returned', 'refunded'] } }),
        db.collection('deliveries').countDocuments({ partnerId: rider._id, direction: 'return_pickup', status: { $nin: ['rejected', 'delivered', 'failed'] } }),
      ]);
      results.push({ name: user.name, approved: rider.status, online: rider.isAvailable, accountActive: user.isActive, deliveryRole: user.roles?.includes('delivery'),
        zones: rider.zones, radiusKm: rider.deliveryRadiusKm,
        baseDistanceKm: pickup ? distanceKm(point(rider.baseLocation), pickup) : null,
        currentDistanceKm: pickup ? distanceKm(rider.currentLocation, pickup) : null,
        currentLocationUpdatedAt: rider.currentLocation?.updatedAt, baseLocationUpdatedAt: rider.baseLocation?.updatedAt,
        exclusion: pickup ? riderIneligibility(rider, user, order, pickup) : 'missing_store_pickup',
        capacity: { open: forward + returns, limit: Number(process.env.RIDER_MAX_CONCURRENT_DELIVERIES) || 0 },
      });
    }
  }
  console.log(JSON.stringify({ orderId, channel: order.type, status: order.status, pickupPinned: Boolean(pickup), pickupPincode: pickup?.pincode,
    destinationPincode: order.shippingAddress?.pincode, globalPickupRadiusKm: (Number(process.env.PICKUP_RADIUS_METERS) || 5000) * 3 / 1000,
    matchingAccounts: users.length, riders: results }, null, 2));
} catch (error) { console.error('Read-only eligibility inspection failed:', error.code || error.name); process.exitCode = 1; }
finally { await mongoose.disconnect(); }
