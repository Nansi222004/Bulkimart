import React from 'react';
import { useUser } from '../context/UserContext';
import useTypingFocus from '../../../hooks/useTypingFocus';

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
  account: (color) => (
    <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  ),
};

const BottomNav = () => {
  const { activeNav, setActiveNav } = useUser();
  const typing = useTypingFocus();
  const items = [
    { id: 'home', label: 'Home' },
    { id: 'categories', label: 'Categories' },
    { id: 'orders', label: 'Orders' },
    { id: 'account', label: 'Profile' },
  ];

  if (typing) return null;

  return (
    <nav className="bottom-nav-bar" aria-label="Customer navigation">
      {items.map((item) => {
        const active = activeNav === item.id;
        const color = active ? 'var(--nav-active-color, var(--primary))' : 'var(--nav-inactive-color, var(--text-secondary))';
        return (
          <button key={item.id} type="button" className={`nav-item ${active ? 'active' : ''}`} onClick={() => setActiveNav(item.id)} aria-current={active ? 'page' : undefined}>
            <span className="nav-icon-container">
              {ICONS[item.id](color, active)}
            </span>
            <span className="nav-label">{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
};

export default BottomNav;
