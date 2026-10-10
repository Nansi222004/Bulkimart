import React from 'react';
import { useSHG } from '../context/SHGContext';
import BrandLogo from '../../../components/BrandLogo';

const navItems = [
  {
    id: 'dashboard', label: 'Dashboard',
    icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/></svg>
  },
  {
    id: 'products', label: 'Products',
    icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
  },
  {
    id: 'orders', label: 'Orders',
    icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>
  },
  {
    id: 'subscriptions', label: 'Subscriptions',
    icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
  },
  {
    id: 'members', label: 'Members',
    icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
  },
  {
    id: 'earnings', label: 'Earnings',
    icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>
  },
  {
    id: 'payouts', label: 'Payouts',
    icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
  },
  {
    id: 'support', label: 'Support',
    icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
  },
  {
    id: 'account', label: 'Account',
    icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
  }
];

const SHGLeftNav = ({ isCollapsed, onToggleCollapse }) => {
  const { activeTab, setActiveTab } = useSHG();

  return (
    <nav className={`shg-left-nav ${isCollapsed ? 'collapsed' : ''}`} aria-label="SHG Panel Navigation">
      {/* Brand Logo */}
      <div className="shg-left-nav-logo" title="SHG Store Panel">
        <BrandLogo variant="mark" alt="Bulkimart SHG portal" />
      </div>

      {/* Nav Items */}
      <div className="shg-left-nav-items">
        {navItems.map(item => (
          <button
            key={item.id}
            className={`shg-nav-item ${activeTab === item.id ? 'active' : ''}`}
            onClick={() => setActiveTab(item.id)}
            title={item.label}
            aria-label={item.label}
          >
            {item.icon}
            <span className="shg-nav-label">{item.label}</span>
          </button>
        ))}
      </div>

      {/* Footer: Hamburger Collapse / Expand Sidebar Toggle */}
      <div className="shg-left-nav-footer">
        <button
          className="shg-nav-item shg-collapse-btn"
          onClick={onToggleCollapse}
          title={isCollapsed ? "Expand Navigation Bar" : "Collapse Navigation Bar"}
          aria-label={isCollapsed ? "Expand Navigation Bar" : "Collapse Navigation Bar"}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
          <span className="shg-nav-label" style={{ opacity: 0.8 }}>
            {isCollapsed ? 'Expand' : 'Collapse'}
          </span>
        </button>
      </div>
    </nav>
  );
};

export default SHGLeftNav;
