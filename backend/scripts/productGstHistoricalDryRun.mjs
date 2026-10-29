// Product GST historical dry run: READ-ONLY. It classifies every order's product GST evidence and
// writes a report file. It never writes to the database, and there is no apply mode: a backfill needs
// explicit approval and its own reviewed script (see docs/product-gst-implementation.md).
// Usage: node scripts/productGstHistoricalDryRun.mjs <report.json>
import 'dotenv/config';
import fs from 'node:fs/promises';
import mongoose from 'mongoose';
import { classifyHistoricalOrderGst, HISTORICAL_GST_CLASSES } from '../utils/productGstHistory.js';

const output = process.argv[2];
if (!output || process.argv.includes('--apply')) throw new Error('Usage: node scripts/productGstHistoricalDryRun.mjs <report.json>; apply is not supported');
const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
if (!uri) throw new Error('MONGO_URI is required');
await mongoose.connect(uri, { readPreference: 'secondaryPreferred' });
try {
  const orders = mongoose.connection.db.collection('orders');
  const rows = [];
  for await (const order of orders.find({}, { projection: { orderNo: 1, createdAt: 1, items: 1, pricing: 1, productTax: 1, financialSnapshot: 1 } }).sort({ createdAt: 1 })) {
    rows.push(classifyHistoricalOrderGst(order));
  }
  const counts = Object.fromEntries(Object.values(HISTORICAL_GST_CLASSES).map(name => [name, rows.filter(row => row.class === name).length]));
  const report = { reportVersion: 1, mode: 'dry-run', mutations: 0, database: mongoose.connection.db.databaseName, observedAt: new Date().toISOString(), orders: rows.length, counts, rows };
  await fs.writeFile(output, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ mode: 'dry-run', mutations: 0, orders: rows.length, counts }));
} finally { await mongoose.disconnect(); }
