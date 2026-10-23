import { useFeedback } from '../../../components/feedback/FeedbackProvider';
import React, { useEffect, useRef, useState } from 'react';
import { adminGet, adminPatch } from '../../../utils/adminApi';

const money = v => typeof v === 'number' && Number.isFinite(v) ? `₹${v.toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '—';
export default function SellerLedgerAdminTab({ view = 'earnings' }) {
  const ui = useFeedback();
  const actionLock = useRef(false); const [working, setWorking] = useState(false);
  const withLock = work => async (...args) => { if (actionLock.current) return; actionLock.current = true; setWorking(true); try { return await work(...args); } finally { actionLock.current = false; setWorking(false); } };
  const [rows, setRows] = useState([]); const [ledger, setLedger] = useState([]);
  const [loading, setLoading] = useState(true); const [error, setError] = useState('');
  const load = async () => {
    setLoading(true); setError('');
    try {
      if (view === 'payouts') {
        const result = await adminGet('/vendor-payouts');
        if (!Array.isArray(result.data) || result.data.some(row => !row?._id || typeof row.amount !== 'number' || !Number.isFinite(row.amount) || row.amount <= 0 || !['pending','approved','rejected'].includes(row.status) || typeof row.settlementEligible !== 'boolean')) throw new Error('Payout review data is incomplete. No empty result has been confirmed.');
        setRows(result.data);
      }
      else {
        const [summary, entries] = await Promise.all([adminGet('/seller-balances'), adminGet('/seller-ledger?limit=100')]);
        if (!Array.isArray(summary.data?.rows) || !Array.isArray(entries.data) || summary.data.rows.some(row => ['pending','held','eligible','reserved','settled','quickFreightObligations','bulkimartServiceFees'].some(key => typeof row.balances?.[key] !== 'number' || !Number.isFinite(row.balances[key])))) throw new Error('Seller finance data is incomplete. Missing balances are unavailable.');
        setRows(summary.data.rows); setLedger(entries.data);
      }
    } catch (e) { setError(e.message); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [view]);
  const settle = withLock(async (payout) => {
    const ref = await ui.collect('Enter the confirmed bank transaction reference. This must only be done after the transfer succeeds.', {title:'Bank transaction reference', inputLabel:'Transaction reference'});
    if (ref === null) return;
    const reason = await ui.collect('Describe the independent bank verification evidence.', { title: 'Reconciliation evidence', inputLabel: 'Verification reason' });
    if (reason === null) return;
    return ui.perform({title:'Record this payout as paid?',message:`Reconcile ${payout.payoutRef} · ${money(payout.amount)} INR · ${payout.storeName || payout.sellerId?._id || payout.sellerId} · account ending ${payout.destination?.accountLast4 || 'verified UPI destination'} · verification process ${payout.beneficiaryVerification?.processVersion || 'unverified'} using ${ref}? Only confirm after the external bank transfer has succeeded.`,confirmLabel:'Record as paid'}, async () => {
      await adminPatch(`/vendor-payouts/${payout._id}/settle`, {transactionRef:ref, reason, verified:true});
      await load();
    });
  });
  const reject = withLock(async payout => {
    const reason = await ui.collect('Explain why this payout reservation should be released.', {title:'Reject payout', inputLabel:'Rejection reason'});
    if (reason === null) return;
    return ui.perform({title:'Reject this payout?',message:'This returns the reservation through auditable ledger entries. Existing holds and refund debts still apply.',confirmLabel:'Reject payout'}, async () => {
      await adminPatch(`/vendor-payouts/${payout._id}/reject`, {reason}); await load();
    });
  });
  const reviewBeneficiary = withLock(async payout => {
    const evidenceReference = await ui.collect('Enter the ownership-verification evidence reference from the approved external process. Account details alone are not verification.', { title: 'Beneficiary review', inputLabel: 'Ownership evidence reference' });
    if (!evidenceReference) return;
    const approvalReference = await ui.collect('Enter the approval reference for the bank verification process.', { title: 'Approved process', inputLabel: 'Process approval reference' });
    if (!approvalReference) return;
    const reason = await ui.collect('Describe the reviewed ownership evidence for this destination.', { title: 'Review reason', inputLabel: 'Reason' });
    if (!reason) return;
    return ui.perform({ title: 'Record beneficiary verification?', message: payout.payoutRef + ' · ' + money(payout.amount) + ' INR · account ending ' + (payout.destination?.accountLast4 || 'UPI destination') + '. Another finance operator must reconcile the successful external transfer.', confirmLabel: 'Record reviewed evidence' }, async () => {
      await adminPatch('/vendor-payouts/' + payout._id + '/beneficiary-review', { evidenceReference, approvalReference, reason, fingerprint: payout.destinationFingerprint }); await load();
    });
  });
  if (loading) return <div style={{ padding: 40 }}>Loading authoritative seller finances…</div>;
  if (error) return <div role="alert">{error}<button onClick={load}>Retry finance read</button></div>;
  return <div><h2>{view === 'payouts' ? 'Seller payout allocations' : 'Seller ledger balances'}</h2>
    <p style={{ color: '#64748b' }}>Historical orders are excluded. Amounts shown are derived from append-only ledger entries.</p>
    {error && <div style={{ padding: 12, background: '#fef2f2', color: '#991b1b' }}>{error}</div>}
    <div tabIndex={0} role="region" aria-label="Scrollable data table" style={{ overflowX: 'auto', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12 }}><table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
      {view === 'payouts' ? <><thead><tr>{['Reference','Seller','Amount','Status','Transaction','Action'].map(h => <th key={h} style={{ padding: 12, textAlign: 'left' }}>{h}</th>)}</tr></thead>
        <tbody>{rows.length ? rows.map(p => <tr key={p._id} style={{ borderTop: '1px solid #eee' }}><td style={{ padding: 12 }}>{p.payoutRef}</td><td>{p.storeName}</td><td>{money(p.amount)}</td><td>{p.status === 'approved' ? 'External transfer confirmed / reconciled' : p.status === 'pending' ? 'Pending Admin review' : 'Rejected'}</td><td>{p.transactionRef || p.settlementBlocker || '—'}</td><td>{p.status === 'pending' ? <>{(p.beneficiaryReviewRequired || !p.beneficiaryVerification?.verifiedAt) && <button disabled={working || !p.destinationFingerprint} onClick={() => reviewBeneficiary(p)}>Review beneficiary evidence</button>}<button disabled={working || !p.settlementEligible} onClick={() => settle(p)}>Reconcile external transfer</button><button disabled={working} onClick={() => reject(p)}>Reject</button></> : '—'}</td></tr>) : <tr><td colSpan="6" style={{ padding: 25 }}>No payout requests.</td></tr>}</tbody></>
        : <><thead><tr>{['Seller','Pending','Held','Eligible','Reserved','Settled','Freight obligations','Service fees'].map(h => <th key={h} style={{ padding: 12, textAlign: 'left' }}>{h}</th>)}</tr></thead>
        <tbody>{rows.map(r => <tr key={r.sellerId} style={{ borderTop: '1px solid #eee' }}><td style={{ padding: 12 }}>{r.storeName}</td>{['pending','held','eligible','reserved','settled','quickFreightObligations','bulkimartServiceFees'].map(k => <td key={k}>{money(r.balances?.[k])}</td>)}</tr>)}</tbody></>}
    </table></div>
    {view !== 'payouts' && <div style={{ marginTop: 18, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 16 }}><h3>Recent ledger entries</h3>
      {ledger.length ? ledger.map(e => <div key={e._id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '9px 0', borderTop: '1px solid #f1f5f9' }}><span>{e.sellerId?.storeDetails?.name || e.sellerId?.businessName} · {e.description}</span><strong>{e.direction === 'debit' ? '−' : '+'}{money(e.amount)}</strong></div>) : <div>No ledger entries.</div>}</div>}
  </div>;
}
