import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import mongoose from 'mongoose';

await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/nhcone', { autoIndex: false });
try {
  const db = mongoose.connection.db;
  const dangling = async (from, localField, to, as = 'target') => {
    const rows = await db.collection(from).aggregate([
      { $match: { [localField]: { $exists: true, $ne: null } } },
      { $lookup: { from: to, localField, foreignField: '_id', as } },
      { $match: { [`${as}.0`]: { $exists: false } } },
      { $project: { _id: 0, missingId: `$${localField}` } },
    ]).toArray();
    return rows.map((row) => String(row.missingId));
  };

  const itemSellerRows = await db.collection('orders').aggregate([
    { $unwind: '$items' },
    { $match: { 'items.sellerId': { $exists: true, $ne: null } } },
    { $lookup: { from: 'sellers', localField: 'items.sellerId', foreignField: '_id', as: 'seller' } },
    { $match: { 'seller.0': { $exists: false } } },
    { $project: { _id: 0, missingId: '$items.sellerId' } },
  ]).toArray();

  const backupRoot = path.resolve('backups/account-cleanup');
  const backupDirs = await fs.readdir(backupRoot).catch(() => []);
  let backup = null;
  for (const dir of backupDirs.sort().reverse()) {
    try {
      backup = JSON.parse(await fs.readFile(path.join(backupRoot, dir, 'account-backup.json'), 'utf8'));
      break;
    } catch { /* dry-run directories do not contain account-backup.json */ }
  }
  const beforeIds = {
    users: new Set((backup?.collections?.users || []).map((row) => String(row._id))),
    sellers: new Set((backup?.collections?.sellers || []).map((row) => String(row._id))),
    deliverypartners: new Set((backup?.collections?.deliveryPartners || []).map((row) => String(row._id))),
  };

  const danglingIds = {
    sellerUsers: await dangling('sellers', 'userId', 'users'),
    deliveryUsers: await dangling('deliverypartners', 'userId', 'users'),
    orderUsers: await dangling('orders', 'userId', 'users'),
    paymentUsers: await dangling('payments', 'userId', 'users'),
    walletLedgerUsers: await dangling('walletledgers', 'userId', 'users'),
    coinWalletUsers: await dangling('coinwallets', 'userId', 'users'),
    productSellers: await dangling('products', 'sellerId', 'sellers'),
    orderItemSellers: itemSellerRows.map((row) => String(row.missingId)),
    orderDeliveryPartners: await dangling('orders', 'deliveryPartnerId', 'deliverypartners'),
    deliveryPartners: await dangling('deliveries', 'partnerId', 'deliverypartners'),
  };
  const targetCollection = {
    sellerUsers: 'users', deliveryUsers: 'users', orderUsers: 'users', paymentUsers: 'users',
    walletLedgerUsers: 'users', coinWalletUsers: 'users', productSellers: 'sellers',
    orderItemSellers: 'sellers', orderDeliveryPartners: 'deliverypartners', deliveryPartners: 'deliverypartners',
  };
  const classifiedDangling = Object.fromEntries(Object.entries(danglingIds).map(([key, ids]) => {
    const before = beforeIds[targetCollection[key]];
    const introduced = ids.filter((id) => before.has(id)).length;
    return [key, { total: ids.length, preExisting: ids.length - introduced, introduced }];
  }));

  const report = {
    counts: {
      admins: await db.collection('admins').countDocuments(),
      users: await db.collection('users').countDocuments(),
      sellers: await db.collection('sellers').countDocuments(),
      deliveryPartners: await db.collection('deliverypartners').countDocuments(),
    },
    danglingReferences: classifiedDangling,
    inactiveCredentials: await db.collection('users').countDocuments({
      isActive: false,
      $or: [
        { fcmToken: { $exists: true, $nin: [null, ''] } },
        { pushTokens: { $elemMatch: { active: true } } },
      ],
    }),
  };
  report.cleanupIntroducedNoDanglingReferences = Object.values(report.danglingReferences).every((value) => value.introduced === 0);
  report.inactiveCredentialsRevoked = report.inactiveCredentials === 0;
  console.log(JSON.stringify(report, null, 2));
} finally {
  await mongoose.disconnect();
}
