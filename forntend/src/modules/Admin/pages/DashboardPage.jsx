import React from 'react';
import { useAdmin } from '../context/AdminContext';
import LeftNav from '../components/LeftNav';
import OverviewTab from '../components/OverviewTab';
import SellersTab from '../components/SellersTab';
import ProductsTab from '../components/ProductsTab';
import PayoutsTab from '../components/PayoutsTab';
import TicketsTab from '../components/TicketsTab';
import CategoriesTab from '../components/CategoriesTab';
import UsersTab from '../components/UsersTab';
import SHGVendorsTab from '../components/SHGVendorsTab';
import DeliveryTab from '../components/DeliveryTab';
import SubscriptionsTab from '../components/SubscriptionsTab';
import SHGSubscriptionsTab from '../components/SHGSubscriptionsTab';

const TAB_TITLES = {
  overview: 'Platform Overview',
  users: 'Consumer Memberships & KYC',
  'user-dashboard': 'Consumer Users - Ecosystem Dashboard',
  'users-all': 'Customer Management - All Customers',
  'users-active': 'Customer Management - Active Customers',
  'users-inactive': 'Customer Management - Inactive Customers',
  'users-blocked': 'Customer Management - Blocked Accounts',
  'user-activity': 'Customer Activity & Security Log',
  'user-orders': 'Commerce - Customer Orders Log',
  'user-subscriptions': 'Commerce - Active Subscriptions',
  'user-reviews': 'Commerce - Customer Reviews',
  sellers: 'Seller Verifications',
  'vendors-all': 'General Vendors - All Directory',
  'vendors-pending': 'General Vendors - Pending Approvals',
  'vendors-approved': 'General Vendors - Approved Merchants',
  'vendors-rejected': 'General Vendors - Rejected Applications',
  'vendors-suspended': 'General Vendors - Suspended Accounts',
  'stores-all': 'Store Management - Stores Directory',
  'stores-approval': 'Store Management - Store Approvals',
  'stores-status': 'Store Management - Operational Status',
  'vendor-products': 'Vendor Catalog - Products',
  'vendor-inventory': 'Vendor Catalog - Inventory Control',
  'vendor-orders': 'Vendor Orders - Active Pipeline',
  'vendor-order-history': 'Vendor Orders - Order History',
  'vendor-sales': 'Vendor Financials - Sales Ledger',
  'vendor-earnings': 'Vendor Financials - Net Earnings',
  'vendor-payouts': 'Vendor Financials - Bank Payouts',
  'vendor-performance': 'Vendor Performance & SLA Scorecards',
  'vendor-ratings-reviews': 'Vendor Ratings & Moderated Reviews',
  'vendor-ad-requests': 'Vendor Promotions - Advertisement Requests',
  'vendor-featured-seller': 'Vendor Promotions - Featured Sellers',
  'shg-dashboard': 'SHG Cooperatives - Executive Summary Dashboard',
  'shg-all': 'SHG Management - All Cooperatives',
  'shg-pending': 'SHG Management - Pending Applications',
  'shg-approved': 'SHG Management - Approved Cooperatives',
  'shg-rejected': 'SHG Management - Rejected Applications',
  'shg-suspended': 'SHG Management - Suspended Cooperatives',
  'shg-categories': 'SHG Catalog - Categories Directory',
  'shg-products': 'SHG Catalog - Product Directory',
  'shg-subscriptions': 'SHG Seller Subscriptions',
  'shg-product-approval': 'SHG Catalog - Product Approval Queue',
  'shg-orders': 'SHG Orders - Fulfillment Pipeline',
  'shg-performance': 'SHG Performance - Impact & SLA Scorecards',
  'shg-featured-collections': 'SHG Marketplace - Featured Collections',
  'shg-vendors': 'Self-Help Group (SHG) Registrations',
  'sub-dashboard': 'Subscriptions - Executive Dashboard',
  'sub-plans': 'Subscriptions - Plan Directory & Configurator',
  'sub-subscriptions': 'Subscriptions - Active Customer Subscriptions',
  'sub-custom-packages': 'Subscriptions - Custom Package Builder',
  'sub-scheduled-deliveries': 'Subscriptions - 7:30 AM Morning Scheduled Deliveries',
  'sub-renewals': 'Subscriptions - Auto-Renewals & Expiring Queue',
  'sub-reports': 'Subscriptions - MRR & Delivery SLA Reports',
  'delivery-dashboard': 'Delivery Fleet - Operational Command Dashboard',
  'delivery-all': 'Delivery Partners - All Fleet Directory',
  'delivery-pending': 'Delivery Partners - Pending Applications',
  'delivery-active': 'Delivery Partners - Active Fleet',
  'delivery-suspended': 'Delivery Partners - Suspended Partners',
  'delivery-active-ops': 'Delivery Operations - Live Active Deliveries',
  'delivery-assignment': 'Delivery Operations - Manual Order Assignment',
  'delivery-tracking': 'Delivery Operations - Live GPS Tracking',
  'delivery-history': 'Delivery History - Completed Deliveries Log',
  'delivery-performance': 'Delivery Performance & Rider SLA Scorecard',
  'delivery-earnings': 'Delivery Fleet - Earnings & UPI Disbursal',
  delivery: 'Delivery Partners & Logistics',
  products: 'Product Catalog Approvals',
  payouts: 'Payout Approvals',
  tickets: 'Support Tickets',
  'categories-all': 'Categories Directory',
  'categories-header': 'Header Navigation Modes',
  'categories-main': 'Main Catalog Categories',
  'categories-sub': 'Product Sub-Categories',
};

export const DashboardPage = () => {
  const { activeTab } = useAdmin();

  const renderActiveTab = () => {
    if (activeTab.startsWith('categories-')) {
      return <CategoriesTab subTab={activeTab} />;
    }

    switch (activeTab) {
      case 'overview': return <OverviewTab />;
      case 'users':    return <UsersTab />;
      case 'sellers':  return <SellersTab />;
      case 'shg-vendors': return <SHGVendorsTab />;
      case 'subscriptions': return <SubscriptionsTab />;
      case 'shg-subscriptions': return <SHGSubscriptionsTab />;
      case 'delivery': return <DeliveryTab />;
      case 'products': return <ProductsTab />;
      case 'payouts':  return <PayoutsTab />;
      case 'tickets':  return <TicketsTab />;
      default:         return <OverviewTab />;
    }
  };

  return (
    <div className="admin-dashboard-layout">
      <LeftNav />

      <div className="admin-main-content">
        {/* Header */}
        <div className="admin-header-row">
          <h2 className="admin-header-title">{TAB_TITLES[activeTab] || activeTab}</h2>
          <div className="admin-header-actions">
            <button className="admin-header-btn" aria-label="Alerts">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
              </svg>
              <span className="admin-notification-badge" />
            </button>
          </div>
        </div>

        {/* Tab content */}
        <div className="admin-tab-content-container">
          {renderActiveTab()}
        </div>
      </div>
    </div>
  );
};

export default DashboardPage;
