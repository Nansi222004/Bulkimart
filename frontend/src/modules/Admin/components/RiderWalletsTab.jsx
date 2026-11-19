import React, { useCallback, useEffect, useState } from 'react';
import { adminGet, adminPost, qs } from '../../../utils/adminApi';
import { useAdmin } from '../context/AdminContext';

/**
 * Rider wallets (COD parcels). A rider keeps their earning from parcel cash and owes
 * Bulkimart the rest; later earnings clear it automatically. This page lists riders who
 * still owe, and the UPI / cash payments they report, for an admin to approve with the
 * amount actually received, or reject with a reason.
 */
const rupees = (paise) => '₹' + ((Number(paise) || 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const when = (d) => (d ? new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '—');
const card = { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14, padding: '14px 16px', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' };
const btn = (kind) => ({ padding: '7px 12px', borderRadius: 8, fontWeight: 700, fontSize: 12.5, cursor: 'pointer',
  border: kind === 'primary' ? 'none' : kind === 'danger' ? '1px solid #fca5a5' : '1px solid #cbd5e1',
  background: kind === 'primary' ? '#10b981' : '#fff', color: kind === 'primary' ? '#fff' : kind === 'danger' ? '#b91c1c' : '#0f172a' });
const input = { padding: '7px 9px', borderRadius: 8, border: '1px solid #cbd5e1', fontSize: 13, minWidth: 0 };
const TYPE_LABEL = { parcel_earning: 'Parcel earning', parcel_cash_due: 'COD parcel cash', rider_cash_payment: 'Paid to Bulkimart', delivery_earning: 'Order earning', payout_reservation: 'Payout', payout_settlement: 'Payout returned' };

function PaymentRow({ p, onDone }) {
  const { triggerToast } = useAdmin();
  const [amount, setAmount] = useState(String(p.amountPaise / 100));
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const act = async (path, body, okText) => {
    setBusy(true);
    try { await adminPost(`/rider-wallets/payments/${p._id}/${path}`, body); triggerToast(okText); onDone(); }
    catch (err) { triggerToast(err.message || 'Could not update the payment', { type: 'error' }); }
    finally { setBusy(false); }
  };
  return <div style={{ ...card, display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
    <div style={{ flex: '1 1 240px' }}>
      <div style={{ fontWeight: 800 }}>{p.riderName} <span style={{ fontWeight: 400, color: '#64748b' }}>{p.riderPhone}</span></div>
      <div style={{ fontSize: 13 }}>Reported <strong>{rupees(p.amountPaise)}</strong> by {p.method === 'upi' ? 'UPI' : 'cash'} · ref <code>{p.reference}</code></div>
      <div style={{ fontSize: 12, color: '#64748b' }}>{when(p.createdAt)} · now owes {rupees(p.currentlyOwedPaise)}{p.note ? ` · “${p.note}”` : ''}</div>
      {p.currentlyOwedPaise < p.amountPaise ? <div style={{ fontSize: 12, color: '#92400e' }}>Their earnings have cleared part of the debt since. Approve what you actually received; anything extra stays in their wallet for payout.</div> : null}
    </div>
    {p.status === 'pending' ? (rejecting ? <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
      <input placeholder="Reason shown to the rider" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} style={{ ...input, width: 240 }} />
      <button type="button" style={btn('danger')} disabled={busy || reason.trim().length < 3} onClick={() => act('reject', { reason }, 'Payment rejected')}>Reject</button>
      <button type="button" style={btn()} onClick={() => setRejecting(false)}>Back</button>
    </div> : <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
      <label style={{ fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>Received ₹
        <input type="number" min="1" step="0.01" max={p.amountPaise / 100} value={amount} onChange={(e) => setAmount(e.target.value)} style={{ ...input, width: 100 }} /></label>
      <button type="button" style={btn('primary')} disabled={busy || !(Number(amount) >= 1)} onClick={() => act('approve', { amount: Number(amount) }, 'Payment approved and added to the rider wallet')}>Approve</button>
      <button type="button" style={btn('danger')} onClick={() => setRejecting(true)}>Reject…</button>
    </div>) : <span style={{ fontSize: 12.5, fontWeight: 700, color: p.status === 'approved' ? '#047857' : '#b91c1c' }}>
      {p.status === 'approved' ? `Approved ${rupees(p.approvedPaise)}` : `Rejected: ${p.rejectReason}`}{p.reviewedBy ? ` · ${p.reviewedBy}` : ''}</span>}
  </div>;
}

function RiderStatement({ partnerId, onBack }) {
  const { triggerToast } = useAdmin();
  const [d, setD] = useState(null);
  useEffect(() => { adminGet(`/rider-wallets/${partnerId}`).then((r) => setD(r.data)).catch((e) => triggerToast(e.message || 'Could not load wallet', { type: 'error' })); }, [partnerId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!d) return <p style={{ color: '#64748b' }}>Loading…</p>;
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
    <div><button type="button" style={btn()} onClick={onBack}>← All rider wallets</button></div>
    <div style={card}>
      <div style={{ fontSize: 18, fontWeight: 800 }}>{d.rider.name}</div>
      <div style={{ fontSize: 13, color: '#475569' }}>{[d.rider.phone, d.rider.vehicle].filter(Boolean).join(' · ')}</div>
      <div style={{ marginTop: 8, fontSize: 22, fontWeight: 800, color: d.balancePaise < 0 ? '#b91c1c' : '#047857' }}>{d.balancePaise < 0 ? `Owes ${rupees(d.owedPaise)}` : `Wallet ${rupees(d.balancePaise)}`}</div>
      <div style={{ fontSize: 12, color: '#64748b' }}>Available for payout {rupees(d.availablePaise)} · on hold {rupees(d.onHoldPaise)} · cash parcels {d.cashParcelsBlocked ? 'blocked (debt limit reached)' : 'allowed'}</div>
    </div>
    <div style={card}>
      <strong>Statement</strong>
      {d.statement.length ? <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, marginTop: 8 }}><tbody>
        {d.statement.map((s) => <tr key={s._id} style={{ borderTop: '1px solid #f1f5f9' }}>
          <td style={{ padding: '7px 4px', color: '#64748b', whiteSpace: 'nowrap' }}>{when(s.at)}</td>
          <td style={{ padding: '7px 4px' }}>{TYPE_LABEL[s.type] || s.type}{s.onHold ? ' (on hold)' : ''}<div style={{ fontSize: 12, color: '#64748b' }}>{s.description}</div></td>
          <td style={{ padding: '7px 4px', textAlign: 'right', fontWeight: 700, color: s.amountPaise < 0 ? '#b91c1c' : '#047857' }}>{s.amountPaise < 0 ? '−' : '+'}{rupees(Math.abs(s.amountPaise))}</td>
        </tr>)}
      </tbody></table> : <p style={{ color: '#64748b', fontSize: 13 }}>No wallet activity yet.</p>}
    </div>
  </div>;
}

export const RiderWalletsTab = () => {
  const { triggerToast } = useAdmin();
  const [status, setStatus] = useState('pending');
  const [payments, setPayments] = useState(null);
  const [owing, setOwing] = useState(null);
  const [q, setQ] = useState('');
  const [viewing, setViewing] = useState(null);
  const load = useCallback(async () => {
    try {
      const [p, o] = await Promise.all([adminGet('/rider-wallets/payments' + qs({ status })), adminGet('/rider-wallets' + qs({ q }))]);
      setPayments(p.data); setOwing(o.data);
    } catch (err) { triggerToast(err.message || 'Could not load rider wallets', { type: 'error' }); }
  }, [status, q]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);

  const wrap = { padding: '20px 16px', maxWidth: 1100, margin: '0 auto', fontFamily: "'Inter', sans-serif", color: '#0f172a', display: 'flex', flexDirection: 'column', gap: 16 };
  if (viewing) return <div style={wrap}><RiderStatement partnerId={viewing} onBack={() => { setViewing(null); load(); }} /></div>;
  return <div style={wrap}>
    <div>
      <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>👛 Rider Wallets</h2>
      <p style={{ margin: '4px 0 0', fontSize: 12.5, color: '#64748b' }}>For COD parcels a rider keeps their earning from the cash and owes Bulkimart the rest. Their next earnings clear it automatically; otherwise they pay by UPI or cash and you approve it here. Riders at the debt limit{owing ? ` (${rupees(owing.debtLimitPaise)}, set in Finance → Payouts & tax)` : ''} get no new cash parcels.</p>
    </div>
    {owing ? <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
      <div style={{ ...card, flex: '1 1 200px' }}><div style={{ fontSize: 12, color: '#64748b', fontWeight: 600 }}>Riders who owe</div><div style={{ fontSize: 22, fontWeight: 800 }}>{owing.totals.riders}</div></div>
      <div style={{ ...card, flex: '1 1 200px' }}><div style={{ fontSize: 12, color: '#64748b', fontWeight: 600 }}>Total owed to Bulkimart</div><div style={{ fontSize: 22, fontWeight: 800 }}>{rupees(owing.totals.owedPaise)}</div></div>
      <div style={{ ...card, flex: '1 1 200px' }}><div style={{ fontSize: 12, color: '#64748b', fontWeight: 600 }}>Payments to review</div><div style={{ fontSize: 22, fontWeight: 800 }}>{status === 'pending' && payments ? payments.total : '—'}</div></div>
    </div> : null}

    <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0, fontSize: 16 }}>Payments reported by riders</h3>
        <select value={status} onChange={(e) => setStatus(e.target.value)} style={input}><option value="pending">Waiting for approval</option><option value="approved">Approved</option><option value="rejected">Rejected</option></select>
      </div>
      {payments?.rows.length ? payments.rows.map((p) => <PaymentRow key={p._id} p={p} onDone={load} />)
        : <div style={{ ...card, color: '#64748b', fontSize: 13 }}>{payments ? 'Nothing here.' : 'Loading…'}</div>}
    </section>

    <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0, fontSize: 16 }}>Riders who owe Bulkimart</h3>
        <input placeholder="Search name or phone" value={q} onChange={(e) => setQ(e.target.value)} style={{ ...input, width: 220 }} />
      </div>
      <div style={{ ...card, padding: 0, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 620 }}>
          <thead><tr style={{ background: '#f8fafc', textAlign: 'left' }}>{['Rider', 'Owes', 'Last COD parcel', 'Payment waiting', ''].map((h) => <th key={h} style={{ padding: 10, fontSize: 12, color: '#475569' }}>{h}</th>)}</tr></thead>
          <tbody>
            {owing && !owing.rows.length ? <tr><td colSpan={5} style={{ padding: 24, textAlign: 'center', color: '#64748b' }}>No rider owes anything right now.</td></tr> : null}
            {(owing?.rows || []).map((r) => <tr key={r.partnerId} style={{ borderTop: '1px solid #f1f5f9' }}>
              <td style={{ padding: 10 }}><div style={{ fontWeight: 700 }}>{r.name}</div><div style={{ fontSize: 12, color: '#64748b' }}>{[r.phone, r.vehicle].filter(Boolean).join(' · ')}</div></td>
              <td style={{ padding: 10, fontWeight: 800, color: r.owedPaise >= owing.debtLimitPaise ? '#b91c1c' : '#0f172a' }}>{rupees(r.owedPaise)}{r.owedPaise >= owing.debtLimitPaise ? ' · at limit' : ''}</td>
              <td style={{ padding: 10 }}>{when(r.lastCashAt)}</td>
              <td style={{ padding: 10 }}>{r.pendingPayment ? `${rupees(r.pendingPayment.amountPaise)} by ${r.pendingPayment.method === 'upi' ? 'UPI' : 'cash'}` : '—'}</td>
              <td style={{ padding: 10 }}><button type="button" style={btn()} onClick={() => setViewing(String(r.partnerId))}>Statement</button></td>
            </tr>)}
          </tbody>
        </table>
      </div>
    </section>
  </div>;
};

export default RiderWalletsTab;
