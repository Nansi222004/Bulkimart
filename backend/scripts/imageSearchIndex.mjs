import 'dotenv/config';
import mongoose from 'mongoose';
import Product from '../models/Product.js';
import Job from '../models/ProductImageIndexJob.js';
import Index from '../models/ProductImageIndex.js';
import { enqueueImageSearchIndex, processImageIndexJob } from '../services/imageSearchIndexer.service.js';

// Explicit operational command only; never invoked by tests or deployment.
if (!process.env.MONGO_URI) throw new Error('Set MONGO_URI for the intended environment.');
try {
  await mongoose.connect(process.env.MONGO_URI); await Promise.all([Job.init(), Index.init()]);
  let queued = 0, processed = 0;
  for await (const product of Product.find({ isDeleted: false, 'images.0': { $exists: true } }).select('_id').cursor()) { await enqueueImageSearchIndex(product._id); queued++; }
  while (await processImageIndexJob()) processed++;
  console.log(JSON.stringify({ queued, processed, pending: await Job.countDocuments() }));
} finally { await mongoose.disconnect(); }
