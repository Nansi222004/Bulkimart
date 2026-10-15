// Deliberately never serialize the driver error: its message can contain data.
export function checkoutFailureDetails(error, { requestId, operation, stage, session } = {}) {
  const keyPattern = Object.fromEntries(Object.entries(error.keyPattern || {}).filter(([key]) => /^[\w.]{1,120}$/.test(key)));
  return {
    event: 'checkout_database_failure', requestId, operation, stage,
    errorName: error.name, databaseCode: error.code,
    index: error.message?.match(/index: ([\w.:-]{1,160}) /)?.[1],
    keyPattern,
    keyValue: Object.fromEntries(Object.keys(keyPattern).map(key => [key, error.keyValue?.[key] == null ? null : '[redacted]'])),
    transactionState: session?.transaction?.state || 'unavailable',
    stackFrames: String(error.stack || '').split('\n').filter(line => /^\s+at /.test(line)).slice(0, 8),
  };
}

export const logCheckoutFailure = (error, context) => console.error(JSON.stringify(checkoutFailureDetails(error, context)));
