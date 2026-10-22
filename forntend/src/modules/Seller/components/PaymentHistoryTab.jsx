import React from 'react';
import { useSeller } from '../context/SellerContext';

const money = (v) => `₹${Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
export const PaymentHistoryTab = () => {
  const { financeSummary, financeLoading, financeError, fetchSellerFinances } = useSeller();
  if (financeLoading) return <div style={{ padding: 32 }}>Loading payout history…</div>;
  return <div><h2>Payout history</h2>
    <p>Delivered orders appear in Earnings. Payout history shows payout requests and recorded settlements.</p>
    <button onClick={fetchSellerFinances}>Refresh</button>
    {financeError && <div role="alert" style={{ color: '#991b1b' }}>{financeError}</div>}
    <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, overflow: 'hidden' }}>
      {(financeSummary?.payouts || []).length ? financeSummary.payouts.map((p) => <div key={p._id} style={{ padding: 14, borderTop: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between' }}>
        <span><strong>{p.payoutNo}</strong><br/><small>{p.status} {p.transactionRef ? `· ${p.transactionRef}` : ''}</small></span><strong>{money(p.amount)}</strong>
      </div>) : <div style={{ padding: 28, color: '#64748b' }}>{financeError ? 'Payout history could not be loaded. Please retry.' : 'No payout transaction has been recorded.'}</div>}
    </div></div>;
};
export default PaymentHistoryTab;
