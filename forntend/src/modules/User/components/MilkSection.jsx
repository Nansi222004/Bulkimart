import React from 'react';
import { useUser } from '../context/UserContext';
import { useProducts } from '../hooks/useProducts';
import { useCategoryBranch } from '../hooks/useCategoryTree';
import { formatCurrency } from '../utils/helpers';
import WishlistHeartButton from './WishlistHeartButton';

const MilkSection = () => {
  const { addToCart, setSelectedProduct, setSelectedCategoryFilter } = useUser();

  /**
   * Which slice of the catalogue this section shows.
   *
   * The slug is the admin's own identifier for the category, so renaming the
   * category in the admin panel does not silently empty this section, and no
   * display name is ever compared. Products are filed against leaf categories,
   * so the hook expands this to every category beneath it.
   *
   * If the category is missing, `categoryParam` is undefined and the section
   * falls back to the channel's newest products — the behaviour it had before.
   */
  const { node, categoryParam, loading: categoryLoading, error: categoryError, retry: retryCategories } = useCategoryBranch('grocery', 'grocery--dairy-and-bakery--dairy--milk');
  const { products, loading, error, retry } = useProducts({ type: 'grocery', category: categoryParam, limit: 6 });

  return (
    <div className="landing-section-container">
      <div className="section-header">
        <h3 className="section-title">Milk & Dairy</h3>
        <button className="view-all-link" onClick={() => setSelectedCategoryFilter(node)}>View All</button>
      </div>

      {(categoryError || error) && (
        <div className="inline-section-state" role="alert">
          <span>{categoryError ? 'Category information is unavailable.' : 'Products could not be loaded.'}</span>
          <button type="button" onClick={categoryError ? retryCategories : retry}>Retry</button>
        </div>
      )}

      {!categoryLoading && !loading && !categoryError && !error && products.length === 0 && (
        <div className="product-empty-state">
          No products listed here yet.
        </div>
      )}

      {!categoryError && !error && <div className="section-products-grid">
        {products.map((product) => (
          <div
            key={product.id}
            className="grid-product-card"
            onClick={() => setSelectedProduct(product)}
          >
            <div className="grid-product-img-wrapper" style={{ position: 'relative' }}>
              <img
                src={product.image}
                alt={product.name}
                className="grid-product-img"
              />
              <WishlistHeartButton productId={product.id} size={13} style={{ position: 'absolute', top: 4, right: 4 }} />
            </div>
            <div className="grid-product-details">
              <h4 className="grid-product-name">{product.name}</h4>
              <span className="grid-product-shg">{product.shg}</span>
              
              <div className="grid-product-footer">
                <span className="grid-product-price">
                  {formatCurrency(product.price)}
                </span>
                <button
                  className="grid-product-add-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    addToCart(product);
                  }}
                  aria-label={`Add ${product.name} to cart`}
                >
                  Add
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>}
    </div>
  );
};

export default MilkSection;
