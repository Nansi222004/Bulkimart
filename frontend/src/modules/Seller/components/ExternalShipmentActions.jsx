import React, { useState } from 'react';

/**
 * After handing a Self Delivery parcel to your own courier: correct the tracking (with a reason, at most three
 * times) or report a failed delivery attempt. Delivered and Out for delivery stay on the normal order actions.
 */
export default function ExternalShipmentActions({ order, busy, onSubmit }) {
  const ext = order.externalShipment;
  const [mode, setMode] = useState(null);
  const [form, setForm] = useState({ courierName: ext.courierName, awb: ext.awb, trackingUrl: ext.trackingUrl, reason: '' });
  const [error, setError] = useState('');
  const set = (key) => (event) => setForm((value) => ({ ...value, [key]: event.target.value }));
  const corrections = ext.corrections?.length || 0;

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    if (form.reason.trim().length < 5) return setError('Give a reason of at least 5 characters.');
    const body = mode === 'correct_tracking'
      ? { action: 'correct_tracking', courierName: form.courierName.trim(), awb: form.awb.trim(), trackingUrl: form.trackingUrl.trim(), reason: form.reason.trim() }
      : { action: 'delivery_failed', reason: form.reason.trim() };
    const result = await onSubmit(body);
    if (result?.ok) setMode(null); else setError(result?.message || 'Could not save');
  };

  return (
    <section className="seller-delivery-panel" aria-label="Your courier delivery">
      <h3>Your courier delivery</h3>
      {ext.status === 'delivery_failed' && <p role="status" style={{ fontSize: 12, color: '#b45309' }}>Last attempt failed: {ext.failure?.reason}. Mark it Out for delivery or Delivered when the courier tries again; support can cancel and refund if it cannot be delivered.</p>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="order-action-btn-sm" disabled={busy || corrections >= 3} onClick={() => setMode('correct_tracking')}>Correct tracking{corrections ? ` (${3 - corrections} left)` : ''}</button>
        <button type="button" className="order-action-btn-sm" disabled={busy} onClick={() => setMode('delivery_failed')}>Report failed delivery</button>
      </div>
      {mode && (
        <form onSubmit={submit} noValidate style={{ marginTop: 10 }}>
          {mode === 'correct_tracking' && <>
            <label className="onboarding-label">Courier company<input className="onboarding-input" value={form.courierName} onChange={set('courierName')} maxLength={60} /></label>
            <label className="onboarding-label">Tracking ID / AWB<input className="onboarding-input" value={form.awb} onChange={set('awb')} maxLength={40} /></label>
            <label className="onboarding-label">Tracking link<input className="onboarding-input" type="url" value={form.trackingUrl} onChange={set('trackingUrl')} maxLength={500} /></label>
          </>}
          <label className="onboarding-label">{mode === 'correct_tracking' ? 'Why are you correcting it?' : 'What happened?'}
            <textarea className="onboarding-input" rows={2} maxLength={300} value={form.reason} onChange={set('reason')} />
          </label>
          {error && <p role="alert" style={{ fontSize: 12, color: '#b91c1c' }}>{error}</p>}
          <button type="submit" className="primary-onboarding-btn" disabled={busy}>{busy ? 'Saving…' : mode === 'correct_tracking' ? 'Save correction' : 'Report failed delivery'}</button>
          <button type="button" className="order-action-btn-sm" disabled={busy} onClick={() => setMode(null)} style={{ marginLeft: 8 }}>Cancel</button>
        </form>
      )}
    </section>
  );
}
