import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

await mongoose.connect(process.env.MONGO_URI);

const User = mongoose.model('User', new mongoose.Schema({}, { strict: false }));
const Admin = mongoose.model('Admin', new mongoose.Schema({}, { strict: false }));

const cleanCollection = async (Model, name) => {
  const docs = await Model.find({ 'pushTokens.0': { $exists: true } }).select('_id pushTokens');
  let cleanedCount = 0;

  for (const doc of docs) {
    if (!doc.pushTokens || !doc.pushTokens.length) continue;

    let modified = false;
    const active = doc.pushTokens.filter(t => t.active);
    if (active.length > 1) {
      // Group by platform
      for (const plat of ['web', 'app']) {
        const platActive = active.filter(t => (plat === 'web' ? t.platform === 'web' : t.platform !== 'web'));
        if (platActive.length <= 1) continue;

        // Group by deviceId
        const trackedMap = new Map();
        const untracked = [];
        for (const t of platActive) {
          if (t.deviceId) {
            const existing = trackedMap.get(t.deviceId);
            if (!existing || new Date(t.lastUsedAt || 0) > new Date(existing.lastUsedAt || 0)) {
              if (existing) existing.active = false;
              trackedMap.set(t.deviceId, t);
            } else {
              t.active = false;
              modified = true;
            }
          } else {
            untracked.push(t);
          }
        }

        // Untracked tokens: keep only 1 most recently used, deactivate rest
        if (untracked.length > 1) {
          untracked.sort((a, b) => new Date(b.lastUsedAt || b.createdAt || 0) - new Date(a.lastUsedAt || a.createdAt || 0));
          for (let i = 1; i < untracked.length; i++) {
            untracked[i].active = false;
            modified = true;
          }
        }

        // Web platform: only 1 active web token overall
        if (plat === 'web') {
          const remainingWeb = doc.pushTokens.filter(t => t.active && t.platform === 'web');
          if (remainingWeb.length > 1) {
            remainingWeb.sort((a, b) => new Date(b.lastUsedAt || b.createdAt || 0) - new Date(a.lastUsedAt || a.createdAt || 0));
            for (let i = 1; i < remainingWeb.length; i++) {
              remainingWeb[i].active = false;
              modified = true;
            }
          }
        }
      }
    }

    if (modified) {
      await Model.updateOne({ _id: doc._id }, { $set: { pushTokens: doc.pushTokens } });
      cleanedCount++;
    }
  }

  console.log(`[CLEANUP] ${name}: Cleaned ${cleanedCount} accounts with duplicate active push tokens.`);
};

await cleanCollection(User, 'User');
await cleanCollection(Admin, 'Admin');

await mongoose.disconnect();
console.log('[CLEANUP] Done.');
