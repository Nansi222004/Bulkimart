import React, { useEffect, useState } from 'react';
import GstAssistance from '../../../components/gst/GstAssistance';
import ParcelOperations from '../../../components/parcels/ParcelOperations';
import AdminSessionGate from '../../../components/AdminSessionGate';
import { clearPortalRequests } from '../../../utils/portalRequests';
import { deregisterPushToken } from '../../../utils/firebaseMessaging';
import { disconnectSocket } from '../../../utils/socket';
import AdminProductDetailsPage from '../pages/AdminProductDetailsPage';
import AdminServicesWorkspace from '../../../components/services/LegalAdminWorkspace';
import PageErrorBoundary from '../../../components/PageErrorBoundary';
import { AdminProvider, useAdmin } from '../context/AdminContext';
import LeftSidebar from '../components/LeftSidebar';
import TopHeader from '../components/TopHeader';
import SuperAdminDashboard from '../pages/SuperAdminDashboard';
import SellersTab from '../components/SellersTab';
import VendorOrdersTab from '../components/VendorOrdersTab';
import { VendorFinancialsTab } from '../components/VendorFinancialsTab';
import ProductsTab from '../components/ProductsTab';
import PayoutsTab from '../components/PayoutsTab';
import TicketsTab from '../components/TicketsTab';
import CategoriesTab from '../components/CategoriesTab';
import CouponsTab from '../components/CouponsTab';
import SectionModuleTab from '../components/SectionModuleTab';
import ReportsTab from '../components/ReportsTab';
import CustomerActivityLogTab from '../components/CustomerActivityLogTab';
import ConsumerOrdersTab from '../components/ConsumerOrdersTab';
import ConsumerDashboardTab from '../components/ConsumerDashboardTab';
import UsersTab from '../components/UsersTab';
import DeliveryTab from '../components/DeliveryTab';
import DeliveryDashboardTab from '../components/DeliveryDashboardTab';
import DeliveryAssignmentTab from '../components/DeliveryAssignmentTab';
import DeliveryActiveOpsTab from '../components/DeliveryActiveOpsTab';
import DeliveryHistoryTab from '../components/DeliveryHistoryTab';
import DeliveryPerformanceTab from '../components/DeliveryPerformanceTab';
import DeliveryZonesTab from '../components/DeliveryZonesTab';
import UserReviewsTab from '../components/UserReviewsTab';
import SellerKYCTab from '../components/SellerKYCTab';
import VendorDashboardTab from '../components/VendorDashboardTab';
import DeliveryTrackingTab from '../components/DeliveryTrackingTab';
import RiderPayoutsTab from '../components/RiderPayoutsTab';
import TipSettingsTab from '../components/TipSettingsTab';
import BannersTab from '../components/BannersTab';
import StorefrontStudio from '../components/StorefrontStudio';
import CampaignsTab from '../components/CampaignsTab';
import AdvertisingWorkspace from '../../../components/advertising/AdvertisingWorkspace';
import ReturnsTab from '../components/ReturnsTab';
import ReturnPolicySettingsTab from '../components/ReturnPolicySettingsTab';
import RadiusSettingsTab from '../components/RadiusSettingsTab';
import NotificationBroadcasterTab from '../components/NotificationBroadcasterTab';
import PrivacyPolicyTab from '../components/PrivacyPolicyTab';
import UserWalletsTab from '../components/UserWalletsTab';
import AdminLoginPage from '../pages/AdminLoginPage';
import WholesaleManagementTab from '../components/WholesaleManagementTab';
import FinanceCenter from '../components/FinanceCenter';
import HelplineSettingsTab from '../components/HelplineSettingsTab';

import '../SuperAdmin.css';
import '../Admin.css'; // Toast alert styles

