import { httpError } from '../utils/response.js';

export const financeFlags = () => ({
  snapshots: process.env.FINANCE_SNAPSHOTS_ENABLED === 'true',
  operations: process.env.FINANCE_OPERATIONS_ENABLED === 'true',
  payouts: process.env.FINANCE_PAYOUTS_ENABLED === 'true',
  policyApproved: Boolean(process.env.FINANCE_POLICY_APPROVAL_REFERENCE?.trim()),
  testsApproved: Boolean(process.env.FINANCE_E2E_APPROVAL_REFERENCE?.trim()),
});
export const requireFinanceOperation = (kind = 'operations') => {
  const flags = financeFlags();
  if (!flags[kind] || !flags.policyApproved || !flags.testsApproved) {
    throw httpError(503, 'Financial operation disabled pending policy and end-to-end approval', { code: 'FINANCE_RELEASE_DISABLED' });
  }
};
export const financialTransaction = async (work) => {
  const { default: mongoose } = await import('mongoose');
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => { result = await work(session); });
    return result;
  } catch (error) {
    if (error.code === 20 || /Transaction numbers are only allowed|replica set|deployment does not support retryable writes/i.test(error.message)) {
      throw httpError(503, 'Financial operations require a MongoDB replica set or supported sharded transaction topology');
    }
    throw error;
  } finally { await session.endSession(); }
};
