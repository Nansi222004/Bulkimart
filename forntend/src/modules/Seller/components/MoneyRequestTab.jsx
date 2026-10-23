import React from 'react';
import { useSeller } from '../context/SellerContext';
import { sellerMoney as money } from '../utils/sellerFinanceRead';

export const MoneyRequestTab = () => {
  const { payoutSubmitting, payoutAmount, setPayoutAmount, handleRequestPayout, financeSummary, financeLoading, financeError, fetchSellerFinances } = useSeller();
  const balances = financeSummary?.balances || {};
  const eligible = Number(balances.eligible || 0);
  const policy = financeSummary?.payoutPolicy;
  const minimum = Number(policy?.minimum || 0);
  const weekly = policy?.schedule === 'weekly';
  if (financeLoading) return <p role="status">Loading payout balances…</p>;
  if (financeError || !financeSummary) return <section><h1>Payout request</h1>
    <p role={financeError ? 'alert' : 'status'}>{financeError || 'Payout balances have not loaded yet.'}</p>
    <p>Payout balances and requests are unavailable. No zero balance or empty history has been confirmed.</p>
    <button onClick={fetchSellerFinances}>Refresh</button>
  </section>;

  return <div style={{ padding: '0 4px 40px', maxWidth: 820 }}>
    <h1 style={{ margin: 0, fontSize: 22, color: '#0f172a' }}>Payout request</h1>
    <p style={{ color: '#64748b', fontSize: 13 }}>Only money that is “Available to withdraw” can be requested. Earnings on hold become available when the order’s return window ends.</p>
    {financeError && <div style={{ padding: 12, borderRadius: 9, background: '#fef2f2', color: '#991b1b' }}>{financeError}</div>}
    <div style={{ padding: 22, borderRadius: 18, color: '#fff', background: 'linear-gradient(135deg,#0891b2,#0f766e)', margin: '18px 0' }}>
      <div style={{ fontSize: 11, textTransform: 'uppercase' }}>Available to withdraw</div><div style={{ fontSize: 34, fontWeight: 900 }}>{money(eligible)}</div>
      <div style={{ marginTop: 10, fontSize: 12 }}>On hold: {money(balances.held)} · Pending: {money(balances.pending)} · Already requested: {money(balances.reserved)}</div>
    </div>
    <div style={{ background: '#fff', border: '1px solid #e2e8f0', padding: 20, borderRadius: 16 }}>
      {weekly && <p role="status" style={{ marginTop: 0 }}>Payouts are sent automatically every week, so there is nothing to request. Your full available balance is included in the next weekly payout.</p>}
      <form onSubmit={handleRequestPayout}>
        <label htmlFor="payout-amount" style={{ display: 'block', fontWeight: 700, marginBottom: 7 }}>Amount</label>
        <input id="payout-amount" type="number" min={minimum > 0 ? minimum : 0.01} step="0.01" max={eligible} value={payoutAmount} onChange={(e) => setPayoutAmount(e.target.value)}
          disabled={payoutSubmitting || !financeSummary.payoutActionsEnabled || eligible <= 0} style={{ width: '100%', boxSizing: 'border-box', padding: 12, border: '1px solid #cbd5e1', borderRadius: 9 }} />
        <small style={{ display: 'block', color: '#64748b', marginTop: 6 }}>Up to {money(eligible)}{minimum > 0 ? `; at least ${money(minimum)}` : ''}. Money goes to the bank account in your profile.</small>
        <button type="submit" disabled={payoutSubmitting || !financeSummary.payoutActionsEnabled || eligible <= 0 || Number(payoutAmount) > eligible || (minimum > 0 && Number(payoutAmount) < minimum)}
          style={{ width: '100%', marginTop: 14, padding: 12, border: 0, borderRadius: 9, color: '#fff', background: eligible > 0 ? '#0f9f91' : '#94a3b8' }}>
          {payoutSubmitting ? 'Submitting request…' : eligible <= 0 ? 'No eligible balance' : !financeSummary.payoutActionsEnabled ? 'Payout requests are currently disabled' : 'Request payout'}
        </button>
      </form>
      <p style={{ color: '#64748b', fontSize: 12 }}>Bulkimart checks your bank account, then sends the money manually outside this app. You will see “Paid” with the bank reference once it is done.</p>
    </div>
    <div style={{ marginTop: 18, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 16, overflow: 'hidden' }}>
      <div style={{ padding: 15, fontWeight: 800 }}>Requests</div>
      {(financeSummary?.payouts || []).length ? financeSummary.payouts.map((p) => <div key={p._id} style={{ padding: 13, borderTop: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between' }}><span>{p.payoutNo} · {p.status === 'APPROVED' ? 'Paid' : p.status === 'PENDING' ? 'Being processed' : 'Rejected'}</span><strong>{money(p.amount)}</strong></div>) : <div style={{ padding: 20, color: '#64748b' }}>No payout requests.</div>}
    </div>
  </div>;
};

export default MoneyRequestTab;
