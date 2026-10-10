import React from 'react';
import { EmptyState } from './EmptyState';

/**
 * Payout transaction history.
 *
 * This screen used to list four invented NEFT/IMPS transfers against an HDFC
 * account that no seller here has, and summed them into a "Total Received"
 * figure. There is no payout system behind any of it — no transfers are made,
 * so there is nothing to list. Showing the shell with real-looking rows told
 * sellers they had been paid.
 */
export const PaymentHistoryTab = () => (
  <EmptyState
    icon="💳"
    title="No payout transactions"
    message="Bank transfers to sellers are not processed yet, so there is no payment history to show. Your gross sales are on the Earnings tab."
    notBuilt
  />
);

export default PaymentHistoryTab;
