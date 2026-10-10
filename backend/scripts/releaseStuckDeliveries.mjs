import '../config/bootstrap.js';
import mongoose from 'mongoose';
import Order from '../models/Order.js';
import Delivery from '../models/Delivery.js';
import DeliveryPartner from '../models/DeliveryPartner.js';

/**
 * Unstick deliveries that were accepted and then abandoned.
 *
 * Testing leaves these behind: a rider accepts an order, the tab is closed, and
 * nothing ever completes it. The order sits in `out_for_delivery` with a rider
 * attached, and — now that going on duty is refused while anything is open —
 * that rider can never take another job.
 *
 * The order is put back on offer rather than cancelled. The shop packed it and
 * the customer paid; the only thing that went wrong is that this particular
 * rider stopped carrying it, so it goes back to `dispatched` for someone else.
 *
 * Run:  node scripts/releaseStuckDeliveries.mjs                (report only)
 *       node scripts/releaseStuckDeliveries.mjs --apply        (release)
 *       node scripts/releaseStuckDeliveries.mjs --apply --older-than 30
 */

const APPLY = process.argv.includes('--apply');

/** Only touch deliveries that have been idle a while — never a live one. */
const minutesArg = process.argv.indexOf('--older-than');
const IDLE_MINUTES = minutesArg !== -1 ? Number(process.argv[minutesArg + 1]) || 20 : 20;

const run = async () => {
  await mongoose.connect(process.env.MONGO_URI);
  const cutoff = new Date(Date.now() - IDLE_MINUTES * 60 * 1000);

  console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY RUN'} · releasing deliveries idle for over ${IDLE_MINUTES} min\n`);

  const stuck = await Order.find({
    deliveryPartnerId: { $ne: null },
    status: 'out_for_delivery',
    updatedAt: { $lt: cutoff },
  }).select('orderNo status deliveryId deliveryPartnerId updatedAt');

  if (stuck.length === 0) {
    console.log('  Nothing stuck.');
    await mongoose.disconnect();
    return;
  }

  const freed = new Set();

  for (const order of stuck) {
    const delivery = await Delivery.findById(order.deliveryId).select('status');
    const idleMin = Math.round((Date.now() - order.updatedAt) / 60000);
    console.log(`  ${order.orderNo}  delivery=${delivery?.status || '—'}  idle ${idleMin} min`);

    if (!APPLY) continue;

    // Back on offer for any rider, with no partner attached.
    await Order.updateOne(
      { _id: order._id },
      {
        $set: { status: 'dispatched' },
        $unset: { deliveryPartnerId: '', deliveryId: '' },
        $push: {
          timeline: {
            status: 'dispatched',
            timestamp: new Date(),
            note: 'Returned to the pool — the assigned rider did not complete the delivery',
          },
        },
      }
    );

    if (delivery) {
      await Delivery.updateOne({ _id: delivery._id }, { $set: { status: 'failed' } });
    }

    freed.add(String(order.deliveryPartnerId));
  }

  if (APPLY && freed.size) {
    // The riders can take work again.
    await DeliveryPartner.updateMany(
      { _id: { $in: [...freed] } },
      { $set: { isAvailable: false } }   // off duty, not on: let them choose
    );
    console.log(`\n  ${freed.size} rider(s) released and set off duty — they can go back on when ready`);
  }

  console.log(`\n  ${stuck.length} ${APPLY ? 'released' : 'would be released'}`);
  if (!APPLY) console.log('  Re-run with --apply to do it.');

  await mongoose.disconnect();
};

run().catch((err) => { console.error(err); process.exit(1); });
