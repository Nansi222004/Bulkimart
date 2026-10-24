import React, { useEffect } from 'react';
import { StorefrontProvider, useStorefront } from '../context/StorefrontContext';
import { themeStyle, resolveTokens } from '../../../utils/storefront';
import PromotionalSplash from '../components/PromotionalSplash';
import StorefrontSections, { StorefrontAnnouncement } from '../components/StorefrontSections';
import '../Storefront.css';
import CustomerServices, { HomeServiceEntries } from '../../../components/services/CustomerServices';
import LegalServices from '../../../components/services/LegalServices';
import { ParcelCustomerEntry } from '../../../components/parcels/ParcelDelivery';
import { readProductRoute, rememberWholesaleReturn } from '../utils/productRoute';
import RealtimeNotice from '../../../components/RealtimeNotice';
import { UserProvider, useUser } from '../context/UserContext';
import '../User.css';
import UnifiedHeader from '../components/UnifiedHeader';
import HeroBanner from '../components/HeroBanner';
import DynamicCategorySection from '../components/DynamicCategorySection';
import QuickActions from '../components/QuickActions';
import PopularCategories from '../components/PopularCategories';
import TopProducts from '../components/TopProducts';
import BottomNav from '../components/BottomNav';
import CategoriesPage from './CategoriesPage';
import WishlistPage from './WishlistPage';
import OrdersPage from './OrdersPage';
import ProfilePage from './ProfilePage';
import ProductDetailPage from './ProductDetailPage';
import CartPage from './CartPage';
import CheckoutPage from './CheckoutPage';
import OrderTrackingPage from './OrderTrackingPage';
import CampaignLandingPage from './CampaignLandingPage';
import SearchPage from './SearchPage';
import WholesalePage from './WholesalePage';
import WriteReviewPage from './WriteReviewPage';
import DigitalLibraryPage from './DigitalLibraryPage';
import VegetablesSection from '../components/VegetablesSection';
import MilkSection from '../components/MilkSection';
import ElectronicsSection from '../components/ElectronicsSection';
import MensWearSection from '../components/MensWearSection';
import WomenWearSection from '../components/WomenWearSection';
import ChildWearSection from '../components/ChildWearSection';
import CouponsSection from '../components/CouponsSection';
import AuthPage from './AuthPage';
import VoiceSearchModal from '../components/VoiceSearchModal';
import FashionSection from '../components/FashionSection';
import GroceriesSection from '../components/GroceriesSection';
import LocationPromptModal from '../components/LocationPromptModal';
import NotificationPopup from '../../../components/NotificationPopup';

/** Same allowlist NotificationDrawer.jsx's own resolveNav uses — an
 * unrecognised deep link falls back to doing nothing rather than a dead tab. */
const resolvePopupNav = (route) => {
  if (!route) return null;
  if (route.startsWith('/orders')) return 'orders';
  return null;
};

/**
 * Which body belongs under the tab that is open.
 *
 * A hand-written section wins when one exists for this subject: they know their
 * own layout, and Coupons is not a product grid at all. Everything else is a
 * category the shop added after these components were written, and is rendered
 * generically by id.
 *
 * Matched on the SLUG, which carries the channel and the path, so a grocery tab
 * can never fall through to a Shop All body.
 */
const isSlug = (subNav) => /^(grocery|ecommerce|shg)--/.test(subNav || '');

