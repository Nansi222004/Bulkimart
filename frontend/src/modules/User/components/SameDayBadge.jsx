import React from 'react';

/**
 * The ⚡ on a product card, when the server says this customer can have it today.
 *
 * Renders nothing at all unless `verdict.available` is true. That is the whole
 * design: absence is the default, and the badge is the exception the backend has
 * to earn. A seller ticking a box is one of eight conditions — the distance, the
 * stock, the cut-off, the packing time, the day and a free rider decide the rest
 * — so this component never reads `sameDay.enabled` and never guesses.
 *
 * It also stays silent while a verdict is still loading. A badge that flashes on
 * and then disappears is worse than one that arrives a moment late.
 *
 * @param {object} verdict  one entry from /api/products/delivery-options
 */
export const SameDayBadge = ({ verdict, compact = false }) => {
  if (!verdict?.available) return null;

  return (
    <span
      title={verdict.promisedBy
        ? `Expected by ${new Date(verdict.promisedBy).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}`
        : 'Same-day delivery available'}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        background: '#dcfce7',
        color: '#166534',
        borderRadius: 6,
        padding: compact ? '2px 6px' : '3px 8px',
        fontSize: compact ? 9 : 10,
        fontWeight: 800,
        letterSpacing: 0.2,
        whiteSpace: 'nowrap',
        marginTop: 4,
      }}
    >
      ⚡ Same-day
    </span>
  );
};

export default SameDayBadge;
