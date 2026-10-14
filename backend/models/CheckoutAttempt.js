import mongoose from 'mongoose';

const { Schema, model } = mongoose;

/**
 * One durable idempotency record per authenticated customer and checkout key.
 * Created and completed in the same MongoDB transaction as order/payment,
 * inventory and cart writes. Contains references and a request digest only;
 * never gateway credentials, payment tokens, addresses, or card data.
 */
const checkoutAttemptSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  key: { type: String, required: true, maxlength: 128 },
  requestHash: { type: String, required: true, minlength: 64, maxlength: 64 },
  operation: { type: String, enum: ['single', 'unified', 'digital'], required: true },
  status: { type: String, enum: ['processing', 'completed'], required: true },
  orderIds: [{ type: Schema.Types.ObjectId, ref: 'Order' }],
  paymentId: { type: Schema.Types.ObjectId, ref: 'Payment' },
  groupRef: String,
  totals: Schema.Types.Mixed,
  paymentMethod: String,
  amount: Number,
  coinsUsed: Number,
  coinDiscount: Number,
  nextStep: String,
}, { timestamps: true, autoIndex: false });

checkoutAttemptSchema.index({ userId: 1, key: 1 }, { unique: true, name: 'checkout_user_key_unique' });

export default model('CheckoutAttempt', checkoutAttemptSchema);
