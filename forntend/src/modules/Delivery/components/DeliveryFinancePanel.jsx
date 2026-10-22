import React, { useEffect, useRef, useState } from 'react';
import { apiUrl } from '../../../utils/api';
import { boundedFetch } from '../../../utils/portalRequests';
import './DeliveryFinancePanel.css';

const money = paise => `₹${(Number(paise || 0) / 100).toFixed(2)}`;
export default function DeliveryFinancePanel() {
  const generation = useRef(0);
  const [cash, setCash] = useState([]), [ledger, setLedger] = useState([]), [balances, setBalances] = useState([]);
  const [trips, setTrips] = useState([]);
  const [page, setPage] = useState(1), [pages, setPages] = useState(1), [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [selected, setSelected] = useState(null);
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
  const submit = async event => {
    event.preventDefault(); setBusy(true); setMessage('');
    try {
      await request(`/orders/${selected._id}/cod/${selected.cash.status === 'collected' ? 'remit' : 'collect'}`, { ...proof, amount: Number(proof.amount), method: 'cash' });
      setSelected(null); await load(); setMessage('Report saved. Platform receipt requires independent cash verification.');
    } catch (error) { setMessage(error.message); } finally { setBusy(false); }
  };
  return <section className="delivery-finance-panel" style={{ margin: '20px 0', padding: 16, background: '#effbfe', border: '1px solid #b5e2eb', borderRadius: 12 }} aria-label="COD and verified delivery earnings">
    <h3>COD cash & verified earnings</h3><p>Cash held for an order is separate from your earnings. Report collection after OTP delivery, then report the handover reference.</p>
    {!enabled && <p>Cash reporting is awaiting policy approval. Contact operations for existing cash obligations.</p>}
    {message && <p role="status">{message}</p>}
    <button type="button" disabled={busy} onClick={() => { setBusy(true); load().catch(e => setMessage(e.message)).finally(() => setBusy(false)); }}>Refresh records</button>
    <div>{balances.map(row => <p key={row._id.bucket}>{row._id.bucket}: {money(Math.round(row.amount * 100))}</p>)}</div>
    {cash.map(row => <article key={row._id} style={{ padding: '12px 0', borderBottom: '1px solid #b5e2eb' }}><strong>{row.orderNo} · {row.status}</strong><p>Collect {money(row.cash.expectedPaise)} · {row.cash.status}<br />Reported collected {money(row.cash.collectedPaise)} · Handover reported {money(row.cash.reportedPaise)}<br />Verified {money(row.cash.verifiedPaise)} · Outstanding {money(row.cash.outstandingPaise)}</p>
      {row.status === 'delivered' && ['expected','collected'].includes(row.cash.status) && <button type="button" disabled={busy || !enabled} onClick={() => { setSelected(row); setProof({ amount: '', reference: '', reason: '' }); }}>{row.cash.status === 'collected' ? 'Report cash handover' : 'Report cash collection'}</button>}
    </article>)}
    {!cash.length && <p>No versioned COD assignments on this page.</p>}
    {selected && <form onSubmit={submit}><h4>{selected.orderNo} · {selected.cash.status === 'collected' ? 'Handover report' : 'Collection report'}</h4>
      <label style={{ display: 'block', margin: '12px 0' }}>Amount (INR)<input required type="number" min="0" step="0.01" value={proof.amount} onChange={e => setProof({ ...proof, amount: e.target.value })} /></label>
      <label style={{ display: 'block', margin: '12px 0' }}>Collection or handover evidence reference<input required minLength={4} maxLength={200} value={proof.reference} onChange={e => setProof({ ...proof, reference: e.target.value })} /></label>
      <label style={{ display: 'block', margin: '12px 0' }}>Collection or handover details<input required minLength={5} maxLength={1000} value={proof.reason} onChange={e => setProof({ ...proof, reason: e.target.value })} /></label>
      <button disabled={busy}>Submit report</button><button type="button" disabled={busy} onClick={() => setSelected(null)}>Cancel</button>
    </form>}
    <details><summary>Earning and payout ledger</summary>{ledger.map(entry => <p key={entry._id}>{entry.description} · {entry.bucket} · {entry.direction} ₹{entry.amount.toFixed(2)} · {entry.reference || entry.entryNo}</p>)}</details>
    <details><summary>Delivery earning calculations</summary>{trips.length ? trips.map(trip => <article key={trip._id} style={{ padding: '10px 0' }}>
      <p>Delivery {trip._id} · {trip.status} · {trip.financialEarningStatus || 'Historical record; reconciliation required'}</p>
      {trip.ratesUsed?.rateId ? <p>Frozen rate: {trip.ratesUsed.rateId}<br />Base {money(trip.ratesUsed.base * 100)} · Distance rate {money(trip.ratesUsed.perKm * 100)} / km<br />Distance {Number.isFinite(trip.route?.distanceKm) ? `${trip.route.distanceKm.toFixed(2)} km` : 'Awaiting verification'} · Tip {money(trip.partnerTip * 100)}<br />Recorded earning: {Number.isFinite(trip.partnerEarnings) ? money(trip.partnerEarnings * 100) : 'Awaiting verified calculation'}</p> : <p>Rate evidence requires reconciliation. No amount is inferred.</p>}
    </article>) : <p>No delivery records on this page.</p>}</details>
    <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginTop: 12 }}><button type="button" disabled={busy || page <= 1} onClick={() => setPage(page - 1)}>Previous</button><span>Page {page} of {pages}</span><button type="button" disabled={busy || page >= pages} onClick={() => setPage(page + 1)}>Next</button></div>
  </section>;
}
