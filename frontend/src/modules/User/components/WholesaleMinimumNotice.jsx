import React from 'react';
import { browseWholesale } from './CartUI';

const rupees = (value) => `₹${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

/**
 * Wholesale minimum order value (server: services/wholesaleMinimum.service.js). Shown on the
 * cart and at checkout while a basket has Wholesale items; retail baskets never get one.
 * `state` is totals.wholesaleMinimum from the basket quote (null = nothing to show).
 */
export default function WholesaleMinimumNotice({ state, showAddMore = true }) {
  if (!state) return null;
  const short = !state.met;
  return (
    <div role={short ? 'alert' : 'status'} className="wholesale-minimum-notice"
      style={{ border: `1px solid ${short ? '#fcd34d' : '#86efac'}`, background: short ? '#fffbeb' : '#f0fdf4', color: short ? '#92400e' : '#166534', padding: 12, borderRadius: 10, fontSize: 13, display: 'grid', gap: 8, marginBottom: 12 }}>
      <strong style={{ fontSize: 13.5 }}>
        {short
          ? `Wholesale minimum order is ${rupees(state.minimumOrderValue)}. Add ${rupees(state.remainingAmount)} more to place your order.`
          : `Wholesale minimum of ${rupees(state.minimumOrderValue)} reached.`}
      </strong>
      <div aria-hidden="true" style={{ height: 6, borderRadius: 6, background: short ? '#fde68a' : '#bbf7d0', overflow: 'hidden' }}>
        <div style={{ width: `${state.progressPercentage}%`, height: '100%', background: short ? '#d97706' : '#16a34a' }} />
      </div>
      <span>Wholesale products in your cart: {rupees(state.wholesaleProductsTotal)}. Delivery and COD fee are not counted. Retail items have no minimum.</span>
      {short && showAddMore && <button type="button" className="cart-secondary-btn" onClick={browseWholesale} style={{ justifySelf: 'start' }}>Add more Wholesale items</button>}
    </div>
  );
}
