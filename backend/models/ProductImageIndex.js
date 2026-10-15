import mongoose from 'mongoose';
const schema = new mongoose.Schema({
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  imageUrl: { type: String, required: true }, version: { type: Number, required: true },
  hash: String, bands: [String], spatial: [Number], histogram: [Number],
}, { timestamps: true });
schema.index({ productId: 1, imageUrl: 1 }, { unique: true });
schema.index({ version: 1, bands: 1 });
export default mongoose.model('ProductImageIndex', schema);
