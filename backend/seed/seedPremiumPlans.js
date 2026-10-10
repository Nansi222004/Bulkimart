import '../config/bootstrap.js';
import mongoose from 'mongoose';
import PremiumPlan from '../models/PremiumPlan.js';

/**
 * One-off seed for the initial customer Premium Membership plans.
 * Idempotent — upserts by name, so re-running never duplicates a plan.
 *
 *   node seed/seedPremiumPlans.js
 *
 * Same shape as seedShgSubscriptionPlans.js, for the customer-side catalog.
 *
 * NOTE: an existing plan's PRICE is left alone on re-run. These are seed
 * defaults, not the source of truth — once an admin has edited a price in
 * the panel, re-running this must not silently undo them. Only genuinely
 * missing plans are created.
 */

const PLANS = [
  { name: '2 Months', durationMonths: 2, price: 199 },
  { name: '6 Months', durationMonths: 6, price: 499 },
  { name: '1 Year', durationMonths: 12, price: 799 },
];

const run = async () => {
  await mongoose.connect(process.env.MONGO_URI);

  for (const plan of PLANS) {
    const existing = await PremiumPlan.findOne({ name: plan.name });
    if (existing) {
      console.log(`↷ Skipped "${plan.name}" — already exists at ₹${existing.price} (admin-managed)`);
    } else {
      await PremiumPlan.create(plan);
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
