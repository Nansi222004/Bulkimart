import React from 'react';
import { useSeller } from '../context/SellerContext';

const money = (value) => `₹${Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const label = (value) => String(value || '').replaceAll('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export const EarningsTab = () => {
  const { financeSummary, ledgerEntries, financeLoading, financeError, fetchSellerFinances, setActiveTab } = useSeller();
  const balances = financeSummary?.balances || {};
  const cards = [
    ['Earned earnings', balances.earnedEarnings, '#0f766e'], ['Pending earnings', balances.pending, '#0284c7'],
    ['Held earnings', balances.held, '#d97706'], ['Settlement eligible', balances.eligible, '#16a34a'],
    ['Reserved for payout', balances.reserved, '#7c3aed'], ['Paid / settled', balances.settled, '#334155'],
    ['Quick freight obligations', balances.quickFreightObligations, '#dc2626'], ['Bulkimart service fees', balances.bulkimartServiceFees, '#ea580c'],
  ];
  if (financeLoading) return <div style={{ padding: 40, textAlign: 'center', color: '#64748b' }}>Loading authoritative seller ledger…</div>;

  return <div style={{ padding: '0 4px 40px' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 18 }}>
      <div><h1 style={{ margin: 0, fontSize: 22, color: '#0f172a' }}>Earnings & settlements</h1>
        <p style={{ color: '#64748b', fontSize: 13 }}>Balances below come only from the append-only seller ledger.</p></div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={fetchSellerFinances} style={{ padding: '9px 14px', border: '1px solid #cbd5e1', borderRadius: 9, background: '#fff' }}>Refresh</button>
        <button disabled={!financeSummary?.payoutActionsEnabled} onClick={() => setActiveTab('moneyrequest')}
          title={!financeSummary?.payoutActionsEnabled ? 'No settlement-eligible balance' : 'Request payout'}
          style={{ padding: '9px 16px', border: 0, borderRadius: 9, color: '#fff', background: financeSummary?.payoutActionsEnabled ? '#0f9f91' : '#94a3b8', cursor: financeSummary?.payoutActionsEnabled ? 'pointer' : 'not-allowed' }}>Request payout</button>
      </div>
    </div>
    {financeError && <div style={{ padding: 14, background: '#fef2f2', color: '#991b1b', borderRadius: 10, marginBottom: 14 }}>{financeError}</div>}
    {financeSummary?.coverage && <div style={{ padding: 14, background: '#eff6ff', color: '#1e40af', border: '1px solid #bfdbfe', borderRadius: 10, marginBottom: 16, fontSize: 12 }}>
      Ledger v1 covers newly posted entries only. Historical orders are not backfilled or deducted. Funds remain ineligible until return-window and COD release policies are approved.
    </div>}
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 20 }}>
      {cards.map(([title, value, color]) => <div key={title} style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14, padding: 16 }}>
        <div style={{ fontSize: 12, color: '#64748b' }}>{title}</div><div style={{ marginTop: 6, fontSize: 21, fontWeight: 800, color }}>{money(value)}</div>
      </div>)}
    </div>
    <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14, overflow: 'hidden', marginBottom: 20 }}>
      <div style={{ padding: 16, fontWeight: 800 }}>Order-level ledger history</div><div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}><thead><tr style={{ background: '#f8fafc', textAlign: 'left' }}>
        {['Date', 'Reference', 'Description', 'Bucket', 'Credit', 'Debit', 'Status'].map((h) => <th key={h} style={{ padding: 12 }}>{h}</th>)}
      </tr></thead><tbody>{ledgerEntries.length ? ledgerEntries.map((entry) => <tr key={entry._id} style={{ borderTop: '1px solid #f1f5f9' }}>
        <td style={{ padding: 12 }}>{new Date(entry.createdAt).toLocaleString('en-IN')}</td><td style={{ padding: 12 }}>{entry.reference || entry.entryNo}</td>
        <td style={{ padding: 12 }}>{entry.description}</td><td style={{ padding: 12 }}>{label(entry.bucket)}</td>
        <td style={{ padding: 12, color: '#15803d' }}>{entry.direction === 'credit' ? money(entry.amount) : '—'}</td>
        <td style={{ padding: 12, color: '#b91c1c' }}>{entry.direction === 'debit' ? money(entry.amount) : '—'}</td><td style={{ padding: 12 }}>{label(entry.status)}</td>
      </tr>) : <tr><td colSpan="7" style={{ padding: 30, textAlign: 'center', color: '#64748b' }}>No ledger entries yet. Historical orders are intentionally not backfilled.</td></tr>}</tbody></table></div>
    </div>
    <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14, overflow: 'hidden' }}>
      <div style={{ padding: 16, fontWeight: 800 }}>Payout requests</div>
      {(financeSummary?.payouts || []).length ? financeSummary.payouts.map((payout) => <div key={payout._id} style={{ padding: '12px 16px', borderTop: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between' }}>
        <span>{payout.payoutNo} · {label(payout.status)}</span><strong>{money(payout.amount)}</strong>
      </div>) : <div style={{ padding: 24, color: '#64748b' }}>No payout requests.</div>}
    </div>
  </div>;
};

export default EarningsTab;
