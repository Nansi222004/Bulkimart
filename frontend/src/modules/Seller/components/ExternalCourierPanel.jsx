import React, { useState } from 'react';

/**
 * Self Delivery: hand the packed parcel to a courier the seller arranged and pays for.
 * Every field is required (untracked local couriers are not allowed). The server validates them
 * again, refuses a second delivery method, and lets the customer and admin follow the tracking link.
 */
const today = () => new Date().toISOString().slice(0, 10);

export default function ExternalCourierPanel({ option, busy, onSubmit }) {
  const [form, setForm] = useState({ courierName: '', awb: '', trackingUrl: '', dispatchDate: today() });
  const [error, setError] = useState('');
  const set = (key) => (event) => setForm((value) => ({ ...value, [key]: event.target.value }));

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    if (form.courierName.trim().length < 2) return setError('Enter the courier company name.');
    if (form.awb.trim().length < 3) return setError('Enter the tracking ID / AWB number.');
    if (!/^https:\/\//i.test(form.trackingUrl.trim())) return setError('Enter the tracking link, starting with https://');
    if (!form.dispatchDate) return setError('Enter the dispatch date.');
    const result = await onSubmit({ ...form, courierName: form.courierName.trim(), awb: form.awb.trim(), trackingUrl: form.trackingUrl.trim() });
    if (result && !result.ok) setError(result.message);
  };

  return (
    <form id="seller-external-delivery" className="seller-delivery-panel" aria-label="Own courier" onSubmit={submit} noValidate>
      <h3>Your own courier</h3>
      <p className="seller-delivery-help">You book and pay the courier. Enter its tracking details so the customer can follow the parcel, then update the status as it is delivered.</p>
      <label className="onboarding-label">Courier company
        <input className="onboarding-input" value={form.courierName} onChange={set('courierName')} maxLength={60} placeholder="e.g. DTDC" required />
      </label>
      <label className="onboarding-label">Tracking ID / AWB number
        <input className="onboarding-input" value={form.awb} onChange={set('awb')} maxLength={40} placeholder="As printed on the courier receipt" required />
      </label>
      <label className="onboarding-label">Tracking link
        <input className="onboarding-input" type="url" value={form.trackingUrl} onChange={set('trackingUrl')} maxLength={500} placeholder="https://…" required />
      </label>
      <label className="onboarding-label">Dispatch date
        <input className="onboarding-input" type="date" value={form.dispatchDate} max={today()} onChange={set('dispatchDate')} required />
      </label>
      {error && <p role="alert" style={{ fontSize: 12, color: '#b91c1c' }}>{error}</p>}
      {!option?.available && option?.reason && <p style={{ fontSize: 11, color: '#b45309' }}>{option.reason}</p>}
      <button type="submit" className="primary-onboarding-btn" style={{ width: '100%', marginTop: 8 }} disabled={busy || !option?.available}>
        {busy ? 'Saving…' : 'Confirm hand-off to courier'}
      </button>
    </form>
  );
}
