// Isolated backend for the Reports browser check: in-memory MongoDB seeded with
// the September 2026 reports fixture, the real admin routes, a finance admin token.
// First: the test-only environment (fixture JWT secret, no real database URI).
import './env.js';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import express from 'express';
import jwt from 'jsonwebtoken';
import adminRoutes from '../routes/admin.routes.js';
import { errorHandler } from '../middlewares/error.middleware.js';
import { JWT_SECRET } from '../config/jwt.js';
import Admin from '../models/Admin.js';
import { seedReports } from './fixtures/reportsFixture.js';

const db = await MongoMemoryReplSet.create({ binary: { version: '7.0.14' }, replSet: { count: 1 } });
await mongoose.connect(db.getUri());
await seedReports();
const adminId = new mongoose.Types.ObjectId();
await Admin.collection.insertOne({ _id: adminId, name: 'Finance', email: 'finance@example.test', role: 'superAdmin', isActive: true });
const app = express(); app.use(express.json()); app.use('/api/admin', adminRoutes); app.use(errorHandler);
const server = app.listen(0, '127.0.0.1', () => process.send?.({ ready: true, port: server.address().port, token: jwt.sign({ id: String(adminId), type: 'admin' }, JWT_SECRET) }));
process.on('message', async message => {
  if (message?.action !== 'stop') return;
  server.close(); await mongoose.disconnect(); await db.stop(); process.exit(0);
});
