import mongoose from 'mongoose';
const schema = new mongoose.Schema({
  name: { type: String, required: true }, slug: { type: String, required: true, unique: true },
  description: String, instructions: String,
  audiences: { type: [String], enum: ['vendor', 'customer'], default: ['vendor'] },
  legalCategory: String,
  // 'archived' = deleted by an admin but kept because requests refer to it; hidden everywhere.
  status: { type: String, enum: ['draft', 'published', 'unpublished', 'archived'], default: 'draft', index: true },
  archivedAt: Date, archivedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
  // amount is the base price before tax; taxRate (%) is set per service by the admin
  // and added on top at checkout. Absent on older services, which therefore charge no tax.
  pricing: { mode: { type: String, enum: ['free', 'fixed'] }, amount: Number, currency: String, taxRate: Number },
  // Admin-written payment, cancellation and disclaimer terms the applicant must accept before paying.
  terms: String,
  // Hours after payment in which the applicant may cancel (for a wallet refund) while work has not started.
  cancellationWindowHours: Number,
  fields: [mongoose.Schema.Types.Mixed], formVersion: { type: Number, default: 1 },
  submissionCount: { type: Number, default: 0 },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' }, publishedAt: Date,
}, { timestamps: true, optimisticConcurrency: true });
schema.set('autoIndex', process.env.NODE_ENV === 'test');
export default mongoose.model('Service', schema);
