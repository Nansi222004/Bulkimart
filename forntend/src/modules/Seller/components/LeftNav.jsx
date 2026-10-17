import React from 'react';
import { useSeller } from '../context/SellerContext';
import BrandLogo from '../../../components/BrandLogo';

const NavIcon = ({ children }) => children;

export const LeftNav = ({ isCollapsed, onToggleCollapse }) => {
  const { activeTab, setActiveTab, setTrackingOrder, setShowReturnPanel, logoutSeller } = useSeller();

  const navItems = [
    {
      id: 'dashboard',
      label: 'Dashboard',
      icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/></svg>
    },
    {
      id: 'products',
      label: 'Products',
      icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
    },
    {
      id: 'stock',
      label: 'Stocks',
      icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>
    },
    {
      id: 'orders',
      label: 'Orders',
      icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>
    },
    {
      id: 'track',
      label: 'Track Order',
      icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8"/></svg>
    },
    {
      id: 'salesreport',
      label: 'Sales Report',
      icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
    },
    {
      id: 'moneyrequest',
      label: 'Money Request',
      icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
    },
    {
      id: 'paymenthistory',
      label: 'Payments',
      icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>
    },
    {
      id: 'earnings',
      label: 'Earnings',
      icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>
    },
    {
      id: 'services', label: 'Services', icon: <span aria-hidden="true">▤</span>
    },
    {
      id: 'item-returns',
      label: 'Returns',
      icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.51"/></svg>
    },
    {
      id: 'faqs',
      label: 'Product FAQs',
      icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
    },
    {
      id: 'support',
      label: 'Support',
      icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
    },
    {
      id: 'profile',
      label: 'Profile',
      icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
    },
  ];

  return (
    <nav id="seller-navigation" className="seller-left-nav" aria-label="Seller navigation" inert={isCollapsed ? true : undefined}>
      {/* Brand logo header */}
      <div className="seller-left-nav-logo">
        <div className="logo-brand-group">
          <BrandLogo className="logo-icon-box" variant="mark" />
          {!isCollapsed && <span className="seller-logo-text">Bulkimart Seller</span>}
        </div>
        <button
          type="button"
          className="seller-drawer-close-btn"
          onClick={onToggleCollapse}
          title="Close Sidebar"
          aria-label="Close Sidebar"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* Scrollable nav items */}
      <div className="seller-left-nav-items">
        {navItems.map(item => (
          <button
            key={item.id}
            aria-current={activeTab === item.id ? 'page' : undefined}
            className={`seller-nav-item ${activeTab === item.id ? 'active' : ''}`}
            onClick={() => {
              setActiveTab(item.id);
              setTrackingOrder(null);
              setShowReturnPanel(false);
              if (window.innerWidth < 768 && onToggleCollapse && !isCollapsed) {
                onToggleCollapse();
              }
            }}
            title={item.label}
          >
            {item.icon}
            {!isCollapsed && <span className="seller-nav-label">{item.label}</span>}
          </button>
        ))}
      </div>
    </nav>
  );
};

export default LeftNav;
