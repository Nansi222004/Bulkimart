import 'dotenv/config';
import { setServers } from 'dns';
import mongoose from 'mongoose';

import User from '../models/User.js';
import Seller from '../models/Seller.js';
import SHGStore from '../models/SHGStore.js';
import Category from '../models/Category.js';
import Product from '../models/Product.js';
import Commission from '../models/Commission.js';
import Banner from '../models/Banner.js';
import Cart from '../models/Cart.js';
import Order from '../models/Order.js';

import { ROLE, VENDOR_STATUS } from '../constants/enums.js';
import { categories } from './data/categories.js';
import { users } from './data/users.js';
import { sellers } from './data/sellers.js';
import { shgStores } from './data/shgStores.js';
import { products } from './data/products.js';
import { commissions } from './data/commissions.js';
import { banners } from './data/banners.js';

// Never run against a production database.
if (process.env.NODE_ENV === 'production') {
  console.error('✖ Refusing to seed: NODE_ENV is production.');
  process.exit(1);
}

if (process.env.NODE_ENV === 'development') {
  setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);
}

const RESET = process.argv.includes('--reset');
const WITH_PRODUCTS = process.argv.includes('--with-products');

/** Idempotent bulk upsert keyed on the fixed _id. Re-running never duplicates. */
const upsertAll = async (Model, docs, label) => {
  if (!docs.length) return;
  const ops = docs.map((doc) => ({
    updateOne: { filter: { _id: doc._id }, update: { $set: doc }, upsert: true },
  }));
  const res = await Model.bulkWrite(ops, { ordered: false });
  const created = res.upsertedCount ?? 0;
  console.log(`  ${label.padEnd(14)} ${String(docs.length).padStart(3)} total  (${created} new, ${docs.length - created} updated)`);
};

const run = async () => {
  const uri = process.env.MONGO_URI || 'mongodb://localhost:27017/nhcone';
  await mongoose.connect(uri);
  console.log(`\n🌱 Seeding ${mongoose.connection.name} @ ${mongoose.connection.host}\n`);

  if (RESET) {
    console.log('⚠  --reset: clearing seeded collections (Admin is preserved)\n');
    await Promise.all([
      User.deleteMany({}), Seller.deleteMany({}), SHGStore.deleteMany({}),
      Category.deleteMany({}), Product.deleteMany({}), Commission.deleteMany({}),
      Banner.deleteMany({}), Cart.deleteMany({}), Order.deleteMany({}),
    ]);
  }

  // ---- order matters: categories before products, users before vendor profiles
  await upsertAll(Category, categories, 'categories');
  await upsertAll(User, users, 'users');
  await upsertAll(Seller, sellers, 'sellers');
  await upsertAll(SHGStore, shgStores, 'shg stores');
  // Demo products are NOT seeded by default any more — the catalogue should
  // start empty so real seller listings are the only products in the system.
  // Pass --with-products if you ever need the old demo catalogue back.
  if (WITH_PRODUCTS) {
    await upsertAll(Product, products, 'products');
  }
  await upsertAll(Commission, commissions, 'commissions');
  await upsertAll(Banner, banners, 'banners');

  // ---- link vendor profiles back onto their User docs and grant roles.
  // Only APPROVED vendors get the role — mirrors what admin approval does,
  // so requireRole('seller') behaves correctly for seeded accounts.
  for (const s of sellers) {
    const update = { $set: { sellerId: s._id } };
    if (s.status === VENDOR_STATUS.APPROVED) update.$addToSet = { roles: ROLE.SELLER };
    await User.updateOne({ _id: s.userId }, update);
  }
  for (const g of shgStores) {
    const update = { $set: { shgStoreId: g._id } };
    if (g.status === VENDOR_STATUS.APPROVED) update.$addToSet = { roles: ROLE.SHG };
    await User.updateOne({ _id: g.userId }, update);
  }

  // ---- summary
  const [pendingSellers, pendingProducts, lowStock] = await Promise.all([
    Seller.countDocuments({ status: VENDOR_STATUS.PENDING }),
    Product.countDocuments({ status: 'pending' }),
    Product.countDocuments({ stock: { $lt: 20 } }),
  ]);

  console.log(`
✅ Seed complete.

   Test accounts (OTP is always 1234 while OTP_MODE=mock)
   ──────────────────────────────────────────────────────
   9000000001  buyer
   9000000002  buyer
   9000000005  buyer, DEACTIVATED    → expect 403
   9000000011  approved seller       (Joshi General Store)
   9000000013  PENDING seller        → use for the admin approval demo
   9000000021  approved SHG          (Jai Bhavani Mahila Bachat Gat)
   9000000023  PENDING SHG           → use for the admin approval demo
   admin       ${process.env.ADMIN_EMAIL || 'admin@admin.com'} / POST /api/auth/admin/login

   Awaiting admin action: ${pendingSellers} sellers, ${pendingProducts} products
   Low stock (<20): ${lowStock} products
`);

  await mongoose.disconnect();
  process.exit(0);
};

run().catch(async (err) => {
  console.error('\n✖ Seed failed:', err.message);
  console.error(err.stack);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
