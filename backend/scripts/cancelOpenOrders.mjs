import '../config/bootstrap.js';
import mongoose from 'mongoose';
import Order from '../models/Order.js';
import DeliveryPartner from '../models/DeliveryPartner.js';
import { cancelOrderAndRestore } from '../controllers/order.controller.js';
import { ORDER_STATUS } from '../constants/enums.js';

/**
 * Clear out orders left open by testing.
 *
 * Goes through cancelOrderAndRestore rather than writing `status: cancelled`
 * directly, because checkout did three things that all have to be undone: it
 * decremented stock, spent the coupon, and may have taken payment. A bare
 * status update would leave units missing from shelves that still hold them and
 * coupons nobody could reuse — and those are exactly the sort of quiet
 * discrepancies that get blamed on something else weeks later.
 *
 * Run:  node scripts/cancelOpenOrders.mjs          (report only)
 *       node scripts/cancelOpenOrders.mjs --apply  (cancel)
 */

const APPLY = process.argv.includes('--apply');

const OPEN = [
  ORDER_STATUS.PLACED,
  ORDER_STATUS.CONFIRMED,
  ORDER_STATUS.PREPARING,
  ORDER_STATUS.DISPATCHED,
  ORDER_STATUS.OUT_FOR_DELIVERY,
];

const run = async () => {
  await mongoose.connect(process.env.MONGO_URI);
  console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY RUN'}\n`);

  const open = await Order.find({ status: { $in: OPEN } })
    .sort({ createdAt: -1 })
    .select('orderNo status pricing deliveryPartnerId');

  if (open.length === 0) {
    console.log('  Nothing open.');
    await mongoose.disconnect();
    return;
  }

  let done = 0;
  const riders = new Set();

  for (const order of open) {
    if (order.deliveryPartnerId) riders.add(String(order.deliveryPartnerId));

    if (!APPLY) {
      console.log(`  ${order.orderNo}  ${order.status.padEnd(18)} ₹${order.pricing.totalAmount}`);
      continue;
    }

    const res = await cancelOrderAndRestore(order._id, {
      reason: 'Cancelled during development testing',
      allowedFrom: OPEN,
      cancelledBy: 'system',
    });

    console.log(`  ${order.orderNo}  ${res.ok ? 'cancelled' : 'skipped: ' + res.reason}`);
    if (res.ok) done += 1;
  }

  // Riders who were carrying one of these are free again. Left off duty rather
  // than on: coming back on shift is their decision, not this script's.
  if (APPLY && riders.size) {
    await DeliveryPartner.updateMany(
      { _id: { $in: [...riders] } },
      { $set: { isAvailable: false } }
    );
    console.log(`\n  ${riders.size} rider(s) freed and left off duty`);
  }

  console.log(`\n  ${APPLY ? `${done} cancelled` : `${open.length} would be cancelled`}`);
  if (!APPLY) console.log('  Re-run with --apply to do it.');

  await mongoose.disconnect();
};

run().catch((err) => { console.error(err); process.exit(1); });
