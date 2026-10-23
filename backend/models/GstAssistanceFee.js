import mongoose from 'mongoose';
const schema = new mongoose.Schema({
  _id: { type: String, default: 'gst-assistance' },
  amountPaise: { type: Number, required: true, min: 1 },
  currency: { type: String, enum: ['INR'], default: 'INR' },
  terms: { type: String, required: true },
  version: { type: Number, required: true, default: 1 },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
  history: [{ _id: false, version: Number, amountPaise: Number, terms: String, by: mongoose.Schema.Types.ObjectId, at: Date }],
}, { timestamps: true, optimisticConcurrency: true, autoIndex: false, autoCreate: false });
export default mongoose.model('GstAssistanceFee', schema);
