import React, { useEffect, useState } from 'react';
import { useSHG } from '../context/SHGContext';
import SHGLeftNav from '../components/SHGLeftNav';
import SubscriptionBanner from '../components/SubscriptionBanner';
import SubscriptionRequiredModal from '../components/SubscriptionRequiredModal';
import SHGDashboardTab from '../components/SHGDashboardTab';
import SHGProductsTab from '../components/SHGProductsTab';
import SHGOrdersTab from '../components/SHGOrdersTab';
import SHGSubscriptionsTab from '../components/SHGSubscriptionsTab';
import SHGMembersTab from '../components/SHGMembersTab';
import SHGEarningsTab from '../components/SHGEarningsTab';
import SHGSupportTab from '../components/SHGSupportTab';
import SHGAccountTab from '../components/SHGAccountTab';
// Genuinely shared with the Seller panel — a subscription request ring and
// a pack checklist are the same screens for either kind of vendor, and the
// endpoints behind them serve both.
import SubscriptionRequestRingModal from '../../Seller/components/SubscriptionRequestRingModal';
import SubscriptionPackChecklist from '../../Seller/components/SubscriptionPackChecklist';

const TAB_TITLES = {
  dashboard: 'SHG Store Dashboard',
  products: 'Community Catalog',
  orders: 'Fulfillment Orders',
  subscriptions: 'Customer Subscriptions',
  members: 'SHG Group Registry',
  earnings: 'Cooperative Profits',
  payouts: 'Bank Settlement Ledger',
  support: 'Compliance Help Desk',
  account: 'SHG Profile Profile'
};

const MODES = [
  { key: 'ecommerce', label: 'E-Commerce', icon: '📦', color: '#3b82f6', gradient: 'linear-gradient(135deg, #3b82f6, #1d4ed8)' },
  { key: 'quick', label: 'Quick Commerce', icon: '⚡', color: '#10b981', gradient: 'linear-gradient(135deg, #10b981, #047857)' },
];

