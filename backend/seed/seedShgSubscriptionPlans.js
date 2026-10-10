import '../config/bootstrap.js';
import mongoose from 'mongoose';
import SubscriptionPlan from '../models/SubscriptionPlan.js';

/**
 * One-off seed for the initial SHG business-subscription plans.
 * Idempotent — upserts by name, so re-running never duplicates a plan.
 *
 *   node seed/seedShgSubscriptionPlans.js
 */

const PLANS = [
  { name: '3 Months', durationMonths: 3, price: 1100 },
  { name: '6 Months', durationMonths: 6, price: 2000 },
  { name: '1 Year', durationMonths: 12, price: 3500 },
];

const run = async () => {
  await mongoose.connect(process.env.MONGO_URI);

  for (const plan of PLANS) {
    const existing = await SubscriptionPlan.findOne({ name: plan.name });
    if (existing) {
      existing.durationMonths = plan.durationMonths;
      existing.price = plan.price;
      await existing.save();
      console.log(`↺ Updated plan "${plan.name}" — ₹${plan.price} / ${plan.durationMonths}mo`);
    } else {
      await SubscriptionPlan.create(plan);
      console.log(`✅ Created plan "${plan.name}" — ₹${plan.price} / ${plan.durationMonths}mo`);
    }
  }

  await mongoose.disconnect();
  process.exit(0);
};

run().catch(async (err) => {
  console.error('\n✖ Failed:', err.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
