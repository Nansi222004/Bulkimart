import React, { useState } from 'react';
import RealtimeNotice from '../../../components/RealtimeNotice';
import ServicesPanel from '../../../components/services/ServicesPanel';
import { useSeller } from '../context/SellerContext';
import { useNotifications } from '../../../utils/useNotifications';
import LeftNav from '../components/LeftNav';
import NotificationDrawer from '../components/NotificationDrawer';
import DashboardTab from '../components/DashboardTab';
import ProductsTab from '../components/ProductsTab';
import StockTab from '../components/StockTab';
import OrdersTab from '../components/OrdersTab';
import TrackOrderTab from '../components/TrackOrderTab';
import SalesReportTab from '../components/SalesReportTab';
import MoneyRequestTab from '../components/MoneyRequestTab';
import PaymentHistoryTab from '../components/PaymentHistoryTab';
import EarningsTab from '../components/EarningsTab';
import SupportTab from '../components/SupportTab';
import FaqsTab from '../components/FaqsTab';
import SellerCampaignsTab from '../components/SellerCampaignsTab';
import SellerPromotionsTab from '../components/SellerPromotionsTab';
import SellerReturnsTab from '../components/SellerReturnsTab';
import ProfileTab from '../components/ProfileTab';
import GrowTab from '../components/GrowTab';
import AccountTab from '../components/AccountTab';
import SellerOrderAlerts from '../components/SellerOrderAlerts';
import SellerPushControl from '../components/SellerPushControl';
import NotificationPopup from '../../../components/NotificationPopup';

/** Maps an Admin/business-event deep link (always `/seller/...` per
 * broadcast.service.js's own allowlist) onto this dashboard's own tab ids. */
const resolvePopupNav = (route) => {
  if (!route) return null;
  if (route.startsWith('/seller/services')) return 'services';
  if (route.startsWith('/seller/returns')) return 'item-returns';
  if (route.startsWith('/seller/orders')) return 'orders';
  if (route.startsWith('/seller')) return 'dashboard';
  return null;
};

const TAB_TITLES = {
  services: 'Services',
  dashboard: 'Dashboard',
  products: 'Products',
  stock: 'Stocks',
  orders: 'Orders',
  returns: 'Return Requests',
  track: 'Track Order',
  salesreport: 'Sales Report',
  moneyrequest: 'Money Request',
  paymenthistory: 'Payment History',
  earnings: 'Earnings',
  campaigns: 'Campaigns / Deals',
  promotions: 'Promotions',
  faqs: 'Product FAQs',
  support: 'Support & Help',
  profile: 'Profile',
  grow: 'Grow',
  account: 'Account',
};

