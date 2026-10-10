import 'dotenv/config';
import { setServers } from 'dns';
import mongoose from 'mongoose';
import Product from '../models/Product.js';

/**
 * npm run remove:mock-products -- --dry-run   (inspect first)
 * npm run remove:mock-products               (delete)
 *
 * Removes ONLY the seeded demo products. Categories, sellers, SHG stores and
 * anything a real seller created are left completely alone — this deletes rows
 * from the products collection, nothing else.
 *
 * Seeded products are identified by their fixed ObjectIds (see seed/ids.js:
 * products are minted as 6504…). Anything created through the app has a random
 * Mongo-generated id and is therefore never matched.
 */

if (process.env.NODE_ENV === 'development') setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);
if (process.env.NODE_ENV === 'production') {
  console.error('✖ Refusing to run against production.');
  process.exit(1);
}

const DRY = process.argv.includes('--dry-run');
const SEED_ID_PREFIX = '6504';   // seed/ids.js → ID.product(n)

const run = async () => {
  await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/nhcone');
  console.log(`\n🧹 ${DRY ? 'DRY RUN — nothing will be deleted' : 'DELETING'} · ${mongoose.connection.name}\n`);

  const all = await Product.find({}, 'name type status sellerId shgStoreId').lean();
  const mock = all.filter((p) => String(p._id).startsWith(SEED_ID_PREFIX));
  const real = all.filter((p) => !String(p._id).startsWith(SEED_ID_PREFIX));

  console.log(`  Products in database : ${all.length}`);
  console.log(`  Seeded / mock        : ${mock.length}   ← to remove`);
  console.log(`  Created in the app   : ${real.length}   ← kept, untouched`);

  if (real.length) {
    console.log('\n  KEEPING these real products:');
    real.forEach((p) => console.log(`     • ${p.name}  [${p.type} · ${p.status}]`));
  }

  if (mock.length) {
    const byType = {};
    mock.forEach((p) => { byType[p.type] = (byType[p.type] || 0) + 1; });
    console.log('\n  Mock products by channel:');
    Object.entries(byType).forEach(([t, n]) => console.log(`     ${t.padEnd(10)} ${n}`));
  }

  if (DRY) {
    console.log('\n  Nothing deleted. Re-run without --dry-run to apply.\n');
    await mongoose.disconnect();
    process.exit(0);
  }

  if (!mock.length) {
    console.log('\n  ✅ No mock products left — nothing to do.\n');
    await mongoose.disconnect();
    process.exit(0);
  }

  const res = await Product.deleteMany({ _id: { $in: mock.map((p) => p._id) } });
  const remaining = await Product.countDocuments();

  console.log(`\n  ✅ Deleted ${res.deletedCount} mock products.`);
  console.log(`     Products remaining: ${remaining}`);
  console.log('     Categories, sellers and all UI sections are untouched.\n');

  await mongoose.disconnect();
  process.exit(0);
};

run().catch(async (err) => {
  console.error('\n✖ Failed:', err.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
