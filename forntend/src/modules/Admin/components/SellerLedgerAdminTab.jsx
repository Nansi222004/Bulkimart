import { useFeedback } from '../../../components/feedback/FeedbackProvider';
import React, { useEffect, useState } from 'react';
import { adminGet, adminPatch } from '../../../utils/adminApi';

const money = (v) => `₹${Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
export default function SellerLedgerAdminTab({ view = 'earnings' }) {
  const ui = useFeedback();
  const [rows, setRows] = useState([]); const [ledger, setLedger] = useState([]);
  const [loading, setLoading] = useState(true); const [error, setError] = useState('');
  const load = async () => {
    setLoading(true); setError('');
    try {
      if (view === 'payouts') setRows((await adminGet('/vendor-payouts')).data || []);
      else {
        const [summary, entries] = await Promise.all([adminGet('/seller-balances'), adminGet('/seller-ledger?limit=100')]);
        setRows(summary.data?.rows || []); setLedger(entries.data || []);
      }
    } catch (e) { setError(e.message); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [view]);
  const settle = async (payout) => {
    const ref = await ui.collect('Enter the confirmed bank transaction reference. This must only be done after the transfer succeeds.', {title:'Bank transaction reference', inputLabel:'Transaction reference'});
    if (ref === null) return;
    return ui.perform({title:'Record this payout as paid?',message:`Record ${payout.payoutRef} as paid using ${ref}? Only confirm after the bank transfer has succeeded.`,confirmLabel:'Record as paid'}, async () => {
      await adminPatch(`/vendor-payouts/${payout._id}/settle`, {transactionRef:ref});
      await load();
    });
  };
  if (loading) return <div style={{ padding: 40 }}>Loading authoritative seller finances…</div>;
  return <div><h2>{view === 'payouts' ? 'Seller payout allocations' : 'Seller ledger balances'}</h2>
    <p style={{ color: '#64748b' }}>Historical orders are excluded. Amounts shown are derived from append-only ledger entries.</p>
    {error && <div style={{ padding: 12, background: '#fef2f2', color: '#991b1b' }}>{error}</div>}
    <div tabIndex={0} role="region" aria-label="Scrollable data table" style={{ overflowX: 'auto', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12 }}><table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
      {view === 'payouts' ? <><thead><tr>{['Reference','Seller','Amount','Status','Transaction','Action'].map(h => <th key={h} style={{ padding: 12, textAlign: 'left' }}>{h}</th>)}</tr></thead>
        <tbody>{rows.length ? rows.map(p => <tr key={p._id} style={{ borderTop: '1px solid #eee' }}><td style={{ padding: 12 }}>{p.payoutRef}</td><td>{p.storeName}</td><td>{money(p.amount)}</td><td>{p.status}</td><td>{p.transactionRef || p.settlementBlocker || '—'}</td><td>{p.status === 'pending' && p.settlementEligible ? <button onClick={() => settle(p)}>Confirm paid</button> : '—'}</td></tr>) : <tr><td colSpan="6" style={{ padding: 25 }}>No payout requests.</td></tr>}</tbody></>
        : <><thead><tr>{['Seller','Pending','Held','Eligible','Reserved','Settled','Freight obligations','Service fees'].map(h => <th key={h} style={{ padding: 12, textAlign: 'left' }}>{h}</th>)}</tr></thead>
        <tbody>{rows.map(r => <tr key={r.sellerId} style={{ borderTop: '1px solid #eee' }}><td style={{ padding: 12 }}>{r.storeName}</td>{['pending','held','eligible','reserved','settled','quickFreightObligations','bulkimartServiceFees'].map(k => <td key={k}>{money(r.balances?.[k])}</td>)}</tr>)}</tbody></>}
    </table></div>
    {view !== 'payouts' && <div style={{ marginTop: 18, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 16 }}><h3>Recent ledger entries</h3>
      {ledger.length ? ledger.map(e => <div key={e._id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '9px 0', borderTop: '1px solid #f1f5f9' }}><span>{e.sellerId?.storeDetails?.name || e.sellerId?.businessName} · {e.description}</span><strong>{e.direction === 'debit' ? '−' : '+'}{money(e.amount)}</strong></div>) : <div>No ledger entries.</div>}</div>}
  </div>;
}
