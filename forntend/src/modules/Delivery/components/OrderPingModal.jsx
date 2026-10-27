import ModalPortal from '../../../components/ModalPortal';
import React, { useState, useEffect, useMemo } from 'react';
import { DeliveryMap } from '../../../components/DeliveryMap';

const PING_WINDOW_SECONDS = 60; // how long a rider has to accept before the offer expires

export const OrderPingModal = ({ order, onAccept, onDecline, onExpire }) => {
  const [timeLeft, setTimeLeft] = useState(PING_WINDOW_SECONDS);
  const [showMap, setShowMap] = useState(false);
  const validPoint = point => Number.isFinite(Number(point?.lat)) && Number.isFinite(Number(point?.lng));
  const pickupPoint = useMemo(() => validPoint(order.merchantLocation) ? { lat: Number(order.merchantLocation.lat), lng: Number(order.merchantLocation.lng), name: order.merchantName } : undefined, [order.merchantLocation?.lat, order.merchantLocation?.lng, order.merchantName]);
  const dropPoint = useMemo(() => validPoint(order.customerLocation) ? { lat: Number(order.customerLocation.lat), lng: Number(order.customerLocation.lng), name: order.customerName } : undefined, [order.customerLocation?.lat, order.customerLocation?.lng, order.customerName]);
  // The full route in the phone's maps app, shop to customer.
  const fullMapUrl = pickupPoint && dropPoint
    ? `https://www.google.com/maps/dir/?api=1&origin=${pickupPoint.lat},${pickupPoint.lng}&destination=${dropPoint.lat},${dropPoint.lng}&travelmode=driving`
    : pickupPoint ? `https://www.google.com/maps/search/?api=1&query=${pickupPoint.lat},${pickupPoint.lng}` : null;

  /**
   * Count down, and nothing else.
   *
   * `onDecline()` used to be called from inside the `setTimeLeft` updater. React
   * runs updater functions during rendering, so declining from in there set
   * state on the provider mid-render — the "Cannot update a component while
   * rendering a different component" warning. The expiry is now just a state
   * change; acting on it happens in its own effect, after the render settles.
   */
  useEffect(() => {
    const timer = setInterval(() => {
      setTimeLeft((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  /**
   * Running out the clock is not the rider declining.
   *
   * These used to be the same call, which meant an offer nobody ever looked
   * at recorded the same event as one somebody actively refused. `onExpire`
   * is temporary — it still only clears the local screen, same as before —
   * until a real OFFER_EXPIRED backend event exists (see Step 3). Falls back
   * to `onDecline` only so an older caller that has not been updated yet does
   * not silently stop clearing the offer.
   */
  useEffect(() => {
    if (timeLeft === 0) (onExpire || onDecline)();
  }, [timeLeft, onExpire, onDecline]);

  /**
   * The payout comes from the server, already computed.
   *
   * This screen used to work it out itself as `80 + km × 12`, while the backend
   * settled at `km × 12 + 20`. A rider offered ₹97 for a 1.4 km trip was
   * actually paid ₹37 — and only discovered it after doing the job. There is
   * now one function behind both numbers, and this only displays it.
   */
  const payout = order.payout || {};
  const distance = order.distance;                 // shop → customer
  const pickupDistance = order.pickupDistance;     // rider → shop

  const km = (v) => (typeof v === 'number' ? `${v} km` : '—');

  return (
    <ModalPortal className="delivery-modal-overlay">
      <div className="delivery-order-ping-modal-sheet">
        {/* Pulsing Alert Banner */}
        <div className="ping-modal-header-pulsing">
          <span className="ping-pulsing-circle" />
          <span className="ping-title">INCOMING DELIVERY REQUEST</span>
        </div>

        {/* Countdown display */}
        <div className="ping-countdown-circle">
          <svg viewBox="0 0 36 36" className="circular-chart">
            <path 
              className="circle-bg"
              d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
            />
            <path 
              className="circle"
              strokeDasharray={`${(timeLeft / PING_WINDOW_SECONDS) * 100}, 100`}
              d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
            />
          </svg>
          <div className="countdown-number">{timeLeft}s</div>
        </div>

        {/* Job Payout Preview */}
        <div className="ping-payout-box">
          <span className="payout-label">RIDER DELIVERY PAYOUT</span>
          <span className="payout-val">₹{payout.total ?? 0}</span>
          <span className="payout-sub">
            Base ₹{payout.base ?? 0} + Dist ₹{payout.distancePay ?? 0}
            {payout.tip > 0 && ` + Tip ₹${payout.tip}`}
          </span>
        </div>

        {/*
          A tip gets its own banner rather than only the line above.
          It is the one number on this screen that says something about the
          customer rather than the job, and a rider has seconds to decide —
          it has to be readable at a glance, not parsed out of a formula.
        */}
        {payout.tip > 0 && (
          <div className="ping-tip-banner">
            <span className="ping-tip-icon">🎉</span>
            <span className="ping-tip-text">
              Customer is tipping <strong>₹{payout.tip}</strong> — yours in full
            </span>
          </div>
        )}

        {/* Distance Info Cards */}
        <div className="ping-details-grid">
          <div className="ping-detail-item">
            <span>To the store</span>
            <strong>{km(pickupDistance)}</strong>
          </div>
          <div className="ping-detail-item">
            <span>Store to customer</span>
            <strong>{km(distance)}</strong>
          </div>
          <div className="ping-detail-item">
            <span>Order Value</span>
            <strong>₹{order.totalAmount || order.codAmount || 0}</strong>
          </div>
          <div className="ping-detail-item">
            <span>Payment Type</span>
            <strong className={order.paymentMethod === 'COD' ? 'cod-highlight' : ''}>
              {order.paymentMethod} {order.paymentMethod === 'COD' && `(₹${order.codAmount})`}
            </strong>
          </div>
        </div>

        {/* Route preview — the map stays closed until asked, so the offer fits on screen. */}
        {(pickupPoint || dropPoint) && (
          <div className="ping-map-box">
            <div className="ping-map-actions">
              <button type="button" className="ping-map-toggle" aria-expanded={showMap} onClick={() => setShowMap(open => !open)}>
                {showMap ? 'Hide map' : 'View route on map'}
              </button>
              {fullMapUrl && <a className="ping-map-open" href={fullMapUrl} target="_blank" rel="noreferrer">Open full map ↗</a>}
            </div>
            {showMap && <DeliveryMap pickup={pickupPoint} drop={dropPoint} showRiderCard={false} height={200} />}
          </div>
        )}

        {/* Addresses summary */}
        <div className="ping-addresses-box">
          <div className="ping-address-row">
            <span className="address-marker green">🏪</span>
            <div className="address-meta">
              <strong>Pickup: {order.merchantName}</strong>
              <span className="address-text" style={{ display: 'block', fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
                {order.merchantAddress}
              </span>
            </div>
          </div>
          <div className="ping-address-row">
            <span className="address-marker red">🏠</span>
            <div className="address-meta">
              <strong>Drop: {order.customerName}</strong>
              <span className="address-text" style={{ display: 'block', fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
                {order.customerAddress}
              </span>
              {Boolean(order.landmarkImage || order.hasLandmarkImage) && (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: '6px', background: '#e0f2fe',
                  color: '#0369a1', padding: '5px 8px', borderRadius: '6px', fontSize: '11px',
                  fontWeight: '700', marginTop: '6px'
                }}>
                  <span>📸</span>
                  <span>Landmark Photo Available</span>
                  {order.landmarkImage && (
                    <img src={order.landmarkImage} alt="Landmark" style={{ width: '24px', height: '24px', borderRadius: '4px', objectFit: 'cover', marginLeft: 'auto' }} />
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="ping-actions-row">
          <button 
            className="delivery-danger-btn-outline"
            onClick={onDecline}
            style={{ flex: 1 }}
          >
            Decline
          </button>
          <button 
            className="delivery-primary-action-btn"
            onClick={onAccept}
            style={{ flex: 2, margin: 0 }}
          >
            Accept Job
          </button>
        </div>
      </div>
    </ModalPortal>
  );
};

export default OrderPingModal;
