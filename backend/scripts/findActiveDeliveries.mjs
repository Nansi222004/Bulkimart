import '../config/bootstrap.js';
import mongoose from 'mongoose';
import Order from '../models/Order.js';
import Delivery from '../models/Delivery.js';
import DeliveryPartner from '../models/DeliveryPartner.js';
import User from '../models/User.js';

const run = async () => {
  await mongoose.connect(process.env.MONGO_URI);
  console.log('Connected to MongoDB.\n');

  // Find all active orders with deliveryPartnerId
  const activeOrders = await Order.find({
    deliveryPartnerId: { $ne: null },
    status: { $nin: ['delivered', 'cancelled', 'returned', 'refunded'] }
  }).select('orderNo status deliveryId deliveryPartnerId userId updatedAt');

  console.log(`Found ${activeOrders.length} active orders with assigned delivery partners:`);
  for (const order of activeOrders) {
    const partner = await DeliveryPartner.findById(order.deliveryPartnerId);
    let partnerUser = null;
    if (partner) {
      partnerUser = await User.findById(partner.userId);
    }
    const delivery = order.deliveryId ? await Delivery.findById(order.deliveryId) : null;
    
    console.log(`\nOrder: ${order.orderNo}`);
    console.log(`  Order Status: ${order.status}`);
    console.log(`  Delivery Status: ${delivery ? delivery.status : 'N/A'}`);
    console.log(`  Partner ID: ${order.deliveryPartnerId}`);
    console.log(`  Partner Name: ${partnerUser ? partnerUser.name : 'Unknown'}`);
    console.log(`  Partner Phone: ${partnerUser ? partnerUser.phone : 'Unknown'}`);
    console.log(`  Partner isAvailable: ${partner ? partner.isAvailable : 'N/A'}`);
    console.log(`  Last Updated: ${order.updatedAt}`);
  }

  // Find all deliveries in active state
  console.log('\n--- Active Deliveries (not delivered/failed/rejected) ---');
  const activeDeliveries = await Delivery.find({
    status: { $nin: ['delivered', 'failed', 'rejected'] }
  });
  console.log(`Found ${activeDeliveries.length} active deliveries.`);
  for (const del of activeDeliveries) {
    const partner = await DeliveryPartner.findById(del.partnerId);
    let partnerUser = null;
    if (partner) {
      partnerUser = await User.findById(partner.userId);
    }
    const order = await Order.findById(del.orderId);
    console.log(`\nDelivery ID: ${del._id}`);
    console.log(`  Status: ${del.status}`);
    console.log(`  Order No: ${order ? order.orderNo : 'Unknown'}`);
    console.log(`  Partner Name: ${partnerUser ? partnerUser.name : 'Unknown'}`);
    console.log(`  Partner isAvailable: ${partner ? partner.isAvailable : 'N/A'}`);
  }

  // Find all delivery partners who are offline but have active assignments or general partners who are online
  console.log('\n--- Delivery Partners Status ---');
  const partners = await DeliveryPartner.find({});
  for (const p of partners) {
    const u = await User.findById(p.userId);
    console.log(`Rider: ${u ? u.name : 'Unknown'} (${u ? u.phone : 'Unknown'})`);
    console.log(`  ID: ${p._id}`);
    console.log(`  status (verification): ${p.status}`);
    console.log(`  isAvailable (online/on-duty): ${p.isAvailable}`);
  }

  await mongoose.disconnect();
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
