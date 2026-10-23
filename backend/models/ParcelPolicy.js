import mongoose from 'mongoose';
const schema = new mongoose.Schema({
  _id: { type: String, default: 'parcel' },
  version: { type: Number, required: true },
  config: { type: mongoose.Schema.Types.Mixed, required: true },
  history: [{ _id: false, version: Number, config: mongoose.Schema.Types.Mixed, by: mongoose.Schema.Types.ObjectId, at: Date }],
}, { timestamps: true, optimisticConcurrency: true, autoIndex: false, autoCreate: false });
export default mongoose.model('ParcelPolicy', schema);
