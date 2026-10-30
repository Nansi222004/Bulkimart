import { useFeedback } from '../../../components/feedback/FeedbackProvider';
import React, { useEffect, useRef, useState } from 'react';
import AdvertisingWorkspace from '../../../components/advertising/AdvertisingWorkspace';
import RealtimeNotice from '../../../components/RealtimeNotice';
import ServicesPanel from '../../../components/services/ServicesPanel';
import PageErrorBoundary from '../../../components/PageErrorBoundary';
import GstAssistance from '../../../components/gst/GstAssistance';
import GstStatusChip from '../../../components/gst/GstStatusChip';
import { useSeller } from '../context/SellerContext';
import { useNotifications } from '../../../utils/useNotifications';
import LeftNav from '../components/LeftNav';
import NotificationDrawer from '../components/NotificationDrawer';
import DashboardTab from '../components/DashboardTab';
import ProductsTab from '../components/ProductsTab';
import StockTab from '../components/StockTab';
import OrdersTab from '../components/OrdersTab';
import OrderDetailsPage from './OrderDetailsPage';
import TrackOrderTab from '../components/TrackOrderTab';
import SalesReportTab from '../components/SalesReportTab';
import MoneyRequestTab from '../components/MoneyRequestTab';
import PaymentHistoryTab from '../components/PaymentHistoryTab';
import EarningsTab from '../components/EarningsTab';
import SupportTab from '../components/SupportTab';
import FaqsTab from '../components/FaqsTab';
import SellerReturnsTab from '../components/SellerReturnsTab';
import ProfileTab from '../components/ProfileTab';
import AccountTab from '../components/AccountTab';
import SellerOrderAlerts from '../components/SellerOrderAlerts';
import SellerReturnAlerts from '../components/SellerReturnAlerts';
import SellerPushControl from '../components/SellerPushControl';
import PullToRefresh from '../../../components/pullToRefresh/PullToRefresh';
import { useRefreshHandler } from '../../../utils/refreshRegistry';
import NotificationPopup from '../../../components/NotificationPopup';
import { openAdvertisingNotification } from '../../../components/advertising/advertisingNotifications';
import { isSellerReturnNotification, openSellerReturn } from '../utils/returnNotification';

/** Maps an Admin/business-event deep link (always `/seller/...` per
 * broadcast.service.js's own allowlist) onto this dashboard's own tab ids. */
const resolvePopupNav = (route) => {
  if (!route) return null;
  if (route.startsWith('/seller/services')) return 'services';
  if (isSellerReturnNotification({ route })) return 'item-returns';
  if (route.startsWith('/seller/orders')) return 'orders';
  if (route.startsWith('/seller')) return 'dashboard';
  return null;
};

const TAB_TITLES = {
  advertising: 'Advertising',
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
  faqs: 'Product FAQs',
  support: 'Support & Help',
  profile: 'Profile',
  account: 'Account',
};

