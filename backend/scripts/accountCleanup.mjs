import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import mongoose from 'mongoose';
import Admin from '../models/Admin.js';
import User from '../models/User.js';
import Seller from '../models/Seller.js';
import DeliveryPartner from '../models/DeliveryPartner.js';
import Order from '../models/Order.js';
import Payment from '../models/Payment.js';
import Return from '../models/Return.js';
import WalletLedger from '../models/WalletLedger.js';
import CoinWallet from '../models/CoinWallet.js';
import CoinTransaction from '../models/CoinTransaction.js';
import Product from '../models/Product.js';
import SellerPayout from '../models/SellerPayout.js';
import DeliveryPayout from '../models/DeliveryPayout.js';
import Delivery from '../models/Delivery.js';
import {
  assessCustomerAccount, assessSellerAccount, assessDeliveryAccount, executeAccountAction,
} from '../services/accountLifecycle.service.js';

const apply = process.argv.includes('--apply');
const confirmation = process.argv.find((arg) => arg.startsWith('--confirm='))?.slice('--confirm='.length)
  || process.env.ACCOUNT_CLEANUP_CONFIRM;
if (apply && confirmation !== 'BULKIMART_ACCOUNT_CLEANUP') {
  throw new Error('Refusing apply: set ACCOUNT_CLEANUP_CONFIRM=BULKIMART_ACCOUNT_CLEANUP');
}

const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/nhcone';
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupDir = path.resolve('backups/account-cleanup', stamp);

const countSnapshot = async () => ({
  admins: await Admin.countDocuments(),
  users: await User.countDocuments(),
  activeUsers: await User.countDocuments({ isActive: true }),
  sellers: await Seller.countDocuments(),
  activeSellers: await Seller.countDocuments({ status: { $in: ['approved', 'pending', 'under_review', 'incomplete'] } }),
  deliveryPartners: await DeliveryPartner.countDocuments(),
  activeDeliveryPartners: await DeliveryPartner.countDocuments({ status: { $in: ['approved', 'pending', 'under_review', 'incomplete'] } }),
  preserved: {
    orders: await Order.countDocuments(), payments: await Payment.countDocuments(), returns: await Return.countDocuments(),
    walletLedgers: await WalletLedger.countDocuments(), coinWallets: await CoinWallet.countDocuments(),
    coinTransactions: await CoinTransaction.countDocuments(), products: await Product.countDocuments(),
    sellerPayouts: await SellerPayout.countDocuments(), deliveryPayouts: await DeliveryPayout.countDocuments(),
    deliveries: await Delivery.countDocuments(),
  },
});

const summarize = (assessments) => {
  const result = { total: assessments.length, delete: 0, deactivate: 0, skip: 0, reasons: {} };
  for (const item of assessments) {
    result[item.action] += 1;
    for (const code of item.reasonCodes) result.reasons[code] = (result.reasons[code] || 0) + 1;
  }
  return result;
};

const publicAssessment = ({ category, action, reasonCodes, dependencies }) => ({ category, action, reasonCodes, dependencies });

await mongoose.connect(mongoUri, { autoIndex: false });
try {
  const before = await countSnapshot();
  const [users, sellers, partners] = await Promise.all([
    User.find().select('+email').lean(), Seller.find().lean(), DeliveryPartner.find().lean(),
  ]);
  const [customerPlans, sellerPlans, deliveryPlans] = await Promise.all([
    Promise.all(users.map(assessCustomerAccount)),
    Promise.all(sellers.map(assessSellerAccount)),
    Promise.all(partners.map(assessDeliveryAccount)),
  ]);

  const indexes = {};
  for (const collectionName of ['users', 'sellers', 'deliverypartners', 'admins']) {
    const collection = mongoose.connection.collection(collectionName);
    const exists = await collection.countDocuments({}, { limit: 1 }).then(() => true).catch(() => false);
    indexes[collectionName] = exists ? (await collection.indexes()).map((index) => ({
      name: index.name, key: index.key, unique: Boolean(index.unique), sparse: Boolean(index.sparse),
      ...(index.partialFilterExpression ? { partialFilterExpression: index.partialFilterExpression } : {}),
    })) : [];
  }

  const initialReport = {
    generatedAt: new Date().toISOString(), mode: apply ? 'apply' : 'dry-run', before, indexes,
    proposed: {
      customer: summarize(customerPlans.filter(Boolean)),
      seller: summarize(sellerPlans.filter(Boolean)),
      delivery: summarize(deliveryPlans.filter(Boolean)),
    },
  };

  await fs.mkdir(backupDir, { recursive: true });
  await fs.writeFile(path.join(backupDir, 'initial-report.json'), JSON.stringify(initialReport, null, 2));

  if (!apply) {
    console.log(JSON.stringify(initialReport, null, 2));
  } else {
    const backup = {
      createdAt: new Date().toISOString(),
      recovery: 'Restore account documents to their original collections by _id, then restore User role/link/isActive fields from this backup. Historical collections were never modified.',
      collections: { users, sellers, deliveryPartners: partners },
      relationshipMetadata: {
        customer: customerPlans.filter(Boolean).map(publicAssessment),
        seller: sellerPlans.filter(Boolean).map(publicAssessment),
        delivery: deliveryPlans.filter(Boolean).map(publicAssessment),
      },
    };
    await fs.writeFile(path.join(backupDir, 'account-backup.json'), JSON.stringify(backup, null, 2));

    const results = { customer: [], seller: [], delivery: [] };
    for (const plan of sellerPlans.filter(Boolean)) results.seller.push(await executeAccountAction({ category: 'seller', targetId: plan.targetId, source: 'cleanup' }));
    for (const plan of deliveryPlans.filter(Boolean)) results.delivery.push(await executeAccountAction({ category: 'delivery', targetId: plan.targetId, source: 'cleanup' }));

    // Re-read identities after role-profile actions. This safely includes the
    // associated login identity of a permanently removed seller/rider, while a
    // retained historical profile remains a hard ROLE_PROFILE_EXISTS block.
    const remainingUsers = await User.find().select('+email').lean();
    for (const user of remainingUsers) {
      const result = await executeAccountAction({ category: 'customer', targetId: user._id, source: 'cleanup' });
      if (result) results.customer.push(result);
    }

    const after = await countSnapshot();
    const resultSummary = Object.fromEntries(Object.entries(results).map(([category, rows]) => [category, {
      total: rows.length,
      deleted: rows.filter((r) => r.outcome === 'deleted').length,
      deactivated: rows.filter((r) => r.outcome === 'deactivated').length,
      skipped: rows.filter((r) => r.outcome === 'skipped').length,
      failed: rows.filter((r) => r.outcome === 'failed').length,
      reasons: rows.flatMap((r) => r.reasonCodes).reduce((acc, code) => ({ ...acc, [code]: (acc[code] || 0) + 1 }), {}),
    }]));
    const preservation = Object.fromEntries(Object.keys(before.preserved).map((key) => [key, before.preserved[key] === after.preserved[key]]));
    const finalReport = { generatedAt: new Date().toISOString(), before, after, results: resultSummary, preservation, administratorsPreserved: before.admins === after.admins };
    await fs.writeFile(path.join(backupDir, 'final-report.json'), JSON.stringify(finalReport, null, 2));
    console.log(JSON.stringify(finalReport, null, 2));
  }
} finally {
  await mongoose.disconnect();
}
