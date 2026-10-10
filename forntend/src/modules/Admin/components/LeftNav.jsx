import React, { useState } from 'react';
import { useAdmin } from '../context/AdminContext';

export const LeftNav = () => {
  const { activeTab, setActiveTab } = useAdmin();
  const [categoriesExpanded, setCategoriesExpanded] = useState(true);

  const navItems = [
    {
      id: 'overview',
      label: 'Overview',
      icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/></svg>
    },
    {
      id: 'users',
      label: 'Users',
      icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
    },
    {
      id: 'sellers',
      label: 'Sellers',
      icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>
    },
    {
      id: 'shg-vendors',
      label: 'SHG Vendors',
      icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
    },
    {
      id: 'subscriptions',
      label: 'Subscriptions',
      icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
    },
    {
      id: 'delivery',
      label: 'Delivery Logistics',
      icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>
    },
    {
      id: 'products',
      label: 'Products',
      icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
    },
    {
      id: 'payouts',
      label: 'Payouts',
      icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
    },
    {
      id: 'tickets',
      label: 'Tickets',
      icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
    },
    {
      id: 'donation-settings',
      label: 'Donations',
      icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l8.78-8.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
    }
  ];

  return (
    <div className="admin-left-nav">
      {/* Brand logo */}
      <div className="admin-left-nav-logo">
        <div className="admin-logo-icon-box">ADM</div>
      </div>

      {/* Scrollable nav items */}
      <div className="admin-left-nav-items">
        {navItems.map(item => (
          <button
            key={item.id}
            className={`admin-nav-item ${activeTab === item.id ? 'active' : ''}`}
            onClick={() => setActiveTab(item.id)}
            title={item.label}
          >
            {item.icon}
            <span className="admin-nav-label">{item.label}</span>
          </button>
        ))}

        {/* Collapsible Categories Section */}
        <div className="admin-nav-accordion">
          <button
            className={`admin-nav-accordion-trigger ${activeTab.startsWith('categories-') ? 'active' : ''}`}
            onClick={() => setCategoriesExpanded(!categoriesExpanded)}
            title="Categories"
          >
            <div className="admin-accordion-icon-box">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/>
                <line x1="7" y1="7" x2="7.01" y2="7"/>
              </svg>
            </div>
            <span className="admin-nav-label admin-accordion-label">Categories</span>
            <span className="admin-accordion-chevron">
              {categoriesExpanded ? (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15"/></svg>
              ) : (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
              )}
            </span>
          </button>
          
          {categoriesExpanded && (
            <div className="admin-nav-accordion-content">
              {[
                { id: 'categories-all', label: 'All Categories' },
                { id: 'categories-header', label: 'Header Categories' },
                { id: 'categories-main', label: 'Main Categories' },
                { id: 'categories-sub', label: 'Sub-Categories' }
              ].map(sub => (
                <button
                  key={sub.id}
                  className={`admin-nav-sub-item ${activeTab === sub.id ? 'active' : ''}`}
                  onClick={() => setActiveTab(sub.id)}
                >
                  <span className="admin-nav-sub-bullet">•</span>
                  <span className="admin-nav-sub-label">{sub.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Footer: Exit/Logout */}
      <div className="admin-left-nav-footer">
        <button
          className="admin-nav-item"
          onClick={() => { if (window.confirm('Exit Admin Panel?')) window.location.href = '/'; }}
          title="Exit Admin"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
            <polyline points="16 17 21 12 16 7"/>
            <line x1="21" y1="12" x2="9" y2="12"/>
          </svg>
          <span className="admin-nav-label" style={{ opacity: 0.7 }}>Exit</span>
        </button>
      </div>
    </div>
  );
};

export default LeftNav;
