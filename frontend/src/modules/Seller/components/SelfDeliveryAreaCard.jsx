import React, { useEffect, useState } from 'react';
import { apiUrl } from '../../../utils/api';

/**
 * Where the seller delivers Self Delivery products: whole states and/or individual pincodes.
 * Customers outside this area cannot buy Self Delivery items. Shown only while delivery methods are
 * switched on (the server's delivery-method switch).
 */
const headers = () => ({ Authorization: `Bearer ${localStorage.getItem('sellerToken') || ''}`, 'Content-Type': 'application/json' });

export default function SelfDeliveryAreaCard() {
  const [enabled, setEnabled] = useState(false);
  const [area, setArea] = useState(null);
  const [states, setStates] = useState([]);
  const [pincodes, setPincodes] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const config = await fetch(apiUrl('/api/products/seller/delivery-methods'), { headers: headers(), signal: controller.signal }).then(r => r.json());
        if (!config?.data?.enabled) return;
        const body = await fetch(apiUrl('/api/sellers/self-delivery-area'), { headers: headers(), signal: controller.signal }).then(r => r.json());
        if (!body?.data) return;
        setEnabled(true); setArea(body.data); setStates(body.data.states || []); setPincodes((body.data.pincodes || []).join(', '));
      } catch { /* not shown when unavailable */ }
    })();
    return () => controller.abort();
  }, []);

  if (!enabled || !area) return null;

  const save = async () => {
    setSaving(true); setMessage('');
    try {
      const res = await fetch(apiUrl('/api/sellers/self-delivery-area'), { method: 'PUT', headers: headers(), body: JSON.stringify({ states, pincodes }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setMessage(body.message || 'Could not save the delivery area'); return; }
      setArea(body.data); setPincodes((body.data.pincodes || []).join(', ')); setMessage('Self Delivery area saved.');
    } finally { setSaving(false); }
  };

  return (
    <section className="seller-profile-card" aria-label="Self Delivery area">
      <h2>Self Delivery area</h2>
      <p style={{ fontSize: 12 }}>Customers can buy your Self Delivery products only at these places. Choose whole states, or list pincodes, or both.</p>
      <label className="onboarding-label" htmlFor="self-delivery-states">States you deliver to</label>
      <select id="self-delivery-states" multiple size={6} className="onboarding-input" value={states}
        onChange={(e) => setStates([...e.target.selectedOptions].map((o) => o.value))}>
        {area.stateOptions.map((name) => <option key={name} value={name}>{name}</option>)}
      </select>
      <label className="onboarding-label" htmlFor="self-delivery-pincodes">Pincodes you deliver to</label>
      <textarea id="self-delivery-pincodes" className="onboarding-input" rows={3} value={pincodes}
        placeholder="e.g. 452001, 452010" onChange={(e) => setPincodes(e.target.value)} />
      {message && <p role="status" style={{ fontSize: 12 }}>{message}</p>}
      <button type="button" className="primary-onboarding-btn" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save delivery area'}</button>
    </section>
  );
}
