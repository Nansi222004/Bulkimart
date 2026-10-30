import mongoose from 'mongoose';
export const GST_ASSISTANCE_STATUSES = ['pending', 'under_review', 'additional_information_required', 'approved', 'rejected', 'completed', 'cancelled'];
const schema = new mongoose.Schema({
  // The seller application is also the request's unique identity. Concurrent
  // submissions need only the built-in _id constraint, never a new live index.
  _id: { type: mongoose.Schema.Types.ObjectId, ref: 'Seller' },
  vendorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Seller', required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  gstinAtSubmission: { type: String, default: '' },
  gstinStatusAtSubmission: { type: String, enum: ['not_provided'], required: true },
  details: { type: mongoose.Schema.Types.Mixed, required: true },
  consent: { accepted: Boolean, version: String, acceptedAt: Date },
  submittedAt: { type: Date, required: true },
  status: { type: String, enum: GST_ASSISTANCE_STATUSES, default: 'pending' },
  requestedCorrections: String,
  files: { type: [mongoose.Schema.Types.Mixed], default: [] },
  verification: mongoose.Schema.Types.Mixed,
  billing: { type: new mongoose.Schema({
    amountPaise: Number, currency: { type: String, default: 'INR' }, terms: String, version: Number,
    paymentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment' },
    status: { type: String, default: 'unpaid' }, mode: String, acceptedAt: Date, refundedPaise: { type: Number, default: 0 }, reviewRequired: { type: Boolean, default: false },
  }, { _id: false }), default: undefined },
  events: { type: [mongoose.Schema.Types.Mixed], default: [] },
}, { timestamps: true, optimisticConcurrency: true, autoCreate: false, autoIndex: false });
export default mongoose.model('GstAssistanceRequest', schema);
