import crypto from 'node:crypto';
import mongoose from 'mongoose';
import FinancePolicy, { FINANCE_POLICY_FIELDS } from '../models/FinancePolicy.js';
import { DELIVERY_MIN_PAYOUT_AMOUNT } from '../constants/enums.js';
import { moneyPaise } from '../utils/financeMoney.js';
import { httpError } from '../utils/response.js';

// The beneficiary-verification process the payout settlement checks against.
// It is written from the admin policy screen instead of by hand in the database.
export const BANK_VERIFICATION_PROCESS_ID = 'BULKIMART-BANK-VERIFICATION';

const defaults = () => ({
  tcsRatePercent: 0, tdsRatePercent: 0, sellerMinPayout: 0, riderMinPayout: DELIVERY_MIN_PAYOUT_AMOUNT,
  payoutSchedule: 'on_request', payoutWeekday: 1, requireIndependentPayoutReviewer: true, bankVerificationMethod: '',
});

export const getFinancePolicy = async ({ session = null } = {}) => {
  const query = FinancePolicy.findById('current').lean();
  if (session) query.session(session);
  const saved = await query;
  const policy = { ...defaults(), revision: 0, configured: false };
  if (!saved) return policy;
  for (const key of FINANCE_POLICY_FIELDS) if (saved[key] !== undefined && saved[key] !== null) policy[key] = saved[key];
  return { ...policy, revision: saved.revision, configured: true, note: saved.note, updatedBy: saved.updatedBy, updatedAt: saved.updatedAt, history: saved.history || [] };
};

const rate = (value, name) => {
  const number = Number(value);
  if (value === '' || value == null || !Number.isFinite(number) || number < 0 || number > 5) throw httpError(400, `${name} must be between 0 and 5 percent`);
  moneyPaise(number, name);
  return number;
};
const amount = (value, name) => {
  const number = Number(value);
  if (value === '' || value == null || !Number.isFinite(number) || number < 0) throw httpError(400, `${name} must be zero or more`);
  moneyPaise(number, name);
  return number;
};

export const validateFinancePolicy = (input = {}) => {
  if (!['on_request', 'weekly'].includes(input.payoutSchedule)) throw httpError(400, 'Choose a payout schedule');
  const weekday = Number(input.payoutWeekday);
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) throw httpError(400, 'Choose a payout weekday');
  if (typeof input.requireIndependentPayoutReviewer !== 'boolean') throw httpError(400, 'Choose whether a second admin must confirm payouts');
  const method = String(input.bankVerificationMethod || '').trim();
  if (method && (method.length < 5 || method.length > 500)) throw httpError(400, 'Bank verification method must be 5–500 characters');
  const note = String(input.note || '').trim();
  if (note.length < 5 || note.length > 500) throw httpError(400, 'A change reason of 5–500 characters is required');
  return {
    values: {
      tcsRatePercent: rate(input.tcsRatePercent, 'TCS rate'), tdsRatePercent: rate(input.tdsRatePercent, 'TDS rate'),
      sellerMinPayout: amount(input.sellerMinPayout, 'Seller minimum payout'), riderMinPayout: amount(input.riderMinPayout, 'Rider minimum payout'),
      payoutSchedule: input.payoutSchedule, payoutWeekday: weekday,
      requireIndependentPayoutReviewer: input.requireIndependentPayoutReviewer, bankVerificationMethod: method,
    },
    note,
  };
};

export const saveFinancePolicy = async (input, adminId) => {
  const { values, note } = validateFinancePolicy(input);
  const { financialTransaction } = await import('./financeSafety.service.js');
  return financialTransaction(async session => {
    const current = await FinancePolicy.findById('current').session(session);
    const revision = current?.revision || 0;
    if (Number(input.revision ?? 0) !== revision) throw httpError(409, 'Finance policy changed; reload before saving');
    const previous = current ? Object.fromEntries(FINANCE_POLICY_FIELDS.map(key => [key, current[key]])) : null;
    const update = { $set: { ...values, revision: revision + 1, note, updatedBy: adminId } };
    if (previous) update.$push = { history: { $each: [{ revision, changedAt: current.updatedAt, changedBy: current.updatedBy, note: current.note, values: previous }], $slice: -50 } };
    const result = await FinancePolicy.updateOne({ _id: 'current', revision }, update, { upsert: !current, session });
    if (current && !result.matchedCount) throw httpError(409, 'Finance policy changed; reload before saving');
    if (values.bankVerificationMethod && values.bankVerificationMethod !== previous?.bankVerificationMethod) {
      // A changed method is a new process version, so earlier reviews must be renewed.
      const version = crypto.createHash('sha256').update(values.bankVerificationMethod).digest('hex').slice(0, 16);
      await mongoose.connection.collection('finance_approved_processes').updateOne({ _id: BANK_VERIFICATION_PROCESS_ID }, { $set: {
        kind: 'bank_beneficiary_verification', status: 'approved', approvedBy: new mongoose.Types.ObjectId(String(adminId)),
        approvalEvidenceReference: `finance-policy-r${revision + 1}`, version, description: values.bankVerificationMethod, effectiveAt: new Date(),
      } }, { upsert: true, session });
    }
    return getFinancePolicy({ session });
  });
};
