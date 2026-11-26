import React, { useState } from 'react';
import { apiUrl } from '../../../utils/api';

/**
 * A Self Delivery parcel the seller marked delivered (own courier): the customer can say it never arrived,
 * until `reportableUntil`. The seller's earnings wait while the report is open; Bulkimart support resolves it.
 */
export default function ExternalNotReceived({ orderId, shipment, onReported }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  if (shipment?.reportStatus === 'open') {
    return <p role="status" style={{ fontSize: 12, color: '#9a3412', marginBottom: 12 }}>You reported that this parcel did not arrive. Our team is checking with the seller.</p>;
  }
  const until = shipment?.reportableUntil ? new Date(shipment.reportableUntil) : null;
  if (!until || until <= new Date()) return null;

  const submit = async () => {
    if (reason.trim().length < 5) { setMessage('Tell us briefly what happened (at least 5 characters).'); return; }
    setBusy(true); setMessage('');
    try {
      const res = await fetch(apiUrl(`/api/orders/${orderId}/not-received`), {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (localStorage.getItem('userToken') || '') },
        body: JSON.stringify({ reason: reason.trim() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setMessage(body.message || 'Could not send your report'); return; }
      setOpen(false); onReported?.();
    } finally { setBusy(false); }
  };

  return (
    <div style={{ marginBottom: 12 }}>
      {!open ? (
        <button type="button" onClick={() => setOpen(true)} style={{ fontSize: 12, fontWeight: 700, background: 'none', border: 'none', color: 'var(--primary)', textDecoration: 'underline', cursor: 'pointer', padding: 0 }}>
          I did not receive this parcel
        </button>
      ) : (
        <div style={{ padding: 12, borderRadius: 10, border: '1px solid var(--border-color)' }}>
          <label htmlFor="not-received-reason" style={{ fontSize: 12, fontWeight: 700 }}>What happened?</label>
          <textarea id="not-received-reason" rows={3} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} style={{ width: '100%', marginTop: 6 }} />
          {message && <p role="alert" style={{ fontSize: 12, color: '#b91c1c' }}>{message}</p>}
          <button type="button" disabled={busy} onClick={submit} style={{ marginRight: 8 }}>{busy ? 'Sending…' : 'Send report'}</button>
          <button type="button" disabled={busy} onClick={() => setOpen(false)}>Cancel</button>
        </div>
      )}
    </div>
  );
}
