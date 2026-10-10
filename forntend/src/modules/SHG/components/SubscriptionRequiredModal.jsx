import React, { useState } from 'react';
import { useSHG } from '../context/SHGContext';

/**
 * Opened when a subscription-gated write is rejected by the backend with
 * meta.code === 'SUBSCRIPTION_REQUIRED' (see handledSubscriptionBlock in
 * SHGContext). Prices always come from the backend plan list — nothing here
 * hardcodes an amount, so an admin's price change is reflected immediately.
 */
const SubscriptionRequiredModal = () => {
  const {
    showSubscriptionModal, setShowSubscriptionModal,
    subscriptionPlans, purchasePlan, subscriptionLoading, mySubscription,
  } = useSHG();

  const [selectedPlanId, setSelectedPlanId] = useState(null);

  if (!showSubscriptionModal) return null;

  const isRenewal = Boolean(mySubscription);

  return (
    <div className="shg-modal-overlay" onClick={() => setShowSubscriptionModal(false)}>
      <div className="shg-modal-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="shg-modal-header">
          <h3 className="shg-modal-title">{isRenewal ? 'Renew your subscription' : 'Subscription required'}</h3>
          <button className="shg-modal-close" onClick={() => setShowSubscriptionModal(false)}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>

        <p style={{ margin: '0 0 16px 0', fontSize: 13, color: 'var(--shg-text-secondary)', lineHeight: 1.5 }}>
          Your SHG account is approved and the panel stays open, but listing or
          editing products needs an active subscription. Choose a plan to continue —
          your existing products, stock and order history are all preserved.
        </p>

        {subscriptionPlans.length === 0 ? (
          <div className="shg-empty-state">
            <div className="shg-empty-icon">📦</div>
            <p className="shg-empty-text">No subscription plans are available right now.</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
            {subscriptionPlans.map((plan) => {
              const selected = selectedPlanId === plan._id;
              return (
                <button
                  key={plan._id}
                  onClick={() => setSelectedPlanId(plan._id)}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '14px 16px',
                    borderRadius: 'var(--shg-radius-md)',
                    border: `1.5px solid ${selected ? 'var(--shg-primary)' : 'var(--shg-border)'}`,
                    background: selected ? 'var(--shg-primary-light)' : '#fff',
                    cursor: 'pointer',
                    textAlign: 'left',
                    width: '100%',
                  }}
                >
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--shg-text-primary)' }}>{plan.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--shg-text-muted)', marginTop: 2 }}>
                      {plan.durationMonths} month{plan.durationMonths === 1 ? '' : 's'} of full business access
                    </div>
                  </div>
                  <div style={{ fontSize: 18, fontWeight: 900, color: 'var(--shg-primary)' }}>
                    ₹{plan.price.toLocaleString('en-IN')}
                  </div>
                </button>
              );
            })}
          </div>
        )}

        <button
          className="shg-primary-btn"
          style={{ margin: 0, opacity: !selectedPlanId || subscriptionLoading ? 0.6 : 1 }}
          disabled={!selectedPlanId || subscriptionLoading}
          onClick={() => purchasePlan(selectedPlanId)}
        >
          {subscriptionLoading ? 'Starting payment…' : 'Pay with PhonePe'}
        </button>

        <p style={{ margin: '10px 0 0 0', fontSize: 10.5, color: 'var(--shg-text-muted)', textAlign: 'center', lineHeight: 1.5 }}>
          You'll be redirected to PhonePe. Your subscription activates only once the
          payment is confirmed by the payment gateway.
        </p>
      </div>
    </div>
  );
};

export default SubscriptionRequiredModal;
