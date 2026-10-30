import { useFeedback } from '../../../components/feedback/FeedbackProvider';
import React, { useState, useRef, useEffect } from 'react';
import { useAdmin } from '../context/AdminContext';
import { createAdminNotificationOpener } from '../utils/serviceNotifications';
import { adminGet } from '../../../utils/adminApi';
import SellerPushControl from '../../Seller/components/SellerPushControl';
import { initPushNotifications } from '../../../utils/firebaseMessaging';

const registerAdminPush = options => initPushNotifications(options, 'admin');

const pageTitles = {
  overview: 'Dashboard', dashboard: 'Dashboard', reports: 'Reports',
  'user-dashboard': 'Consumer Users', 'vendor-dashboard': 'Sellers / Vendors',
  'delivery-dashboard': 'Delivery Partners', 'storefront-studio': 'Storefront Studio',
  'ecom-orders': 'E-Commerce Orders', 'qcom-orders': 'Quick Commerce Orders', 'wholesale-orders': 'Wholesale Orders',
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

// Resolve search query to best matching admin tab
const resolveSearchTab = (query) => {
  const q = query.toLowerCase().trim();
  if (!q) return null;
  if (/user|customer|buyer/.test(q)) return 'user-dashboard';
  if (/seller|vendor|store/.test(q)) return 'vendor-dashboard';
  if (/order|purchase/.test(q)) return 'user-orders';
  if (/product|item|inventory/.test(q)) return 'products';
  if (/delivery|rider|dispatch/.test(q)) return 'delivery-dashboard';
  if (/ticket|support/.test(q)) return 'tickets';
  if (/report|analytics/.test(q)) return 'reports';
  if (/banner|advertis/.test(q)) return 'banners';
  if (/category|categor/.test(q)) return 'categories-all';
  if (/payout|payment|financ|wallet/.test(q)) return 'finance-center';
  if (/coupon|promo|campaign/.test(q)) return 'campaigns';
  if (/notification|broadcast/.test(q)) return 'notifications';
  if (/return|refund/.test(q)) return 'returns';
  if (/review|rating/.test(q)) return 'user-reviews';
  return null;
};

export const TopHeader = ({ onLogout }) => {
  const ui = useFeedback();
  const {
    triggerToast, activeTab, setActiveTab,
    adminNotifications, adminUnreadCount, adminNotifLoading, adminNotifError,
    fetchAdminNotifications, markAdminNotificationRead, markAllAdminNotificationsRead,
    openTicketDetail,
  } = useAdmin();
  const pageTitle = pageTitles[activeTab] || String(activeTab || 'Dashboard').split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');

  const [showNotifPanel, setShowNotifPanel] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const panelRef = useRef(null);
  const profileRef = useRef(null);
  const notificationOpener = useRef(createAdminNotificationOpener());

  useEffect(() => {
    if (showNotifPanel) fetchAdminNotifications();
  }, [showNotifPanel, fetchAdminNotifications]);

  useEffect(() => {
    const onClickOutside = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) setShowNotifPanel(false);
      if (profileRef.current && !profileRef.current.contains(e.target)) setShowProfileModal(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const handleOpenNotification = n => notificationOpener.current(n, {
    markRead: markAdminNotificationRead, setTab: setActiveTab,
    close: () => setShowNotifPanel(false), openTicket: openTicketDetail, toast: triggerToast,
    resolveServiceType: async id => (await adminGet(`/services/applications/${encodeURIComponent(id)}`)).data?.applicantType,
    openService: id => {
      window.history.pushState(null, '', `/admin/services?application=${encodeURIComponent(id)}`);
      window.dispatchEvent(new Event('service-application-open'));
    },
  });

  // Bug #186 fix: universal search actually navigates
  const handleSearch = (e) => {
    if (e.key === 'Enter' && searchQuery.trim()) {
      const targetTab = resolveSearchTab(searchQuery);
      if (targetTab) {
        setActiveTab(targetTab);
        triggerToast(`Navigating to ${pageTitles[targetTab] || targetTab} for "${searchQuery}"`);
      } else {
        triggerToast(`No matching section found for "${searchQuery}". Try: users, orders, sellers, delivery, reports…`);
      }
      setSearchQuery('');
    }
  };

  let adminInfo = null;
  try { adminInfo = JSON.parse(localStorage.getItem('adminUser') || '{}'); } catch { adminInfo = null; }
  const displayName = adminInfo?.name || 'Super Admin';
  const displayEmail = adminInfo?.email || 'admin@bulkimart.in';
  const displayRole = adminInfo?.role || 'superAdmin';
  const initials = displayName.split(' ').map(n => n[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || 'SA';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
      {/* Sticky top raw header row */}
      <div className="sa-header">
        
        {/* Left segment titles */}
        <div className="sa-header-left">
          <h2 className="sa-header-title">{pageTitle}</h2>
          <span className="sa-header-subtitle">{activeTab === 'overview' ? 'Overview of Bulkimart platform performance' : `Manage ${pageTitle.toLowerCase()} in Bulkimart`}</span>
        </div>

        {/* Center global search bar — Bug #185: removed Ctrl+K badge; Bug #186: navigates on Enter */}
        <div className="sa-search-wrapper">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--sa-text-muted)" strokeWidth="2.5">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            type="text"
            className="sa-search-input"
            placeholder="Search users, orders, products, sellers…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={handleSearch}
          />
        </div>

        {/* Right utility buttons */}
        <div className="sa-header-right">
          
          {/* Bug #187 fix: notification panel with "Mark All Read" button */}
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
                <div style={{ padding: '10px 14px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontWeight: 800, fontSize: 15 }}>
                    Notifications {adminUnreadCount > 0 && <span style={{ color: '#dc2626' }}>({adminUnreadCount})</span>}
                  </span>
                  {adminUnreadCount > 0 && (
                    <button
                      type="button"
                      onClick={() => markAllAdminNotificationsRead()}
                      style={{ fontSize: 11, fontWeight: 700, color: '#2563eb', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px', borderRadius: 6, whiteSpace: 'nowrap' }}
                    >
                      Mark all read
                    </button>
                  )}
                </div>
                <div style={{ overflowY: 'auto', flex: 1 }}>
                  <div style={{ padding: 14 }}><SellerPushControl register={registerAdminPush} label="Admin notification settings" buttonLabel="Enable push notifications" /></div>
                  {adminNotifError && <div role="alert" style={{ padding: 14, color: '#991b1b' }}>{adminNotifError} <button type="button" onClick={() => fetchAdminNotifications()}>Retry notifications</button></div>}
                  {adminNotifLoading ? (
                    <div style={{ padding: 20, textAlign: 'center', fontSize: 14, color: '#94a3b8' }}>Loading…</div>
                  ) : adminNotifications.length === 0 ? adminNotifError ? null : (
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

          {/* Bug #188 fix: clicking avatar opens profile modal, not immediate logout */}
          <div ref={profileRef} style={{ position: 'relative' }}>
            <div
              className="sa-user-badge" role="button" tabIndex={0} aria-label="View admin profile"
              onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setShowProfileModal(v => !v); } }}
              onClick={() => setShowProfileModal(v => !v)}
              style={{ cursor: 'pointer' }}
              title="Click to view profile"
            >
              <div className="sa-avatar">{initials}</div>
              <div className="sa-user-info">
                <span className="sa-user-name">{displayName}</span>
                <span className="sa-user-role">View Profile</span>
              </div>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--sa-text-muted)" strokeWidth="2.5">
                <polyline points="6 9 12 15 18 9"/>
              </svg>
            </div>

            {showProfileModal && (
              <div style={{
                position: 'absolute', top: '120%', right: 0, width: 'min(280px, calc(100vw - 32px))',
                background: '#fff', borderRadius: 14, border: '1px solid #e2e8f0',
                boxShadow: '0 12px 32px rgba(15,23,42,0.15)', zIndex: 200, overflow: 'hidden',
              }}>
                {/* Profile header */}
                <div style={{ padding: '18px 16px 14px', background: 'linear-gradient(135deg, #0ea5e9 0%, #6366f1 100%)', textAlign: 'center' }}>
                  <div style={{ width: 52, height: 52, borderRadius: '50%', background: 'rgba(255,255,255,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, fontWeight: 900, color: '#fff', margin: '0 auto 10px' }}>{initials}</div>
                  <div style={{ fontWeight: 800, fontSize: 15, color: '#fff' }}>{displayName}</div>
                  <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.8)', marginTop: 2 }}>{displayEmail}</div>
                </div>
                {/* Profile details */}
                <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {[['Role', displayRole.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase())], ['Platform', 'Bulkimart Admin'], ['Session', 'Active']].map(([label, value]) => (
                    <div key={label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                      <span style={{ color: '#64748b', fontWeight: 600 }}>{label}</span>
                      <span style={{ fontWeight: 800, color: '#0f172a' }}>{value}</span>
                    </div>
                  ))}
                </div>
                {/* Logout button */}
                <div style={{ padding: '0 12px 12px' }}>
                  <button
                    type="button"
                    onClick={async () => {
                      setShowProfileModal(false);
                      return ui.perform('Are you sure you want to log out?', async () => {
                        return await onLogout();
                      });
                    }}
                    style={{ width: '100%', padding: '8px 0', borderRadius: 8, background: '#fef2f2', border: '1px solid #fecaca', color: '#dc2626', fontWeight: 800, fontSize: 13, cursor: 'pointer' }}
                  >
                    🚪 Log Out
                  </button>
                </div>
              </div>
            )}
          </div>

        </div>
      </div>

      {/* 5 CORE SECTIONS TOP TAB NAVIGATION BAR — hidden on Reports, whose own
          report tabs carry the same four names and would read as a second filter row. */}
      {activeTab !== 'reports' && <div className="sa-section-tabs" style={{
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
            isActive = activeTab === 'overview' || activeTab === 'dashboard';
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
      </div>}

    </div>
  );
};

export default TopHeader;
