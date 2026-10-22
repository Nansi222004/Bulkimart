import mongoose from 'mongoose';
const schema = new mongoose.Schema({
  name: { type: String, required: true }, slug: { type: String, required: true, unique: true },
  description: String, instructions: String,
  audiences: { type: [String], enum: ['vendor', 'customer'], default: ['vendor'] },
  legalCategory: String,
  status: { type: String, enum: ['draft', 'published', 'unpublished'], default: 'draft', index: true },
  pricing: { mode: { type: String, enum: ['free', 'fixed'] }, amount: Number, currency: String },
  fields: [mongoose.Schema.Types.Mixed], formVersion: { type: Number, default: 1 },
  submissionCount: { type: Number, default: 0 },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' }, publishedAt: Date,
}, { timestamps: true, optimisticConcurrency: true });
schema.set('autoIndex', process.env.NODE_ENV === 'test');
export default mongoose.model('Service', schema);
