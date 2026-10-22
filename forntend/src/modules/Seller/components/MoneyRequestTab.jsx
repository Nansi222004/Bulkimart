import React from 'react';
import { useSeller } from '../context/SellerContext';

const money = (value) => `₹${Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const MoneyRequestTab = () => {
  const { payoutAmount, setPayoutAmount, handleRequestPayout, financeSummary, financeLoading, financeError, fetchSellerFinances } = useSeller();
  const balances = financeSummary?.balances || {};
  const eligible = Number(balances.eligible || 0);

  return <div style={{ padding: '0 4px 40px', maxWidth: 820 }}>
    <h1 style={{ margin: 0, fontSize: 22, color: '#0f172a' }}>Payout request</h1>
    <p style={{ color: '#64748b', fontSize: 13 }}>Only settlement-eligible ledger funds can be reserved for payout.</p>
    {financeError && <div style={{ padding: 12, borderRadius: 9, background: '#fef2f2', color: '#991b1b' }}>{financeError}</div>}
    <div style={{ padding: 22, borderRadius: 18, color: '#fff', background: 'linear-gradient(135deg,#0891b2,#0f766e)', margin: '18px 0' }}>
      <div style={{ fontSize: 11, textTransform: 'uppercase' }}>Settlement-eligible balance</div><div style={{ fontSize: 34, fontWeight: 900 }}>{money(eligible)}</div>
      <div style={{ marginTop: 10, fontSize: 12 }}>Held: {money(balances.held)} · Pending: {money(balances.pending)} · Reserved: {money(balances.reserved)}</div>
    </div>
    <div style={{ background: '#fff', border: '1px solid #e2e8f0', padding: 20, borderRadius: 16 }}>
      <form onSubmit={handleRequestPayout}>
        <label htmlFor="payout-amount" style={{ display: 'block', fontWeight: 700, marginBottom: 7 }}>Amount</label>
        <input id="payout-amount" type="number" min="0.01" step="0.01" max={eligible} value={payoutAmount} onChange={(e) => setPayoutAmount(e.target.value)}
          disabled={financeLoading || eligible <= 0} style={{ width: '100%', boxSizing: 'border-box', padding: 12, border: '1px solid #cbd5e1', borderRadius: 9 }} />
        <button type="submit" disabled={financeLoading || eligible <= 0 || Number(payoutAmount) > eligible}
          style={{ width: '100%', marginTop: 14, padding: 12, border: 0, borderRadius: 9, color: '#fff', background: eligible > 0 ? '#0f9f91' : '#94a3b8' }}>
          {eligible > 0 ? 'Reserve and request payout' : 'No eligible balance'}
        </button>
      </form>
      <p style={{ color: '#64748b', fontSize: 12 }}>Held and pending funds cannot be withdrawn. A request reserves funds immediately; an admin can mark it paid only with a confirmed bank reference.</p>
    </div>
    <div style={{ marginTop: 18, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 16, overflow: 'hidden' }}>
      <div style={{ padding: 15, fontWeight: 800 }}>Requests</div>
      {(financeSummary?.payouts || []).length ? financeSummary.payouts.map((p) => <div key={p._id} style={{ padding: 13, borderTop: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between' }}><span>{p.payoutNo} · {p.status}</span><strong>{money(p.amount)}</strong></div>) : <div style={{ padding: 20, color: '#64748b' }}>No payout requests.</div>}
    </div>
  </div>;
};

export default MoneyRequestTab;