export const DashboardPage = () => {
  const {
    activeTab, setActiveTab, logoutSeller, selectedTypes, activeMode, setActiveMode,
    openSellerOrder,
    sellerProfile, userProfile, bizForm, requestWholesaleChannel,
  } = useSeller();
  const [showNotifications, setShowNotifications] = useState(false);
  const { unreadCount } = useNotifications({ autoFetch: false });

  const isHybrid = (selectedTypes.includes('ecommerce') && selectedTypes.includes('quick')) ||
    (Array.isArray(sellerProfile?.salesChannels) && sellerProfile.salesChannels.includes('ecommerce') && sellerProfile.salesChannels.includes('grocery'));

  const displayName = sellerProfile?.storeDetails?.name || sellerProfile?.businessName || sellerProfile?.userId?.name || userProfile?.name || sellerProfile?.userId?.phone || userProfile?.phone || bizForm?.storeName || 'Seller';
  const displayInitial = (displayName || 'S').trim().charAt(0).toUpperCase();

  const renderActiveTab = () => {
    switch (activeTab) {
      case 'services': return <ServicesPanel />;
      case 'dashboard':     return <DashboardTab />;
      case 'products':      return <ProductsTab />;
      case 'stock':         return <StockTab />;
      case 'orders':        return <OrdersTab />;
      case 'track':         return <TrackOrderTab />;
      case 'salesreport':   return <SalesReportTab />;
      case 'moneyrequest':  return <MoneyRequestTab />;
      case 'paymenthistory':return <PaymentHistoryTab />;
      case 'earnings':      return <EarningsTab />;
      case 'campaigns':     return <SellerCampaignsTab />;
      case 'promotions':    return <SellerPromotionsTab />;
      case 'item-returns':  return <SellerReturnsTab />;
      case 'faqs':          return <FaqsTab />;
      case 'support':       return <SupportTab />;
      case 'profile':       return <ProfileTab />;
      case 'grow':          return <GrowTab />;
      case 'account':       return <AccountTab />;
      default:              return <DashboardTab />;
    }
  };

  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => window.innerWidth < 768);

  return (
    <div className={`seller-dashboard-layout ${isSidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      {!isSidebarCollapsed && (
        <div
          className="seller-sidebar-backdrop"
          onClick={() => setIsSidebarCollapsed(true)}
        />
      )}

      <LeftNav isCollapsed={isSidebarCollapsed} onToggleCollapse={() => setIsSidebarCollapsed(!isSidebarCollapsed)} />

      <div className="seller-main-content">
        <RealtimeNotice />
        {/* Header — layout lives in Seller.css (.seller-header-row etc.) */}
        <div className="seller-header-row">
          <div className="seller-header-left">
            <button
              type="button"
              className="seller-hamburger-btn"
              onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
              title={isSidebarCollapsed ? "Expand Navigation Sidebar" : "Collapse Navigation Sidebar"}
              aria-label="Toggle Navigation Sidebar"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            </button>
            {activeTab !== 'stock' && activeTab !== 'products' && (
              <h2 className="seller-header-title" style={{ color: activeMode === 'quick' ? '#078ccb' : '#073b78', transition: 'color 0.2s' }}>
                {TAB_TITLES[activeTab] || activeTab}
              </h2>
            )}
          </div>

          <div className="seller-header-actions">
            <button
              className="seller-header-btn"
              onClick={() => setShowNotifications(true)}
              aria-label="Notifications"
              style={{ color: '#64748b', position: 'relative' }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
              </svg>
              {unreadCount > 0 && (
                <span className="notification-badge" style={{
                  position: 'absolute', top: 3, right: 3, background: '#ef4444',
                  width: 10, height: 10, borderRadius: '50%', border: '1.5px solid #fff',
                  zIndex: 2
                }} />
              )}
            </button>

            {/* Profile chip — avatar only below 768px, name+role at 768px+ */}
            <div className="seller-profile-chip">
              <div className="seller-profile-avatar" style={{ backgroundColor: activeMode === 'quick' ? '#10b981' : '#3b82f6' }}>
                {displayInitial}
              </div>
              <div className="seller-profile-text">
                <span className="seller-profile-name">{displayName}</span>
                <span className="seller-profile-role" style={{ color: activeMode === 'quick' ? '#10b981' : '#3b82f6' }}>
                  {activeMode === 'quick' ? 'Quick Seller' : 'E-Comm Seller'}
                </span>
              </div>
            </div>

            {/* Sign Out — icon-only below 768px, label at 768px+ */}
            <button
              className="seller-signout-btn"
              onClick={() => { if (window.confirm('Logout from seller panel?')) logoutSeller(); }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                <polyline points="16 17 21 12 16 7"/>
                <line x1="21" y1="12" x2="9" y2="12"/>
              </svg>
              <span className="signout-label">Sign Out</span>
            </button>
          </div>
        </div>

        <SellerPushControl />

        {/* Tab content */}
        <div className="seller-tab-content-container">
          {sellerProfile?.status === 'approved' && (
            <section aria-label="Wholesale channel access" style={{
              margin: '0 0 16px', padding: '14px 16px', border: '1px solid #bae6fd',
              borderRadius: 12, background: '#f0fbff', display: 'flex',
              alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap',
            }}>
              <div>
                <strong style={{ display: 'block', color: '#073b78', fontSize: 14 }}>Wholesale (B2B)</strong>
                <span style={{ color: '#64748b', fontSize: 12 }}>
                  {sellerProfile.wholesaleChannel?.status === 'approved'
                    ? 'Approved seller channel'
                    : sellerProfile.wholesaleChannel?.status === 'pending'
                      ? 'Your request is awaiting admin review'
                      : sellerProfile.wholesaleChannel?.status === 'rejected'
                        ? 'Your previous request was not approved'
                      : sellerProfile.wholesaleChannel?.status === 'suspended'
                        ? 'Wholesale access is suspended. Contact an administrator to restore access.'
                        : 'Request access to prepare quantity-based pricing'}
                </span>
              </div>
              {sellerProfile.wholesaleChannel?.status !== 'approved' && sellerProfile.wholesaleChannel?.status !== 'pending' && sellerProfile.wholesaleChannel?.status !== 'suspended' && (
                <button
                  type="button"
                  onClick={requestWholesaleChannel}
                  style={{ border: 0, borderRadius: 8, background: '#08b9e8', color: '#fff', padding: '9px 14px', fontWeight: 700, cursor: 'pointer' }}
                >
                  Request Wholesale Access
                </button>
              )}
            </section>
          )}
          {renderActiveTab()}
        </div>
      </div>

      <NotificationDrawer isOpen={showNotifications} onClose={() => setShowNotifications(false)} />
      <SellerOrderAlerts />

      {/* WhatsApp-style floating notification — reacts to the existing
          socket `notification_new` event; no new backend call besides the
          existing mark-read PATCH. Deliberately separate from
          SellerOrderRingModal/SubscriptionRequestRingModal above, which
          keep their own higher-priority urgent ping behavior untouched. */}
      <NotificationPopup excludeSellerOrders onNavigate={(route, notification) => {
        if (notification?.metadata?.orderId) return openSellerOrder(notification.metadata.orderId);
        const tab = resolvePopupNav(route); if (tab) setActiveTab(tab);
      }} />
    </div>
  );
};

export default DashboardPage;
