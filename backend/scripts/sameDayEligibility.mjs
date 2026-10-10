import '../config/bootstrap.js';
import mongoose from 'mongoose';
import connectDB from '../config/db.js';
import DeliveryPartner from '../models/DeliveryPartner.js';
import { checkSameDayEligibility, checkCartSameDayEligibility, SAME_DAY_REASON } from '../services/sameDay.service.js';
import { VENDOR_STATUS, SAME_DAY_MAX_RADIUS_KM, SAME_DAY_SELLER_INCENTIVE, SAME_DAY_DELIVERY_FEE } from '../constants/enums.js';

/**
 * Same-Day eligibility, case by case.
 *
 * Table-driven and hitting the service directly rather than over HTTP: every
 * case here is one rule, and a rule is easier to trust when the test that proves
 * it is four lines rather than a whole checkout.
 *
 * `now` is injected throughout. Cut-off tests that read the wall clock pass all
 * morning and fail after four in the afternoon, which is the kind of test that
 * gets deleted rather than fixed.
 */

const SHOP = { lat: 22.7175, lng: 75.8708 };                 // Indore, a real seller pin
const NEAR = { lat: 22.7196, lng: 75.8577 };                 // ~1.4 km away
const FAR = { lat: 22.9500, lng: 76.1200 };                  // ~38 km away
const MIDDAY = new Date('2026-08-20T11:00:00');              // a Thursday
const LATE = new Date('2026-08-20T17:30:00');
const SUNDAY = new Date('2026-08-23T11:00:00');

const seller = (over = {}) => ({
  _id: new mongoose.Types.ObjectId(),
  status: VENDOR_STATUS.APPROVED,
  storeDetails: { ...SHOP },
  sameDay: { enabled: true, cutoffTime: '16:00', availableDays: [1, 2, 3, 4, 5, 6], radiusKm: 20 },
  ...over,
});

const product = (over = {}) => ({
  _id: new mongoose.Types.ObjectId(),
  type: 'ecommerce',
  stock: 10,
  price: 150,
  sameDay: { enabled: true, processingMinutes: 60 },
  ...over,
});

let pass = 0, fail = 0;
const check = (label, got, want) => {
  if (got === want) { pass++; console.log('   PASS  ' + label.padEnd(46) + got); }
  else { fail++; console.log('   FAIL  ' + label.padEnd(46) + 'got ' + got + ', wanted ' + want); }
};

await connectDB();

// A real online rider near the shop is required for the happy path; without one
// every case would fail on NO_RIDER and prove nothing about the rules above it.
const liveRider = await DeliveryPartner.findOne({
  status: VENDOR_STATUS.APPROVED, isAvailable: true, 'baseLocation.point': { $exists: true },
}).lean();

console.log('\nRider near the shop: ' + (liveRider ? 'yes' : 'NONE — happy-path cases will report NO_RIDER'));

const one = (label, { p = {}, s = {}, dest = NEAR, qty = 1, now = MIDDAY }, want) =>
  checkSameDayEligibility({ product: product(p), seller: seller(s), destination: dest, qty, now })
    .then((v) => { check(label, v.code, want); return v; });

console.log('\n1-2. The two gates, and the short circuit');
await one('product Same-Day off', { p: { sameDay: { enabled: false } } }, SAME_DAY_REASON.PRODUCT_DISABLED);
await one('product has no sameDay object at all', { p: { sameDay: undefined } }, SAME_DAY_REASON.PRODUCT_DISABLED);
await one('seller Same-Day off', { s: { sameDay: { enabled: false } } }, SAME_DAY_REASON.SELLER_DISABLED);
await one('seller not approved', { s: { status: VENDOR_STATUS.PENDING } }, SAME_DAY_REASON.SELLER_NOT_OPERATIONAL);

console.log('\n3-4. The 20 km rule');
await one('inside the radius', {}, liveRider ? SAME_DAY_REASON.OK : SAME_DAY_REASON.NO_RIDER);
await one('outside the radius', { dest: FAR }, SAME_DAY_REASON.TOO_FAR);
await one('seller narrowed to 1 km', { s: { sameDay: { enabled: true, cutoffTime: '16:00', radiusKm: 1 } } }, SAME_DAY_REASON.TOO_FAR);
await one('seller tries 500 km — ceiling still applies',
  { s: { sameDay: { enabled: true, cutoffTime: '16:00', radiusKm: 500 } }, dest: FAR }, SAME_DAY_REASON.TOO_FAR);

console.log('\n5-6. Stock');
await one('stock available', { qty: 5 }, liveRider ? SAME_DAY_REASON.OK : SAME_DAY_REASON.NO_RIDER);
await one('not enough stock', { qty: 50 }, SAME_DAY_REASON.OUT_OF_STOCK);
await one('zero stock', { p: { stock: 0 } }, SAME_DAY_REASON.OUT_OF_STOCK);

