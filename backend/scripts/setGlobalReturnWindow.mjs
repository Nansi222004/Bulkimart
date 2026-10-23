import '../config/bootstrap.js';
import mongoose from 'mongoose';
import { getGlobalReturnPolicy, saveGlobalReturnPolicy } from '../services/returnPolicy.service.js';

// Local setup only. Ongoing changes use Admin -> Return Window Settings.
if (process.env.NODE_ENV !== 'development') throw new Error('This setup command is only available in development');
const input = process.argv.find(value => value.startsWith('--days='))?.slice('--days='.length);
if (!input || !/^\d+$/.test(input)) throw new Error('Provide --days=<whole number>');
try {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000, autoIndex: false });
  const current = await getGlobalReturnPolicy();
  const row = current?.isActive && current.returnWindowDays === Number(input) ? current : await saveGlobalReturnPolicy({ returnWindowDays: Number(input), isActive: true, version: current?.version || 0 });
  console.log(JSON.stringify({ returnWindowDays: row.returnWindowDays, isActive: row.isActive, version: row.version }));
} finally { await mongoose.disconnect(); }
