import mongoose from 'mongoose';
const schema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  displayName: { type: String, required: true },
  status: { type: String, enum: ['approved', 'suspended'], required: true },
  services: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Service' }],
  // Private reference to the admin's identity/eligibility/credential review.
  // This attestation never creates or advertises a professional credential.
  reviewReference: { type: String, required: true }, reviewedAt: { type: Date, required: true },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', required: true },
  events: [mongoose.Schema.Types.Mixed],
}, { timestamps: true, optimisticConcurrency: true, autoIndex: false });
schema.index({ user: 1 }, { unique: true, name: 'legal_provider_user_unique' });
export default mongoose.model('LegalProvider', schema);
