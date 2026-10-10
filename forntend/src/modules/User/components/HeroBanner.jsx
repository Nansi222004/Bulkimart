import React, { useState, useEffect } from 'react';
import { useUser } from '../context/UserContext';
import { apiUrl } from '../../../utils/api';

const HeroBanner = () => {
  const { activeMode, activeSubNav, setActiveNav, setActiveSubNav, setSelectedCategoryFilter, setSelectedProduct, setSelectedCampaignId, setSelectedPromotionId } = useUser();
  const [banners, setBanners] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeSlide, setActiveSlide] = useState(0);
  const [isHovered, setIsHovered] = useState(false);
  const [failedImages, setFailedImages] = useState(() => new Set());
  const [error, setError] = useState('');
  const [retryToken, setRetryToken] = useState(0);
  const [isMobile, setIsMobile] = useState(() => window.matchMedia('(max-width: 600px)').matches);

  // Touch swipe support
  const [touchStart, setTouchStart] = useState(null);
  const [touchEnd, setTouchEnd] = useState(null);
  const minSwipeDistance = 50;

  useEffect(() => {
    const media = window.matchMedia('(max-width: 600px)');
    const updateViewport = (event) => setIsMobile(event.matches);
    media.addEventListener('change', updateViewport);
    return () => media.removeEventListener('change', updateViewport);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const fetchActiveBanners = async () => {
      setLoading(true);
      setError('');
      try {
        const params = new URLSearchParams({ type: activeMode });
        // The root Home carousel is the storefront-wide HOME_HERO placement.
        // A category parameter there incorrectly hides banners assigned through
        // the admin to another customer-visible sub-nav tab. Once a shopper is
        // actually browsing a category tab, keep the existing scoped query.
        const storefrontHomeTabs = new Set(['home', 'grocery--home', 'smart-buy', 'ecommerce--smart-buy']);
        if (activeSubNav && !storefrontHomeTabs.has(activeSubNav)) {
          params.set('category', activeSubNav);
        }
        const res = await fetch(apiUrl(`/api/banners?${params.toString()}`));
        if (!res.ok) throw new Error(`Banners unavailable (${res.status})`);
        const data = await res.json();
        if (cancelled) return;
        if (!Array.isArray(data)) {
          throw new Error('Banner service returned an unexpected response');
        }
        setBanners(data);
        setFailedImages(new Set());
        setActiveSlide(0);
      } catch (err) {
        if (cancelled) return;
        console.error("Error fetching banners:", err);
        setBanners([]);
        setError(err.message || 'Could not load banners');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    
    fetchActiveBanners();
    return () => { cancelled = true; };
  }, [activeMode, activeSubNav, retryToken]);

  const activeBanners = banners.filter((banner) => {
    const searchable = `${banner.title || ''} ${banner.subtitle || ''} ${banner.targetRoute || ''}`.toLowerCase();
    return !searchable.includes('subscription') && !searchable.includes('premium membership');
  });

  // Auto-advance slides (Flipkart style horizontal sliding)
  useEffect(() => {
    if (activeBanners.length <= 1 || isHovered) return;
    const interval = setInterval(() => {
      setActiveSlide(prev => (prev + 1) % activeBanners.length);
    }, 3800);
    return () => clearInterval(interval);
  }, [activeBanners.length, isHovered]);

  if (loading) {
    return <div className="hero-banner-status hero-banner-status--loading" aria-label="Loading promotions" />;
  }

  if (error) {
    return (
      <div className="hero-banner-status" role="alert">
        <span>Promotions could not be loaded.</span>
        <button type="button" onClick={() => setRetryToken((value) => value + 1)}>Retry</button>
      </div>
    );
  }

  if (activeBanners.length === 0) {
    return <div className="hero-banner-status hero-banner-status--empty">New offers will appear here.</div>;
  }

  const safeSlideIndex = activeBanners.length > 0 ? activeSlide % activeBanners.length : 0;

  const handleBannerClick = (bannerToHandle) => {
    if (!bannerToHandle) return;

    // Track click on backend
    if (bannerToHandle._id && bannerToHandle._id !== 'default-shg') {
      fetch(apiUrl(`/api/banners/${bannerToHandle._id}/click`), { method: 'POST' }).catch(() => {});
    }

    if (bannerToHandle.actionType === 'CATEGORY' && bannerToHandle.targetCategory) {
      setSelectedCategoryFilter({ slug: bannerToHandle.targetCategory.slug, name: bannerToHandle.targetCategory.name });
      return;
    }
    if (bannerToHandle.actionType === 'PRODUCT' && bannerToHandle.targetProduct) {
      const p = bannerToHandle.targetProduct;
      setSelectedProduct({
        id: p._id, _id: p._id, name: p.name,
        image: p.images?.[0] || '', images: p.images || [],
        price: p.price, mrp: p.mrp, discountPercent: p.discountPercent,
        stock: p.stock, type: p.type,
      });
      return;
    }
    if (bannerToHandle.actionType === 'CAMPAIGN' && bannerToHandle.targetCampaign) {
      setSelectedCampaignId(bannerToHandle.targetCampaign._id || bannerToHandle.targetCampaign);
      return;
    }
    if (bannerToHandle.actionType === 'SELLER_PROMOTION' && bannerToHandle.targetPromotion) {
      setSelectedPromotionId(bannerToHandle.targetPromotion._id || bannerToHandle.targetPromotion);
      return;
    }
    if (bannerToHandle.actionType === 'EXTERNAL_URL' && bannerToHandle.externalUrl) {
      window.open(bannerToHandle.externalUrl, '_blank', 'noopener,noreferrer');
      return;
    }
    if (bannerToHandle.actionType === 'NONE') return;

    if (!bannerToHandle.targetRoute) return;
    const route = bannerToHandle.targetRoute;

    if (route.startsWith('http://') || route.startsWith('https://')) {
      window.open(route, '_blank');
      return;
    }

    if (['/shg-stores', '/nhc-stores', '/nsg-stores'].includes(route)) {
      setActiveNav('home');
    } else if (route === '/cart') {
      setActiveNav('cart');
    } else if (route === '/categories') {
      setActiveNav('categories');
    } else if (route === '/account') {
      setActiveNav('account');
    } else if (route === '/orders') {
      setActiveNav('orders');
    } else if (route === '/grocery') {
      setActiveNav('home');
      setActiveSubNav('groceries');
    } else if (route === '/electronics') {
      setActiveNav('home');
      setActiveSubNav('electronics');
    } else if (route === '/fashion' || route === '/garments') {
      setActiveNav('home');
      setActiveSubNav('fashion');
    } else {
      const cleanPath = route.replace(/^\//, '');
      if (cleanPath) {
        setActiveNav(cleanPath);
      }
    }
  };

  const onTouchStart = (e) => {
    setTouchEnd(null);
    setTouchStart(e.targetTouches[0].clientX);
  };

  const onTouchMove = (e) => {
    setTouchEnd(e.targetTouches[0].clientX);
  };

  const onTouchEnd = () => {
    if (!touchStart || !touchEnd) return;
    const distance = touchStart - touchEnd;
    const isLeftSwipe = distance > minSwipeDistance;
    const isRightSwipe = distance < -minSwipeDistance;

    if (isLeftSwipe) {
      setActiveSlide(prev => (prev + 1) % activeBanners.length);
    } else if (isRightSwipe) {
      setActiveSlide(prev => (prev - 1 + activeBanners.length) % activeBanners.length);
    }
  };

  return (
    <div className="hero-banner-container">
      <div 
        className="hero-banner-card"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        <div 
          className="hero-banner-track"
          style={{ transform: `translateX(-${safeSlideIndex * 100}%)` }}
        >
          {activeBanners.map((b, idx) => {
            const isClickable = (b.actionType && b.actionType !== 'NONE') || b.targetRoute;
            // Current Banner records expose `image`. Optional aliases are read
            // defensively so responsive variants can be adopted without
            // breaking existing CMS records or changing the API contract.
            const desktopImage = b.desktopImage || b.imageDesktop || b.image;
            const mobileImage = b.mobileImage || b.imageMobile || desktopImage;
            const image = isMobile ? mobileImage : desktopImage;
            return (
              <div 
                key={b._id || idx}
                className="hero-banner-slide"
                style={{ cursor: isClickable ? 'pointer' : 'default' }}
                onClick={() => handleBannerClick(b)}
              >
                {failedImages.has(b._id || idx) ? (
                  <div className="hero-banner-fallback" role="img" aria-label={`${b.title || 'Promotional banner'} image unavailable`}>
                    {b.title || 'Bulkimart offer'}
                  </div>
                ) : (
                  <img
                    src={image}
                    alt={b.title || 'Bulkimart promotional banner'}
                    className="hero-banner-image"
                    loading={idx === 0 ? 'eager' : 'lazy'}
                    decoding="async"
                    onError={() => setFailedImages((current) => new Set(current).add(b._id || idx))}
                  />
                )}

                {(b.actionType === 'SELLER_PROMOTION' || b.targetPromotion) && (
                  <div className="hero-banner-sponsored-badge">
                    <span className="sponsored-dot"></span> Promoted
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {activeBanners.length > 1 && (
          <div className="hero-carousel-indicators" onClick={(e) => e.stopPropagation()}>
            {activeBanners.map((_, idx) => (
              <span 
                key={idx} 
                className={`dot ${idx === safeSlideIndex ? 'active' : ''}`}
                onClick={() => setActiveSlide(idx)}
              ></span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default HeroBanner;
