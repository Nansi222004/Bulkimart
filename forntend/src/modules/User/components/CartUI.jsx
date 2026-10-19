import React from 'react';
import './CartUI.css';

export const openWholesaleCart = () => {
  if (window.location.pathname === '/cart' && window.location.search === '?channel=wholesale') return;
  window.history.pushState(null, '', '/cart?channel=wholesale');
  window.dispatchEvent(new Event('popstate'));
};

export const browseWholesale = () => {
  window.history.pushState(null, '', '/wholesale');
  window.dispatchEvent(new Event('popstate'));
};

export const CartIcon = ({ size = 23, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="9" cy="20" r="1" /><circle cx="19" cy="20" r="1" />
    <path d="M2 3h3l2.4 11.5a2 2 0 0 0 2 1.5h8.8a2 2 0 0 0 2-1.6L22 7H6" />
  </svg>
);

export const CartEmptyState = ({ wholesale = false, onBrowse }) => (
  <div className="cart-empty-state">
    <CartIcon size={54} />
    <h3>{wholesale ? 'Your Wholesale cart is empty.' : 'Your Cart is Empty'}</h3>
    <p>{wholesale ? 'Explore bulk offers and quantity-based prices from approved sellers.' : 'Explore local products, fresh groceries, organic items, and traditional handicrafts.'}</p>
    <button className="pd-add-to-cart-btn" onClick={onBrowse}>{wholesale ? 'Browse Wholesale' : 'Continue shopping'}</button>
  </div>
);

export const CartSection = ({ title, children }) => (
  <section className="profile-menu-card cart-section"><h2>{title}</h2>{children}</section>
);

export const CartTotalRow = ({ label, value, strong }) => (
  <div className={`cart-total-row${strong ? ' cart-total-row--grand' : ''}`} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: strong ? 12.5 : 11.5,
    fontWeight: strong ? 800 : 600, color: strong ? 'var(--text-primary)' : 'var(--text-muted)', marginTop: 3 }}>
    <span>{label}</span><span>{value}</span>
  </div>
);
