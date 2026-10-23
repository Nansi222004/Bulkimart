import mongoose from 'mongoose';
const schema = new mongoose.Schema({
  _id: String, campaignId: { type: mongoose.Schema.Types.ObjectId, ref: 'SellerPromotion', required: true },
  revision: { type: Number, required: true }, productId: { type: mongoose.Schema.Types.ObjectId, required: true },
  placement: { type: String, enum: ['CATEGORY_SPONSORED'], required: true },
  mode: { type: String, enum: ['NON_BILLABLE_PILOT','PAID_CATEGORY'], required: true },
  type: { type: String, enum: ['IMPRESSION','CLICK'], required: true },
  at: { type: Date, required: true }, expiresAt: { type: Date, required: true },
}, { versionKey: false });
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
schema.index({ campaignId: 1, revision: 1, mode: 1, type: 1, at: 1 });
for (const method of ['updateOne','updateMany','findOneAndUpdate','replaceOne','findOneAndReplace','bulkWrite']) schema.pre(method, function () { throw Error('Ad events are append-only'); });
schema.pre('save', function () { if (!this.isNew) throw Error('Ad events are append-only'); });
export default mongoose.model('AdEvent', schema);
