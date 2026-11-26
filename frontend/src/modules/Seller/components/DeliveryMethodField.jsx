import React, { useEffect, useState } from 'react';
import { apiUrl } from '../../../utils/api';

/**
 * Delivery method for a physical Shop All product: Easy Ship (Shiprocket), Self Delivery
 * (the seller delivers; prepaid orders only) or Fulfilled by Bulkimart (Bulkimart's warehouse).
 *
 * The server decides what is on offer (GET /api/products/seller/delivery-methods). While the
 * feature is switched off nothing is rendered, so the form looks exactly as it did before.
 * The server also enforces every rule shown here (FBB is one-way; Quick and e-books have none).
 *
 * Choosing FBB first shows the service charges and asks the seller to accept that the change is
 * permanent. A new listing then saves as FBB with the accepted charge version; an existing listing
 * is converted straight away (POST /api/products/:id/fbb-conversion), separately from the edit form.
 */
const HINTS = {
  easy_ship: 'You pack the order; Shiprocket picks it up and delivers it.',
  self_delivery: 'You pack and deliver the order yourself — with a Bulkimart rider or your own courier. Customers can pay online only (no Cash on Delivery).',
  fbb: 'Send stock to the Bulkimart warehouse; Bulkimart packs and delivers. Paid service. Once chosen it cannot be changed back.',
};
const BASIS = { per_unit: 'per unit', per_order: 'per order' };
const authHeaders = () => ({ Authorization: `Bearer ${localStorage.getItem('sellerToken') || ''}` });
const money = (n) => `₹${Number(n || 0).toFixed(2)}`;

