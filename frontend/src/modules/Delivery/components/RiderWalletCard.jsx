import React, { useCallback, useEffect, useState } from 'react';
import { apiUrl } from '../../../utils/api';
import { boundedFetch } from '../../../utils/portalRequests';
import { socket } from '../../../utils/socket';

/**
 * Wallet for COD parcels (same as the rider app's WalletCard). The rider keeps their
 * earning from parcel cash and owes Bulkimart the rest; later earnings clear it, or the
 * rider pays by UPI or cash and an admin approves it. `compact` is the dashboard notice.
 */
const rupees = (paise) => `₹${((Number(paise) || 0) / 100).toFixed(2)}`;
const when = (d) => (d ? new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '');
const LABEL = { parcel_earning: 'Parcel earning', parcel_cash_due: 'COD parcel cash', rider_cash_payment: 'Paid to Bulkimart', delivery_earning: 'Order earning', payout_reservation: 'Payout to bank', payout_settlement: 'Payout returned' };
const headers = () => ({ Authorization: `Bearer ${localStorage.getItem('deliveryToken') || ''}`, 'Content-Type': 'application/json' });
const request = async (path, options = {}) => {
  const r = await boundedFetch(apiUrl(`/api/delivery${path}`), { ...options, headers: headers() });
  const body = await r.json().catch(() => ({}));
  if (!r.ok || body.success === false) throw new Error(body.message || 'Could not load your wallet');
  return body.data;
};
const red = '#b91c1c', green = '#166534';
const box = { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14, padding: 16, display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 };
const owingBox = { ...box, borderColor: '#fca5a5', background: '#fef2f2' };
const field = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, fontWeight: 700 };
const inputStyle = { padding: '10px 12px', borderRadius: 8, border: '1px solid #cbd5e1', fontSize: 15 };