export const SHGDashboardPage = () => {
  const {
    activeTab,
    activeMode,
    setActiveMode,
    groupForm,
    toastMessage,
    toastType,
    showNotifications,
    setShowNotifications,
    fetchMySubscription,
    triggerToast,
    incomingSubscriptionRequest,
    setIncomingSubscriptionRequest,
    subscriptionPrepAlerts,
    dismissSubscriptionPrepAlert,
    fetchShgSubscriptions,
  } = useSHG();

  const currentMode = MODES.find((m) => m.key === activeMode) || MODES[0];
  const [openPackAlert, setOpenPackAlert] = useState(null); // { subscriptionId, deliveryEntryId } | null
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  // PhonePe sends the seller back to /shg?subscriptionPayment=paid|failed.
  // The redirect itself is never trusted as proof of payment — the backend
  // already reconciled against the gateway before issuing it; this only
  // refreshes the panel's view of the now-authoritative server state.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get('subscriptionPayment');
    if (!result) return;

    fetchMySubscription();
    if (result === 'paid') triggerToast('Subscription activated successfully!');
    else if (result === 'failed') triggerToast('Payment failed — please try again.', 'error');

    params.delete('subscriptionPayment');
    const rest = params.toString();
    window.history.replaceState({}, '', window.location.pathname + (rest ? `?${rest}` : ''));
  }, []);

  const renderActiveTab = () => {
    switch (activeTab) {
      case 'dashboard': return <SHGDashboardTab />;
      case 'products': return <SHGProductsTab />;
      case 'orders': return <SHGOrdersTab />;
      case 'subscriptions': return <SHGSubscriptionsTab />;
      case 'members': return <SHGMembersTab />;
      case 'earnings': return <SHGEarningsTab />;
      case 'payouts': return <SHGEarningsTab />; // handled in earnings
      case 'support': return <SHGSupportTab />;
      case 'account': return <SHGAccountTab />;
      default: return <SHGDashboardTab />;
    }
  };

  return (
    <div className={`shg-dashboard-layout ${isSidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      {/* Toast popup */}
      {toastMessage && (
        <div className={`shg-toast ${toastType}`}>
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Navigation sidebar */}
      <SHGLeftNav
        isCollapsed={isSidebarCollapsed}
        onToggleCollapse={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
      />

      {/* Plan chooser — opened by the banner, or automatically when a
          subscription-gated action is rejected by the backend. */}
      <SubscriptionRequiredModal />

      {/* Main Content Area */}
      <div className="shg-main-content">

        {/* Top Header */}
        <header className="shg-header-row">
          <div className="shg-header-top-line">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {isSidebarCollapsed && (
                <button
                  type="button"
                  onClick={() => setIsSidebarCollapsed(false)}
                  style={{
                    background: 'var(--shg-primary-light, #f5f3ff)',
                    border: '1.5px solid var(--shg-primary-mid, #ede9fe)',
                    borderRadius: 8,
                    padding: '5px 8px',
                    color: 'var(--shg-primary, #7c3aed)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    fontSize: 12,
                    fontWeight: 700,
                  }}
                  title="Expand Navigation Sidebar"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="3" y1="12" x2="21" y2="12" />
                    <line x1="3" y1="6" x2="21" y2="6" />
                    <line x1="3" y1="18" x2="21" y2="18" />
                  </svg>
                  <span>Menu</span>
                </button>
              )}
              <h2 className="shg-header-title" style={{ color: currentMode.color, transition: 'color 0.2s' }}>
                {TAB_TITLES[activeTab] || 'SHG Panel'}
              </h2>
            </div>

            <div className="shg-header-right">
              <button
                className="shg-header-btn"
                onClick={() => setShowNotifications(!showNotifications)}
                aria-label="Notifications Drawer"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></svg>
                <span className="shg-badge-dot" />
              </button>

              {/* Profile User Card — label follows the active storefront */}
              <div className="shg-profile-card">
                <div className="shg-profile-avatar" style={{ backgroundColor: currentMode.color }}>
                  {(groupForm?.groupName || 'SHG').charAt(0).toUpperCase()}
                </div>
                <div className="shg-profile-info">
                  <span className="shg-profile-name">{groupForm?.groupName || 'SHG Group'}</span>
                  <span className="shg-profile-role" style={{ color: currentMode.color }}>
                    {currentMode.label} Seller
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Storefront Mode Switcher — placed directly BELOW the header title line */}
          <div className="shg-mode-switcher-row">
            <div className="shg-mode-switcher">
              {MODES.map((mode) => {
                const active = activeMode === mode.key;
                return (
                  <button
                    key={mode.key}
                    className={`shg-mode-btn ${active ? 'active' : ''}`}
                    onClick={() => setActiveMode(mode.key)}
                    style={{
                      border: 'none',
                      background: active ? mode.gradient : 'none',
                      color: active ? '#fff' : '#64748b',
                      fontSize: 11,
                      fontWeight: 800,
                      padding: '6px 12px',
                      borderRadius: 10,
                      cursor: 'pointer',
                      transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
                      boxShadow: active ? `0 2px 4px ${mode.color}33` : 'none',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                    }}
                  >
                    {mode.icon} {mode.label}
                  </button>
                );
              })}
            </div>
          </div>
        </header>

        {/* Subscription state strip — renders nothing while a subscription
            is active and not near expiry. The panel itself stays reachable
            in every state, by design. */}
        <SubscriptionBanner />

        {/* Tab components loader */}
        <div className="shg-tab-content-container">
          {renderActiveTab()}
        </div>
      </div>

      {/* A customer wants to subscribe to this group's Quick Commerce
          listings — same 2-minute accept/decline ring the Seller panel
          gets, backed by the same endpoints and the same server-side
          accept-window sweeper. */}
      {incomingSubscriptionRequest && (
        <SubscriptionRequestRingModal
          request={incomingSubscriptionRequest}
          onAccept={() => {
            setIncomingSubscriptionRequest(null);
            fetchShgSubscriptions();
          }}
          onDecline={() => setIncomingSubscriptionRequest(null)}
        />
      )}

      {/* Subscription deliveries due for packing. */}
      {subscriptionPrepAlerts.length > 0 && (
        <div style={{ position: 'fixed', top: 76, right: 16, zIndex: 500, display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 320 }}>
          {subscriptionPrepAlerts.map((alert) => (
            <div
              key={alert.deliveryEntryId}
              style={{
                background: '#fff', border: '1.5px solid #10b981', borderRadius: 14,
                padding: '12px 14px', boxShadow: '0 8px 16px -4px rgba(0,0,0,0.12)',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
              }}
            >
              <div>
                <strong style={{ fontSize: 13, display: 'block' }}>📦 Delivery due soon</strong>
                <span style={{ fontSize: 12, color: 'var(--shg-text-muted)' }}>
                  {new Date(alert.deliveryDate).toLocaleString([], { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  onClick={() => setOpenPackAlert({ subscriptionId: alert.subscriptionId, deliveryEntryId: alert.deliveryEntryId })}
                  style={{ padding: '6px 10px', borderRadius: 10, border: 'none', background: '#10b981', color: '#fff', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}
                >
                  Prepare
                </button>
                <button
                  onClick={() => dismissSubscriptionPrepAlert(alert.deliveryEntryId)}
                  style={{ padding: '6px 10px', borderRadius: 10, border: '1px solid #e2e8f0', background: '#fff', color: 'var(--shg-text-muted)', fontSize: 12, cursor: 'pointer' }}
                >
                  ✕
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {openPackAlert && (
        <SubscriptionPackChecklist
          subscriptionId={openPackAlert.subscriptionId}
          deliveryEntryId={openPackAlert.deliveryEntryId}
          viewPath="shg-view"
          onPacked={(entryId) => {
            dismissSubscriptionPrepAlert(entryId);
            setOpenPackAlert(null);
            fetchShgSubscriptions();
          }}
          onClose={() => setOpenPackAlert(null)}
        />
      )}

      {/* Notifications Drawer */}
      {showNotifications && (
        <>
          <div className="shg-notif-overlay" onClick={() => setShowNotifications(false)} />
          <div className="shg-notif-drawer">
            <div className="shg-notif-header">
              <h3 className="shg-notif-title">Group Alerts & Updates</h3>
              <button className="shg-notif-close" onClick={() => setShowNotifications(false)}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>

            <div style={{ flex: 1, overflowY: 'auto' }}>
              <p style={{ padding: 16, fontSize: 12, color: 'var(--shg-text-muted)', textAlign: 'center' }}>
                No new notifications.
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default SHGDashboardPage;
