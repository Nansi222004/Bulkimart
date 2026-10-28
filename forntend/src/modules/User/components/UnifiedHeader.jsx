import React, { useEffect, useRef, useState } from 'react';
import { House, MessageCircle, CircleArrowRight, Flame, LayoutGrid } from 'lucide-react';
import { useUser } from '../context/UserContext';
import { useNotifications } from '../../../utils/useNotifications';
import NotificationDrawer from './NotificationDrawer';
import { ImageSearchButton } from './ImageSearchSheet';
import HeaderCategories from './HeaderCategories';
import bulkimartIcon from '../../../assets/logo-icon-transparent.png';
import Celebration from './Celebration';
import { hasFestiveHeader } from './FestiveHeader';
import { useStorefront } from '../context/StorefrontContext';

const UnifiedHeader = () => {
  const {
    activeMode,
    setActiveMode,
    getCartCount,
    setActiveNav,
    activeSubNav,
    setActiveSubNav,
    location,
    setShowLocationModal,
    wishlist,
    openVoiceSearch,
    openImageSearch,
    activeNav,
  } = useUser();
  // The festive header (home feed only) hosts the page effect when it is shown;
  // otherwise this header does, clipped to its own box.
  const { effect, theme, now } = useStorefront() || {};
  const headerEffect = activeNav === 'home' && hasFestiveHeader(theme) ? null : effect;
  const cartCount = getCartCount();
  const wishlistCount = wishlist?.size || 0;
  const [showNotifications, setShowNotifications] = useState(false);
  const { unreadCount } = useNotifications({ autoFetch: false });

  // The header is sticky with a negative top equal to its brand and mode rows,
  // so those scroll away and the search bar and category tabs stay pinned.
  const headerRef = useRef(null);
  useEffect(() => {
    const header = headerRef.current;
    if (!header || typeof ResizeObserver === 'undefined') return;
    const rows = [...header.querySelectorAll(':scope > .header-primary-row, :scope > .header-switcher-bar')];
    const update = () => header.style.setProperty('--header-collapse', `${rows.reduce((sum, row) => sum + row.offsetHeight, 0)}px`);
    const observer = new ResizeObserver(update);
    rows.forEach(row => observer.observe(row)); update();
    return () => observer.disconnect();
  }, []);

  // Admin-selected category tabs share this row with application shortcuts.
  const currentSubNavItems = [
    ...(activeMode === 'shop-all'
      ? [{ id: 'ecommerce--smart-buy', label: 'Smart Buy', Icon: CircleArrowRight }, { id: 'ecommerce--hot-deals', label: 'Hot Deals', Icon: Flame }]
      : [{ id: 'grocery--home', label: 'My Home', Icon: House }, { id: 'coupons', label: 'Coupons', Icon: MessageCircle }]),
    { id: 'explore-more', label: 'All categories', Icon: LayoutGrid },
  ];

  const handleSubNavClick = (item) => {
    if (item.id === 'explore-all' || item.id === 'explore-more') {
      setActiveNav('categories');
    } else {
      setActiveSubNav(item.id);
    }
  };

  // Reset sub-nav to default when switching modes to avoid color bleed
  const handleModeSwitch = (newMode) => {
    setActiveMode(newMode);
    setActiveSubNav(newMode === 'quick' ? 'grocery--home' : 'ecommerce--smart-buy');
  };

  const renderSearch = (modifier) => (
    <div className={`header-search-row ${modifier}`}>
      <div className="search-bar-pill" onClick={() => setActiveNav('search')}>
        <span className="search-pill-icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </span>
        <button type="button" className="search-pill-input search-pill-placeholder" aria-label="Open search" onClick={event => { event.stopPropagation(); setActiveNav('search'); }}>Search products and categories</button>
        <ImageSearchButton className="search-image-control" onClick={event => { event.stopPropagation(); openImageSearch(); }} />
        <button type="button"
          className="search-voice-control"
          onClick={(event) => {
            event.stopPropagation();
            openVoiceSearch();
          }}
          title="Voice Search"
          aria-label="Start voice search"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" y1="19" x2="12" y2="23" />
            <line x1="8" y1="23" x2="16" y2="23" />
          </svg>
        </button>
      </div>
    </div>
  );

  return (
    <div ref={headerRef} className={`unified-header-container mode-${activeMode}`}>
      {headerEffect && <div className="header-celebration"><Celebration effect={headerEffect} now={now} /></div>}
      <div className="header-primary-row">
        <div className="header-brand-location">
          <div className="header-brand-identity" aria-label="Bulkimart — Sabse Smart Bulkimart">
            <img className="header-brand-icon" src={bulkimartIcon} alt="" />
            <span className="header-brand-copy">
              <span className="header-brand-name"><span>Bulk</span><span>imart</span></span>
              <span className="header-brand-tagline">Sabse Smart Bulkimart</span>
            </span>
          </div>
          <button className="header-address-block" onClick={() => setShowLocationModal(true)} type="button" aria-label={`Change delivery location. Current location: ${location || 'Select your location'}`}>
            <svg className="header-address-pin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z" />
              <circle cx="12" cy="10" r="2.5" />
            </svg>
            <span className="header-address-copy">
              <span className="address-label-text">DELIVER TO</span>
              <span className="address-bold-title">{location || 'Select your location'}</span>
            </span>
            <span className="address-dropdown-arrow" aria-hidden="true">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </span>
          </button>
        </div>

        {renderSearch('header-search-row--desktop')}

        <div className="header-customer-actions">
            <button
              className="header-profile-silhouette-btn"
              onClick={() => setActiveNav('wishlist')}
              aria-label="Wishlist"
            >
              <span className="profile-silhouette-circle">
                <svg width="20" height="20" viewBox="0 0 24 24" fill={wishlistCount > 0 ? '#ef4444' : 'none'} stroke={wishlistCount > 0 ? '#ef4444' : 'currentColor'} strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l8.78-8.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                </svg>
              </span>
              {wishlistCount > 0 && <span className="header-action-badge">{wishlistCount}</span>}
            </button>
            <button
              className="header-profile-silhouette-btn"
              onClick={() => setShowNotifications(true)}
              aria-label="Notifications"
            >
              <span className="profile-silhouette-circle">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                  <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                </svg>
              </span>
              {unreadCount > 0 && <span className="header-action-dot" />}
            </button>
            <button
              className="header-profile-silhouette-btn header-account-action"
              onClick={() => setActiveNav('account')}
              aria-label="Account"
            >
              <span className="profile-silhouette-circle">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
              </span>
            </button>
            <button className="header-profile-silhouette-btn header-cart-action" onClick={() => setActiveNav('cart')} aria-label={`Cart with ${cartCount} items`}>
              <span className="profile-silhouette-circle">
                <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="9" cy="20" r="1" /><circle cx="19" cy="20" r="1" />
                  <path d="M3 4h2l2.4 11.2a2 2 0 0 0 2 1.6h8.8a2 2 0 0 0 2-1.6L22 8H6" />
                </svg>
              </span>
              {cartCount > 0 && <span className="header-action-badge">{cartCount}</span>}
            </button>
        </div>
      </div>

      <div className="header-switcher-bar">
        <div className="unified-tab-switcher" role="group" aria-label="Storefront">
          <button className={`switcher-tab-btn quick ${activeMode === 'quick' ? 'active' : ''}`} onClick={() => handleModeSwitch('quick')}>
            <svg className="tab-lightning-icon" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
            </svg>
            Quick
          </button>
          <button className={`switcher-tab-btn shop-all ${activeMode === 'shop-all' ? 'active' : ''}`} onClick={() => handleModeSwitch('shop-all')}>
            ShopAll
          </button>
        </div>
      </div>

      <div className="header-body-content">
        {renderSearch('header-search-row--mobile')}
        <div className="header-sub-nav-wrapper">
          <div className="header-sub-nav-scroll">
            {currentSubNavItems.map((item, index) => {
              const isActive = activeSubNav === item.id;
              const isMore = item.id === 'explore-more';
              return (
                <React.Fragment key={item.id}><button
                  className={`sub-nav-item-btn ${isActive ? 'active' : ''}`}
                  onClick={() => handleSubNavClick(item)}
                  style={{
                    ...(isMore ? { flex: '0 1 110px' } : {}),
                  }}
                >
                  <span className="sub-nav-icon"><item.Icon size={18} strokeWidth={2} aria-hidden="true" /></span>
                  <span className="sub-nav-label">{item.label}</span>
                  {isActive && (
                    <span className="sub-nav-active-line" />
                  )}
                </button>{index === 0 && <HeaderCategories />}</React.Fragment>
              );
            })}
          </div>
        </div>
      </div>

      <NotificationDrawer isOpen={showNotifications} onClose={() => setShowNotifications(false)} />
    </div>
  );
};

export default UnifiedHeader;