export default function RiderWalletCard({ compact = false }) {
  const [wallet, setWallet] = useState(null);
  const [error, setError] = useState('');
  const [paying, setPaying] = useState(false);
  const [form, setForm] = useState({ amount: '', method: 'upi', reference: '', note: '' });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(async () => {
    try { setWallet(await request('/wallet')); setError(''); } catch (e) { setError(e.message); }
  }, []);
  useEffect(() => {
    load();
    const onNote = (n) => { if (['PAYOUT_COMPLETED', 'PAYOUT_REJECTED', 'PARCEL_UPDATED'].includes(n?.event)) load(); };
    socket.on('notification_new', onNote); window.addEventListener('focus', load);
    return () => { socket.off('notification_new', onNote); window.removeEventListener('focus', load); };
  }, [load]);

  if (compact) {
    if (!wallet?.owedPaise) return null;
    return <a href="/delivery/earnings" style={{ ...owingBox, textDecoration: 'none', color: 'inherit' }}>
      <strong style={{ display: 'flex', justifyContent: 'space-between' }}>You owe Bulkimart <span style={{ color: red }}>{rupees(wallet.owedPaise)}</span></strong>
      <span style={{ fontSize: 13 }}>From COD parcel cash (after your earning). Your next earnings clear it, or pay by UPI / cash.</span>
      {wallet.cashParcelsBlocked && <span role="alert" style={{ fontSize: 13, color: red, fontWeight: 700 }}>Limit reached: no new cash parcels until it comes down. Online parcels and orders still come.</span>}
      <span style={{ fontWeight: 700, color: '#078ccb' }}>Open wallet ›</span>
    </a>;
  }

  if (!wallet) return <section style={box} aria-label="Wallet">{error ? <p role="alert">{error}</p> : <p>Loading wallet…</p>}</section>;
  const owes = wallet.owedPaise > 0;
  const lastRejected = !wallet.pendingPayment && wallet.payments.find((p) => p.status === 'rejected');
  const rows = showAll ? wallet.statement : wallet.statement.slice(0, 5);
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setMessage('');
    try {
      await request('/wallet/payments', { method: 'POST', body: JSON.stringify({ amount: Number(form.amount), method: form.method, reference: form.reference.trim(), note: form.note.trim() }) });
      setPaying(false); setMessage('Payment sent. Bulkimart will confirm it soon.'); load();
    } catch (err) { setMessage(err.message); } finally { setBusy(false); }
  };

  return <section style={owes ? owingBox : box} aria-label="Wallet">
    <span className="delivery-card-title">Wallet</span>
    <strong style={{ fontSize: 28, color: owes ? red : green }}>{owes ? `−${rupees(wallet.owedPaise)}` : rupees(wallet.balancePaise)}</strong>
    <p style={{ margin: 0, fontSize: 13 }}>{owes ? `You owe Bulkimart ${rupees(wallet.owedPaise)} from COD parcel cash. It clears automatically from your next earnings, or pay it now.` : 'Nothing owed. COD parcel cash minus your earning shows here as an amount you owe.'}</p>
    {wallet.cashParcelsBlocked && <p role="alert" style={{ margin: 0, color: red, fontWeight: 700, fontSize: 13 }}>You reached the {rupees(wallet.debtLimitPaise)} limit, so you get no new cash parcels until it comes down. Online parcels and orders still come.</p>}
    {wallet.pendingPayment ? <p role="status" style={{ margin: 0, fontSize: 13 }}>Waiting for approval: {rupees(wallet.pendingPayment.amountPaise)} by {wallet.pendingPayment.method === 'upi' ? 'UPI' : 'cash'} (ref {wallet.pendingPayment.reference}), sent {when(wallet.pendingPayment.createdAt)}.</p>
      : lastRejected ? <p style={{ margin: 0, fontSize: 13, color: '#92400e' }}>Your payment of {rupees(lastRejected.amountPaise)} was not approved: {lastRejected.rejectReason}</p> : null}
    {message && <p role="status" style={{ margin: 0, fontSize: 13 }}>{message}</p>}
    {owes && !wallet.pendingPayment && !paying && <button type="button" className="delivery-primary-action-btn" onClick={() => { setForm({ amount: (wallet.owedPaise / 100).toFixed(2), method: 'upi', reference: '', note: '' }); setPaying(true); setMessage(''); }}>Pay to Bulkimart</button>}
    {paying && <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div role="radiogroup" aria-label="Payment method" style={{ display: 'flex', gap: 8 }}>
        {[['upi', 'UPI'], ['cash', 'Cash']].map(([key, label]) => <label key={key} style={{ flex: 1, textAlign: 'center', padding: 10, borderRadius: 8, border: '1px solid #cbd5e1', fontWeight: 700, cursor: 'pointer', background: form.method === key ? '#078ccb' : '#fff', color: form.method === key ? '#fff' : '#0f172a' }}>
          <input type="radio" name="wallet-method" value={key} checked={form.method === key} onChange={() => setForm((f) => ({ ...f, method: key }))} style={{ position: 'absolute', opacity: 0 }} />{label}</label>)}
      </div>
      <label style={field}>Amount (₹)<input type="number" min="1" step="0.01" max={wallet.owedPaise / 100} required value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} style={inputStyle} />
        <span style={{ fontWeight: 400, fontSize: 12, color: '#64748b' }}>You owe {rupees(wallet.owedPaise)}. You can pay part of it.</span></label>
      <label style={field}>{form.method === 'upi' ? 'UPI transaction ID / UTR' : 'Cash receipt number or who received it'}<input required minLength={4} maxLength={100} value={form.reference} onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))} style={inputStyle} /></label>
      <label style={field}>Note (optional)<input maxLength={300} value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} style={inputStyle} /></label>
      <button type="submit" className="delivery-primary-action-btn" disabled={busy}>{busy ? 'Sending…' : 'Send for approval'}</button>
      <button type="button" className="delivery-secondary-action-btn" onClick={() => setPaying(false)}>Cancel</button>
    </form>}
    {rows.length > 0 && <div>
      <strong style={{ fontSize: 13 }}>Recent activity</strong>
      {rows.map((s) => <div key={s._id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '8px 0', borderTop: '1px solid #e2e8f0' }}>
        <div><div style={{ fontWeight: 700, fontSize: 14 }}>{LABEL[s.type] || s.type}{s.onHold ? ' (on hold)' : ''}</div><div style={{ fontSize: 12, color: '#64748b' }}>{when(s.at)} · {s.description}</div></div>
        <strong style={{ color: s.amountPaise < 0 ? red : green, whiteSpace: 'nowrap' }}>{s.amountPaise < 0 ? '−' : '+'}{rupees(Math.abs(s.amountPaise))}</strong>
      </div>)}
      {wallet.statement.length > 5 && <button type="button" className="delivery-secondary-action-btn" onClick={() => setShowAll((v) => !v)}>{showAll ? 'Show less' : 'Show all'}</button>}
    </div>}
  </section>;
}
