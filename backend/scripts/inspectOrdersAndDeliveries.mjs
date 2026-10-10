import '../config/bootstrap.js';
import mongoose from 'mongoose';
import Order from '../models/Order.js';
import Delivery from '../models/Delivery.js';
import DeliveryPartner from '../models/DeliveryPartner.js';
import User from '../models/User.js';

const run = async () => {
  await mongoose.connect(process.env.MONGO_URI);
  console.log('Connected to MongoDB.\n');

  const activeDeliveries = await Delivery.find({
    status: { $nin: ['delivered', 'failed', 'rejected'] }
  });

  for (const del of activeDeliveries) {
    const order = await Order.findById(del.orderId);
    const partner = await DeliveryPartner.findById(del.partnerId);
    const user = partner ? await User.findById(partner.userId) : null;
    
    console.log(`\nDelivery ID: ${del._id}`);
    console.log(`  Delivery Status: ${del.status}`);
    console.log(`  Order No: ${order ? order.orderNo : 'N/A'}`);
    console.log(`  Order Status: ${order ? order.status : 'N/A'}`);
    console.log(`  Order deliveryPartnerId: ${order ? order.deliveryPartnerId : 'N/A'}`);
    console.log(`  Partner ID: ${del.partnerId}`);
    console.log(`  Partner Name: ${user ? user.name : 'Unknown'}`);
    console.log(`  Partner isAvailable: ${partner ? partner.isAvailable : 'N/A'}`);
  }

  await mongoose.disconnect();
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