const AdminRoutesContent = ({ onLogout }) => {
  const { toastMessage, activeTab } = useAdmin();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => window.innerWidth < 768);

  const renderActiveTabContent = () => {
    if (activeTab === 'overview' || activeTab === 'dashboard') {
      return <SuperAdminDashboard />;
    }
    if (activeTab.startsWith('categories-') || activeTab === 'categories') {
      return <CategoriesTab subTab={activeTab.startsWith('categories-') ? activeTab : 'categories-all'} />;
    }
    switch (activeTab) {
      case 'parcel-delivery': return <ParcelOperations admin />;
      case 'advertising': return <AdvertisingWorkspace admin />;
      case 'services': return <PageErrorBoundary name="admin-services"><AdminServicesWorkspace /></PageErrorBoundary>;
      case 'users':             
      case 'users-all':         return <UsersTab defaultStatusFilter="All" />;
      case 'users-active':      return <UsersTab defaultStatusFilter="Active" />;
      case 'users-inactive':    return <UsersTab defaultStatusFilter="Inactive" />;
      case 'users-blocked':     return <UsersTab defaultStatusFilter="Blocked" />;
      case 'user-activity':     return <CustomerActivityLogTab />;
      case 'user-reviews':      return <UserReviewsTab />;
      case 'user-dashboard':    return <ConsumerDashboardTab />;
      case 'user-orders':       return <ConsumerOrdersTab />;
      case 'vendor-ratings-reviews': return <UserReviewsTab />;
      case 'vendor-dashboard': return <VendorDashboardTab />;
      case 'gst-assistance': return <GstAssistance admin />;
      case 'delivery-dashboard':return <DeliveryDashboardTab />;
      case 'delivery-partners':
      case 'delivery-all':       return <DeliveryTab defaultStatusFilter="All" />;
      case 'delivery-pending':   return <DeliveryTab defaultStatusFilter="Pending" />;
      case 'delivery-active':    return <DeliveryTab defaultStatusFilter="Active" />;
      case 'delivery-suspended': return <DeliveryTab defaultStatusFilter="Suspended" />;
      case 'delivery-active-ops':return <DeliveryActiveOpsTab />;
      case 'delivery-assignment':return <DeliveryAssignmentTab />;
      case 'delivery-tracking': return <DeliveryTrackingTab />;
      case 'delivery-history':  return <DeliveryHistoryTab />;
      case 'delivery-performance': return <DeliveryPerformanceTab />;
      case 'delivery-zones':     return <DeliveryZonesTab />;
      case 'delivery-earnings':
      case 'rider-payouts':      return <FinanceCenter key={activeTab} legacyTab={activeTab} />;
      case 'delivery-rates': return <FinanceCenter key={activeTab} legacyTab={activeTab} />;
      case 'tip-settings':       return <TipSettingsTab />;
      case 'banners':            return <BannersTab />;
      case 'storefront-studio':  return <StorefrontStudio />;
      case 'campaigns':          return <CampaignsTab />;
      case 'returns':            return <ReturnsTab />;
      case 'return-policies':    return <ReturnPolicySettingsTab />;
      case 'radius-settings':    return <RadiusSettingsTab />;
      case 'helpline-settings':  return <HelplineSettingsTab />;
      case 'notifications':      return <NotificationBroadcasterTab />;
      case 'privacy-policy':
      case 'privacy':            return <PrivacyPolicyTab />;
      case 'user-wallets':       return <UserWalletsTab />;
      case 'wholesale':         return <WholesaleManagementTab />;
      case 'sellers':
      // status values match the backend enum (lowercase)
      case 'coupons':          return <CouponsTab />;
      case 'vendors-all':       return <SellersTab defaultStatusFilter="all" />;
      case 'vendors-pending':   return <SellersTab defaultStatusFilter="pending" />;
      case 'vendors-approved':  return <SellersTab defaultStatusFilter="approved" />;
      case 'vendors-rejected':  return <SellersTab defaultStatusFilter="rejected" />;
      case 'vendors-suspended': return <SellersTab defaultStatusFilter="suspended" />;
      case 'seller-kyc':        return <SellerKYCTab />;
      case 'products':          
      case 'vendor-products':   return window.location.pathname.startsWith('/admin/products/') ? <AdminProductDetailsPage /> : <ProductsTab />;
      case 'vendor-orders':      return <VendorOrdersTab defaultMode="active" />;
      case 'vendor-order-history': return <VendorOrdersTab defaultMode="history" />;
      case 'vendor-sales':       return <VendorFinancialsTab defaultSubTab="sales" />;
      case 'vendor-earnings':    return <FinanceCenter key={activeTab} legacyTab={activeTab} />;
      case 'finance-center':
      case 'app-settings':
      case 'finance-operations': return <FinanceCenter key={activeTab} legacyTab={activeTab} />;
      case 'payouts':           
      case 'vendor-payouts':    return <FinanceCenter key={activeTab} legacyTab={activeTab} />;
      case 'quick-third-party-settings': return <FinanceCenter key={activeTab} legacyTab={activeTab} />;
      case 'tickets':           return <TicketsTab />;
      case 'reports':           return <ReportsTab />;
      default:                  return <SectionModuleTab moduleId={activeTab} />;
    }
  };

  return (
    <div className="sa-layout-container">
      {/* Toast Alert banner */}
      {toastMessage && (
        <div className="admin-toast-container" style={{ top: '80px', right: '24px', left: 'auto', width: 'auto', maxWidth: '350px' }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
            <polyline points="22 4 12 14.01 9 11.01"></polyline>
          </svg>
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Sidebar navigation */}
      {!sidebarCollapsed && <button type="button" className="sa-mobile-backdrop" aria-label="Close navigation" onClick={() => setSidebarCollapsed(true)} />}
      <LeftSidebar collapsed={sidebarCollapsed} setCollapsed={setSidebarCollapsed} />

      {/* Main Workspace content */}
      <div className="sa-workspace">
        <TopHeader onLogout={onLogout} />
        
        {/* Render tab contents */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {renderActiveTabContent()}
        </div>
      </div>
    </div>
  );
};

export const AdminRoutes = () => {
  const [token, setToken] = useState(localStorage.getItem('adminToken'));

  useEffect(() => {
    const changed = event => { if (!event.key || event.key === 'adminToken') { clearPortalRequests('admin'); setToken(localStorage.getItem('adminToken')); } };
    window.addEventListener('storage', changed); window.addEventListener('bulkimart:admin-session-changed', changed);
    return () => { window.removeEventListener('storage', changed); window.removeEventListener('bulkimart:admin-session-changed', changed); };
  }, []);
  const logout = async () => {
    const pushCleanup = deregisterPushToken('admin').catch(() => {});
    disconnectSocket();
    clearPortalRequests('admin'); localStorage.removeItem('adminToken'); localStorage.removeItem('adminUser'); setToken(null);
    await pushCleanup;
  };
  return (
    <>
      {!token ? (
        <AdminLoginPage onLoginSuccess={setToken} />
      ) : (
        <AdminSessionGate token={token} onInvalid={logout}><AdminProvider key={token}><AdminRoutesContent onLogout={logout} /></AdminProvider></AdminSessionGate>
      )}
    </>
  );
};

export default AdminRoutes;
