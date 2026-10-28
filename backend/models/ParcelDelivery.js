import mongoose from 'mongoose';
export const PARCEL_STATES = ['payment_pending', 'payment_failed', 'searching_for_driver', 'needs_admin_assignment', 'driver_assigned', 'driver_arriving', 'arrived_at_pickup', 'picked_up', 'in_transit', 'arrived_at_dropoff', 'delivered', 'cancellation_review', 'cancelled', 'delivery_failed'];
// Bookings paused until an admin decides: a rider asked for help or the customer asked to cancel.
export const PARCEL_REVIEW_STATES = ['delivery_failed', 'cancellation_review'];
const schema = new mongoose.Schema({
  reference: { type: String, required: true },
  customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  quoteId: { type: mongoose.Schema.Types.ObjectId, ref: 'ParcelQuote', required: true },
  requestHash: { type: String, required: true },
  details: { type: mongoose.Schema.Types.Mixed, required: true },
  pricing: { type: mongoose.Schema.Types.Mixed, required: true },
  status: { type: String, enum: PARCEL_STATES, required: true },
  paymentMethod: { type: String, enum: ['online', 'pay_driver'], required: true },
  paymentStatus: { type: String, default: 'pending' },
  paymentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment' },
  partnerId: { type: mongoose.Schema.Types.ObjectId, ref: 'DeliveryPartner' },
  assignment: { type: mongoose.Schema.Types.Mixed, default: () => ({ attempts: [], reason: '' }) },
  proof: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
  cash: { type: mongoose.Schema.Types.Mixed, default: () => ({ status: 'outstanding', amountPaise: 0 }) },
  finance: { type: mongoose.Schema.Types.Mixed, default: () => ({ held: true, refundedPaise: 0 }) },
  cancellation: mongoose.Schema.Types.Mixed,
  exception: mongoose.Schema.Types.Mixed,
  history: [{ _id: false, status: String, action: String, actorId: mongoose.Schema.Types.ObjectId, actorType: String, at: Date, reason: String }],
}, { timestamps: true, optimisticConcurrency: true, minimize: false, autoIndex: false, autoCreate: false });
schema.index({ reference: 1 }, { unique: true });
schema.index({ customerId: 1, createdAt: -1 });
schema.index({ partnerId: 1, status: 1 });
schema.index({ status: 1, 'assignment.offer.expiresAt': 1 });
export default mongoose.model('ParcelDelivery', schema);
