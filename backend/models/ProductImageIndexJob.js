import mongoose from 'mongoose';
const schema = new mongoose.Schema({
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', unique: true, required: true },
  revision: { type: Number, default: 0 }, attempts: { type: Number, default: 0 },
  lockedUntil: { type: Date, default: () => new Date(0) }, nextAttemptAt: { type: Date, default: Date.now },
}, { timestamps: true });
schema.index({ nextAttemptAt: 1, lockedUntil: 1 });
export default mongoose.model('ProductImageIndexJob', schema);
