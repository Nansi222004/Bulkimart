import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import Coupon from '../models/Coupon.js';
import CouponRedemption from '../models/CouponRedemption.js';
import { redeemCoupon } from '../services/coupon.service.js';

let db;
beforeAll(async () => {
  db = await MongoMemoryReplSet.create({ binary: { version: '7.0.14' }, replSet: { count: 1 } });
  const uri = db.getUri('coupon_redemption_test');
  if (!/^mongodb:\/\/(127\.0\.0\.1|localhost):/.test(uri)) throw new Error('Refusing non-local test database');
  await mongoose.connect(uri);
}, 300_000);
afterEach(async () => { await Promise.all([Coupon.deleteMany({}), CouponRedemption.deleteMany({})]); });
afterAll(async () => { await mongoose.disconnect(); await db?.stop(); });

const spend = async (coupon, userId) => {
  const session = await mongoose.startSession();
  try {
    return await session.withTransaction(() => redeemCoupon({ coupon, userId, orderId: new mongoose.Types.ObjectId(),
      discountAmount: 10, orderTotal: 90 }, session));
  } finally { await session.endSession(); }
};

test('concurrent redemptions cannot exceed the total coupon limit', async () => {
  const coupon = await Coupon.create({ code: 'ONEUSE', title: 'One use', discountType: 'fixed', value: 10,
    totalUsageLimit: 1, perUserLimit: 0 });
  const users = [new mongoose.Types.ObjectId(), new mongoose.Types.ObjectId()];
  const outcomes = await Promise.allSettled(users.map(user => spend(coupon, user)));
  expect(outcomes.filter(result => result.status === 'fulfilled')).toHaveLength(1);
  expect((await Coupon.findById(coupon._id)).usedCount).toBe(1);
  expect(await CouponRedemption.countDocuments({ couponId: coupon._id })).toBe(1);
});

test('a second use by the same customer is rejected inside the transaction', async () => {
  const coupon = await Coupon.create({ code: 'PERUSER', title: 'Per user', discountType: 'fixed', value: 10,
    totalUsageLimit: 10, perUserLimit: 1 });
  const userId = new mongoose.Types.ObjectId();
  await spend(coupon, userId);
  await expect(spend(coupon, userId)).rejects.toMatchObject({ status: 409 });
  expect((await Coupon.findById(coupon._id)).usedCount).toBe(1);
});
