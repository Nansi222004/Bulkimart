import React, { useState } from 'react';
import { useUser } from '../context/UserContext';
import { useCategoryTree } from '../hooks/useCategoryTree';
import { useNotifications } from '../../../utils/useNotifications';
import NotificationDrawer from './NotificationDrawer';
import bulkimartIcon from '../../../assets/logo-icon-transparent.png';

/**
 * A tab icon for a category the admin created after this file was written.
 *
 * Keyword matching, deliberately loose, and never the thing that decides where a
 * tap goes — that is always the category's own id. A wrong guess here costs a
 * slightly odd picture; the fallback is a plain grid, which is honest about
 * being a category rather than pretending to be something specific.
 */
const CATEGORY_ICON = (name = '') => {
  const n = name.toLowerCase();
  const svg = (children) => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{children}</svg>
  );

  if (/fruit|vegetab|fresh|grocer/.test(n)) {
    return svg(<><path d="M12 2a9 9 0 0 0-9 9c0 5 4 11 9 11s9-6 9-11a9 9 0 0 0-9-9z" /><path d="M12 2v6" /></>);
  }
  if (/dairy|milk|bakery/.test(n)) {
    return svg(<><path d="M8 2h8l1 5v13a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V7z" /><path d="M8 7h8" /></>);
  }
  if (/cloth|wear|fashion|garment|footwear/.test(n)) {
    return svg(<path d="M20.38 3.46L16 2.14a2 2 0 0 0-1.16 0L10.46 3.46A2 2 0 0 0 9 5.38V19a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2v-1.25M17 19.5h4v-12h-4v12z" />);
  }
  if (/electronic|appliance|solar|light/.test(n)) {
    return svg(<><rect x="2" y="3" width="20" height="14" rx="2" ry="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" /></>);
  }
  if (/beauty|personal|care|baby/.test(n)) {
    return svg(<><circle cx="12" cy="8" r="5" /><path d="M20 21a8 8 0 0 0-16 0" /></>);
  }
  if (/kitchen|dining|home|household|clean/.test(n)) {
    return svg(<><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" /></>);
  }
  if (/book|station|automotive|toy/.test(n)) {
    return svg(<><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></>);
  }
  return svg(<><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /></>);
};

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
  } = useUser();
  const cartCount = getCartCount();
  const wishlistCount = wishlist?.size || 0;
  const [showNotifications, setShowNotifications] = useState(false);
  const { unreadCount } = useNotifications({ autoFetch: false });

  // Sub-navigation tabs configuration for Quick mode (4 items)
  const subNavItems = [
    {
      id: 'grocery--home',
      label: 'My Home',
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
          <polyline points="9 22 9 12 15 12 15 22"></polyline>
        </svg>
      )
    },
    {
      id: 'groceries',
      label: 'Groceries',
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="11" width="18" height="10" rx="2" ry="2"></rect>
          <path d="M12 2L2 7l10 5 10-5-10-5z"></path>
          <path d="M6 21V11M18 21V11"></path>
        </svg>
      )
    },
    {
      id: 'electronics',
      label: 'Electronics',
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
          <line x1="8" y1="21" x2="16" y2="21"></line>
          <line x1="12" y1="17" x2="12" y2="21"></line>
        </svg>
      )
    },
    {
      id: 'coupons',
      label: 'Coupons',
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path>
        </svg>
      )
    },
    {
      id: 'garments',
      label: 'Fashion',
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20.38 3.46L16 2.14a2 2 0 0 0-1.16 0L10.46 3.46A2 2 0 0 0 9 5.38V19a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2v-1.25M17 19.5h4v-12h-4v12z"></path>
        </svg>
      )
    }
  ];

  // Sub-navigation tabs configuration for Shop All (E-commerce) mode (5 items)
  const shopAllSubNavItems = [
    {
      id: 'ecommerce--smart-buy',
      label: 'Smart Buy',
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10"></circle>
          <path d="M12 8l4 4-4 4M8 12h8"></path>
        </svg>
      )
    },
    {
      id: 'ecommerce--hot-deals',
      label: 'Hot Deals',
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"></path>
        </svg>
      )
    },
    {
      id: 'electronics',
      label: 'Electronics',
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
          <line x1="8" y1="21" x2="16" y2="21"></line>
          <line x1="12" y1="17" x2="12" y2="21"></line>
        </svg>
      )
    },
    {
      id: 'explore-all',
      label: 'Explore All',
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="7" height="7" rx="1"></rect>
          <rect x="14" y="3" width="7" height="7" rx="1"></rect>
          <rect x="14" y="14" width="7" height="7" rx="1"></rect>
          <rect x="3" y="14" width="7" height="7" rx="1"></rect>
        </svg>
      )
    },
    {
      id: 'fashion',
      label: 'Fashion',
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20.38 3.46L16 2.14a2 2 0 0 0-1.16 0L10.46 3.46A2 2 0 0 0 9 5.38V19a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2v-1.25M17 19.5h4v-12h-4v12z"></path>
        </svg>
      )
    }
  ];

  const staticSubNavItems = activeMode === 'shop-all' ? shopAllSubNavItems : subNavItems;

  /**
   * The header, half fixed and half whatever the shop decided.
   *
   * "My Home", "Smart Buy", "Hot Deals" and "Explore All" are application
   * sections — a saved-address feed, a promotions page, the full category
   * browser. They are not categories and never were, so they stay written down
   * here. Everything between them comes from the admin panel: any header
   * category with "show as a tab" ticked, in the order the admin sorted them.
   *
   * Nothing was reparented to make this work. The tabs read a flag; the
   * catalogue keeps the shape it already had.
   */
  const { tree: headerCategories } = useCategoryTree(activeMode === 'shop-all' ? 'ecommerce' : 'grocery');

  /**
   * Every header category the shop has configured for this storefront.
   *
   * Showing them all is the default on purpose. Requiring a tick meant a shop
   * that had carefully built eight Quick categories saw none of them until
   * somebody went back and ticked eight boxes — the app ignored the very
   * configuration it was supposed to be driven by.
   *
   * `showInNav` survives as an opt-in NARROWING: tick nothing and you get the
   * whole catalogue, tick some and you get exactly those. So the flag is a
   * curation tool for a shop with thirty-nine categories, not a switch that has
   * to be found before anything works at all.
   */
  const chosen = headerCategories.filter((c) => c.showInNav && !c.isSystem);
  const categoriesList = (chosen.length ? chosen : headerCategories).filter((c) => !c.isSystem);
  
  // Total of 4 icons + plus icon: since both modes contain 2 static items,
  // we display the first 2 dynamic categories to achieve exactly 4 icons.
  const slicedCategories = categoriesList.slice(0, 2);

  const navCategories = slicedCategories.map((c) => ({
    id: c.slug,
    label: c.name,
    categoryId: c._id,
    icon: c.icon
      ? <img src={c.icon} alt="" width="18" height="18" style={{ objectFit: 'contain' }} />
      : CATEGORY_ICON(c.name),
  }));

  const moreTabItem = {
    id: 'explore-more',
    label: '',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <line x1="12" y1="5" x2="12" y2="19"></line>
        <line x1="5" y1="12" x2="19" y2="12"></line>
      </svg>
    )
  };

  const currentSubNavItems = (() => {
    if (activeMode === 'shop-all') {
      const smartBuy = staticSubNavItems.find(i => i.id === 'ecommerce--smart-buy');
      const hotDeals = staticSubNavItems.find(i => i.id === 'ecommerce--hot-deals');
      
      const head = [];
      if (smartBuy) head.push(smartBuy);
      if (hotDeals) head.push(hotDeals);

      return [...head, ...navCategories, moreTabItem];
    } else {
      const home = staticSubNavItems.find(i => i.id === 'grocery--home');
      const coupons = staticSubNavItems.find(i => i.id === 'coupons');

      const head = home ? [home] : [];
      const tail = coupons ? [coupons] : [];

      return [...head, ...navCategories, ...tail, moreTabItem];
    }
  })();

  /**
   * The shop's own colours for this storefront's header, when it has chosen any.
   *
   * The first header that has actually been styled wins; the rest carry no
   * colours and are skipped. Everything falls back to `undefined`, which leaves
   * the existing stylesheet in charge.
   */
  // Category records can contain colours saved under the legacy theme. The
  // customer header is brand-owned, so catalogue metadata must not override
  // the centralized Bulkimart aqua/orange design tokens.
  const styledHeader = null;
  const headerStyle = undefined;

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
      <button type="button" className="search-bar-pill" onClick={() => setActiveNav('search')} aria-label="Open search">
        <span className="search-pill-icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </span>
        <span className="search-pill-input search-pill-placeholder">Search products and categories</span>
        <span
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
        </span>
      </button>
    </div>
  );

  return (
    <div className={`unified-header-container mode-${activeMode}`}>
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
              className="header-profile-silhouette-btn"
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

      <div className="header-body-content" style={headerStyle}>
        {renderSearch('header-search-row--mobile')}
        <div className="header-sub-nav-wrapper">
          <div className="header-sub-nav-scroll">
            {currentSubNavItems.map((item) => {
              const isActive = activeSubNav === item.id;
              const isMore = item.id === 'explore-more';
              return (
                <button
                  key={item.id}
                  className={`sub-nav-item-btn ${isActive ? 'active' : ''}`}
                  onClick={() => handleSubNavClick(item)}
                  style={{
                    ...(isMore ? { flex: '0 0 auto', width: '48px' } : {}),
                  }}
                >
                  <span className="sub-nav-icon" style={isMore ? { display: 'flex', alignItems: 'center', justifyContent: 'center', width: 24, height: 24, borderRadius: '50%', backgroundColor: 'rgba(255,255,255,0.18)', transition: 'background-color 0.2s', marginTop: 2 } : undefined}>
                    {item.icon}
                  </span>
                  {!isMore && <span className="sub-nav-label">{item.label}</span>}
                  {isActive && (
                    <span className="sub-nav-active-line" />
                  )}
                </button>
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
