import React, { useEffect, useState } from 'react';
import { useAdmin } from '../context/AdminContext';
import { parcelRequest } from '../../../components/parcels/parcelApi';
import BrandLogo from '../../../components/BrandLogo';
import { useAdvertisingNavigation } from '../../../components/advertising/useAdvertisingNavigation';

// Paused parcel bookings waiting for an admin (rider help or cancellation requests).
// Refreshed every minute and right after an admin acts on one; failures keep the last count.
function useParcelReviewCount(enabled) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!enabled) return undefined;
    let alive = true;
    const load = () => parcelRequest('admin', '/bookings?status=needs_review&limit=1').then(result => { if (alive) setCount(Number(result.meta?.total) || 0); }).catch(() => {});
    load();
    const timer = setInterval(load, 60000);
    window.addEventListener('parcel-review-changed', load);
    return () => { alive = false; clearInterval(timer); window.removeEventListener('parcel-review-changed', load); };
  }, [enabled]);
  return count;
}

export const LeftSidebar = ({ collapsed, setCollapsed }) => {
  const advertisingEnabled = useAdvertisingNavigation(true);
  const { activeTab, setActiveTab } = useAdmin();
  const [categoriesExpanded, setCategoriesExpanded] = useState(true);

  // Helper to trigger navigation
  const handleNavClick = (id, label) => {
    if (id === 'dashboard') {
      setActiveTab('overview');
    } else {
      setActiveTab(id);
    }
  };

  const navGroups = [
    {
      title: 'Platform',
      links: [
        { id: 'dashboard', label: 'Dashboard', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/></svg> },
        { id: 'reports', label: 'Reports', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg> }
      ]
    },
    {
      title: 'User Management',
      links: [
        { id: 'users', label: 'Users', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg> },
        { id: 'user-wallets', label: 'Real Money Wallets', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg> },
        { id: 'tickets', label: 'Support Tickets', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg> }
      ]
    },
    {
      title: 'Vendor Management',
      links: [
        ...(advertisingEnabled ? [{ id: 'advertising', label: 'Advertising', icon: <span aria-hidden="true">▤</span> }] : []),
        { id: 'services', label: 'Services', icon: <span aria-hidden="true">▤</span> },
        { id: 'gst-assistance', label: 'GST Registration Assistance', icon: <span aria-hidden="true">▤</span> },
        { id: 'parcel-delivery', label: 'Parcel Deliveries', icon: <span aria-hidden="true">▣</span> },
        { id: 'sellers', label: 'Sellers / Vendors', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg> },
      ]
    },
    {
      title: 'Product Management',
      links: [
        { id: 'products', label: 'Products', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="21" y1="12" x2="3" y2="12"/><line x1="12" y1="3" x2="12" y2="21"/></svg> },
        { id: 'wholesale', label: 'Wholesale', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="m3 7 9-4 9 4-9 4-9-4Z"/><path d="M3 7v10l9 4 9-4V7M12 11v10"/></svg> },
        { id: 'categories', label: 'Categories', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg> },
        { id: 'coupons', label: 'Coupons', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M20 12a2 2 0 0 1 2-2V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v4a2 2 0 0 1 0 4v4a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-4a2 2 0 0 1-2-2z"/><line x1="13" y1="5" x2="13" y2="19"/></svg> },
        { id: 'inventory', label: 'Inventory', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><box y="3" x="3" width="7" height="7"/><box y="3" x="14" width="7" height="7"/><box y="14" x="14" width="7" height="7"/><box y="14" x="3" width="7" height="7"/></svg> }
      ]
    },
    {
      title: 'Order Management',
      links: [
        { id: 'ecom-orders', label: 'E-Commerce Orders', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg> },
        { id: 'qcom-orders', label: 'Quick Commerce Orders', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg> },
        { id: 'wholesale-orders', label: 'Wholesale Orders', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="12" width="8" height="8" rx="1"/><rect x="13" y="12" width="8" height="8" rx="1"/><rect x="8" y="3" width="8" height="8" rx="1"/></svg> },
      ]
    },
    {
      title: 'Delivery Management',
      links: [
        { id: 'delivery-partners', label: 'Delivery Partners', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg> },
        { id: 'delivery-zones', label: 'Delivery Zones', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg> }
      ]
    },
    {
      title: 'Marketing & CMS',
      links: [
        { id: 'storefront-studio', label: 'Storefront Studio', icon: <span aria-hidden="true">✦</span> },
        { id: 'banners', label: 'Banners', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="3" y="3" width="18" height="18" rx="2"/><rect x="7" y="7" width="10" height="10"/></svg> },
        { id: 'campaigns', label: 'Campaigns / Deals', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 12a2 2 0 0 1 2-2V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v4a2 2 0 0 1 0 4v4a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-4a2 2 0 0 1-2-2z"/><path d="M9 9h.01M15 15h.01M15 9l-6 6"/></svg> },
        { id: 'tip-settings', label: 'Rider Tip Settings', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg> },
        { id: 'notifications', label: 'Notifications', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg> },
        { id: 'privacy-policy', label: 'Privacy Policy CMS', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg> }
      ]
    },
    {
      title: 'Returns & Refunds',
      links: [
        { id: 'returns', label: 'Returns & Refunds', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.51"/></svg> },
        { id: 'return-policies', label: 'Return Window Settings', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> },
      ]
    },
    {
      title: 'Settings',
      links: [
        { id: 'app-settings', label: 'App Settings', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06-.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg> },
        { id: 'radius-settings', label: 'Radius Settings', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="4"/><line x1="12" y1="2" x2="12" y2="5"/></svg> },
        { id: 'helpline-settings', label: 'Helpline & SOS Settings', icon: <span style={{ fontSize: 14 }}>🚨</span> }
      ]
    }
  ];

  // Section navigation expands beneath its parent inside the shared admin tree.
  const isVendorSection = [
    'sellers', 'seller-kyc', 'payouts',
    'vendor-dashboard', 'vendors-all', 'vendors-pending', 'vendors-approved', 'vendors-rejected', 'vendors-suspended',
    'vendor-products', 'vendor-inventory',
    'vendor-orders', 'vendor-order-history',
    'vendor-sales', 'vendor-earnings', 'vendor-payouts', 'finance-operations',
    'vendor-performance', 'vendor-ratings-reviews',  ].includes(activeTab);
  const isUserSection = [
    'users', 'user-dashboard', 'users-all', 'users-active', 'users-inactive', 'users-blocked',
    'user-activity', 'user-orders', 'user-reviews'
  ].includes(activeTab);
  const isDeliverySection = [
    'delivery-partners', 'delivery-tracking', 'rider-payouts', 'delivery-zones',
    'delivery-dashboard', 'delivery-all', 'delivery-pending', 'delivery-active', 'delivery-suspended',
    'delivery-active-ops', 'delivery-assignment', 'delivery-history', 'delivery-performance', 'delivery-earnings'
  ].includes(activeTab);

  let filteredNavGroups = navGroups;

  if (isUserSection) {
    filteredNavGroups = [
      {
        title: 'CONSUMER USERS',
        links: [
          { id: 'user-dashboard', label: 'Dashboard', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/></svg> }
        ]
      },
      {
        title: 'CUSTOMER MANAGEMENT',
        links: [
          { id: 'users-all', label: 'All Customers', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg> },
          { id: 'users-active', label: 'Active Customers', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> },
          { id: 'users-inactive', label: 'Inactive Customers', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg> },
          { id: 'users-blocked', label: 'Blocked Customers', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg> }
        ]
      },

      {
        title: 'CUSTOMER ACTIVITY',
        links: [
          { id: 'user-activity', label: 'User Activity', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg> }
        ]
      },
      {
        title: 'COMMERCE',
        links: [
          { id: 'user-orders', label: 'Orders', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg> }
        ]
      }
    ];
  } else if (isVendorSection) {
    filteredNavGroups = [
      {
        title: 'GENERAL VENDORS',
        links: [
          { id: 'vendor-dashboard', label: 'Dashboard', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/></svg> }
        ]
      },
      {
        title: 'VENDOR MANAGEMENT',
        links: [
          { id: 'vendors-all', label: 'All Vendors', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg> },
          { id: 'vendors-pending', label: 'Pending Approval', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> },
          { id: 'vendors-approved', label: 'Approved Vendors', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> },
          { id: 'vendors-rejected', label: 'Rejected Vendors', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg> },
          { id: 'vendors-suspended', label: 'Suspended Vendors', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg> }
        ]
      },
      {
        title: 'CATALOG',
        links: [
          { id: 'vendor-products', label: 'Vendor Products', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="21" y1="12" x2="3" y2="12"/><line x1="12" y1="3" x2="12" y2="21"/></svg> },
          { id: 'vendor-inventory', label: 'Inventory', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg> }
        ]
      },
      {
        title: 'ORDERS',
        links: [
          { id: 'vendor-orders', label: 'Vendor Orders', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg> },
          { id: 'vendor-order-history', label: 'Order History', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 8v4l3 3"/><circle cx="12" cy="12" r="10"/></svg> }
        ]
      },
      {
        title: 'FINANCIAL',
        links: [
          { id: 'finance-operations', label: 'Finance Operations', icon: <span aria-hidden="true">₹</span> },
          { id: 'vendor-sales', label: 'Sales', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg> },
          { id: 'vendor-earnings', label: 'Earnings', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg> },
          { id: 'vendor-payouts', label: 'Payouts', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="2" y="4" width="20" height="16" rx="2" ry="2"/><path d="M12 8v8m-4-4h8"/></svg> },
          { id: 'quick-third-party-settings', label: 'Quick 3P Settings', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M3 12h18M12 3v18"/><circle cx="12" cy="12" r="9"/></svg> }
        ]
      },
      {
        title: 'PERFORMANCE',
        links: [
          { id: 'vendor-performance', label: 'Vendor Performance', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg> },
          { id: 'vendor-ratings-reviews', label: 'Ratings & Reviews', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg> }
        ]
      }
    ];
  } else if (isDeliverySection) {
    filteredNavGroups = [
      {
        title: 'DELIVERY FLEET',
        links: [
          { id: 'delivery-dashboard', label: 'Dashboard', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/></svg> }
        ]
      },
      {
        title: 'DELIVERY PARTNERS',
        links: [
          { id: 'delivery-all', label: 'All Partners', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg> },
          { id: 'delivery-pending', label: 'Pending Applications', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> },
          { id: 'delivery-active', label: 'Active Partners', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> },
          { id: 'delivery-suspended', label: 'Suspended Partners', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg> }
        ]
      },
      {
        title: 'DELIVERY OPERATIONS',
        links: [
          { id: 'delivery-active-ops', label: 'Active Deliveries', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg> },
          { id: 'delivery-assignment', label: 'Order Assignment', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg> },
          { id: 'delivery-tracking', label: 'Delivery Tracking', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg> },
          { id: 'delivery-zones', label: 'Delivery Hub Zones', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg> }
        ]
      },
      {
        title: 'DELIVERY HISTORY',
        links: [
          { id: 'delivery-history', label: 'Completed Deliveries', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg> }
        ]
      },
      {
        title: 'PERFORMANCE',
        links: [
          { id: 'delivery-performance', label: 'Delivery Performance', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg> }
        ]
      },
      {
        title: 'EARNINGS',
        links: [
          { id: 'delivery-earnings', label: 'Earnings & Payouts', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="2" y="4" width="20" height="16" rx="2" ry="2"/><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg> },
          { id: 'delivery-rates', label: 'Rider Pay Rates', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg> }
        ]
      }
    ];
  }

  // Finance stays a single entry; legacy links are served by the center.
  const financeTabs = ['finance-center','finance-operations','app-settings','quick-third-party-settings','delivery-rates','vendor-earnings','vendor-payouts','payouts','delivery-earnings','rider-payouts'];
  const sectionParent = isUserSection ? 'users' : isVendorSection ? 'sellers' : isDeliverySection ? 'delivery-partners' : null;
  const sectionLinks = sectionParent ? filteredNavGroups.flatMap(group => group.links).filter(link => !financeTabs.includes(link.id) && !['user-dashboard', 'vendor-dashboard', 'delivery-dashboard', 'delivery-zones'].includes(link.id)) : [];
  const sharedNavGroups = navGroups.map(group => ({ ...group, links: group.links.filter(link => !financeTabs.includes(link.id)) })).filter(group => group.links.length);
  sharedNavGroups.push({title:'FINANCE',links:[{id:'finance-center',label:'Finance Center',icon:<span aria-hidden="true">₹</span>}]});
  const parcelReviews = useParcelReviewCount(sharedNavGroups.some(group => group.links.some(link => link.id === 'parcel-delivery')));

  return (
    <div className={`sa-sidebar ${collapsed ? 'collapsed' : ''}`}>
      {/* Brand Header */}
      <div className="sa-sidebar-header">
        <div className="sa-logo-box">
          <BrandLogo className="sa-logo-icon" variant="icon" />
          <div className="sa-logo-text">
            <span className="sa-logo-title">Bulkimart</span>
            <span className="sa-logo-subtitle">Super Admin</span>
          </div>
        </div>
        <button className="sa-collapse-btn" onClick={() => setCollapsed(!collapsed)} title={collapsed ? 'Expand menu' : 'Collapse menu'} aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'} aria-expanded={!collapsed}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            {collapsed ? (
              <>
                <polyline points="13 17 18 12 13 7" />
                <polyline points="6 17 11 12 6 7" />
              </>
            ) : (
              <>
                <polyline points="11 17 6 12 11 7" />
                <polyline points="18 17 13 12 18 7" />
              </>
            )}
          </svg>
        </button>
      </div>

      {/* Nav Link Tree */}
      <div className="sa-sidebar-nav">
        {sharedNavGroups.map(group => (
          <div key={group.title} className="sa-nav-group">
            <span className="sa-nav-group-title">{group.title}</span>
            {group.links.map(link => {
              if (link.id === 'categories') {
                const isSubActive = activeTab.startsWith('categories-') || activeTab === 'categories';
                return (
                  <div key={link.id} className="sa-nav-accordion" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <button
                      className={`sa-nav-link ${isSubActive ? 'active' : ''}`}
                      onClick={() => setCategoriesExpanded(!categoriesExpanded)}
                      title={link.label}
                      style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        {link.icon}
                        {!collapsed && <span>{link.label}</span>}
                      </div>
                      {!collapsed && (
                        <span style={{ display: 'flex', alignItems: 'center' }}>
                          {categoriesExpanded ? (
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="18 15 12 9 6 15"/></svg>
                          ) : (
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="6 9 12 15 18 9"/></svg>
                          )}
                        </span>
                      )}
                    </button>
                    {!collapsed && categoriesExpanded && (
                      <div className="sa-nav-sub-links-container" style={{ display: 'flex', flexDirection: 'column', gap: 2, paddingLeft: 12 }}>
                        {[
                          { id: 'categories-all', label: 'All Categories' },
                          { id: 'categories-header', label: 'Header Categories' },
                          { id: 'categories-main', label: 'Main Categories' },
                          { id: 'categories-sub', label: 'Sub-Categories' }
                        ].map(sub => {
                          const isSubLinkActive = activeTab === sub.id;
                          return (
                            <button
                              key={sub.id}
                              className={`sa-nav-link sa-nav-sub-link ${isSubLinkActive ? 'active' : ''}`}
                              onClick={() => handleNavClick(sub.id, sub.label)}
                              title={sub.label}
                              style={{ 
                                paddingLeft: 24, 
                                fontSize: '11.5px', 
                                opacity: isSubLinkActive ? 1 : 0.85,
                                borderLeft: isSubLinkActive ? '2.5px solid var(--sa-primary)' : 'none',
                                borderRadius: isSubLinkActive ? '0 4px 4px 0' : '4px',
                                minHeight: '32px'
                              }}
                            >
                              <span style={{ marginRight: 6, fontSize: 12 }}>•</span>
                              <span>{sub.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              }

              const isActive = (link.id === 'dashboard' && activeTab === 'overview') || link.id === sectionParent || (activeTab === link.id || (link.id === 'finance-center' && financeTabs.includes(activeTab)));
              return (
                <React.Fragment key={link.id}>
                <button
                  className={`sa-nav-link ${isActive ? 'active' : ''}`}
                  aria-current={isActive && (link.id !== sectionParent || ['user-dashboard', 'vendor-dashboard', 'delivery-dashboard'].includes(activeTab)) ? 'page' : undefined}
                  onClick={() => handleNavClick(link.id, link.label)}
                  title={link.label}
                >
                  {link.icon}
                  <span>{link.label}</span>
                  {link.id === 'parcel-delivery' && parcelReviews > 0 && <b className="sa-nav-badge" aria-label={`${parcelReviews} paused ${parcelReviews === 1 ? 'booking needs' : 'bookings need'} review`}>{parcelReviews > 99 ? '99+' : parcelReviews}</b>}
                </button>
                {link.id === sectionParent && !collapsed && <div className="sa-nav-sub-links-container" role="group" aria-label={`${link.label} pages`} style={{ paddingLeft: 12 }}>
                  {sectionLinks.map(sub => <button key={sub.id} className={`sa-nav-link sa-nav-sub-link ${activeTab === sub.id ? 'active' : ''}`} aria-current={activeTab === sub.id ? 'page' : undefined} title={sub.label} onClick={() => handleNavClick(sub.id, sub.label)}>{sub.icon}<span>{sub.label}</span></button>)}
                </div>}
                </React.Fragment>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
};

export default LeftSidebar;
