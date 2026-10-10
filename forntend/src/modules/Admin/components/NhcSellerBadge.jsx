import React from 'react';

/**
 * Reusable visual badge for NHC Sellers in Admin vendor components.
 */
export const NhcSellerBadge = ({ isNhc, style = {}, className = '' }) => {
  if (isNhc !== undefined && !isNhc) return null;
  return (
    <span
      className={`nhc-seller-badge ${className}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        padding: '3px 8px',
        borderRadius: '6px',
        fontSize: '11px',
        fontWeight: '800',
        backgroundColor: '#fef3c7',
        color: '#b45309',
        border: '1px solid #fde68a',
        letterSpacing: '0.3px',
        boxShadow: '0 1px 2px rgba(180, 83, 9, 0.08)',
        whiteSpace: 'nowrap',
        lineHeight: '1.2',
        ...style,
      }}
    >
      ⭐ NHC SELLER
    </span>
  );
};

/**
 * Helper: preserves natural list mixture while allowing visual badge highlighting.
 */
export const sortNhcSellersFirst = (list = []) => {
  if (!Array.isArray(list)) return [];
  return list;
};

export default NhcSellerBadge;
