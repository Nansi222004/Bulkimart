import React from 'react';
import { useUser } from '../context/UserContext';

const ICONS = {
  home: (color, active) => (
    <svg width="23" height="23" viewBox="0 0 24 24" fill={active ? color : 'none'} stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  ),
  categories: (color) => (
    <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
    </svg>
  ),
  orders: (color) => (
    <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 2h12l3 5-9 5-9-5 3-5z" />
      <path d="M3 7v10l9 5 9-5V7" />
      <path d="M12 12v10" />
    </svg>
  ),
  cart: (color) => (
    <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="20" r="1" />
      <circle cx="19" cy="20" r="1" />
      <path d="M2 3h3l2.4 11.5a2 2 0 0 0 2 1.5h8.8a2 2 0 0 0 2-1.6L22 7H6" />
    </svg>
  ),
};

const BottomNav = () => {
  const { activeNav, setActiveNav, getCartCount } = useUser();
  const cartCount = getCartCount?.() || 0;
  const items = [
    { id: 'home', label: 'Home' },
    { id: 'categories', label: 'Categories' },
    { id: 'orders', label: 'Orders' },
    { id: 'cart', label: 'Cart', badge: cartCount },
  ];

  return (
    <nav className="bottom-nav-bar" aria-label="Customer navigation">
      {items.map((item) => {
        const active = activeNav === item.id;
        const color = active ? 'var(--nav-active-color, var(--primary))' : 'var(--nav-inactive-color, var(--text-secondary))';
        return (
          <button key={item.id} type="button" className={`nav-item ${active ? 'active' : ''}`} onClick={() => setActiveNav(item.id)} aria-current={active ? 'page' : undefined}>
            <span className="nav-icon-container">
              {ICONS[item.id](color, active)}
              {item.badge > 0 && <span className="nav-cart-badge">{item.badge > 99 ? '99+' : item.badge}</span>}
            </span>
            <span className="nav-label">{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
};

export default BottomNav;
