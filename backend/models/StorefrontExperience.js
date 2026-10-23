import mongoose from 'mongoose';
const { Schema } = mongoose;
// Presentation configuration only. Banner remains media/navigation; Campaign remains deal pricing.
const schema = new Schema({
  kind: { type: String, enum: ['theme', 'campaign', 'section'], required: true, immutable: true },
  name: { type: String, required: true, maxlength: 100 },
  description: { type: String, maxlength: 2000 },
  status: { type: String, enum: ['draft', 'published', 'paused', 'archived'], default: 'draft' },
  scope: { type: String, enum: ['global', 'quick', 'shop-all'], default: 'global' },
  device: { type: String, enum: ['all', 'mobile', 'desktop'], default: 'all' },
  priority: { type: Number, default: 0 }, order: { type: Number, default: 0 },
  startAt: Date, endAt: Date, timezone: { type: String, default: 'Asia/Kolkata' },
  revision: { type: Number, default: 1 },
  config: { type: Schema.Types.Mixed, required: true },
  history: { type: [Schema.Types.Mixed], default: [], select: false },
  createdBy: { type: Schema.Types.ObjectId, ref: 'Admin' }, updatedBy: { type: Schema.Types.ObjectId, ref: 'Admin' },
}, { timestamps: true, optimisticConcurrency: true });
schema.index({ kind: 1, status: 1, scope: 1, startAt: 1, endAt: 1 });
export default mongoose.model('StorefrontExperience', schema);
