import React, { useState } from 'react';
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
import DeliveryRatesTab from '../components/DeliveryRatesTab';
import TipSettingsTab from '../components/TipSettingsTab';
import BannersTab from '../components/BannersTab';
import CampaignsTab from '../components/CampaignsTab';
import SellerPromotionsTab from '../components/SellerPromotionsTab';
import PromotionPackagesTab from '../components/PromotionPackagesTab';
import ReturnsTab from '../components/ReturnsTab';
import ReturnPolicySettingsTab from '../components/ReturnPolicySettingsTab';
import RadiusSettingsTab from '../components/RadiusSettingsTab';
import NotificationBroadcasterTab from '../components/NotificationBroadcasterTab';
import PrivacyPolicyTab from '../components/PrivacyPolicyTab';
import UserWalletsTab from '../components/UserWalletsTab';
import AdminLoginPage from '../pages/AdminLoginPage';
import WholesaleManagementTab from '../components/WholesaleManagementTab';
import QuickThirdPartySettingsTab from '../components/QuickThirdPartySettingsTab';
import SellerLedgerAdminTab from '../components/SellerLedgerAdminTab';

import '../SuperAdmin.css';
import '../Admin.css'; // Toast alert styles

const AdminRoutesContent = ({ onLogout }) => {
  const { toastMessage, activeTab } = useAdmin();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const renderActiveTabContent = () => {
    if (activeTab === 'overview' || activeTab === 'dashboard') {
      return <SuperAdminDashboard />;
    }
    if (activeTab.startsWith('categories-') || activeTab === 'categories') {
      return <CategoriesTab subTab={activeTab.startsWith('categories-') ? activeTab : 'categories-all'} />;
    }
    switch (activeTab) {
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
      case 'rider-payouts':      return <RiderPayoutsTab />;
      case 'delivery-rates':     return <DeliveryRatesTab />;
      case 'tip-settings':       return <TipSettingsTab />;
      case 'banners':            return <BannersTab />;
      case 'campaigns':          return <CampaignsTab />;
      case 'seller-promotions':  return <SellerPromotionsTab />;
      case 'promotion-packages': return <PromotionPackagesTab />;
      case 'returns':            return <ReturnsTab />;
      case 'return-policies':    return <ReturnPolicySettingsTab />;
      case 'radius-settings':    return <RadiusSettingsTab />;
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
      case 'vendor-products':   return <ProductsTab />;
      case 'vendor-orders':      return <VendorOrdersTab defaultMode="active" />;
      case 'vendor-order-history': return <VendorOrdersTab defaultMode="history" />;
      case 'vendor-sales':       return <VendorFinancialsTab defaultSubTab="sales" />;
      case 'vendor-earnings':    return <SellerLedgerAdminTab view="earnings" />;
      case 'payouts':           
      case 'vendor-payouts':    return <SellerLedgerAdminTab view="payouts" />;
      case 'quick-third-party-settings': return <QuickThirdPartySettingsTab />;
      case 'tickets':           return <TicketsTab />;
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

  return (
    <AdminProvider>
      {!token ? (
        <AdminLoginPage onLoginSuccess={setToken} />
      ) : (
        <AdminRoutesContent onLogout={() => {
          localStorage.removeItem('adminToken');
          localStorage.removeItem('adminUser');
          setToken(null);
        }} />
      )}
    </AdminProvider>
  );
};

export default AdminRoutes;
