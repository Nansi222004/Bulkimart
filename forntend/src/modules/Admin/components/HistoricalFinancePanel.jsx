import React, { useEffect, useState } from 'react';
import { adminGet, adminPost } from '../../../utils/adminApi';
import { hint, rupeesFromPaise as money } from './financeText';

const STATUS = { pending_approval: 'Waiting for a second admin', approved: 'Approved — ready to apply', applied: 'Applied — earnings on hold', released: 'Released — available to pay', rejected: 'Rejected' };
const blankRow = row => ({ orderId: row.orderId, itemId: row.itemId, orderNo: row.orderNo, grossPaise: Math.round(Number(row.evidence.price) * 100) * row.evidence.qty,
  needsCod: row.evidence.payment?.method === 'cod', needsRefund: row.evidence.returns.length > 0, needsPayout: row.evidence.payouts.length > 0 || row.evidence.unattributedEntries.length > 0,
  commission: '', commissionGst: '', agreementReference: '', fundingEvidenceReference: '', entitlementApprovalReference: '', codCustodyApprovalReference: '', refundReconciliationReference: '', priorPayoutReconciliationReference: '' });

export default function HistoricalFinancePanel() {
  const [page, setPage] = useState(1), [report, setReport] = useState(null), [error, setError] = useState('');
  const [loading, setLoading] = useState(true), [batches, setBatches] = useState([]), [draft, setDraft] = useState([]), [note, setNote] = useState('');
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [reviewNotes, setReviewNotes] = useState({});
  useEffect(() => {
    let active = true; setLoading(true); setError(''); setReport(null);
    adminGet(`/finance/historical-exceptions?page=${page}`).then(response => {
      if (!Array.isArray(response.data?.rows) || response.data.mode !== 'dry-run') throw new Error('Historical evidence response is invalid');
      if (active) setReport(response.data);
    }).catch(error => { if (active) setError(error.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [page]);
  const loadBatches = () => adminGet('/finance/historical-batches').then(response => setBatches(response.data?.batches || [])).catch(e => setMessage(e.message));
  useEffect(() => { loadBatches(); }, []);
  const act = async (work, done) => { setBusy(true); setMessage(''); try { await work(); setMessage(done); await loadBatches(); } catch (e) { setMessage(e.message); } finally { setBusy(false); } };
  const edit = (index, key, value) => setDraft(rows => rows.map((row, i) => i === index ? { ...row, [key]: value } : row));
  const prepare = event => {
    event.preventDefault();
    act(async () => { await adminPost('/finance/historical-batches', { note, rows: draft.map(({ orderNo, grossPaise, needsCod, needsRefund, needsPayout, ...row }) => ({ ...row, commission: Number(row.commission), commissionGst: Number(row.commissionGst) })) }); setDraft([]); setNote(''); }, 'Batch prepared. Another admin must approve it.');
  };
  const field = (index, key, label, help, example, type = 'text') => <label key={key}>{label}<input required type={type} min={type === 'number' ? 0 : undefined} step={type === 'number' ? '0.01' : undefined} minLength={type === 'text' ? 5 : undefined} value={draft[index][key]} onChange={e => edit(index, key, e.target.value)} />{hint(help, example)}</label>;
  return <section className="finance-panel"><h2>Old orders</h2>
    <p>Orders placed before the finance system started recording money breakdowns. They are not added to anyone’s balance automatically, because the original commission and payment proof must be checked first.</p>
    <p className="finance-muted">To settle them: 1) add items to a batch with the proof for each, 2) a different admin approves it, 3) apply it (earnings go on hold), 4) release it (earnings become available to pay).</p>
    {message && <p role="status" className="finance-notice">{message}</p>}
    {loading ? <p role="status">Loading historical evidence…</p> : error ? <p role="alert">{error}</p> : report && <>
      <p>Page {page}; up to {report.limit} of {report.totalOrders} historical orders. One row per seller and order item.</p>
      {report.rows.map(row => <details key={row.idempotencyKey}><summary>{row.orderNo} · {row.classification.replaceAll('_', ' ')} · {row.classification === 'already_reconciled' ? 'Settled' : 'Payable: unresolved'}</summary>
        <p>Seller {row.sellerId} · Item {row.itemId} · {row.evidence.qty} × ₹{row.evidence.price}</p>
        <p>What is missing: {row.reasons.map(reason => reason.replaceAll('_', ' ')).join(' · ')}</p>
        <p>Payment: {row.evidence.payment?.method || 'missing'} / {row.evidence.payment?.status || 'missing'}. Legacy capture metadata: {row.evidence.payment?.legacyCapturePresent ? 'present; requires review' : 'absent'}. COD receipt: {row.evidence.cash?.status || 'not established'}.</p>
        {row.classification !== 'already_reconciled' && !draft.some(item => item.itemId === row.itemId) && <button type="button" onClick={() => setDraft(rows => [...rows, blankRow(row)])}>Add to batch</button>}
      </details>)}
      {!report.rows.length && <p>No historical exceptions within this page.</p>}
    </>}
    <button disabled={loading || page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
    <button disabled={loading || !report || page * report.limit >= report.totalOrders} onClick={() => setPage(page + 1)}>Next</button>

    {draft.length > 0 && <form className="finance-panel finance-review" onSubmit={prepare}><h3>New batch ({draft.length} item{draft.length === 1 ? '' : 's'})</h3>
      <p className="finance-muted">Bulkimart pays any coupon discount, so the seller gets the item price minus the commission and GST you enter.</p>
      {draft.map((row, index) => <fieldset key={row.itemId} className="finance-panel"><legend>{`${row.orderNo} · item price ${money(row.grossPaise)}`}</legend>
        <div className="finance-grid">
          {field(index, 'commission', 'Commission (₹)', 'The commission agreed with the seller at the time of this order.', '10', 'number')}
          {field(index, 'commissionGst', 'GST on commission (₹)', 'Use 0 if no GST was charged on the commission.', '1.80', 'number')}
          {field(index, 'agreementReference', 'Original commission agreement', 'Where the old rate is written down.', 'Seller agreement signed 12 Mar 2025, clause 4')}
          {field(index, 'fundingEvidenceReference', 'Payment proof', 'Proof the customer’s money reached Bulkimart.', 'Razorpay pay_N3x8… or cash book page 12')}
          {field(index, 'entitlementApprovalReference', 'Amount approval', 'Who approved paying this amount, and where.', 'Finance head email, 1 Oct')}
          {row.needsCod && field(index, 'codCustodyApprovalReference', 'COD cash proof', 'Proof the COD cash was handed over to Bulkimart.', 'Hub receipt 0042')}
          {row.needsRefund && field(index, 'refundReconciliationReference', 'Refund check', 'This item had a return: note how the refund was taken into account.', 'Refund RET-0091 deducted, checked 2 Oct')}
          {row.needsPayout && field(index, 'priorPayoutReconciliationReference', 'Earlier payout check', 'The seller already received payouts: confirm this item was not paid before.', 'Payout PAY-17 statement checked')}
        </div>
        <p>{`Seller will get: ${row.commission === '' || row.commissionGst === '' ? '—' : money(row.grossPaise - Math.round(Number(row.commission) * 100) - Math.round(Number(row.commissionGst) * 100))}`}</p>
        <button type="button" onClick={() => setDraft(rows => rows.filter((_, i) => i !== index))}>Remove</button>
      </fieldset>)}
      <label>Batch note<input required minLength={5} value={note} onChange={e => setNote(e.target.value)} />{hint('A short name for this batch.', 'Pre-launch orders, October 2026')}</label>
      <button disabled={busy}>Prepare batch</button><button type="button" disabled={busy} onClick={() => setDraft([])}>Discard</button>
    </form>}

    <h3>Batches</h3>
    {!batches.length ? <p>No batches yet.</p> : batches.map(batch => {
      const total = batch.rows.reduce((sum, row) => sum + row.proposedPayablePaise, 0);
      return <div key={batch._id} className="finance-panel"><strong>{`${batch._id} · ${STATUS[batch.status] || batch.status}`}</strong>
        <p>{`${batch.note} · ${batch.rows.length} item(s) · sellers get ${money(total)}`}{batch.rejectionReason ? ` · Rejected: ${batch.rejectionReason}` : ''}</p>
        {batch.status === 'pending_approval' && <><label>Review note<input value={reviewNotes[batch._id] || ''} onChange={e => setReviewNotes(notes => ({ ...notes, [batch._id]: e.target.value }))} />{hint('Must be a different admin from the one who prepared it.', 'Checked all proofs against bank statement')}</label>
          <button disabled={busy} onClick={() => act(() => adminPost(`/finance/historical-batches/${batch._id}/review`, { approve: true, note: reviewNotes[batch._id] }), 'Batch approved.')}>Approve</button>
          <button disabled={busy} onClick={() => act(() => adminPost(`/finance/historical-batches/${batch._id}/review`, { approve: false, note: reviewNotes[batch._id] }), 'Batch rejected.')}>Reject</button></>}
        {batch.status === 'approved' && <button disabled={busy} onClick={() => act(() => adminPost(`/finance/historical-batches/${batch._id}/apply`, {}), 'Applied. Earnings are on hold.')}>Apply</button>}
        {batch.status === 'applied' && <button disabled={busy} onClick={() => act(() => adminPost(`/finance/historical-batches/${batch._id}/release`, {}), 'Released. Sellers can now withdraw these earnings.')}>Release to sellers</button>}
      </div>;
    })}
  </section>;
}
