import React, { useCallback, useEffect, useRef, useState } from 'react';
import ModalPortal from '../ModalPortal';
import { parcelRequest as request, parcelMoney as money } from './parcelApi';
import { socket } from '../../utils/socket';

const POLL_MS = 10000;
const secondsLeft = (expiresAt) => Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 1000));

/**
 * Incoming parcel offer, shown over every delivery screen like the order and return pick-up pop-ups.
 * The countdown runs to the server's own `offer.expiresAt`; when it ends the pop-up just closes and the
 * server moves the booking on. It opens on the PARCEL_OFFER notification (socket), on a reconnect, and
 * on a 10 s poll, so an offer missed by the socket still appears.
 */
export default function ParcelOfferPopup({ enabled, onAccepted }) {
  const [booking, setBooking] = useState(null);
  const [left, setLeft] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const total = useRef(1);
  const closed = useRef(new Set()); // offer tokens already answered or expired here
  const mounted = useRef(false);

  const load = useCallback(async () => {
    try {
      const body = await request('driver', '/bookings?status=searching_for_driver&limit=10');
      if (!mounted.current) return;
      const open = (body.data || []).filter((b) => b.offer && secondsLeft(b.offer.expiresAt) > 0 && !closed.current.has(b.offer.token));
      setBooking((curr) => (curr && open.some((b) => b.offer.token === curr.offer.token) ? curr : open[0] || null));
    } catch { /* keep what is on screen; the next poll reconciles */ }
  }, []);

  useEffect(() => {
    mounted.current = true;
    if (!enabled) { setBooking(null); return () => { mounted.current = false; }; }
    void load();
    const onNotice = (n) => { if (n?.event === 'PARCEL_OFFER' || n?.event === 'PARCEL_UPDATED') void load(); };
    const onConnect = () => void load();
    const onVisible = () => { if (document.visibilityState === 'visible') void load(); };
    socket.on('notification_new', onNotice);
    socket.on('connect', onConnect);
    document.addEventListener('visibilitychange', onVisible);
    const timer = setInterval(() => void load(), POLL_MS);
    return () => {
      mounted.current = false; clearInterval(timer);
      socket.off('notification_new', onNotice); socket.off('connect', onConnect);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled, load]);

  const token = booking?.offer?.token;
  useEffect(() => {
    if (!token) return undefined;
    const start = secondsLeft(booking.offer.expiresAt);
    total.current = Math.max(1, start); setLeft(start); setMessage(''); setBusy(false);
    try { navigator.vibrate?.([0, 600, 400, 600]); } catch { /* not supported */ }
    const t = setInterval(() => setLeft(secondsLeft(booking.offer.expiresAt)), 500);
    return () => clearInterval(t);
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  const close = useCallback(() => {
    if (token) closed.current.add(token);
    setBooking(null);
    void load(); // another offer may be waiting
  }, [token, load]);

  useEffect(() => { if (token && left === 0 && !busy) close(); }, [token, left, busy, close]);

  const respond = async (action) => {
    if (busy || !booking) return;
    setBusy(true); setMessage('');
    try {
      await request('driver', `/bookings/${booking._id}/offer`, { method: 'POST', body: JSON.stringify({ action, token: booking.offer.token, version: booking.version }) });
      const id = booking._id;
      close();
      if (action === 'accept') onAccepted?.(id);
    } catch (e) {
      if (e.status === 409 || e.status === 404) { setMessage('This parcel is no longer available.'); setTimeout(close, 1500); }
      else { setMessage(e.message || 'Could not reach the server. Try again.'); setBusy(false); }
    }
  };

  if (!enabled || !booking) return null;
  const earning = booking.earningPaise ?? booking.finance?.earningPaise;
  return (
    <ModalPortal className="delivery-modal-overlay" aria-label="New parcel request">
      <div className="delivery-order-ping-modal-sheet">
        <div className="ping-modal-header-pulsing">
          <span className="ping-pulsing-circle" />
          <span className="ping-title">NEW PARCEL REQUEST</span>
        </div>
        <div className="ping-countdown-circle">
          <svg viewBox="0 0 36 36" className="circular-chart" aria-hidden="true">
            <path className="circle-bg" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
            <path className="circle" strokeDasharray={`${(left / total.current) * 100}, 100`} d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
          </svg>
          <div className="countdown-number" aria-live="off">{left}s</div>
        </div>
        {earning != null && (
          <div className="ping-payout-box">
            <span className="payout-label">YOU EARN</span>
            <span className="payout-val">{money(earning)}</span>
          </div>
        )}
        <div className="ping-details-grid">
          <div className="ping-detail-item"><span>Pickup area</span><strong>{booking.pickupArea || '—'}</strong></div>
          <div className="ping-detail-item"><span>Drop area</span><strong>{booking.dropoffArea || '—'}</strong></div>
          {booking.weightKg != null && <div className="ping-detail-item"><span>Weight</span><strong>{booking.weightKg} kg</strong></div>}
          {booking.vehicle?.name && <div className="ping-detail-item"><span>Vehicle</span><strong>{booking.vehicle.name}</strong></div>}
        </div>
        <p className="parcel-offer-popup-note">Pickup address and contact are shown after you accept.</p>
        {message && <p role="alert" className="parcel-offer-popup-note">{message}</p>}
        <div className="ping-actions-row">
          <button type="button" className="delivery-danger-btn-outline" style={{ flex: 1 }} disabled={busy} onClick={() => respond('reject')}>Decline</button>
          <button type="button" className="delivery-primary-action-btn" style={{ flex: 2, margin: 0 }} disabled={busy || left === 0} onClick={() => respond('accept')}>
            {busy ? 'Updating…' : 'Accept parcel'}
          </button>
        </div>
      </div>
    </ModalPortal>
  );
}
