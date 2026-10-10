import React, { useState } from 'react';
import { useUser } from '../context/UserContext';
import { useProducts } from '../hooks/useProducts';
import { formatCurrency } from '../utils/helpers';
import WishlistHeartButton from './WishlistHeartButton';

const TopProducts = () => {
  const { addToCart, setSelectedProduct, setActiveNav, activeMode } = useUser();
  const [addedProductId, setAddedProductId] = useState(null);
  const [cartError, setCartError] = useState('');
  const { products, loading, error, retry } = useProducts({
    type: activeMode === 'quick' ? 'grocery' : 'ecommerce',
    limit: 8
  });

  const handleAddToCart = async (event, product) => {
    event.stopPropagation();
    setCartError('');

    const result = await addToCart(product.id);
    if (result?.ok) {
      setAddedProductId(product.id);
      window.setTimeout(() => {
        setAddedProductId((current) => current === product.id ? null : current);
      }, 1200);
      return;
    }

    if (/sign in/i.test(result?.message || '')) {
      setActiveNav('account');
      return;
    }

    setCartError(result?.message || 'Could not add this item to your cart. Please try again.');
  };

  return (
    <div className="top-products-container">
      <div className="section-header">
        <h3 className="section-title">Top Products</h3>
        <button className="view-all-link">View All</button>
      </div>
      {cartError && <p className="cart-action-feedback" role="status">{cartError}</p>}

      {/* Products Horizontal Scroll list */}
      <div className="products-scroll-wrapper">
        {loading ? (
          <div style={{ padding: '28px 12px', textAlign: 'center', color: '#94a3b8', fontSize: 12, width: '100%' }}>
            Loading products...
          </div>
        ) : error ? (
          <div className="inline-section-state" role="alert">
            <span>Products could not be loaded.</span>
            <button type="button" onClick={retry}>Retry</button>
          </div>
        ) : products.length === 0 ? (
          <div className="product-empty-state">
            No top products available.
          </div>
        ) : (
          products.map((product) => (
            <div
              key={product.id}
              className="product-card"
              style={{ cursor: 'pointer' }}
              onClick={() => setSelectedProduct(product)}
            >
              <div className="product-image-container" style={{ position: 'relative' }}>
                <img
                  src={product.image || 'https://images.unsplash.com/photo-1542838132-92c53300491e?w=500&q=80'}
                  alt={product.name}
                  className="product-image"
                  onError={(e) => {
                    e.target.onerror = null;
                    e.target.src = 'https://images.unsplash.com/photo-1542838132-92c53300491e?w=500&q=80';
                  }}
                />
                <WishlistHeartButton productId={product.id} size={14} style={{ position: 'absolute', top: 6, right: 6 }} />
              </div>
              <div className="product-details">
                <h4 className="product-name">{product.name}</h4>
                <span className="product-seller">{product.shg}</span>
                
                <div className="product-rating">
                  <span className="star-icon">★</span>
                  <span className="rating-value">{product.rating || '5.0'}</span>
                </div>

                <div className="product-card-footer">
                  <span className="product-price">
                    {formatCurrency(product.price)}
                  </span>
                  <button
                    className="add-to-cart-btn"
                    type="button"
                    onClick={(event) => handleAddToCart(event, product)}
                    aria-label={addedProductId === product.id ? `${product.name} added to cart` : `Add ${product.name} to cart`}
                    title={addedProductId === product.id ? 'Added to cart' : 'Add to cart'}
                  >
                    {addedProductId === product.id ? (
                      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    ) : (
                      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <line x1="12" y1="5" x2="12" y2="19" />
                        <line x1="5" y1="12" x2="19" y2="12" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default TopProducts;