export const DashboardPage = () => {
  const ui = useFeedback();
  const {
    activeTab, setActiveTab, logoutSeller, selectedTypes, activeMode, setActiveMode,
    openSellerOrder, orderDetailId,
    sellerProfile, userProfile, bizForm,
    fetchSellerKpis, fetchMyProducts, fetchSellerOrders, fetchSellerFinances,
  } = useSeller();
  const tabScroll = useRef(null);
  // Pull down to refresh: reloads whatever the current tab shows. A tab with its own refresh overrides this.
  useRefreshHandler(async () => {
    switch (activeTab) {
      case 'dashboard': await fetchSellerKpis?.(); break;
      case 'products': case 'stock': await fetchMyProducts?.(); break;
      case 'orders': if (orderDetailId) await openSellerOrder?.(orderDetailId); else await fetchSellerOrders?.('all'); break;
      case 'track': case 'salesreport': await fetchSellerOrders?.('all'); break;
      case 'earnings': case 'moneyrequest': case 'paymenthistory': await fetchSellerFinances?.(); break;
      default: // Tabs that already refresh when the window regains focus (returns and similar).
        window.dispatchEvent(new Event('focus')); await new Promise(resolve => setTimeout(resolve, 600));
    }
  });
  const [showNotifications, setShowNotifications] = useState(false);
  const [returnDetailId, setReturnDetailId] = useState(null);
  const detailOpen = (activeTab === 'orders' && orderDetailId) || (activeTab === 'item-returns' && returnDetailId);
  const { unreadCount } = useNotifications({ autoFetch: false });

  const isHybrid = (selectedTypes.includes('ecommerce') && selectedTypes.includes('quick')) ||
    (Array.isArray(sellerProfile?.salesChannels) && sellerProfile.salesChannels.includes('ecommerce') && sellerProfile.salesChannels.includes('grocery'));

  const roleLabel = isHybrid
    ? 'Hybrid Seller'
    : (activeMode === 'quick' || (sellerProfile?.salesChannels?.includes('grocery') && !sellerProfile?.salesChannels?.includes('ecommerce')))
      ? 'Quick Seller'
      : 'E-Comm Seller';

  const roleColor = isHybrid
    ? '#8b5cf6'
    : activeMode === 'quick'
      ? '#10b981'
      : '#3b82f6';

  const displayName = sellerProfile?.storeDetails?.name || sellerProfile?.businessName || sellerProfile?.userId?.name || userProfile?.name || sellerProfile?.userId?.phone || userProfile?.phone || bizForm?.storeName || 'Seller';
  const displayInitial = (displayName || 'S').trim().charAt(0).toUpperCase();

  const renderActiveTab = () => {
    switch (activeTab) {
      case 'advertising': return <AdvertisingWorkspace />;
      case 'services': return <PageErrorBoundary name="seller-services"><ServicesPanel /></PageErrorBoundary>;
      case 'dashboard':     return <DashboardTab />;
      case 'products':      return <ProductsTab />;
      case 'stock':         return <StockTab />;
      case 'orders':        return orderDetailId ? <OrderDetailsPage /> : <OrdersTab />;
      case 'track':         return <TrackOrderTab />;
      case 'salesreport':   return <SalesReportTab />;
      case 'moneyrequest':  return <MoneyRequestTab />;
      case 'paymenthistory':return <PaymentHistoryTab />;
      case 'earnings':      return <EarningsTab />;
      case 'item-returns':  return <SellerReturnsTab onDetailChange={setReturnDetailId} />;
      case 'faqs':          return <FaqsTab />;
      case 'support':       return <SupportTab />;
      case 'profile':       return <ProfileTab />;
      case 'account':       return <AccountTab />;
      default: return <section className="seller-tab-panel"><h2>Page unavailable</h2><p>This seller page is no longer available.</p><a href="/seller">Back to seller dashboard</a></section>;
    }
  };

  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => window.innerWidth < 768);
  // Every page starts at its top: the tab area is one scroll box and would otherwise keep the previous page's position.
  useEffect(() => { if (typeof document !== 'undefined') document.querySelector('.seller-tab-content-container')?.scrollTo?.({ top: 0 }); }, [activeTab]);

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
        <GstAssistance compact onlyWhenActionNeeded />
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
              aria-expanded={!isSidebarCollapsed}
              aria-controls="seller-navigation"
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
            <GstStatusChip onOpen={() => { try { sessionStorage.setItem('seller-services-tab', 'applications'); } catch { /* optional shortcut */ } setActiveTab('services'); }} />
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
            <button type="button" className="seller-profile-chip" onClick={() => setActiveTab('profile')} aria-label="Open seller profile">
              <span className="seller-profile-avatar" style={{ backgroundColor: roleColor }}>
                {displayInitial}
              </span>
              <span className="seller-profile-text">
                <span className="seller-profile-name">{displayName}</span>
                <span className="seller-profile-role" style={{ color: roleColor }}>
                  {roleLabel}
                </span>
              </span>
            </button>

            {/* Sign Out — icon-only below 768px, label at 768px+ */}
            <button
              className="seller-signout-btn"
              onClick={async () => { return ui.perform('Logout from seller panel?', async () => {return await logoutSeller();}); }}
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

        {!detailOpen && <SellerPushControl />}

        {/* Tab content */}
        <div className="seller-tab-content-container" ref={tabScroll}>
          {renderActiveTab()}
        </div>
      </div>

      <NotificationDrawer isOpen={showNotifications} onClose={() => setShowNotifications(false)} />
      <SellerOrderAlerts />
      <SellerReturnAlerts />

      {/* Orders and new return requests have persistent alerts above.
          Other updates use the shared floating notification. */}
      <PullToRefresh scrollRef={tabScroll} disabled={Boolean(showNotifications)} />
      <NotificationPopup excludeSellerOrders excludeSellerReturns onNavigate={(route, notification) => {
        if (openAdvertisingNotification(notification || { route }, setActiveTab)) return;
        if (isSellerReturnNotification(notification)) return openSellerReturn(setActiveTab, notification);
        if (notification?.metadata?.orderId) return openSellerOrder(notification.metadata.orderId);
        const tab = resolvePopupNav(route); if (tab) setActiveTab(tab);
      }} />
    </div>
  );
};

export default DashboardPage;
