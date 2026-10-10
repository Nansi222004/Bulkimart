import React from 'react';
import { useSHG } from '../context/SHGContext';

/**
 * Persistent strip at the top of the SHG panel.
 *
 * Borrows SellerStatusGate.jsx's visual language (icon + tone + title + body
 * + action) but deliberately NOT its behaviour: that component replaces the
 * whole page, and an expired subscription must still leave the panel fully
 * reachable — the seller has to be able to read their orders and history in
 * order to decide to renew.
 *
 * Shows nothing at all while a subscription is active and not near expiry.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

const SubscriptionBanner = () => {
  const { mySubscription, hasActiveSubscription, setShowSubscriptionModal } = useSHG();

  const endDate = mySubscription?.endDate ? new Date(mySubscription.endDate) : null;
  const daysLeft = endDate ? Math.ceil((endDate - new Date()) / DAY_MS) : null;

  let tone = null;
  let icon = '';
  let title = '';
  let body = '';
  let cta = '';

  if (!hasActiveSubscription) {
    tone = '#ef4444';
    icon = '🚫';
    title = mySubscription ? 'Subscription expired' : 'Subscription required';
    body = mySubscription
      ? 'Your products are hidden from customers and new listings are paused. Your inventory and order history are safe — renew to restore them.'
      : 'Your account is approved. Choose a plan to start listing products.';
    cta = mySubscription ? 'Renew now' : 'Choose a plan';
  } else if (daysLeft !== null && daysLeft <= 7) {
    tone = '#f59e0b';
    icon = '⏳';
    title = `Subscription expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`;
    body = `Your ${mySubscription?.planName || 'plan'} ends on ${endDate.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}. Renew to avoid interruption.`;
    cta = 'Renew now';
  }

  if (!tone) return null;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '12px 18px',
        borderBottom: `1px solid ${tone}44`,
        background: `${tone}12`,
      }}
    >
      <span style={{ fontSize: 22, lineHeight: 1 }}>{icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: tone }}>{title}</div>
        <div style={{ fontSize: 11.5, color: 'var(--shg-text-secondary)', lineHeight: 1.4 }}>{body}</div>
      </div>
      <button
        onClick={() => setShowSubscriptionModal(true)}
        style={{
          border: 'none',
          background: tone,
          color: '#fff',
          fontSize: 12,
          fontWeight: 800,
          padding: '8px 16px',
          borderRadius: 10,
          cursor: 'pointer',
          whiteSpace: 'nowrap',
        }}
      >
        {cta}
      </button>
    </div>
  );
};

export default SubscriptionBanner;
