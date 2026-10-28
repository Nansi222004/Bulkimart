// Inspect request/notification delivery evidence without jobs, providers or writes.
import '../config/environment.js';
import { MongoClient } from 'mongodb';
import { setServers } from 'node:dns';
setServers(['8.8.8.8', '1.1.1.1']);
const deadline = setTimeout(() => { console.error('Read-only notification audit timed out'); process.exit(1); }, 45000);
const client = new MongoClient(process.env.MONGO_URI || 'mongodb://localhost:27017/nhcone', { serverSelectionTimeoutMS: 10000, connectTimeoutMS: 10000 });
try {
  await client.connect(); const db = client.db();
  const requests = await db.collection('serviceapplications').find({}, { projection: { _id: 1, applicantType: 1, status: 1, 'billing.status': 1, 'billing.amountPaise': 1, createdAt: 1 } }).sort({ createdAt: -1 }).limit(15).toArray();
  const notifications = await db.collection('notifications').find({ recipientModel: 'Admin', 'metadata.applicationId': { $in: requests.map(request => request._id) } }, { projection: { 'metadata.applicationId': 1, title: 1, route: 1, isRead: 1, createdAt: 1 } }).toArray();
  console.log(JSON.stringify({ readOnly: true, activeAdmins: await db.collection('admins').countDocuments({ isActive: true }),
    requests: requests.map(request => ({ reference: String(request._id), applicantType: request.applicantType, status: request.status, billing: request.billing || null, createdAt: request.createdAt,
      adminNotifications: notifications.filter(notification => String(notification.metadata.applicationId) === String(request._id)).map(notification => ({ title: notification.title, route: notification.route, isRead: notification.isRead, createdAt: notification.createdAt })) })) }, null, 2));
} finally { await client.close(); clearTimeout(deadline); }
