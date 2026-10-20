import '../config/environment.js';
import mongoose from 'mongoose';
import { ensureSellerNotificationIndex } from '../services/sellerOrderNotification.service.js';

try {
  if (!process.env.MONGO_URI) throw new Error('Missing database configuration');
  await mongoose.connect(process.env.MONGO_URI, { autoIndex: false, autoCreate: false });
  await ensureSellerNotificationIndex();
  console.log('notification_dedupe_key_unique is ready. Existing notification rows were retained.');
} catch {
  console.error('Notification index preparation failed. Check database access and index permissions privately.');
  process.exitCode = 1;
} finally { await mongoose.disconnect(); }
