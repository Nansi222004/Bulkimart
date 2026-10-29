import React, { useEffect, useRef, useState } from 'react';
import { apiUrl } from '../../../utils/api';
import { boundedFetch } from '../../../utils/portalRequests';
import './DeliveryFinancePanel.css';

const money = paise => `₹${(Number(paise || 0) / 100).toFixed(2)}`;
const BUCKETS = { held: 'On hold (waiting for payment check)', eligible: 'Available to withdraw', reserved: 'Payout requested', settled: 'Paid to you', pending: 'Pending' };
const CASH = { expected: 'Collect cash', collected: 'Cash with you — hand it over', remittance_reported: 'Handed over — Bulkimart is checking', verified: 'Cash received by Bulkimart', allocated: 'Cash received by Bulkimart', discrepancy: 'Amount mismatch — Bulkimart will contact you', disputed: 'Under review' };
const small = text => <small style={{ display: 'block', color: '#52657b', fontSize: 12, marginTop: 4 }}>{text}</small>;
export default function DeliveryFinancePanel({ onChanged }) {
  const generation = useRef(0);
  const [cash, setCash] = useState([]), [ledger, setLedger] = useState([]), [balances, setBalances] = useState([]);
  const [trips, setTrips] = useState([]);
  const [page, setPage] = useState(1), [pages, setPages] = useState(1), [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [selected, setSelected] = useState(null);
  const [notice, setNotice] = useState(null);
  const noticeRef = useRef(null);
  // Show the outcome where the rider is looking, not at the top of a long page.
  useEffect(() => { if (notice) noticeRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'center' }); }, [notice]);
  const [proof, setProof] = useState({ amount: '', reference: '', reason: '' });
  const request = async (path, payload) => {
    const token = localStorage.getItem('deliveryToken');
    const response = await boundedFetch(apiUrl(`/api/delivery${path}`), { method: payload ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(payload ? { body: JSON.stringify(payload) } : {}) });
    const result = await response.json(); if (token !== localStorage.getItem('deliveryToken')) throw new Error('Delivery session changed. Refresh your records.');
    if (!response.ok) throw new Error(result.message || 'Financial records unavailable'); return result;
  };
  const load = async () => {
    const currentGeneration = ++generation.current;
    const [cod, entries, deliveries] = await Promise.all([request(`/finances/cod?page=${page}`), request(`/finances/ledger?page=${page}`), request(`/finances/deliveries?page=${page}`)]);
    if (currentGeneration !== generation.current) return;
    setCash(cod.data); setLedger(entries.data.rows); setBalances(entries.data.balances);
    setTrips(deliveries.data);
    setPages(Math.max(1, cod.meta.pages, deliveries.meta.pages, Math.ceil(entries.data.total / entries.data.limit)));
    const flags = entries.data.flags; setEnabled(flags.operations && flags.policyApproved && flags.testsApproved);
  };
  useEffect(() => { let active = true; setBusy(true); load().catch(e => { if (active) setMessage(e.message); }).finally(() => { if (active) setBusy(false); }); return () => { active = false; generation.current++; }; }, [page]);
  // The most a report may state: the order amount for a collection, the cash
  // actually collected for a handover.
  const handover = selected?.cash.status === 'collected';
  const limitPaise = selected ? (handover ? selected.cash.collectedPaise : selected.cash.expectedPaise) : 0;
  const amountPaise = Math.round(Number(proof.amount) * 100);
  const overLimit = proof.amount !== '' && amountPaise > limitPaise;
  const submit = async event => {
    event.preventDefault();
    if (overLimit) return;
    setBusy(true); setMessage(''); setNotice(null);
    try {
      const order = selected;
      await request(`/orders/${order._id}/cod/${order.cash.status === 'collected' ? 'remit' : 'collect'}`, { ...proof, amount: Number(proof.amount), method: 'cash' });
      setSelected(null); await load();
      await onChanged?.();
      setNotice({ tone: 'success', text: order.cash.status === 'collected'
        ? `Submitted ✓ Handover of ₹${Number(proof.amount).toFixed(2)} for ${order.orderNo} sent to Bulkimart. You will be notified once they confirm receipt.`
        : `Submitted ✓ Collection of ₹${Number(proof.amount).toFixed(2)} for ${order.orderNo} recorded. Hand the cash over and report it next.` });
    } catch (error) { setNotice({ tone: 'error', text: error.message }); } finally { setBusy(false); }
  };
  return <section className="delivery-finance-panel" style={{ margin: '20px 0', padding: 16, background: '#effbfe', border: '1px solid #b5e2eb', borderRadius: 12 }} aria-label="COD and verified delivery earnings">
    <h3>COD cash & verified earnings</h3><p>COD cash belongs to Bulkimart until you hand it over; it is not your earning. Steps: 1) after OTP delivery, report what the customer paid; 2) hand the cash over and report the deposit/handover reference. Earnings can be withdrawn only when you hold no COD cash.</p>
    {!enabled && <p>Cash reporting is awaiting policy approval. Contact operations for existing cash obligations.</p>}
    {message && <p role="status">{message}</p>}
    {notice && <p ref={noticeRef} role={notice.tone === 'error' ? 'alert' : 'status'} className={`delivery-finance-notice is-${notice.tone}`}>{notice.text}</p>}
    <button type="button" disabled={busy} onClick={() => { setBusy(true); load().catch(e => setMessage(e.message)).finally(() => setBusy(false)); }}>Refresh records</button>
    <p><strong>Cash with you now: {money(cash.reduce((sum, row) => sum + (row.cash.outstandingPaise || 0), 0))}</strong></p>
    <div>{balances.map(row => <p key={row._id.bucket}>{BUCKETS[row._id.bucket] || row._id.bucket}: {money(Math.round(row.amount * 100))}</p>)}</div>
    {cash.map(row => <article key={row._id} style={{ padding: '12px 0', borderBottom: '1px solid #b5e2eb' }}><strong>{row.orderNo} · {CASH[row.cash.status] || row.cash.status}</strong><p>Order amount {money(row.cash.expectedPaise)}<br />You collected {money(row.cash.collectedPaise)} · You handed over {money(row.cash.reportedPaise)}<br />Bulkimart received {money(row.cash.verifiedPaise)} · Still with you {money(row.cash.outstandingPaise)}</p>
      {row.status === 'delivered' && ['expected','collected'].includes(row.cash.status) && <button type="button" disabled={busy || !enabled} onClick={() => { setSelected(row); setNotice(null); setProof({ amount: '', reference: '', reason: '' }); }}>{row.cash.status === 'collected' ? 'Report cash handover' : 'Report cash collection'}</button>}
    </article>)}
    {!cash.length && <p>No versioned COD assignments on this page.</p>}
    {selected && <form onSubmit={submit}><h4>{selected.orderNo} · {selected.cash.status === 'collected' ? 'Handover report' : 'Collection report'}</h4>
      <label style={{ display: 'block', margin: '12px 0' }}>Amount (INR)<input required type="number" inputMode="decimal" min="0.01" max={(limitPaise / 100).toFixed(2)} step="0.01" aria-invalid={overLimit} value={proof.amount} onChange={e => setProof({ ...proof, amount: e.target.value })} />{overLimit && <span role="alert" className="delivery-finance-field-error">Cannot be more than {money(limitPaise)} — the {handover ? 'cash you collected' : 'order amount'}.</span>}{small(selected.cash.status === 'collected' ? `The cash you are handing over (you collected ${money(selected.cash.collectedPaise)}).` : `What the customer actually paid you, even if it is less than ${money(selected.cash.expectedPaise)}.`)}</label>
      <label style={{ display: 'block', margin: '12px 0' }}>Collection or handover evidence reference<input required minLength={4} maxLength={200} value={proof.reference} onChange={e => setProof({ ...proof, reference: e.target.value })} />{small(selected.cash.status === 'collected' ? 'Bank deposit slip number, UPI transaction ID or hub receipt number. Example: UPI 412345678901' : 'Any note that identifies this payment, e.g. the order number or OTP time.')}</label>
      <label style={{ display: 'block', margin: '12px 0' }}>Collection or handover details<input required minLength={5} maxLength={1000} value={proof.reason} onChange={e => setProof({ ...proof, reason: e.target.value })} />{small(selected.cash.status === 'collected' ? 'Where and to whom you handed it over. Example: Deposited at HDFC Andheri branch' : 'Anything unusual. Example: Customer paid ₹480, said ₹20 was a promised discount')}</label>
      <div className="delivery-finance-actions">
        <button disabled={busy || overLimit}>{busy ? 'Submitting…' : 'Submit report'}</button>
        <button type="button" className="is-secondary" disabled={busy} onClick={() => setSelected(null)}>Cancel</button>
      </div>
    </form>}
    <details><summary>Earning and payout history</summary>{ledger.map(entry => <p key={entry._id}>{entry.description} · {BUCKETS[entry.bucket] || entry.bucket} · {entry.direction === 'credit' ? '+' : '−'}₹{entry.amount.toFixed(2)} · {entry.reference || entry.entryNo}</p>)}</details>
    <details><summary>Delivery earning calculations</summary>{trips.length ? trips.map(trip => <article key={trip._id} style={{ padding: '10px 0' }}>
      <p>Delivery {trip._id} · {trip.status} · {trip.financialEarningStatus || 'Historical record; reconciliation required'}</p>
      {trip.ratesUsed?.rateId ? <p>Frozen rate: {trip.ratesUsed.rateId}<br />Base {money(trip.ratesUsed.base * 100)} · Distance rate {money(trip.ratesUsed.perKm * 100)} / km<br />Distance {Number.isFinite(trip.route?.distanceKm) ? `${trip.route.distanceKm.toFixed(2)} km` : 'Awaiting verification'} · Tip {money(trip.partnerTip * 100)}<br />Recorded earning: {Number.isFinite(trip.partnerEarnings) ? money(trip.partnerEarnings * 100) : 'Awaiting verified calculation'}</p> : <p>Rate evidence requires reconciliation. No amount is inferred.</p>}
    </article>) : <p>No delivery records on this page.</p>}</details>
    <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginTop: 12 }}><button type="button" disabled={busy || page <= 1} onClick={() => setPage(page - 1)}>Previous</button><span>Page {page} of {pages}</span><button type="button" disabled={busy || page >= pages} onClick={() => setPage(page + 1)}>Next</button></div>
  </section>;
}
