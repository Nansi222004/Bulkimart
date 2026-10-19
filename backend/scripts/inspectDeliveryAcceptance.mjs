// Read-only inspection of delivery-acceptance consistency and index definitions.
import '../config/bootstrap.js';
import mongoose from 'mongoose';
const id = process.argv[2];
if (!/^[a-f\d]{24}$/i.test(id || '')) throw new Error('Provide the order ID');
try {
  await mongoose.connect(process.env.MONGO_URI, { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 10000 });
  const db = mongoose.connection.db;
  const orderId = new mongoose.Types.ObjectId(id);
  const order = await db.collection('orders').findOne({ _id: orderId }, { projection: { status: 1, deliveryId: 1, deliveryPartnerId: 1, offerAttempts: 1 } });
  const deliveries = await db.collection('deliveries').find({ orderId }, { projection: { _id: 1, orderId: 1, partnerId: 1, status: 1, direction: 1 } }).toArray();
  const indexes = await db.collection('deliveries').indexes();
  const absentIndexedFields = {};
  for (const index of indexes.filter(index => index.unique && !index.sparse && !index.partialFilterExpression && Object.keys(index.key).length === 1 && !index.key._id)) {
    const field = Object.keys(index.key)[0];
    absentIndexedFields[field] = await db.collection('deliveries').countDocuments({ [field]: { $exists: false } });
  }
  console.log(JSON.stringify({ order, deliveries, indexes, absentIndexedFields }, null, 2));
} catch (error) { console.error('Read-only acceptance inspection failed:', error.code || error.name); process.exitCode = 1; }
finally { await mongoose.disconnect(); }
