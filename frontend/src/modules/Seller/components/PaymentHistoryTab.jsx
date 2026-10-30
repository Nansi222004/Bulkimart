import React from 'react';
import { useSeller } from '../context/SellerContext';
import { sellerMoney as money } from '../utils/sellerFinanceRead';
export const PaymentHistoryTab = () => {
  const { financeSummary, financeLoading, financeError, fetchSellerFinances } = useSeller();
  if (financeLoading) return <div role="status" style={{ padding: 32 }}>Loading payout history…</div>;
  return <div><h2>Payout history</h2>
    <p>Delivered orders appear in Earnings. Payout history shows requests and manually reconciled external transfers; submitting a request does not send money.</p>
    {(financeError || !financeSummary) && <button onClick={fetchSellerFinances}>Refresh</button>}
    {financeError && <div role="alert" style={{ color: '#991b1b' }}>{financeError}</div>}
    <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, overflow: 'hidden' }}>
      {(financeSummary?.payouts || []).length ? financeSummary.payouts.map((p) => <div key={p._id} style={{ padding: 14, borderTop: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between' }}>
        <span><strong>{p.payoutNo}</strong><br/><small>{p.status === 'APPROVED' ? 'Paid' : p.status === 'PENDING' ? 'Being processed' : `Rejected${p.rejectionReason ? `: ${p.rejectionReason}` : ''}`} {p.transactionRef ? `· Bank reference ${p.transactionRef}` : ''}</small></span><strong>{money(p.amount)}</strong>
      </div>) : <div role={!financeSummary && !financeError ? 'status' : undefined} style={{ padding: 28, color: '#64748b' }}>{financeError || !financeSummary ? 'Payout history could not be loaded. Please retry.' : 'No payout transaction has been recorded.'}</div>}
    </div></div>;
};
export default PaymentHistoryTab;