export const LandingPageContent = () => {
  const experience = useStorefront();
  const {
    activeNav,
    activeMode,
    selectedProduct,
    productDetailLoading, productDetailError, retryProductDetail, setSelectedProduct,
    currentUser, logoutUser,
    activeSubNav,
    getCartCount,
    getCartSubtotal,
    setActiveNav,
    selectedOrder,
    selectedCampaignId,
    reviewProductId,
    setReviewProductId,
    isVoiceModalOpen,
    closeVoiceSearch,
    setPendingVoiceQuery,
  } = useUser();

  const cartCount = getCartCount();
  // Delivery is only decided (and added) on the Fulfillment Checkout page —
  // this bar shows the items subtotal so nothing is charged upfront.
  const cartTotal = getCartSubtotal();
  const productLinkPending = !selectedProduct && (productDetailLoading || productDetailError);
  const productRoute = readProductRoute();
  useEffect(() => {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      meta.setAttribute('content', resolveTokens(experience.theme.tokens).header);
    }
  }, [experience.theme.tokens]);
  useEffect(()=>{
    if(!currentUser && productRoute.present && productRoute.mode==='wholesale')rememberWholesaleReturn(productRoute.id,productRoute.variant);
  },[currentUser,productRoute.id,productRoute.variant,productRoute.mode]);

  // The storefront is public: opening `/` should always show the home feed.
  // Authentication is requested only when a shopper enters an account-only
  // area. Keeping this guard outside the page shell also preserves the existing
  // full-screen authentication layout on those protected routes.
  const protectedNavItems = new Set([
    'account',
    'checkout',
    'orders',
    'ebooks',
    'wishlist',
  ]);

  if (!currentUser && protectedNavItems.has(activeNav)) {
    return <div className="sf-storefront" style={themeStyle(experience.theme.tokens)}><AuthPage /></div>;
  }

  const renderContent = () => {
    switch (activeNav) {
      case 'home':
        return (
          <>
            {/* Dynamic Unified Header at the top of the home feed */}
            <UnifiedHeader />

            {/* Scrollable contents below the header */}
            <div className="home-feed-scrollable">
              <StorefrontAnnouncement />
              {/* Hero Promo Carousel Banner (shown on all pages if banners exist) */}
              <HeroBanner />

              {/* Only show home feed dashboard if we are in Shop All mode or in Quick mode's Home tab */}
              {(activeMode === 'shop-all' || activeSubNav === 'grocery--home') && (
                <>
                  {/* Customer discovery shortcuts */}
                  <QuickActions />
                  <HomeServiceEntries />

                  {/* Popular circular categories */}
                  <PopularCategories />

                  {/* Top Products section (unified) */}
                  {experience.sections.length ? <StorefrontSections /> : <TopProducts />}
                </>
              )}

              {/*
                Each storefront sells its own catalogue.

                Both branches used to render the same seven sections, so Quick
                showed shirts and televisions while Shop All showed loose
                vegetables and milk. Nothing broke — add-to-cart routes every
                item to the basket its own channel owns — but a customer in a
                30-minute grocery app was being offered parcels that take days,
                and vice versa.

                Quick home is groceries. Shop All is the e-commerce catalogue,
                and now honours its own sub-nav instead of ignoring it.
              */}
              {(() => {
                const homeTab = ['home', 'grocery--home', 'smart-buy', 'ecommerce--smart-buy'].includes(activeSubNav);
                if (homeTab && experience.sections.length) return null;
                const isGroceriesTab = activeSubNav === 'groceries' || String(activeSubNav || '').endsWith('--groceries');
                const isElectronicsTab = activeSubNav === 'electronics' || String(activeSubNav || '').endsWith('--electronics');
                const isCouponsTab = activeSubNav === 'coupons' || String(activeSubNav || '').endsWith('--coupons') || activeSubNav === 'hot-deals' || String(activeSubNav || '').endsWith('--hot-deals');
                const isFashionTab = activeSubNav === 'garments' || activeSubNav === 'fashion' || String(activeSubNav || '').endsWith('--garments') || String(activeSubNav || '').endsWith('--fashion') || String(activeSubNav || '').endsWith('--clothing-and-handlooms');

                if (activeMode === 'quick') {
                  if (activeSubNav === 'grocery--home') {
                    return (
                      <>
                        <VegetablesSection />
                        <MilkSection />
                      </>
                    );
                  }
                  if (isGroceriesTab) return <GroceriesSection />;
                  if (isElectronicsTab) return <ElectronicsSection />;
                  if (isCouponsTab) return <CouponsSection />;
                  if (isFashionTab) return <FashionSection />;
                  if (isSlug(activeSubNav)) {
                    return <DynamicCategorySection channel="grocery" slug={activeSubNav} />;
                  }
                  return null;
                } else {
                  if (isCouponsTab) return <CouponsSection />;
                  if (isFashionTab) {
                    return (
                      <>
                        <MensWearSection />
                        <WomenWearSection />
                        <ChildWearSection />
                      </>
                    );
                  }
                  if (activeSubNav === 'ecommerce--smart-buy') {
                    return (
                      <>
                        <ElectronicsSection />
                        <MensWearSection />
                        <WomenWearSection />
                        <ChildWearSection />
                      </>
                    );
                  }
                  if (isSlug(activeSubNav)) {
                    if (isElectronicsTab) return <ElectronicsSection />;
                    return <DynamicCategorySection channel="ecommerce" slug={activeSubNav} />;
                  }
                  // Default shop-all home feed fallback
                  return (
                    <>
                      <ElectronicsSection />
                      <MensWearSection />
                      <WomenWearSection />
                      <ChildWearSection />
                    </>
                  );
                }
              })()}
            </div>
          </>
        );
      case 'search':
        return <SearchPage />;
      case 'services':
        return <><UnifiedHeader /><CustomerServices /></>;
      case 'legal-services':
        return <><UnifiedHeader /><LegalServices /></>;
      case 'parcel-delivery':
        return <><UnifiedHeader /><ParcelCustomerEntry /></>;
      case 'categories':
        return <CategoriesPage />;
      case 'orders':
        return <OrdersPage />;
      case 'ebooks':
        return <DigitalLibraryPage />;
      case 'account':
        return <ProfilePage />;
      case 'wishlist':
        return <WishlistPage />;
      case 'cart':
        return <CartPage />;
      case 'checkout':
        return <CheckoutPage />;
      case 'wholesale':
        return <WholesalePage />;
      default:
        return null;
    }
  };

  return (
    <div className={`user-landing-page-container sf-storefront mode-${activeMode} subnav-${activeSubNav}`} data-shopping-mode={activeMode} style={themeStyle(experience.theme.tokens)} data-decoration={experience.theme.tokens.decoration} data-motion={experience.theme.tokens.motion} data-category={experience.theme.tokens.category} data-product={experience.theme.tokens.product}>
      {currentUser && <RealtimeNotice />}
      {/* Scrollable Main Area */}
      <main className={`user-main-content page-${activeNav}`}>
        {productLinkPending ? <>
          <UnifiedHeader />
          <section className="pd-product-link-state" role={productDetailError ? 'alert' : 'status'} aria-live="polite">
            <p>{productDetailError || 'Loading product…'}</p>
            {productDetailError && <button type="button" onClick={retryProductDetail}>Retry product</button>}
            {productDetailError && /sign in|expired|session/i.test(productDetailError) && <button type="button" onClick={()=>{rememberWholesaleReturn(productRoute.id,productRoute.variant);if(currentUser)logoutUser?.();setSelectedProduct(null);setActiveNav('account');}}>Sign in to view Wholesale product</button>}
            <button type="button" onClick={() => setSelectedProduct(null)}>Back to storefront</button>
          </section>
        </> : renderContent()}
      </main>

      {/* Floating Bottom Cart Bar */}
      {cartCount > 0 && (activeNav === 'home' || activeNav === 'categories') && (
        <div
          className="floating-cart-bar"
          onClick={() => setActiveNav('cart')}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 18 }}>🛒</span>
            <div style={{ textAlign: 'left' }}>
              <span style={{ fontWeight: 800, fontSize: 13, display: 'block' }}>{cartCount} {cartCount === 1 ? 'item' : 'items'} in cart</span>
              <span style={{ fontSize: 11, opacity: 0.9 }}>From local collectives & shops</span>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 800, fontSize: 13 }}>
            <span>View Cart • ₹{cartTotal}</span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
          </div>
        </div>
      )}

      {/* Fixed Bottom Nav Bar */}
      <BottomNav />

      {/* Product Detail Page overlay — slides over everything when a product is selected */}
      {selectedProduct && (
        <div className="product-detail-overlay">
          <ProductDetailPage key={`${selectedProduct.id}:${selectedProduct.detailSource || 'retail'}`} />
        </div>
      )}

      {/* Order Tracking Page overlay — slides over everything when an order is selected */}
      {selectedOrder && (
        <div className="product-detail-overlay">
          <OrderTrackingPage />
        </div>
      )}

      {/* Campaign landing overlay — where a Campaign banner click lands */}
      {selectedCampaignId && (
        <div className="product-detail-overlay">
          <CampaignLandingPage />
        </div>
      )}

      {/* Write Review Page overlay — opens inside mobile phone container at /review/:productId */}
      {reviewProductId && (
        <div className="product-detail-overlay">
          <WriteReviewPage
            productId={reviewProductId}
            onBack={() => setReviewProductId(null)}
          />
        </div>
      )}
      {/* Global Voice Search Modal */}
      <VoiceSearchModal
        isOpen={isVoiceModalOpen}
        onClose={closeVoiceSearch}
        onSearch={(queryText) => {
          if (queryText && queryText.trim()) {
            setPendingVoiceQuery(queryText.trim());
            setActiveNav('search');
          }
        }}
      />

      {/* Location Access & Selection Modal */}
      <LocationPromptModal />
    </div>
  );
};


const LandingPage = () => {
  return (
    <UserProvider>
      <StorefrontProvider><PromotionalSplash><LandingPageContent /></PromotionalSplash></StorefrontProvider>
    </UserProvider>
  );
};

export default LandingPage;
