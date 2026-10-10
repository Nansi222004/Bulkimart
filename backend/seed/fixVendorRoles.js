import 'dotenv/config';
import { setServers } from 'dns';
import mongoose from 'mongoose';
import User from '../models/User.js';
import Seller from '../models/Seller.js';
import SHGStore from '../models/SHGStore.js';
import { ROLE, VENDOR_STATUS } from '../constants/enums.js';

/**
 * npm run fix:roles
 *
 * POST /api/sellers/start used to grant the 'seller' role immediately, which meant
 * merely tapping "Become a Seller" unlocked the seller panel before any admin
 * approval. Registration no longer grants the role — but accounts created under
 * the old behaviour still carry it.
 *
 * This revokes 'seller' / 'shg' from anyone whose vendor profile is not approved,
 * and grants it to anyone approved who is missing it. Safe to re-run.
 */

if (process.env.NODE_ENV === 'development') setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);

const run = async () => {
  await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/nhcone');
  console.log(`\n🔧 Reconciling vendor roles on ${mongoose.connection.name}\n`);

  const report = { revokedSeller: 0, grantedSeller: 0, revokedShg: 0, grantedShg: 0 };

  const [sellers, stores] = await Promise.all([
    Seller.find({}, 'userId status businessName'),
    SHGStore.find({}, 'userId status groupName'),
  ]);

  for (const s of sellers) {
    const user = await User.findById(s.userId, 'phone roles');
    if (!user) continue;
    const hasRole = user.roles.includes(ROLE.SELLER);
    const approved = s.status === VENDOR_STATUS.APPROVED;

    if (hasRole && !approved) {
      await User.updateOne({ _id: user._id }, { $pull: { roles: ROLE.SELLER } });
      console.log(`  − revoked seller  ${user.phone}  (${s.businessName || 'unnamed'} is "${s.status}")`);
      report.revokedSeller++;
    } else if (!hasRole && approved) {
      await User.updateOne({ _id: user._id }, { $addToSet: { roles: ROLE.SELLER } });
      console.log(`  + granted seller  ${user.phone}  (${s.businessName || 'unnamed'} is approved)`);
      report.grantedSeller++;
    }
  }

  for (const g of stores) {
    const user = await User.findById(g.userId, 'phone roles');
    if (!user) continue;
    const hasRole = user.roles.includes(ROLE.SHG);
    const approved = g.status === VENDOR_STATUS.APPROVED;

    if (hasRole && !approved) {
      await User.updateOne({ _id: user._id }, { $pull: { roles: ROLE.SHG } });
      console.log(`  − revoked shg     ${user.phone}  (${g.groupName || 'unnamed'} is "${g.status}")`);
      report.revokedShg++;
    } else if (!hasRole && approved) {
      await User.updateOne({ _id: user._id }, { $addToSet: { roles: ROLE.SHG } });
      console.log(`  + granted shg     ${user.phone}  (${g.groupName || 'unnamed'} is approved)`);
      report.grantedShg++;
    }
  }

  const changed = Object.values(report).reduce((a, b) => a + b, 0);
  console.log(changed ? `\n✅ ${changed} role change(s) applied.\n` : '\n✅ All vendor roles already consistent.\n');

  await mongoose.disconnect();
  process.exit(0);
};

run().catch(async (err) => {
  console.error('\n✖ Failed:', err.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
