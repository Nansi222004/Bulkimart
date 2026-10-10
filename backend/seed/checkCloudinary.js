import 'dotenv/config';
import { verifyCloudinary, cloudinaryConfig } from '../services/cloudinary.service.js';

/**
 * npm run check:cloudinary
 *
 * Read-only credential check — nothing is uploaded to the account.
 */

const mask = (s) => (!s ? '(not set)' : s.length <= 6 ? '***' : `${s.slice(0, 3)}…${s.slice(-3)}`);

console.log('\n☁  Cloudinary configuration\n');
console.log('   source     :', process.env.CLOUDINARY_URL ? 'CLOUDINARY_URL' : 'individual CLOUDINARY_* vars');
console.log('   cloud_name :', cloudinaryConfig.cloud_name || '(not set)');
console.log('   api_key    :', mask(cloudinaryConfig.api_key));
console.log('   api_secret :', mask(cloudinaryConfig.api_secret));
console.log('');

const result = await verifyCloudinary();

if (result.ok) {
  console.log(`   ✅ Connected to cloud "${result.cloudName}" — document uploads will work.\n`);
  process.exit(0);
}

console.log(`   ❌ ${result.message}\n`);

if (/cloud_name mismatch/i.test(result.message)) {
  console.log('   This means your API key is valid but belongs to a DIFFERENT cloud than');
  console.log(`   "${cloudinaryConfig.cloud_name}". The cloud name is the auto-generated id`);
  console.log('   shown on your Cloudinary dashboard — not your account name, and not a');
  console.log('   Media Library folder name.\n');
  console.log('   Easiest fix — copy the whole connection string from the dashboard:');
  console.log('     CLOUDINARY_URL=cloudinary://<api_key>:<api_secret>@<cloud_name>');
  console.log('   Put that single line in .env and re-run this check.\n');
}

process.exit(1);
