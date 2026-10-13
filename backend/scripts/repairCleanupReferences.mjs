import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import mongoose from 'mongoose';
import User from '../models/User.js';
import AccountActionAudit from '../models/AccountActionAudit.js';

await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/nhcone', { autoIndex: false });
try {
  const backupRoot = path.resolve('backups/account-cleanup');
  const dirs = (await fs.readdir(backupRoot)).sort().reverse();
  let backup;
  for (const dir of dirs) {
    try {
      backup = JSON.parse(await fs.readFile(path.join(backupRoot, dir, 'account-backup.json'), 'utf8'));
      break;
    } catch { /* ignore dry-run directories */ }
  }
  if (!backup) throw new Error('No account cleanup backup is available');

  const backupUsers = new Map(backup.collections.users.map((row) => [String(row._id), row]));
  const missingWalletUsers = await mongoose.connection.collection('coinwallets').aggregate([
    { $lookup: { from: 'users', localField: 'userId', foreignField: '_id', as: 'user' } },
    { $match: { 'user.0': { $exists: false } } },
    { $project: { _id: 0, userId: 1 } },
  ]).toArray();
  const recoverable = missingWalletUsers.filter((row) => backupUsers.has(String(row.userId)));

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      for (const row of recoverable) {
        const restored = { ...backupUsers.get(String(row.userId)), isActive: false, pushTokens: [] };
        // JSON backup serialization turns ObjectIds into strings. Restore the
        // BSON type as well as the value or $lookup will still see an orphan.
        restored._id = new mongoose.Types.ObjectId(String(row.userId));
        if (restored.createdAt) restored.createdAt = new Date(restored.createdAt);
        if (restored.updatedAt) restored.updatedAt = new Date(restored.updatedAt);
        delete restored.fcmToken;
        // Remove only a prior malformed recovery row from this same script.
        await User.collection.deleteOne({ _id: String(row.userId), isActive: false }, { session });
        await User.collection.insertOne(restored, { session });
        await AccountActionAudit.create([{
          source: 'cleanup', category: 'customer', targetId: row.userId,
          action: 'deactivate', outcome: 'deactivated',
          reasonCodes: ['COIN_WALLET_REFERENCE_RECOVERY'], dependencyCounts: { coinWallet: 1 },
        }], { session });
      }
    });
  } finally {
    await session.endSession();
  }
  console.log(JSON.stringify({ restoredDeactivatedIdentities: recoverable.length, credentialsCleared: true }));
} finally {
  await mongoose.disconnect();
}
