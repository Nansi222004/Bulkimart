import React, { useRef, useState } from 'react';
import ModalPortal from '../../../components/ModalPortal';
import { apiUrl } from '../../../utils/api';

export default function DeliveryPartnerRating({ orderId, riderName, deliveryRating, onRated }) {
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState(5);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);
  if (!deliveryRating?.eligible) return null;
  const close = () => { if (!lock.current) setOpen(false); };
  const submit = async () => {
    if (lock.current) return;
    lock.current = true; setSaving(true); setError('');
    try {
      const res = await fetch(apiUrl(`/api/orders/${orderId}/delivery-rating`), {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('userToken')}` },
        body: JSON.stringify({ rating }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.message || 'Could not submit your rating. Please try again.');
      onRated(body.data.rating); setOpen(false);
    } catch (err) { setError(err.message || 'Could not submit your rating. Please try again.'); }
    finally { lock.current = false; setSaving(false); }
  };
  return <section className="profile-menu-card delivery-rating-card">
    <div><strong>Delivery partner</strong><p>{riderName || 'Your delivery partner'}</p></div>
    {deliveryRating.rating ? <p role="status">You rated your delivery partner {deliveryRating.rating}/5 ★</p>
      : <button type="button" onClick={() => { setError(''); setOpen(true); }}>Rate delivery partner</button>}
    {open && <ModalPortal className="user-action-modal" aria-label="Rate delivery partner" onClick={close}
      onKeyDown={event => { if (event.key === 'Escape') close(); }}
      style={{ background: 'rgba(15,23,42,.65)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <section className="delivery-rating-sheet" onClick={event => event.stopPropagation()}>
        <h2>Rate delivery partner</h2><p>How was your delivery with {riderName || 'your delivery partner'}?</p>
        <div className="delivery-rating-stars" role="group" aria-label="Delivery rating">
          {[1, 2, 3, 4, 5].map(star => <button type="button" key={star} disabled={saving}
            aria-label={`Rate delivery ${star} star${star === 1 ? '' : 's'}`} aria-pressed={rating === star}
            style={{ color: star <= rating ? '#f59e0b' : '#cbd5e1' }} onClick={() => setRating(star)}>★</button>)}
        </div>
        {error && <p role="alert">{error}</p>}
        <div className="user-form-actions">
          <button type="button" disabled={saving} onClick={close}>Cancel</button>
          <button type="button" disabled={saving} onClick={submit}>{saving ? 'Submitting…' : 'Submit rating'}</button>
        </div>
      </section>
    </ModalPortal>}
  </section>;
}