export function FbbChargeSummary({ preview }) {
  const rates = preview?.current;
  if (!rates) return <p style={{ fontSize: 11.5 }}>No FBB charges are set at the moment.</p>;
  return (
    <div style={{ fontSize: 11.5 }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', marginTop: 4 }}>
        <tbody>
          <tr><td>Storage (once, when the warehouse accepts each unit)</td><td style={{ textAlign: 'right' }}>{money(rates.storage.amount)} {BASIS[rates.storage.basis]}</td></tr>
          <tr><td>Packaging (when the order is packed)</td><td style={{ textAlign: 'right' }}>{money(rates.packaging.amount)} {BASIS[rates.packaging.basis]}</td></tr>
          <tr><td>Fulfilment (when the order leaves the warehouse)</td><td style={{ textAlign: 'right' }}>{money(rates.fulfillment.amount)} {BASIS[rates.fulfillment.basis]}</td></tr>
        </tbody>
      </table>
      {preview.upcoming && <p style={{ marginTop: 4 }}>New rates (version {preview.upcoming.version}) apply from {new Date(preview.upcoming.effectiveFrom).toLocaleDateString()}.</p>}
      <p style={{ marginTop: 4, color: 'var(--text-secondary)' }}>Charges are taken from your earnings before payout. {preview.shippingNote} {preview.taxNote}</p>
    </div>
  );
}

export default function DeliveryMethodField({ value, onChange, savedMethod, disabled, productId, onConverted }) {
  const [config, setConfig] = useState(null);
  const [preview, setPreview] = useState(null);
  const [fbbOpen, setFbbOpen] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    fetch(apiUrl('/api/products/seller/delivery-methods'), { headers: authHeaders(), signal: controller.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => { if (body?.data) setConfig(body.data); })
      .catch(() => { /* Unavailable = not shown; the product keeps its current method. */ });
    return () => controller.abort();
  }, []);

  if (!config?.enabled) return null;
  const current = value || 'easy_ship';
  const lockedToFbb = savedMethod === 'fbb';
  const converting = Boolean(productId) && !lockedToFbb;

  const openFbb = async () => {
    setFbbOpen(true); setAccepted(false); setError('');
    try {
      const res = await fetch(apiUrl('/api/products/seller/fbb-charges'), { headers: authHeaders() });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message || 'Could not load the FBB charges');
      setPreview(body.data);
      if (body.data?.readiness && !body.data.readiness.ready) setError(`Fulfilled by Bulkimart is not ready yet: ${(body.data.readiness.blockers || []).join('; ')}`);
    } catch (e) { setError(e.message); }
  };

  const choose = (method) => {
    if (method === 'fbb' && !lockedToFbb) return openFbb();
    setFbbOpen(false);
    return onChange(method);
  };

  const confirmFbb = async () => {
    const version = preview?.current?.version ?? null;
    if (!converting) { onChange('fbb', { fbbChargeVersion: version }); setFbbOpen(false); return; }
    setBusy(true); setError('');
    try {
      const res = await fetch(apiUrl(`/api/products/${productId}/fbb-conversion`), {
        method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: true, acceptedChargeVersion: version }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message || 'The conversion did not go through');
      setFbbOpen(false);
      onConverted?.(body.data);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  return (
    <div className="onboarding-form-group" role="radiogroup" aria-label="Delivery method"
      style={{ border: '1.5px solid var(--border-color)', borderRadius: 10, padding: 12 }}>
      <span className="onboarding-label">🚚 Delivery Method</span>
      <div style={{ display: 'grid', gap: 8, marginTop: 6 }}>
        {config.options.map((option) => {
          const selectable = option.available && !disabled && (!lockedToFbb || option.value === 'fbb');
          return (
            <label key={option.value} style={{ display: 'flex', gap: 9, alignItems: 'flex-start', cursor: selectable ? 'pointer' : 'not-allowed', opacity: selectable || current === option.value ? 1 : 0.55 }}>
              <input type="radio" name="deliveryMethod" value={option.value} checked={current === option.value || (option.value === 'fbb' && fbbOpen)}
                disabled={!selectable} onChange={() => choose(option.value)} />
              <span>
                <strong style={{ fontSize: 12.5 }}>{option.label}</strong>
                {option.reason && <em style={{ fontSize: 11, marginLeft: 6 }}>({option.reason})</em>}
                <span style={{ display: 'block', fontSize: 11, color: 'var(--text-secondary)' }}>{HINTS[option.value]}</span>
              </span>
            </label>
          );
        })}
      </div>

      {fbbOpen && (
        <div role="dialog" aria-label="Fulfilled by Bulkimart charges" style={{ marginTop: 10, padding: 10, borderRadius: 8, background: 'var(--bg-secondary, #f7f7f7)' }}>
          <strong style={{ fontSize: 12.5 }}>Fulfilled by Bulkimart — charges</strong>
          {preview ? <FbbChargeSummary preview={preview} /> : !error && <p style={{ fontSize: 11.5 }}>Loading charges…</p>}
          <p role="alert" style={{ fontSize: 11.5, marginTop: 8, fontWeight: 600 }}>
            This change is permanent: the product cannot go back to Easy Ship or Self Delivery.
            {converting ? ' Its stock becomes 0 here and is set only by what the Bulkimart warehouse receives and verifies. You cannot convert while it has open orders you are delivering.' : ' Its stock is set only by what the Bulkimart warehouse receives and verifies.'}
          </p>
          <label style={{ display: 'flex', gap: 8, fontSize: 11.5, marginTop: 6 }}>
            <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} disabled={busy} />
            I accept these charges and understand the change cannot be undone.
          </label>
          {error && <p role="alert" style={{ fontSize: 11.5, color: '#b42318', marginTop: 6 }}>{error}</p>}
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button type="button" className="seller-products-button" onClick={() => setFbbOpen(false)} disabled={busy}>Cancel</button>
            <button type="button" className="seller-products-button seller-products-primary" onClick={confirmFbb}
              disabled={busy || !accepted || !preview || (preview.readiness && !preview.readiness.ready)}>
              {busy ? 'Converting…' : converting ? 'Convert to Fulfilled by Bulkimart' : 'Use Fulfilled by Bulkimart'}
            </button>
          </div>
        </div>
      )}

      {lockedToFbb && (
        <p role="status" style={{ fontSize: 11, marginTop: 8 }}>Stock for this product is managed by the Bulkimart warehouse. See Seller → FBB for stock, receipts and charges.</p>
      )}
      {savedMethod && current !== savedMethod && (
        <p role="status" style={{ fontSize: 11, marginTop: 8 }}>Orders already placed keep their original delivery method. The change applies to new orders.</p>
      )}
    </div>
  );
}
