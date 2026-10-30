import ModalPortal from '../../../components/ModalPortal';
import React, { useState, useEffect } from 'react';

const PING_WINDOW_SECONDS = 60; // same offer window as OrderPingModal — no server-provided expiry to prefer yet

const km = value => Number.isFinite(Number(value)) && value !== null && value !== '' ? `${Number(value).toFixed(1)} km` : '—';
const addressText = address => !address ? '' : typeof address === 'string' ? address
  : [address.line1, address.line2, address.address, address.landmark, address.city, address.pincode].filter(Boolean).join(', ');

/**
 * QUICK COMMERCE ONLY — the reverse-pickup counterpart to OrderPingModal,
 * same shape/behavior (countdown, accept/decline, expiry) against a
 * `return_pickup_ping` offer instead of a `rider_ping` order offer.
 */
export const ReturnPickupPingModal = ({ offer, onAccept, onDecline, onExpire }) => {
  const [timeLeft, setTimeLeft] = useState(PING_WINDOW_SECONDS);

  // Resets the clock whenever a genuinely new offer replaces this one —
  // dedup in DeliveryContext already keeps the SAME offer from re-triggering this.
  useEffect(() => { setTimeLeft(PING_WINDOW_SECONDS); }, [offer?.returnId]);

  useEffect(() => {
    const timer = setInterval(() => {
      setTimeLeft((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Same split as OrderPingModal: running out the clock is not the rider
  // declining — acted on in its own effect, after render settles.
  useEffect(() => {
    if (timeLeft === 0) (onExpire || onDecline)();
  }, [timeLeft, onExpire, onDecline]);

  if (!offer) return null;

  return (
    <ModalPortal className="delivery-modal-overlay">
      <div className="delivery-order-ping-modal-sheet">
        <div className="ping-modal-header-pulsing">
          <span className="ping-pulsing-circle" />
          <span className="ping-title">RETURN PICKUP REQUEST</span>
        </div>

        <div className="ping-countdown-circle">
          <svg viewBox="0 0 36 36" className="circular-chart">
            <path className="circle-bg" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
            <path className="circle" strokeDasharray={`${(timeLeft / PING_WINDOW_SECONDS) * 100}, 100`} d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
          </svg>
          <div className="countdown-number">{timeLeft}s</div>
        </div>

        <div className="ping-details-grid">
          <div className="ping-detail-item">
            <span>Product</span>
            <strong>{offer.productName || '—'}</strong>
          </div>
          <div className="ping-detail-item">
            <span>Quantity</span>
            <strong>{offer.quantity ?? '—'}</strong>
          </div>
          <div className="ping-detail-item">
            <span>Distance to customer</span>
            <strong>{km(offer.pickupDistanceKm)}</strong>
          </div>
          <div className="ping-detail-item">
            <span>Customer to seller</span>
            <strong>{km(offer.routeDistanceKm)}</strong>
          </div>
          <div className="ping-detail-item" style={{ gridColumn: '1 / -1' }}>
            <span>Return ID</span>
            <strong>{offer.returnNumber || offer.returnId}</strong>
          </div>
        </div>

        <div className="ping-addresses-box">
          <div className="ping-address-row">
            <span className="address-marker red">🏠</span>
            <div className="address-meta">
              <strong>Pickup: {offer.pickupAddress?.name || 'Customer'}</strong>
              <span className="address-text" style={{ display: 'block', fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
                {addressText(offer.pickupAddress) || 'Address shared after you accept'}
              </span>
            </div>
          </div>
          <div className="ping-address-row">
            <span className="address-marker green">🏪</span>
            <div className="address-meta">
              <strong>Drop: {offer.sellerName || 'Seller'}</strong>
              <span className="address-text" style={{ display: 'block', fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
                {addressText(offer.dropAddress) || offer.dropAddress?.name || '—'}
              </span>
            </div>
          </div>
        </div>

        <div className="ping-actions-row">
          <button className="delivery-danger-btn-outline" onClick={onDecline} style={{ flex: 1 }}>
            Decline
          </button>
          <button className="delivery-primary-action-btn" onClick={onAccept} style={{ flex: 2, margin: 0 }}>
            Accept Pickup
          </button>
        </div>
      </div>
    </ModalPortal>
  );
};

export default ReturnPickupPingModal;
