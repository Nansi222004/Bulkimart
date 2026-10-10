import 'dotenv/config';
import { setServers } from 'dns';
import mongoose from 'mongoose';
import Admin from '../models/Admin.js';

/**
 * Deliberately (re)set the Super Admin's password from ADMIN_EMAIL / ADMIN_PASSWORD.
 *
 * Why this exists as a separate command:
 * config/db.js used to re-sync the admin password on EVERY boot, which silently
 * reverted any password changed through the admin panel. That sync was removed.
 * The trade-off is that editing ADMIN_PASSWORD in .env no longer takes effect on
 * its own — so this script is the supported way to apply it, on purpose, when you
 * actually mean to.
 *
 *   npm run admin:password
 *
 * Creates the admin if it does not exist yet.
 */

if (process.env.NODE_ENV === 'development') setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);

const run = async () => {
  const email = (process.env.ADMIN_EMAIL || 'admin@admin.com').toLowerCase();
  const password = process.env.ADMIN_PASSWORD;

  if (!password) {
    console.error('✖ ADMIN_PASSWORD is not set in .env');
    process.exit(1);
  }

  // dotenv treats an unquoted "#" as the start of an inline comment, so
  // ADMIN_PASSWORD=Secret#123 silently becomes "Secret". Quote such values.
  const rawLine = (await import('fs')).readFileSync('.env', 'utf8')
    .split(/\r?\n/).find((l) => l.startsWith('ADMIN_PASSWORD='));
  if (rawLine) {
    const onDisk = rawLine.slice('ADMIN_PASSWORD='.length).trim();
    if (onDisk.replace(/^["']|["']$/g, '') !== password) {
      console.warn(`⚠  ADMIN_PASSWORD on disk (${onDisk.length} chars) differs from the parsed value (${password.length} chars).`);
      console.warn('   dotenv strips inline "#" comments — wrap the value in quotes: ADMIN_PASSWORD="my#pass"');
    }
  }

  await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/nhcone');

  let admin = await Admin.findOne({ email });
  if (!admin) {
    admin = await Admin.create({ name: 'Super Admin', email, password, role: 'superAdmin' });
    console.log(`\n✅ Created admin ${email} (role: superAdmin)\n`);
  } else {
    admin.password = password; // hashed by the pre-save hook
    await admin.save();
    console.log(`\n✅ Password updated for ${email} (role: ${admin.role})\n`);
  }

  // prove it round-trips
  const check = await Admin.findOne({ email });
  console.log('   verification:', (await check.matchPassword(password)) ? 'login will succeed ✓' : 'MISMATCH ✖');
  console.log(`   POST /api/auth/admin/login  { "email": "${email}", "password": "<your ADMIN_PASSWORD>" }\n`);

  await mongoose.disconnect();
  process.exit(0);
};

run().catch(async (err) => {
  console.error('\n✖ Failed:', err.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
