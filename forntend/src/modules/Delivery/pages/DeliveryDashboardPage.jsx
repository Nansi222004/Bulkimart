import React, { useState, useEffect } from 'react';
import { useDelivery } from '../context/DeliveryContext';
import OrderPingModal from '../components/OrderPingModal';
import DepositModal from '../components/DepositModal';
import BrandLogo from '../../../components/BrandLogo';

export const DeliveryDashboardPage = () => {
  const { 
    isOnline, 
    setIsOnline, 
    debitWallet, 
    settleDebitWallet, 
    payoutBalance, 
    acceptOrder,
    declineOrder,
    expireOrder,
    triggerToast,
    earningsData,
    riderName,
    riderProfile,
    riderPingOrder
  } = useDelivery();

  const [showDeposit, setShowDeposit] = useState(false);

  const handleAccept = () => {
    if (riderPingOrder) {
      acceptOrder(riderPingOrder);
    }
  };

  // The rider explicitly tapped Decline — this calls the backend and is
  // recorded as DECLINED_BY_RIDER. Not the same path as the offer timing
  // out (see handleExpire below and OrderPingModal's onExpire prop) — that
  // distinction is the whole point of this step.
  const handleDecline = () => {
    if (riderPingOrder) {
      declineOrder(riderPingOrder);
    }
  };

  /**
   * The offer ran out the clock, nobody tapped anything.
   *
   * Calls the backend expiry endpoint, not decline — a timeout is not the
   * rider refusing the job, and recording it as DECLINED_BY_RIDER would be
   * false. `expireOrder` itself decides whether/when to clear the on-screen
   * offer, based on the backend's authoritative response.
   */
  const handleExpire = () => {
    if (riderPingOrder) {
      expireOrder(riderPingOrder);
    }
  };

  const codLimit = 2000;
  const isWalletWarning = debitWallet >= 1500;
  const isWalletBlocked = debitWallet >= codLimit;

  return (
    <div className="delivery-dashboard-wrapper">
      {/* Top Header Card */}
      <div className="delivery-dashboard-header">
        <BrandLogo variant="mark" portal="Delivery" />
        <div className="delivery-header-profile">
          <div className="delivery-avatar">
            {(riderName || 'R').charAt(0).toUpperCase()}
          </div>
          <div className="delivery-driver-info">
            <span className="delivery-driver-name">Hi, {riderName || 'Rider'}</span>
            <span className="delivery-driver-vehicle">
              {riderProfile?.vehicleType 
                ? `${riderProfile.vehicleType.charAt(0).toUpperCase() + riderProfile.vehicleType.slice(1)} Partner` 
                : 'Delivery Partner'}
            </span>
          </div>
        </div>

        {/* Online/Offline Toggle */}
        <button 
          className={`delivery-status-toggle-btn ${isOnline ? 'online' : 'offline'}`}
          onClick={() => {
            if (isWalletBlocked && !isOnline) {
              triggerToast('Debit wallet balance limit exceeded! Settle COD cash to go Online.');
              return;
            }
            setIsOnline(!isOnline);
            triggerToast(isOnline ? 'You are now Offline.' : 'You are now Online and accepting orders.');
          }}
        >
          <span className="status-toggle-indicator" />
          {isOnline ? 'Go Offline' : 'Go Online'}
        </button>
      </div>

      {/* COD Debit Wallet Status Card */}
      <div className="delivery-card delivery-debit-wallet-card">
        <div className="delivery-card-header">
          <span className="delivery-card-title">💰 COD Debit Wallet</span>
          <span className="delivery-wallet-status">{debitWallet >= codLimit ? 'BLOCKED' : 'ACTIVE'}</span>
        </div>
        <div className="delivery-wallet-balance-row">
          <div className="delivery-balance-col">
            <span className="delivery-balance-val">₹{debitWallet}</span>
            <span className="delivery-balance-label">Cash collected (Liability to company)</span>
          </div>
          <button 
            className="delivery-settle-btn"
            onClick={() => setShowDeposit(true)}
            disabled={debitWallet === 0}
          >
            Deposit Cash
          </button>
        </div>

        {/* Progress bar tracking maximum cash capacity */}
        <div className="delivery-progress-container">
          <div 
            className={`delivery-progress-bar ${isWalletWarning ? 'warning' : ''} ${isWalletBlocked ? 'blocked' : ''}`}
            style={{ width: `${Math.min((debitWallet / codLimit) * 100, 100)}%` }}
          />
          <div className="delivery-progress-labels">
            <span>₹0</span>
            <span>Limit: ₹{codLimit}</span>
          </div>
        </div>

        {/* COD warnings messages */}
        {isWalletBlocked && (
          <div className="delivery-alert-box blocked">
            ⚠️ <strong>Blocked:</strong> Floating cash limit exceeded. Please deposit the cash collected to unlock orders.
          </div>
        )}
        {!isWalletBlocked && isWalletWarning && (
          <div className="delivery-alert-box warning">
            ⚠️ <strong>Nearing Limit:</strong> Settle your COD wallet soon to prevent account blocking.
          </div>
        )}
      </div>

      {/* Today's KPI Dashboard */}
      <div className="delivery-dashboard-kpi-grid">
        {/*
          Today's total is only known from trips finished since this tab opened,
          so after a reload it shows a dash rather than ₹0 — a rider who earned
          ₹263 this morning should not be told they earned nothing. The all-time
          figure beside it comes from their record in the database and is always
          right.
        */}
        <div className="delivery-kpi-card">
          <span className="delivery-kpi-label">Today's Earnings</span>
          <span className="delivery-kpi-val">
            {earningsData.daily.available ? `₹${earningsData.daily.total}` : '—'}
          </span>
          <span className="delivery-kpi-sub">
            {earningsData.daily.available
              ? `${earningsData.daily.trips} trip${earningsData.daily.trips === 1 ? '' : 's'} this session`
              : 'Counted as you deliver'}
          </span>
        </div>
        <div className="delivery-kpi-card">
          <span className="delivery-kpi-label">Total Earnings</span>
          <span className="delivery-kpi-val">
            {earningsData.lifetime.available ? `₹${earningsData.lifetime.total}` : '—'}
          </span>
          <span className="delivery-kpi-sub">
            {earningsData.lifetime.trips} delivered all time
          </span>
        </div>
      </div>

      {/* Main Action Duty Area */}
      <div className="delivery-card delivery-duty-listening-card">
        {isOnline ? (
          <div className="delivery-listening-body">
            <div className="delivery-radar-pulse">
              <div className="radar-ring" />
              <div className="radar-ring-2" />
              <div className="radar-center">📡</div>
            </div>
            <h4>Listening for Orders...</h4>
            <p>We are searching for quick commerce deliveries in your zone.</p>
            
            {isWalletBlocked ? (
              <p className="delivery-error-text" style={{ color: 'var(--error)', fontWeight: 'bold' }}>
                Clear COD Debit Wallet to receive orders.
              </p>
            ) : (
              <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>
                You will be notified when a new order is available in your area.
              </p>
            )}
          </div>
        ) : (
          <div className="delivery-offline-body" style={{ textAlign: 'center', padding: '20px 0' }}>
            <span className="delivery-offline-icon" style={{ fontSize: 40, display: 'block', marginBottom: 12 }}>💤</span>
            <h4>You are Offline</h4>
            <p>Switch your duty status to Online to start earning.</p>
          </div>
        )}
      </div>

      {/* Order Ping Alert overlay */}
      {riderPingOrder && (
        <OrderPingModal
          order={riderPingOrder}
          onAccept={handleAccept}
          onDecline={handleDecline}
          onExpire={handleExpire}
        />
      )}

      {/* Deposit cash modal */}
      <DepositModal 
        isOpen={showDeposit} 
        onClose={() => setShowDeposit(false)} 
      />
    </div>
  );
};

export default DeliveryDashboardPage;
