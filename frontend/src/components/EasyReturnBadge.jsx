import React from 'react';

// Shows the Easy Returns choice frozen on an order item / return (backend services/easyReturns.service.js).
export const returnOptionLabel = (option) => (option === 'EASY_RETURN' ? 'Easy Returns' : option === 'NO_EASY_RETURN' ? 'No Easy Returns' : '');
export const returnOptionRule = (option) => (option === 'NO_EASY_RETURN' ? 'Return only if wrong, damaged or defective' : option === 'EASY_RETURN' ? 'Return for any listed reason within the window' : '');

export default function EasyReturnBadge({ option, extraCharge, days, showRule = false, style }) {
  if (!option) return null;
  const easy = option === 'EASY_RETURN';
  return (
    <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', fontSize: 11.5, ...style }}>
      <span style={{ fontWeight: 800, padding: '2px 8px', borderRadius: 999, background: easy ? '#ecfeff' : '#fff7ed', color: easy ? '#0369a1' : '#c2410c', border: `1px solid ${easy ? '#67e8f9' : '#fdba74'}` }}>
        {returnOptionLabel(option)}{easy && extraCharge > 0 ? ` +₹${extraCharge}/unit` : ''}{days ? ` · ${days} days` : ''}
      </span>
      {showRule ? <span style={{ color: '#64748b' }}>{returnOptionRule(option)}</span> : null}
    </span>
  );
}
