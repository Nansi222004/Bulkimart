import mongoose from 'mongoose';

const { Schema, model } = mongoose;

/**
 * Admin-set payout and marketplace tax policy. One current document
 * (_id 'current'); every save bumps `revision` and appends the previous
 * values to `history`, so the audit trail survives edits.
 *
 * Rates are captured into each order's frozen financial snapshot at checkout,
 * so a later change never rewrites an existing order.
 */
const values = {
  tcsRatePercent: { type: Number, min: 0, max: 5, default: 0 },
  tdsRatePercent: { type: Number, min: 0, max: 5, default: 0 },
  sellerMinPayout: { type: Number, min: 0, default: 0 },
  riderMinPayout: { type: Number, min: 0 },
  payoutSchedule: { type: String, enum: ['on_request', 'weekly'], default: 'on_request' },
  payoutWeekday: { type: Number, min: 0, max: 6, default: 1 },
  requireIndependentPayoutReviewer: { type: Boolean, default: true },
  bankVerificationMethod: { type: String, trim: true, maxlength: 500, default: '' },
};

const financePolicySchema = new Schema({
  _id: { type: String, default: 'current' },
  ...values,
  revision: { type: Number, default: 0 },
  note: { type: String, trim: true, maxlength: 500 },
  updatedBy: { type: Schema.Types.ObjectId, ref: 'Admin' },
  history: [{ _id: false, revision: Number, changedAt: Date, changedBy: Schema.Types.ObjectId, note: String, values: Schema.Types.Mixed }],
}, { timestamps: true, collection: 'finance_policies' });

export const FINANCE_POLICY_FIELDS = Object.keys(values);
const FinancePolicy = model('FinancePolicy', financePolicySchema);
export default FinancePolicy;
