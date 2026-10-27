import React, { useState, useEffect } from 'react';
import { useUser } from '../context/UserContext';
import { normalizeProduct } from '../hooks/useProducts';
import { formatCurrency } from '../utils/helpers';

const WishlistPage = () => {
  const {
    wishlist,
    toggleWishlist,
    addToCart,
    setSelectedProduct,
    setActiveNav,
    refreshWishlist,
    getWishlistItems,
    wishlistLoading: loading,
  } = useUser();

  const [activeTab, setActiveTab] = useState('all'); // 'all' | 'quick' | 'shop-all'

  useEffect(() => {
    refreshWishlist();
  }, [refreshWishlist]);

  // Filter products matching the user's wishlist Set
  const savedProducts = getWishlistItems().map(item => ({ ...normalizeProduct(item), available: item.available }))
    .filter(p => wishlist.has(String(p.id)));

  const quickProducts = savedProducts.filter((p) => p.type === 'grocery');
  const shopAllProducts = savedProducts.filter((p) => p.type !== 'grocery');

  const displayedProducts = (() => {
    if (activeTab === 'quick') return quickProducts;
    if (activeTab === 'shop-all') return shopAllProducts;
    return savedProducts;
  })();

  const renderChannelTag = (type) => {
    if (type === 'grocery') {
      return (
        <span className="wishlist-channel-tag quick">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
          </svg>
          Quick
        </span>
      );
    }
    return (
      <span className="wishlist-channel-tag shop-all">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="9" cy="21" r="1" />
          <circle cx="20" cy="21" r="1" />
          <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
        </svg>
        Shop All
      </span>
    );
  };

  return (
    <div className="wishlist-page-container">
      {/* Top Header */}
      <div className="wishlist-header">
        <button
          className="wishlist-back-btn"
          onClick={() => setActiveNav('home')}
          aria-label="Back to Home"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="19" y1="12" x2="5" y2="12" />
            <polyline points="12 19 5 12 12 5" />
          </svg>
        </button>

        <div className="wishlist-header-title-block">
          <h2 className="wishlist-header-title">My Wishlist</h2>
          <span className="wishlist-header-count">{savedProducts.length} {savedProducts.length === 1 ? 'item' : 'items'}</span>
        </div>

        <div style={{ width: 36 }} />
      </div>

      {/* Filter Tabs (All | Quick | Shop All) */}
      <div className="wishlist-tabs-row">
        <button
          className={`wishlist-tab-btn ${activeTab === 'all' ? 'active' : ''}`}
          onClick={() => setActiveTab('all')}
        >
          All Items ({savedProducts.length})
        </button>
        <button
          className={`wishlist-tab-btn ${activeTab === 'quick' ? 'active' : ''}`}
          onClick={() => setActiveTab('quick')}
        >
          ⚡ Quick ({quickProducts.length})
        </button>
        <button
          className={`wishlist-tab-btn ${activeTab === 'shop-all' ? 'active' : ''}`}
          onClick={() => setActiveTab('shop-all')}
        >
          🛒 Shop All ({shopAllProducts.length})
        </button>
      </div>

      {/* Scrollable Content */}
      <div className="wishlist-content-scrollable">
        {loading ? (
          <div className="wishlist-loading-state">
            <div className="wishlist-spinner" />
            <span>Loading your saved items...</span>
          </div>
        ) : displayedProducts.length === 0 ? (
          <div className="wishlist-empty-state">
            <div className="wishlist-empty-icon-circle">
              <svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l8.78-8.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
              </svg>
            </div>

            <h3 className="wishlist-empty-title">
              {savedProducts.length === 0 ? 'Your Wishlist is Empty' : 'No items found in this section'}
            </h3>
            <p className="wishlist-empty-subtitle">
              {savedProducts.length === 0
                ? 'Explore items across Quick or Shop All and tap the heart icon to save your favorite products!'
                : 'Switch tabs or browse products to add items to your wishlist.'}
            </p>

            <button
              className="wishlist-explore-btn"
              onClick={() => setActiveNav('home')}
            >
              Explore Products
            </button>
          </div>
        ) : (
          <div className="wishlist-grid">
            {displayedProducts.map((product) => (
              <div
                key={product.id || product._id}
                className="wishlist-card"
                onClick={() => setSelectedProduct(product)}
              >
                {/* Image Container with Badges */}
                <div className="wishlist-card-img-wrapper">
                  {renderChannelTag(product.type)}

                  <button
                    className="wishlist-heart-btn active"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleWishlist(product.id || product._id);
                    }}
                    aria-label="Remove from wishlist"
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="#ef4444" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l8.78-8.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                    </svg>
                  </button>

                  <img
                    src={product.image || 'https://via.placeholder.com/150'}
                    alt={product.name}
                    className="wishlist-card-img"
                  />
                </div>

                {/* Card Details */}
                <div className="wishlist-card-details">
                  <span className="wishlist-card-seller">{product.sellerName || 'Verified Store'}</span>
                  <h4 className="wishlist-card-name">{product.name}</h4>

                  <div className="wishlist-card-price-row">
                    <span className="wishlist-card-price">
                      {formatCurrency(product.price)}
                    </span>
                    {product.mrp > product.price && (
                      <span className="wishlist-card-mrp">
                        {formatCurrency(product.mrp)}
                      </span>
                    )}
                  </div>

                  <button
                    className="wishlist-add-cart-btn"
                    disabled={product.available === false}
                    onClick={(e) => {
                      e.stopPropagation();
                      addToCart(product);
                    }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="12" y1="5" x2="12" y2="19" />
                      <line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                    {product.available === false ? 'Unavailable' : 'Add to Cart'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default WishlistPage;