console.log('\n7-8. Cut-off');
await one('before cut-off', { now: MIDDAY }, liveRider ? SAME_DAY_REASON.OK : SAME_DAY_REASON.NO_RIDER);
await one('after cut-off', { now: LATE }, SAME_DAY_REASON.CUTOFF_PASSED);

console.log('\n9-10. Processing time');
await one('60 min packing, 5 hours left', { now: MIDDAY }, liveRider ? SAME_DAY_REASON.OK : SAME_DAY_REASON.NO_RIDER);
await one('8 hour packing cannot finish by cut-off',
  { p: { sameDay: { enabled: true, processingMinutes: 480 } }, now: MIDDAY }, SAME_DAY_REASON.NOT_ENOUGH_TIME);
await one('30 min packing, 20 min before cut-off',
  { p: { sameDay: { enabled: true, processingMinutes: 30 } }, now: new Date('2026-08-20T15:40:00') },
  SAME_DAY_REASON.NOT_ENOUGH_TIME);

console.log('\nAvailable days');
await one('closed on Sunday', { now: SUNDAY }, SAME_DAY_REASON.CLOSED_TODAY);
await one('open on Sunday when listed',
  { s: { sameDay: { enabled: true, cutoffTime: '16:00', availableDays: [0] } }, now: SUNDAY },
  liveRider ? SAME_DAY_REASON.OK : SAME_DAY_REASON.NO_RIDER);

console.log('\nMissing coordinates');
await one('shop has no pin', { s: { storeDetails: {} } }, SAME_DAY_REASON.NO_SHOP_LOCATION);
await one('customer has no pin', { dest: {} }, SAME_DAY_REASON.NO_CUSTOMER_LOCATION);

console.log('\n11-12. Rider availability');
await one('a free rider near the shop', {}, liveRider ? SAME_DAY_REASON.OK : SAME_DAY_REASON.NO_RIDER);
{
  // Somewhere real, but far from every rider in the database.
  const remote = { lat: 26.9124, lng: 75.7873 };              // Jaipur
  const v = await checkSameDayEligibility({
    product: product(),
    seller: seller({ storeDetails: { ...remote } }),
    destination: { lat: 26.9200, lng: 75.7900 },
    now: MIDDAY,
  });
  check('no rider anywhere near the shop', v.code, SAME_DAY_REASON.NO_RIDER);
}

console.log('\nSingle-seller vs multi-seller basket');
{
  const s1 = seller();
  const v = await checkCartSameDayEligibility({
    lines: [{ product: product(), seller: s1, qty: 1 }, { product: product(), seller: s1, qty: 2 }],
    destination: NEAR, now: MIDDAY,
  });
  check('one seller, two lines', v.code, liveRider ? SAME_DAY_REASON.OK : SAME_DAY_REASON.NO_RIDER);
}
{
  const v = await checkCartSameDayEligibility({
    lines: [{ product: product(), seller: seller(), qty: 1 }, { product: product(), seller: seller(), qty: 1 }],
    destination: NEAR, now: MIDDAY,
  });
  check('two sellers', v.code, SAME_DAY_REASON.MULTIPLE_SELLERS);
}
{
  const s1 = seller();
  const v = await checkCartSameDayEligibility({
    lines: [{ product: product(), seller: s1, qty: 1 }, { product: product({ stock: 0 }), seller: s1, qty: 1 }],
    destination: NEAR, now: MIDDAY,
  });
  check('one line out of stock fails the basket', v.code, SAME_DAY_REASON.OUT_OF_STOCK);
}

console.log('\nMoney: four amounts, kept apart');
if (liveRider) {
  const v = await checkSameDayEligibility({ product: product(), seller: seller(), destination: NEAR, now: MIDDAY });
  check('delivery fee', v.deliveryFee, SAME_DAY_DELIVERY_FEE);
  check('seller incentive', v.sellerIncentive, SAME_DAY_SELLER_INCENTIVE);
  check('incentive + fee = customer delivery charge',
    v.sellerIncentive + v.deliveryFee, v.customerDeliveryCharge);
  check('rider payout is quoted separately, not equal to the fee',
    v.riderPayoutQuoted !== v.deliveryFee, true);
  check('distance measured, not guessed', v.distanceKm > 0 && v.distanceKm <= SAME_DAY_MAX_RADIUS_KM, true);
  check('promise is in the future', v.promisedBy > MIDDAY, true);
} else {
  console.log('   SKIP  no online rider in the database to reach a priced verdict');
}

console.log('\n' + '-'.repeat(62));
console.log('  ' + pass + ' passed, ' + fail + ' failed');
await mongoose.connection.close();
process.exit(fail ? 1 : 0);
