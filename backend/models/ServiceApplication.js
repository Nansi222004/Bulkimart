import mongoose from 'mongoose';
const { Schema } = mongoose;
export const APPLICATION_STATUSES = ['submitted', 'under_review', 'information_required', 'in_progress', 'completed', 'rejected'];
const event = new Schema({
  action: { type: String, required: true }, actor: { type: Schema.Types.ObjectId, required: true },
  actorType: { type: String, enum: ['admin', 'vendor'], required: true },
  status: String, message: String, at: { type: Date, default: Date.now },
}, { _id: true });
const file = new Schema({
  fileId: String, name: String, format: String, sizeBytes: Number, sha256: String,
  fieldname: String, kind: { type: String, enum: ['document', 'response', 'deliverable'] },
  uploadedAt: Date,
}, { _id: false });
const schema = new Schema({
  service: { type: Schema.Types.ObjectId, ref: 'Service', required: true, index: true },
  vendor: { type: Schema.Types.ObjectId, ref: 'Seller', required: true, index: true },
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  submissionKey: { type: String, required: true },
  snapshot: { type: Schema.Types.Mixed, required: true }, answers: { type: Schema.Types.Mixed, required: true },
  status: { type: String, enum: APPLICATION_STATUSES, default: 'submitted', index: true },
  files: [file], events: [event], informationRequest: String, rejectionReason: String,
  processingAt: Date, completedAt: Date, processedBy: { type: Schema.Types.ObjectId, ref: 'Admin' },
}, { timestamps: true, optimisticConcurrency: true });
schema.index({ vendor: 1, submissionKey: 1 }, { unique: true });
schema.index({ createdAt: -1, _id: -1 });
export default mongoose.model('ServiceApplication', schema);
