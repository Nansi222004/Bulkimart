import { useFeedback } from '../../../components/feedback/FeedbackProvider';
import React, { useState, useRef, useEffect } from 'react';
import { useAdmin } from '../context/AdminContext';
import { createAdminNotificationOpener } from '../utils/serviceNotifications';

const pageTitles = {
  overview: 'Dashboard', dashboard: 'Dashboard', reports: 'Reports',
  'user-dashboard': 'Consumer Users', 'vendor-dashboard': 'Sellers / Vendors',
  'delivery-dashboard': 'Delivery Partners', 'storefront-studio': 'Storefront Studio',
  'ecom-orders': 'E-Commerce Orders', 'qcom-orders': 'Quick Commerce Orders',
  'user-wallets': 'Real Money Wallets', 'seller-kyc': 'Seller KYC',
  'gst-assistance': 'GST Registration Assistance', 'finance-center': 'Finance Center',
  'categories-all': 'All Categories', 'categories-header': 'Header Categories',
  'categories-main': 'Main Categories', 'categories-sub': 'Sub-Categories',
};

const timeAgo = (iso) => {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
};

export const TopHeader = ({ onLogout }) => {
  const ui = useFeedback();
  const {
    triggerToast, activeTab, setActiveTab,
    adminNotifications, adminUnreadCount, adminNotifLoading,
    fetchAdminNotifications, markAdminNotificationRead,
    openTicketDetail,
  } = useAdmin();
  const pageTitle = pageTitles[activeTab] || String(activeTab || 'Dashboard').split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');

  const [showNotifPanel, setShowNotifPanel] = useState(false);
  const panelRef = useRef(null);
  const notificationOpener = useRef(createAdminNotificationOpener());

  useEffect(() => {
    if (showNotifPanel) fetchAdminNotifications();
  }, [showNotifPanel, fetchAdminNotifications]);

  useEffect(() => {
    const onClickOutside = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) setShowNotifPanel(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const handleOpenNotification = n => notificationOpener.current(n, {
    markRead: markAdminNotificationRead, setTab: setActiveTab,
    close: () => setShowNotifPanel(false), openTicket: openTicketDetail, toast: triggerToast,
    openService: id => {
      window.history.pushState(null, '', `/admin/services?application=${encodeURIComponent(id)}`);
      window.dispatchEvent(new Event('service-application-open'));
    },
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
      {/* Sticky top raw header row */}
      <div className="sa-header">
        
        {/* Left segment titles */}
        <div className="sa-header-left">
          <h2 className="sa-header-title">{pageTitle}</h2>
          <span className="sa-header-subtitle">{activeTab === 'overview' ? 'Overview of Bulkimart platform performance' : `Manage ${pageTitle.toLowerCase()} in Bulkimart`}</span>
        </div>

        {/* Center global search bar */}
        <div className="sa-search-wrapper">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--sa-text-muted)" strokeWidth="2.5">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            type="text"
            className="sa-search-input"
            placeholder="Search users, orders, products, sellers..."
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                triggerToast(`Searching for "${e.target.value}"...`);
              }
            }}
          />
          <span className="sa-search-badge">Ctrl + K</span>
        </div>

        {/* Right utility buttons */}
        <div className="sa-header-right">
          
          <div ref={panelRef} style={{ position: 'relative' }}>
            <button className="sa-header-action-btn" aria-label="Notifications" onClick={() => setShowNotifPanel((v) => !v)}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
              </svg>
              {adminUnreadCount > 0 && <span className="sa-btn-badge" />}
            </button>

            {showNotifPanel && (
              <div style={{
                position: 'absolute', top: '120%', right: 0, width: 'min(340px, calc(100vw - 32px))', maxHeight: 420,
                background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0',
                boxShadow: '0 12px 32px rgba(15,23,42,0.15)', zIndex: 200, display: 'flex', flexDirection: 'column',
              }}>
                <div style={{ padding: '12px 14px', borderBottom: '1px solid #f1f5f9', fontWeight: 800, fontSize: 15 }}>
                  Notifications {adminUnreadCount > 0 && <span style={{ color: '#dc2626' }}>({adminUnreadCount})</span>}
                </div>
                <div style={{ overflowY: 'auto', flex: 1 }}>
                  {adminNotifLoading ? (
                    <div style={{ padding: 20, textAlign: 'center', fontSize: 14, color: '#94a3b8' }}>Loading…</div>
                  ) : adminNotifications.length === 0 ? (
                    <div style={{ padding: 20, textAlign: 'center', fontSize: 14, color: '#94a3b8' }}>No notifications yet</div>
                  ) : adminNotifications.map((n) => (
                    <div
                      key={n._id}
                      onClick={() => handleOpenNotification(n)}
                      style={{
                        padding: '10px 14px', borderBottom: '1px solid #f8fafc', cursor: 'pointer',
                        background: n.isRead ? '#fff' : '#ecfdf5',
                      }}
                    >
                      <div style={{ fontSize: 14, fontWeight: 800, color: '#0f172a' }}>{n.title}</div>
                      <div style={{ fontSize: 13, color: '#64748b', marginTop: 2 }}>{n.message}</div>
                      <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 3 }}>{timeAgo(n.createdAt)}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="sa-header-divider" />

          {/* Admin Avatar section */}
          {(() => {
            let adminInfo = null;
            try { adminInfo = JSON.parse(localStorage.getItem('adminUser') || '{}'); } catch { adminInfo = null; }
            const displayName = adminInfo?.name || 'Super Admin';
            const initials = displayName.split(' ').map(n => n[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || 'SA';
            return (
              <div 
                className="sa-user-badge" role="button" tabIndex={0} aria-label="Log out of admin"
                onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.currentTarget.click(); } }}
                onClick={async () => {
                  return ui.perform("Are you sure you want to log out?", async () => {
                    return await onLogout();
                  });
                }}
                style={{ cursor: 'pointer' }}
                title="Click to Log Out"
              >
                <div className="sa-avatar">{initials}</div>
                <div className="sa-user-info">
                  <span className="sa-user-name">{displayName}</span>
                  <span className="sa-user-role">Logout</span>
                </div>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--sa-text-muted)" strokeWidth="2.5">
                  <polyline points="6 9 12 15 18 9"/>
                </svg>
              </div>
            );
          })()}

        </div>
      </div>

      {/* 5 CORE SECTIONS TOP TAB NAVIGATION BAR */}
      <div className="sa-section-tabs" style={{
        display: 'flex',
        gap: 8,
        padding: '10px 24px',
        backgroundColor: '#ffffff',
        borderBottom: '1px solid #e2e8f0',
        overflowX: 'auto',
        alignItems: 'center'
      }}>
        {[
          { id: 'overview', label: '📊 Platform Overview' },
          { id: 'users', label: '👤 Consumer Users' },
          { id: 'sellers', label: '🏬 General Vendors' },
          { id: 'delivery-partners', label: '🛵 Delivery Fleet' }
        ].map(tab => {
          let isActive = activeTab === tab.id;
          if (tab.id === 'overview') {
            isActive = activeTab === 'overview' || activeTab === 'dashboard' || activeTab === 'reports';
          } else if (tab.id === 'users') {
            isActive = activeTab === 'user-dashboard' || activeTab.startsWith('users-') || activeTab === 'user-activity' || activeTab === 'user-orders' || activeTab === 'user-subscriptions' || activeTab === 'user-reviews';
          } else if (tab.id === 'sellers') {
            isActive = activeTab === 'vendor-dashboard' || activeTab.startsWith('vendors-') || activeTab.startsWith('stores-') || activeTab.startsWith('vendor-');
          } else if (tab.id === 'delivery-partners') {
            isActive = activeTab === 'delivery-dashboard' || activeTab.startsWith('delivery-') || activeTab.startsWith('rider-');
          }
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                padding: '10px 16px',
                minHeight: 44,
                borderRadius: 20,
                border: isActive ? '1.5px solid #10b981' : '1px solid #cbd5e1',
                background: isActive ? '#ebfdf2' : '#ffffff',
                color: isActive ? '#047857' : '#475569',
                fontWeight: isActive ? 800 : 600,
                fontSize: 14,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                boxShadow: isActive ? '0 2px 4px rgba(16, 185, 129, 0.12)' : 'none',
                transition: 'all 0.15s ease'
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

    </div>
  );
};

export default TopHeader;
