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
  });

  const affectedPartners = new Set();

  console.log(`Found ${activeOrders.length} active orders to release:`);
  for (const order of activeOrders) {
    const partnerId = order.deliveryPartnerId;
    affectedPartners.add(String(partnerId));

    const partner = await DeliveryPartner.findById(partnerId);
    const partnerUser = partner ? await User.findById(partner.userId) : null;
    const partnerName = partnerUser ? partnerUser.name : 'Unknown';

    console.log(`Releasing rider "${partnerName}" (${order.deliveryPartnerId}) from order ${order.orderNo}...`);

    // 1. Put order back to dispatched
    await Order.updateOne(
      { _id: order._id },
      {
        $set: { status: 'dispatched' },
        $unset: { deliveryPartnerId: '', deliveryId: '' },
        $push: {
          timeline: {
            status: 'dispatched',
            timestamp: new Date(),
            note: `Delivery partner ${partnerName} released - order returned to pool`,
          },
        },
      }
    );

    // 2. Mark delivery as failed
    if (order.deliveryId) {
      await Delivery.updateOne(
        { _id: order.deliveryId },
        { $set: { status: 'failed' } }
      );
      console.log(`  Set delivery ${order.deliveryId} to 'failed'`);
    }
  }

  // Also clean up any other active Delivery records where the order is already cancelled/delivered
  const activeDeliveries = await Delivery.find({
    status: { $nin: ['delivered', 'failed', 'rejected'] }
  });

  console.log(`\nChecking ${activeDeliveries.length} active delivery records for completed/cancelled orders...`);
  for (const del of activeDeliveries) {
    const order = await Order.findById(del.orderId);
    if (!order || ['delivered', 'cancelled', 'returned', 'refunded'].includes(order.status)) {
      await Delivery.updateOne(
        { _id: del._id },
        { $set: { status: 'failed' } }
      );
      affectedPartners.add(String(del.partnerId));
      console.log(`  Set delivery ${del._id} (Order ${order ? order.orderNo : 'N/A'} - status ${order ? order.status : 'N/A'}) to 'failed'`);
    }
  }

  // Set affected delivery partners to isAvailable: true (free and online)
  if (affectedPartners.size > 0) {
    console.log(`\nSetting availability of affected partners to online (isAvailable: true):`);
    for (const partnerId of affectedPartners) {
      const partner = await DeliveryPartner.findById(partnerId);
      if (partner) {
        partner.isAvailable = true;
        await partner.save();
        const partnerUser = await User.findById(partner.userId);
        console.log(`  Rider "${partnerUser ? partnerUser.name : 'Unknown'}" (${partnerId}) is now FREE and online.`);
      }
    }
  } else {
    console.log('\nNo partners were affected/needed availability updates.');
  }

  await mongoose.disconnect();
  console.log('\nFinished successfully.');
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
