// Defaults to reporting only. No database deletes or approval changes.
import 'dotenv/config';
import mongoose from 'mongoose';
import Seller from '../models/Seller.js';
import { pickupDefinition, queueSellerPickupSync, syncSellerPickup } from '../services/sellerPickupSync.service.js';
const apply = process.argv.includes('--apply');
const target = process.argv.find(arg => arg.startsWith('--database='))?.slice(11);
const sellerId = process.argv.find(arg => arg.startsWith('--seller='))?.slice(9);
const after = process.argv.find(arg => arg.startsWith('--after='))?.slice(8);
if (after && !mongoose.isValidObjectId(after)) throw new Error('Invalid --after cursor');
if (!target || (sellerId && !mongoose.isValidObjectId(sellerId))) throw new Error('Supply --database=EXPECTED_DATABASE and optional --seller=OBJECT_ID. Default is dry-run.');
const limit = Number(process.argv.find(arg => arg.startsWith('--limit='))?.slice(8) || 25);
if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Limit must be 1–100');
try {
  await mongoose.connect(process.env.MONGO_URI, { autoIndex: false });
  if (mongoose.connection.name !== target) throw new Error('Database target mismatch; no records changed');
  if (apply && process.env.NODE_ENV === 'production' && !process.argv.includes('--approved-production-maintenance')) throw new Error('Production writes require an approved maintenance window and --approved-production-maintenance');
  const filter = { status: { $nin: ['rejected', 'suspended'] }, ...(sellerId ? { _id: sellerId } : after ? { _id: { $gt: after } } : {}) };
  const sellers = await Seller.find(filter).sort({ _id: 1 }).limit(limit).populate('userId', 'email phone isActive').lean();
  console.log(JSON.stringify({ database: mongoose.connection.name, mode: apply ? 'apply' : 'dry-run', count: sellers.length }));
  for (const seller of sellers) {
    const definition = pickupDefinition(seller, seller.userId);
    if (apply && !definition.error && seller.userId?.isActive) {
      await queueSellerPickupSync(seller._id, { retry: true }); await syncSellerPickup(seller._id);
    }
    console.log(JSON.stringify({ sellerId: String(seller._id), eligible: !definition.error && Boolean(seller.userId?.isActive), validation: definition.error || null,
      ...(apply ? { status: (await Seller.findById(seller._id).select('pickupSync.status').lean())?.pickupSync?.status } : {}) }));
  }
  console.log(JSON.stringify({ nextAfter: sellers.length === limit ? String(sellers.at(-1)._id) : null }));
} catch { console.error('Pickup maintenance stopped. Check target, database access and configuration. No secrets are logged.'); process.exitCode = 1; }
finally { await mongoose.disconnect(); }
