import ModalPortal from '../../../components/ModalPortal';
import { useFeedback } from '../../../components/feedback/FeedbackProvider';
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useDelivery } from '../context/DeliveryContext';
import { DeliveryMap } from '../../../components/DeliveryMap';
import DeliverySupportPage from './DeliverySupportPage';

export const ActiveDeliveryPage = () => {
  const ui = useFeedback();
  const {
    activeOrder,
    completePickup,
    verifyOTPAndComplete,
    markArrivedAtStore,
    markArrivedAtCustomer,
    requestDeliveryOtp,
    triggerToast,
    cancelOrder,
    riderLocation
  } = useDelivery();

  const [otpInput, setOtpInput] = useState('');
  const [codCollected, setCodCollected] = useState('');
  const [checkedItems, setCheckedItems] = useState({});
  const [timeLeft, setTimeLeft] = useState(600); // 10 minutes SLA (in seconds)
  const [route, setRoute] = useState(null);
  const [showLandmarkModal, setShowLandmarkModal] = useState(false);
  const [imageLoadError, setImageLoadError] = useState(false);
  const [showSupport, setShowSupport] = useState(false);

  const handleRoute = useCallback((info) => setRoute(info), []);

  // Countdown timer effect
  useEffect(() => {
    if (!activeOrder) return;
    const interval = setInterval(() => {
      setTimeLeft(prev => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(interval);
  }, [activeOrder]);

  if (!activeOrder) return null;

  const handleCheckboxChange = (idx) => {
    setCheckedItems(prev => ({
      ...prev,
      [idx]: !prev[idx]
    }));
  };

  const allItemsChecked = activeOrder.items.every((_, idx) => checkedItems[idx]);

  const handlePickup = () => {
    if (!allItemsChecked) {
      triggerToast('Please verify and check all items before pickup.');
      return;
    }
    return ui.perform({title:'Confirm pickup?',message:`Confirm that all items for ${activeOrder.orderNumber || 'this delivery'} have been collected from the store.`,confirmLabel:'Confirm pickup'}, completePickup);
  };

  const handleDeliverySubmit = async (e) => {
    e.preventDefault();
    if (!otpInput) {
      triggerToast('Please enter customer delivery OTP.');
      return;
    }
    const isCod = activeOrder.paymentMethod === 'COD';
    // COD cash is counted in whole rupees; the rounded figure is what is recorded.
    const collected = Math.round(Number(codCollected || 0));
    if (isCod) {
      if (codCollected === '' || !(Number(codCollected) > 0)) {
        triggerToast('Enter the cash you collected from the customer.');
        return;
      }
      const targetCod = Math.round(Number(activeOrder.codAmount || activeOrder.totalAmount || 0));
      if (collected < targetCod) {
        triggerToast(`Cannot accept less amount. Please collect the full COD cash of ₹${targetCod} from customer.`);
        return;
      }
    }
    const success = await verifyOTPAndComplete(otpInput, isCod ? { codCollected: String(collected) } : {});
    if (success) {
      setOtpInput('');
      setCodCollected('');
    }
  };

  // Format SLA timer
  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const isSlaDelayed = timeLeft === 0;

  /**
   * Where the map is pointing.
   *
   * Coordinates come from `/api/delivery/orders/active`, which already carries
   * `merchantLocation` and `customerLocation` from the seller record and the
   * order's shipping address. They are passed through untouched — the address
   * strings below are for the rider to read, never for the map to navigate by.
   * `undefined` when the order has no coordinates, which the map reports rather
   * than papering over.
   *
   * Memoised because the SLA timer above re-renders this page every second. A
   * fresh object each tick would restart the map's draw effect sixty times a
   * minute — it would not buy a route (that is thresholded separately) but it is
   * pointless work on a phone that is also running GPS.
   */
  const isTransit = activeOrder.step === 'transit';

  const pickupPoint = useMemo(
    () => (activeOrder.merchantLocation
      ? { ...activeOrder.merchantLocation, name: activeOrder.merchantName }
      : undefined),
    [activeOrder.merchantLocation, activeOrder.merchantName]
  );

  const dropPoint = useMemo(
    () => (activeOrder.customerLocation
      ? { ...activeOrder.customerLocation, name: activeOrder.customerName }
      : undefined),
    [activeOrder.customerLocation, activeOrder.customerName]
  );

  const riderProp = useMemo(
    () => ({ leg: isTransit ? 'to_customer' : 'to_store', location: riderLocation }),
    [isTransit, riderLocation]
  );

  // Delivery mode verification: Quick Commerce or Same-Day delivery ONLY
  const isQuickCommerce = activeOrder.orderType === 'grocery' || activeOrder.type === 'grocery' || activeOrder.channel === 'grocery';
  const isSameDay = activeOrder.deliveryMode === 'same_day' || activeOrder.delivery?.mode === 'same_day';
  const isEligibleDeliveryMode = isQuickCommerce || isSameDay;

  const landmarkImg = activeOrder.landmarkImage || activeOrder.locationReferenceImage || null;
  const hasImage = Boolean(landmarkImg && typeof landmarkImg === 'string' && landmarkImg.trim().length > 0);
  const customerPhone = String(activeOrder.customerPhone || '').replace(/[\s()-]/g, '');
  const canCallCustomer = /^\+?\d{7,15}$/.test(customerPhone);

  return (
    <div className="delivery-active-delivery-wrapper">
      {showSupport && (
        <ModalPortal className="delivery-support-overlay" aria-label="Delivery support"
          onClick={event => { if (event.target === event.currentTarget) setShowSupport(false); }}
          onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setShowSupport(false); } }}>
          <section className="delivery-support-sheet">
            <header>
              <h2>Chat Support</h2>
              <button type="button" onClick={() => setShowSupport(false)}>Back to delivery</button>
            </header>
            <div className="delivery-support-content">
              <DeliverySupportPage orderId={activeOrder.orderId} orderNo={activeOrder.orderNo || activeOrder.orderNumber} />
            </div>
          </section>
        </ModalPortal>
      )}
      {showLandmarkModal && hasImage && !imageLoadError && (
        <ModalPortal
          onClick={() => setShowLandmarkModal(false)}
          style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.85)', zIndex: 9999, display: 'flex',
            alignItems: 'center', justifyContent: 'center', padding: '20px'
          }}
        >
          <div style={{ position: 'relative', maxWidth: '90%', maxHeight: '85vh' }} onClick={(e) => e.stopPropagation()}>
            <img 
              src={landmarkImg} 
              alt="Customer Landmark Full Preview" 
              style={{ width: '100%', maxHeight: '80vh', borderRadius: '12px', objectFit: 'contain' }} 
            />
            <button
              onClick={() => setShowLandmarkModal(false)}
              style={{
                position: 'absolute', top: -14, right: -14, background: '#ef4444', color: '#fff',
                border: 'none', borderRadius: '50%', width: 32, height: 32, cursor: 'pointer', fontWeight: 'bold', fontSize: '16px'
              }}
            >
              ✕
            </button>
          </div>
        </ModalPortal>
      )}
      {/* SLA Timer Alert Bar */}
      <div className={`delivery-sla-timer-bar ${isSlaDelayed ? 'delayed' : ''}`}>
        <span className="sla-label">⏱️ QUICK SLA TIMER:</span>
        <span className="sla-value">{isSlaDelayed ? 'DELAYED' : formatTime(timeLeft)}</span>
      </div>

      {/* Live Map Navigation Display */}
      <div
        className="delivery-active-map-box"
        style={{ height: 'auto', border: 'none', boxShadow: 'none' }}
      >
        <DeliveryMap
          pickup={pickupPoint}
          drop={dropPoint}
          stage={activeOrder.stage}
          rider={riderProp}
          showRiderCard={false}
          onRoute={handleRoute}
          height={200}
        />

        {(route?.instruction || route?.distanceText) && (
          <div className="delivery-map-nav-bubble">
            <span className="nav-bubble-arrow">➔</span>
            <div className="nav-bubble-text">
              {route.instruction && <strong>{route.instruction}</strong>}
              <span>
                {[route.distanceText, route.durationText].filter(Boolean).join(' · ')}
                {' to '}
                {isTransit ? 'the customer' : 'the store'}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Active Order Card */}
      <div className="delivery-card delivery-active-order-details-card">
        {/* Step Indicator Header */}
        <div className="delivery-active-step-header">
          <span className={`delivery-step-badge ${activeOrder.step === 'pickup' ? 'active' : ''}`}>
            {activeOrder.step === 'pickup' ? '1. Heading to Store' : '1. Store Picked Up'}
          </span>
          <span className={`delivery-step-badge ${activeOrder.step === 'transit' ? 'active' : ''}`}>
            {activeOrder.step === 'transit' ? '2. Delivering to Customer' : '2. Complete Delivery'}
          </span>
        </div>

        {/* Pickup (Store) Stage Layout */}
        {activeOrder.step === 'pickup' && (
          <div className="active-delivery-sub-stage">
            <div className="delivery-address-block">
              <span className="address-type-label">🏪 MERCHANT STORE</span>
              <h4>{activeOrder.merchantName}</h4>
              <p>{activeOrder.merchantAddress}</p>
            </div>

            {/* Checklist items */}
            <div className="delivery-item-checklist-box">
              <span className="checklist-heading">Verify Items Checklist:</span>
              <div className="checklist-list">
                {activeOrder.items.map((it, idx) => (
                  <label key={it.name} className="checklist-item-row">
                    <input 
                      type="checkbox" 
                      checked={!!checkedItems[idx]} 
                      onChange={() => handleCheckboxChange(idx)}
                    />
                    <span className="item-details">
                      <strong>{it.qty}x</strong> {it.name}
                    </span>
                  </label>
                ))}
              </div>
            </div>

            <div className="delivery-action-row-full">
              {activeOrder.stage !== 'arrived_at_store' && (
                <button
                  className="delivery-secondary-action-btn"
                  onClick={markArrivedAtStore}
                  style={{ width: '100%' }}
                >
                  I have reached the store
                </button>
              )}

              <button
                className="delivery-primary-action-btn"
                onClick={handlePickup}
              >
                Confirm Pickup &amp; Start Transit
              </button>
              <button
                className="delivery-danger-btn-outline"
                onClick={async () => {
                  return ui.perform('Cancel this delivery trip? Account warning may apply.', async () => {
                    return await cancelOrder(activeOrder);
                  });
                }}
              >
                Cancel Delivery
              </button>
            </div>
          </div>
        )}

        {/* Transit (Customer) Stage Layout */}
        {activeOrder.step === 'transit' && (
          <div className="active-delivery-sub-stage">
            <div className="delivery-address-block">
              <span className="address-type-label">👤 CUSTOMER ADDRESS</span>
              <h4>{activeOrder.customerName}</h4>
              <p>{activeOrder.customerAddress}</p>

              {/* NEARBY LOCATION REFERENCE SECTION (Quick Commerce & Same-Day ONLY) */}
              {isEligibleDeliveryMode && (
                <div style={{
                  marginTop: '12px',
                  marginBottom: '12px',
                  backgroundColor: '#f8fafc',
                  borderRadius: '10px',
                  padding: '12px',
                  border: '1px solid #e2e8f0',
                }}>
                  <div style={{
                    fontSize: '11px',
                    fontWeight: '800',
                    color: '#334155',
                    letterSpacing: '0.5px',
                    textTransform: 'uppercase',
                    marginBottom: '8px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px'
                  }}>
                    <span>📍</span>
                    <span>NEARBY LOCATION REFERENCE</span>
                  </div>

                  {hasImage ? (
                    /* CASE 1 — IMAGE EXISTS */
                    <div>
                      {imageLoadError ? (
                        <div style={{
                          padding: '14px',
                          backgroundColor: '#fef2f2',
                          borderRadius: '8px',
                          border: '1px solid #fecaca',
                          color: '#991b1b',
                          fontSize: '12px',
                          fontWeight: '600',
                          textAlign: 'center'
                        }}>
                          Location reference image unavailable.
                        </div>
                      ) : (
                        <div>
                          <div 
                            onClick={() => setShowLandmarkModal(true)}
                            style={{
                              position: 'relative',
                              width: '100%',
                              maxHeight: '240px',
                              borderRadius: '8px',
                              overflow: 'hidden',
                              border: '1.5px solid #cbd5e1',
                              cursor: 'pointer',
                              backgroundColor: '#000'
                            }}
                          >
                            <img 
                              src={landmarkImg} 
                              alt="Customer Location Reference" 
                              onError={() => setImageLoadError(true)}
                              style={{
                                width: '100%',
                                maxHeight: '240px',
                                objectFit: 'cover',
                                display: 'block'
                              }} 
                            />
                          </div>
                          <p style={{
                            margin: '8px 0 6px',
                            fontSize: '11.5px',
                            color: '#475569',
                            lineHeight: '1.4'
                          }}>
                            This photo was provided by the customer to help you locate the delivery address.
                          </p>
                          <button
                            type="button"
                            onClick={() => setShowLandmarkModal(true)}
                            style={{
                              padding: '6px 12px',
                              backgroundColor: '#ffffff',
                              border: '1px solid #cbd5e1',
                              borderRadius: '6px',
                              fontSize: '11.5px',
                              fontWeight: '700',
                              color: '#0f172a',
                              cursor: 'pointer',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px'
                            }}
                          >
                            <span>🔍</span>
                            <span>View Full Image</span>
                          </button>
                        </div>
                      )}
                    </div>
                  ) : (
                    /* CASE 2 — IMAGE DOES NOT EXIST */
                    <div style={{
                      padding: '10px 12px',
                      backgroundColor: '#ffffff',
                      borderRadius: '8px',
                      border: '1px dashed #cbd5e1'
                    }}>
                      <div style={{
                        fontSize: '12px',
                        fontWeight: '700',
                        color: '#475569',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px'
                      }}>
                        <span>📷</span>
                        <span>No nearby image provided</span>
                      </div>
                      <p style={{
                        margin: '4px 0 0',
                        fontSize: '11px',
                        color: '#64748b'
                      }}>
                        The customer has not provided a nearby location reference image.
                      </p>
                    </div>
                  )}
                </div>
              )}
              
              <div className="delivery-customer-actions-row">
                {canCallCustomer ? <a href={`tel:${customerPhone}`}>
                  📞 Call Customer
                </a> : <button type="button" onClick={() => triggerToast('The customer phone number is unavailable. Please contact support.')}>
                  📞 Call Customer
                </button>}
                <button type="button" onClick={() => setShowSupport(true)}>
                  💬 Chat Support
                </button>
              </div>
            </div>

            {/*
              Two taps before the code can be asked for: reaching the address,
              then sending the code. Splitting them is what makes the customer's
              screen useful — they see "arrived at your address" and know to come
              down, and only then does a number appear on their phone.
            */}
            {activeOrder.stage !== 'arrived_at_customer' && !activeOrder.otpSent && (
              <button
                className="delivery-secondary-action-btn"
                onClick={markArrivedAtCustomer}
                style={{ width: '100%', marginBottom: 10 }}
              >
                I have reached the customer
              </button>
            )}

            {!activeOrder.otpSent && (
              <button
                className="delivery-primary-action-btn"
                onClick={requestDeliveryOtp}
                style={{ marginBottom: 12 }}
              >
                🔑 Send code to the customer
              </button>
            )}

            {activeOrder.otpSent && (
              <div className="delivery-location-notice" style={{ marginBottom: 12 }}>
                A 4-digit code is on the customer's phone. Ask them to read it out.
              </div>
            )}

            {/* OTP Verification Form */}
            <form onSubmit={handleDeliverySubmit} className="delivery-otp-verify-form">
              <div className="delivery-input-group">
                {/* The code is shown on the customer's phone, and nowhere else.
                    A "TEST OTP" badge used to print it here, which let a rider
                    close the delivery without ever speaking to anyone — the one
                    thing the code exists to prevent. */}
                <div className="delivery-otp-meta-row">
                  <label className="delivery-input-label">Ask the customer for their 4-digit code</label>
                </div>
                <input 
                  type="text" 
                  maxLength="4"
                  className="delivery-otp-digit-input"
                  placeholder="e.g. 5432"
                  value={otpInput}
                  onChange={(e) => setOtpInput(e.target.value.replace(/\D/g, ''))}
                />
              </div>

              {activeOrder.payout?.tip > 0 && (
                <div className="ping-tip-banner">
                  <span className="ping-tip-icon">🎉</span>
                  <span className="ping-tip-text">
                    This customer tipped <strong>₹{activeOrder.payout.tip}</strong> — credited with your pay on completion
                  </span>
                </div>
              )}

              {activeOrder.paymentMethod === 'COD' && (
                <div className="delivery-cod-alert-box">
                  💵 <strong>COLLECT COD CASH:</strong> Please collect <strong>₹{Math.round(Number(activeOrder.codAmount || activeOrder.totalAmount || 0))}</strong> in cash from customer before entering OTP.
                  <label style={{ display: 'block', marginTop: 10, fontWeight: 700 }}>
                    Cash collected (₹)
                    <input
                      type="number"
                      min="0"
                      step="1"
                      inputMode="decimal"
                      className="delivery-otp-digit-input"
                      placeholder={String(Math.round(Number(activeOrder.codAmount || activeOrder.totalAmount || 0)))}
                      value={codCollected}
                      onChange={(e) => setCodCollected(e.target.value)}
                      style={{ display: 'block', width: '100%', marginTop: 6 }}
                    />
                  </label>
                  <small style={{ display: 'block', marginTop: 4, fontWeight: 500, color: '#334155' }}>
                    Collect exact cash of ₹{Math.round(Number(activeOrder.codAmount || activeOrder.totalAmount || 0))} (round off). Less amount cannot be verified. This cash belongs to Bulkimart and must be handed over.
                  </small>
                </div>
              )}

              <button type="submit" className="delivery-primary-action-btn">
                Verify OTP &amp; Complete Order
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
};

export default ActiveDeliveryPage;
