import React from 'react';

/**
 * What a panel shows when it has nothing to show.
 *
 * Two different kinds of nothing, and conflating them misleads the seller:
 *   - "you have no orders yet"  → the feature works, the data is genuinely empty
 *   - "payouts are not live yet" → the feature does not exist, so an empty list
 *                                  is not a statement about their business
 *
 * Pass `notBuilt` for the second. It is worth the distinction: a seller who
 * reads "₹0 paid out" concludes they have not been paid, which is a different
 * claim from "we cannot tell you yet".
 */
export const EmptyState = ({ icon = '📭', title, message, notBuilt = false }) => (
  <div
    style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      textAlign: 'center',
      gap: 8,
      padding: '44px 24px',
      margin: '12px 16px',
      borderRadius: 14,
      backgroundColor: notBuilt ? '#f8fafc' : '#ffffff',
      border: notBuilt ? '1.5px dashed #cbd5e1' : '1.5px solid #e2e8f0',
    }}
  >
    <span style={{ fontSize: 30, lineHeight: 1 }}>{icon}</span>
    <div style={{ fontSize: 14, fontWeight: 800, color: '#0f172a' }}>{title}</div>
    <p style={{ margin: 0, fontSize: 12, color: '#64748b', fontWeight: 500, maxWidth: 300, lineHeight: 1.6 }}>
      {message}
    </p>
    {notBuilt && (
      <span style={{ fontSize: 10, fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.5 }}>
        Not live yet
      </span>
    )}
  </div>
);

export default EmptyState;
