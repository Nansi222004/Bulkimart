import '../config/bootstrap.js';
import mongoose from 'mongoose';
import { mkdir, writeFile } from 'node:fs/promises';
import { reconcileDeliveryPhoneIndex } from '../services/deliveryIndexCompatibility.service.js';
import { releaseIncompleteDeliveryClaim } from '../services/incompleteDeliveryClaim.service.js';

const orderId = process.argv[2];
const apply = process.argv.includes('--apply');
if (!/^[a-f\d]{24}$/i.test(orderId || '')) throw new Error('Provide the order ID');
try {
  await mongoose.connect(process.env.MONGO_URI, { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 10000 });
  const db = mongoose.connection.db;
  const indexReport = await reconcileDeliveryPhoneIndex(db);
  const claimReport = await releaseIncompleteDeliveryClaim(db, orderId);
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'report', indexReport, claimReport }));
  if (apply) {
    const backupDirectory = new URL('../../test-artifacts/delivery-acceptance-repair/', import.meta.url);
    await mkdir(backupDirectory, { recursive: true });
    await writeFile(new URL(`before-${Date.now()}.json`, backupDirectory), JSON.stringify({
      indexes: await db.collection('deliveries').indexes(),
      order: await db.collection('orders').findOne({ _id: new mongoose.Types.ObjectId(orderId) }, { projection: { status: 1, deliveryId: 1, deliveryPartnerId: 1, offerAttempts: 1, timeline: 1, updatedAt: 1, __v: 1 } }),
    }, null, 2), { flag: 'wx' });
    const indexes = await reconcileDeliveryPhoneIndex(db, { apply: true });
    let claim;
    const session = await mongoose.startSession();
    try { await session.withTransaction(async () => { claim = await releaseIncompleteDeliveryClaim(db, orderId, { apply: true, session }); }); }
    finally { await session.endSession(); }
    console.log(JSON.stringify({ indexes, claim }));
  }
} catch (error) { console.error('Delivery acceptance repair stopped:', error.code || error.name); process.exitCode = 1; }
finally { await mongoose.disconnect(); }
