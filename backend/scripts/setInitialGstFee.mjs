import '../config/bootstrap.js';
import mongoose from 'mongoose';
import Fee from '../models/GstAssistanceFee.js';
import { validateGstFee, feeView } from '../services/gstFee.service.js';

// One-time local setup. Later edits belong in the authorized admin workspace.
if (process.env.NODE_ENV !== 'development') throw new Error('Initial fee setup is only available in development');
const args = Object.fromEntries(process.argv.slice(2).map(value => { const index=value.indexOf('='); return [value.slice(0,index),value.slice(index+1)]; }));
if (!/^\d+(\.\d{1,2})?$/.test(args['--amount'] || '')) throw new Error('Provide --amount=<total rupees> and --terms=<payment terms>');
const config = validateGstFee({ amountPaise: Math.round(Number(args['--amount'])*100), terms: args['--terms'], version: 0 });
try {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000, autoIndex: false });
  const row = await Fee.findOneAndUpdate({ _id: 'gst-assistance' }, { $setOnInsert: { ...config, version: 1 } }, { upsert: true, returnDocument: 'after', runValidators: true });
  console.log(JSON.stringify({ fee: feeView(row), existingFeePreserved: true }));
} finally { await mongoose.disconnect(); }
