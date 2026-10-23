import mongoose from 'mongoose';
const schema = new mongoose.Schema({
  customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  details: { type: mongoose.Schema.Types.Mixed, required: true },
  pricing: { type: mongoose.Schema.Types.Mixed, required: true },
  expiresAt: { type: Date, required: true },
  bookingId: { type: mongoose.Schema.Types.ObjectId, ref: 'ParcelDelivery' },
}, { timestamps: true, optimisticConcurrency: true, autoIndex: false, autoCreate: false });
schema.index({ customerId: 1, createdAt: -1 });
export default mongoose.model('ParcelQuote', schema);
