import mongoose from 'mongoose';
const schema = new mongoose.Schema({ _id: String, paymentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment' },
  stage:{type:String,enum:['PROCESSED','INCIDENT'],default:'PROCESSED'},
  kind: String, code:String, gatewayOrderId:String, processedAt: Date }, { versionKey: false });
schema.pre('validate',function(){if(this.stage==='PROCESSED'&&!this.paymentId)throw Error('Processed advertising webhook requires a payment reference');});
for (const method of ['updateOne','updateMany','findOneAndUpdate','deleteOne','deleteMany','bulkWrite']) schema.pre(method, function () { throw Error('Advertising webhook receipts are immutable'); });
schema.pre('save', function () { if (!this.isNew) throw Error('Advertising webhook receipts are immutable'); });
export default mongoose.model('AdWebhookReceipt', schema);
