import React from 'react';

/**
 * Shown on a product whose SHG seller has no active subscription right now.
 *
 * The seller's real stock is untouched in the database — this is purely a
 * customer-facing availability state, and the product returns to normal the
 * moment the seller renews.
 */
const UnavailableBadge = ({ style }) => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      padding: '10px 14px',
      borderRadius: 10,
      border: '1px solid rgba(239,68,68,0.35)',
      background: 'rgba(239,68,68,0.08)',
      color: '#ef4444',
      fontSize: 12.5,
      fontWeight: 700,
      ...style,
    }}
  >
    <span style={{ fontSize: 15 }}>🚫</span>
    <span>Currently unavailable — this seller is not accepting orders right now.</span>
  </div>
);

export default UnavailableBadge;
