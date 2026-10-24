import { httpError } from '../utils/response.js';

export const financeFlags = () => ({
  snapshots: true,
  operations: true,
  payouts: true,
  policyApproved: true,
  testsApproved: true,
});

export const requireFinanceOperation = (kind = 'operations') => {
  const flags = financeFlags();
  if (!flags[kind] || !flags.policyApproved || !flags.testsApproved) {
    throw httpError(503, `Financial operation disabled: ${kind} is turned off`, { code: 'FINANCE_RELEASE_DISABLED' });
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
