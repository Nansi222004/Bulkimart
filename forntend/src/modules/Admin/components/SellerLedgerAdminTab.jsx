import { useFeedback } from '../../../components/feedback/FeedbackProvider';
import React, { useEffect, useRef, useState } from 'react';
import { adminGet, adminPatch } from '../../../utils/adminApi';

const money = v => typeof v === 'number' && Number.isFinite(v) ? `₹${v.toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '—';
const COVERAGE = { original_terms_missing: 'Original order financial terms need review', commission_terms_missing: 'Original commission terms are missing', cod_confirmation_pending: 'COD receipt awaits confirmation', processing_review_required: 'Earnings processing needs review', payment_or_posting_pending: 'Payment confirmation or earnings posting pending' };
function completedSales(row) {
  const metrics = row.salesMetrics;
  return <>
    <strong>{money(metrics?.totalRevenue)}</strong>
    <small style={{ display: 'block' }}>{metrics?.completedOrders ?? '—'} delivered orders across all storefronts · after customer discounts</small>
    {Number.isFinite(metrics?.grossSales) && Number.isFinite(metrics?.customerDiscounts) && <p>Gross product sales: {money(metrics.grossSales)}<br />Customer discounts: {money(metrics.customerDiscounts)}</p>}
    {row.salesByChannel && <p>Shop All: {money(row.salesByChannel.ecommerce?.revenue)}<br />Quick Commerce: {money(row.salesByChannel.grocery?.revenue)}</p>}
  </>;
}
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
    const ref = await ui.collect('Send the money from Bulkimart’s bank first. Then enter the bank reference (UTR) from your bank statement, e.g. 412345678901.', {title:'Bank reference (UTR)', inputLabel:'Bank reference'});
    if (ref === null) return;
    const reason = await ui.collect('How did you confirm the transfer succeeded? e.g. “Seen as debited in HDFC statement on 23 Oct”.', { title: 'How you confirmed it', inputLabel: 'Confirmation note' });
    if (reason === null) return;
    return ui.perform({title:'Mark this payout as paid?',message:`${payout.payoutRef} · ${money(payout.amount)} to ${payout.storeName || payout.sellerId?._id || payout.sellerId} · account ending ${payout.destination?.accountLast4 || 'UPI'} · bank reference ${ref}. Only confirm after the money has left Bulkimart’s account.`,confirmLabel:'Mark as paid'}, async () => {
      await adminPatch(`/vendor-payouts/${payout._id}/settle`, {transactionRef:ref, reason, verified:true});
      await load();
    });
  });
  const reject = withLock(async payout => {
    const reason = await ui.collect('Why are you rejecting this request? The seller sees this. The amount goes back to their available balance. e.g. “Bank account name does not match”.', {title:'Reject payout', inputLabel:'Rejection reason'});
    if (reason === null) return;
    return ui.perform({title:'Reject this payout?',message:'The amount returns to the seller’s available balance.',confirmLabel:'Reject payout'}, async () => {
      await adminPatch(`/vendor-payouts/${payout._id}/reject`, {reason}); await load();
    });
  });
  const reviewBeneficiary = withLock(async payout => {
    const evidenceReference = await ui.collect('Check the bank account belongs to this seller using the method saved in Finance Settings → Payouts & tax. Enter the proof reference, e.g. a penny-drop transaction ID.', { title: 'Check bank account', inputLabel: 'Proof reference' });
    if (!evidenceReference) return;
    const reason = await ui.collect('What did the check show? e.g. “Account holder name matches GST certificate”.', { title: 'Check result', inputLabel: 'Result' });
    if (!reason) return;
    return ui.perform({ title: 'Record the bank account check?', message: payout.payoutRef + ' · ' + money(payout.amount) + ' · account ending ' + (payout.destination?.accountLast4 || 'UPI') + '.', confirmLabel: 'Record check' }, async () => {
      await adminPatch('/vendor-payouts/' + payout._id + '/beneficiary-review', { evidenceReference, reason, fingerprint: payout.destinationFingerprint }); await load();
    });
  });
  if (loading) return <div style={{ padding: 40 }}>Loading authoritative seller finances…</div>;
  if (error) return <div role="alert">{error}<button onClick={load}>Retry finance read</button></div>;
  return <div><h2>{view === 'payouts' ? 'Seller payouts' : 'Seller balances'}</h2>
    <p style={{ color: '#64748b' }}>{view === 'payouts' ? 'To pay a request: 1) Check bank account, 2) send the money from Bulkimart’s bank, 3) Mark as paid with the bank reference.' : '“On hold” waits for the return window. “Available” can be withdrawn. Orders placed before the finance system started are under Reports → Old orders.'}</p>
    {error && <div style={{ padding: 12, background: '#fef2f2', color: '#991b1b' }}>{error}</div>}
    <div tabIndex={0} role="region" aria-label="Scrollable data table" style={{ overflowX: 'auto', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12 }}><table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
      {view === 'payouts' ? <><thead><tr>{['Reference','Seller','Amount','Status','Bank reference / what’s needed','Action'].map(h => <th key={h} style={{ padding: 12, textAlign: 'left' }}>{h}</th>)}</tr></thead>
        <tbody>{rows.length ? rows.map(p => <tr key={p._id} style={{ borderTop: '1px solid #eee' }}><td style={{ padding: 12 }}>{p.payoutRef}</td><td>{p.storeName}</td><td>{money(p.amount)}</td><td>{p.status === 'approved' ? 'Paid' : p.status === 'pending' ? (p.beneficiaryReviewRequired || !p.beneficiaryVerification?.verifiedAt ? 'Waiting: check bank account' : 'Waiting: send money') : 'Rejected'}</td><td>{p.transactionRef || p.settlementBlocker || '—'}</td><td>{p.status === 'pending' ? <>{(p.beneficiaryReviewRequired || !p.beneficiaryVerification?.verifiedAt) && <button disabled={working || !p.destinationFingerprint} onClick={() => reviewBeneficiary(p)}>Check bank account</button>}<button disabled={working || !p.settlementEligible} onClick={() => settle(p)}>Mark as paid</button><button disabled={working} onClick={() => reject(p)}>Reject</button></> : '—'}</td></tr>) : <tr><td colSpan="6" style={{ padding: 25 }}>No payout requests.</td></tr>}</tbody></>
        : <><thead><tr>{['Seller','Completed product sales','Pending','On hold','Available','Payout requested','Paid','Shiprocket freight','Shiprocket fees'].map(h => <th key={h} style={{ padding: 12, textAlign: 'left' }}>{h}</th>)}</tr></thead>
        <tbody>{rows.map(r => <tr key={r.sellerId} style={{ borderTop: '1px solid #eee' }}>
          <td style={{ padding: 12 }}>{r.storeName}</td>
          <td style={{ padding: 12, minWidth: 250 }}>
            {completedSales(r)}
            {r.unpostedSales ? <>
              {r.unpostedSales.orderCount > 0 && <p><strong>{r.unpostedSales.orderCount} orders await settlement posting</strong></p>}
              {r.unpostedSales.reasons.map(issue => <p key={issue.code}>{issue.orderCount} · {COVERAGE[issue.code] || issue.code}</p>)}
              {r.unpostedSales.orderCount > 0 && <a href="/admin/finance-center?area=orders&view=orders">Review order finances</a>}
              {r.unpostedSales.reasons.some(issue => issue.code === 'original_terms_missing') && <p><a href="/admin/finance-center?area=reports&view=historical">Review old orders</a></p>}
            </> : <p>Settlement coverage unavailable</p>}
          </td>
          {['pending','held','eligible','reserved','settled','quickFreightObligations','bulkimartServiceFees'].map(k => <td key={k}>{money(r.balances?.[k])}</td>)}
        </tr>)}</tbody></>}
    </table></div>
    {view !== 'payouts' && <div style={{ marginTop: 18, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 16 }}><h3>Recent ledger entries</h3>
      {ledger.length ? ledger.map(e => <div key={e._id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '9px 0', borderTop: '1px solid #f1f5f9' }}><span>{e.sellerId?.storeDetails?.name || e.sellerId?.businessName} · {e.description}</span><strong>{e.direction === 'debit' ? '−' : '+'}{money(e.amount)}</strong></div>) : <div>No ledger entries.</div>}</div>}
  </div>;
}
