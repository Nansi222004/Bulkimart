import 'dotenv/config';
import { setServers } from 'dns';
import mongoose from 'mongoose';

/**
 * Drops stale indexes left behind by earlier schema versions.
 *
 * users.email_1 (UNIQUE)
 *   models/User.js declares `email: String` with NO unique constraint — email is
 *   optional because auth is phone/OTP based. But a UNIQUE index on it still existed
 *   in the database. Since unique indexes treat multiple `null`s as duplicates, the
 *   SECOND user to register without an email would fail with E11000 — i.e. all
 *   signups after the first would break in production.
 *
 * Safe to re-run: missing indexes are ignored.
 */

if (process.env.NODE_ENV === 'development') setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);

const STALE = [
  { collection: 'users', index: 'email_1' },
  // Carts became one-per-channel, so a single unique index on userId would
  // stop a user from having both a Quick and a Shop All basket.
  { collection: 'carts', index: 'userId_1' },
];

const run = async () => {
  await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/nhcone');
  console.log(`\n🔧 Checking indexes on ${mongoose.connection.name}\n`);

  for (const { collection, index } of STALE) {
    try {
      await mongoose.connection.db.collection(collection).dropIndex(index);
      console.log(`  ✔ dropped ${collection}.${index}`);
    } catch (err) {
      if (err.codeName === 'IndexNotFound' || err.code === 27) {
        console.log(`  – ${collection}.${index} already absent`);
      } else {
        throw err;
      }
    }
  }

  console.log('\n✅ Index check complete.\n');
  await mongoose.disconnect();
  process.exit(0);
};

run().catch(async (err) => {
  console.error('\n✖ Index fix failed:', err.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
