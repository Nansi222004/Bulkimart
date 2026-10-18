import React, { useMemo, useState } from 'react';
import { useUser } from '../context/UserContext';
import { useProducts } from '../hooks/useProducts';
import { useCategoryBranch, descendantIds } from '../hooks/useCategoryTree';
import { formatCurrency } from '../utils/helpers';
import WishlistHeartButton from './WishlistHeartButton';

/**
 * A header category's page, grouped into its Main (Level 2) sections.
 *
 * Opening "Dairy & Bakery" shows Dairy, Breads & Buns, Toast & Khari and so on
 * as vertical sections rather than one flat grid, and each section carries
 * everything filed beneath it — a product under Dairy › Milk appears in the
 * Dairy section.
 *
 * The page does not repeat the header category's own name since the tab above
 * is already showing it.
 */

/** How many products a section shows before "View All" (2 rows of 3 columns = 6 items). */
const PREVIEW_COUNT = 6;

/**
 * Limit for fetching branch products to allow in-memory grouping on client side.
 */
const BRANCH_FETCH_LIMIT = 200;

const ProductCard = ({ product, onOpen, onAdd }) => (
  <div
    className="grid-product-card"
    onClick={() => onOpen(product)}
    style={{
      backgroundColor: '#ffffff',
      border: '1px solid #e2e8f0',
      borderRadius: 12,
      padding: 6,
      cursor: 'pointer',
      display: 'flex',
      flexDirection: 'column',
      boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
    }}
  >
    <div
      className="grid-product-img-wrapper"
      style={{
        width: '100%',
        height: 85,
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        borderRadius: 8,
        backgroundColor: '#f8fafc',
      }}
    >
      <img
        src={product.image}
        alt={product.name}
        className="grid-product-img"
        style={{ width: '85%', height: '85%', objectFit: 'contain' }}
      />
      <WishlistHeartButton productId={product.id} size={11} style={{ position: 'absolute', top: 4, right: 4 }} />
    </div>
    <div className="grid-product-details" style={{ display: 'flex', flexDirection: 'column', marginTop: 6, textAlign: 'left', flex: 1 }}>
      <h4
        className="grid-product-name"
        style={{
          margin: 0,
          fontSize: 11,
          fontWeight: 700,
          color: '#1e293b',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          height: 28,
          lineHeight: '14px',
        }}
      >
        {product.name}
      </h4>
      {product.fulfillmentType === 'digital' && (
        <span style={{ alignSelf: 'flex-start', marginTop: 3, padding: '2px 6px', borderRadius: 999, background: '#e0f2fe', color: '#0369a1', fontSize: 8.5, fontWeight: 900 }}>
          DIGITAL E-BOOK
        </span>
      )}
      <span className="grid-product-shg" style={{ fontSize: 9.5, color: '#64748b', fontWeight: 600, marginTop: 2 }}>
        {product.shg || product.brandName || ''}
      </span>

      <div className="grid-product-footer" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'auto', paddingTop: 6 }}>
        <span className="grid-product-price" style={{ fontSize: 11.5, fontWeight: 800, color: '#0f172a' }}>
          {formatCurrency(product.price)}
        </span>
        <button
          className="grid-product-add-btn"
          onClick={(e) => {
            e.stopPropagation();
            onAdd(product);
          }}
          style={{
            backgroundColor: 'var(--primary, #08b9e8)',
            color: '#ffffff',
            border: 'none',
            borderRadius: 6,
            padding: '3px 8px',
            fontSize: 10,
            fontWeight: 800,
            cursor: 'pointer',
          }}
        >
          ADD
        </button>
      </div>
    </div>
  </div>
);

const ProductGrid = ({ products, onOpen, onAdd }) => (
  <div className="section-products-grid">
    {products.map((product) => (
      <ProductCard
        key={product.id || product._id}
        product={product}
        onOpen={onOpen}
        onAdd={onAdd}
      />
    ))}
  </div>
);

const DynamicCategorySection = ({ channel, slug }) => {
  const { addToCart, setSelectedProduct } = useUser();
  const {
    node: category,
    categoryParam,
    loading: categoryLoading,
    error: categoryError,
    retry: retryCategories,
  } = useCategoryBranch(channel, slug);

  const { products, loading } = useProducts({
    type: channel,
    category: categoryParam,
    limit: BRANCH_FETCH_LIMIT,
  });

  // Which sections the shopper has expanded, keyed by category id.
  const [expandedSections, setExpandedSections] = useState({});

  const level2Categories = category?.children || [];
  const isHeaderCategory = level2Categories.length > 0;

  /**
   * One section per Main category, each holding everything filed at or under
   * it. Empty sections are dropped.
   */
  const groupedSections = useMemo(() => {
    if (!isHeaderCategory || products.length === 0) return [];

    const claimed = new Set();

    const sections = level2Categories.map((l2Node) => {
      const l2Ids = new Set(descendantIds(l2Node).map(String));
      const sectionProducts = products.filter((p) => l2Ids.has(String(p.categoryId)));
      sectionProducts.forEach((p) => claimed.add(p.id || p._id));
      return { category: l2Node, products: sectionProducts };
    }).filter((section) => section.products.length > 0);

    const unclaimed = products.filter((p) => !claimed.has(p.id || p._id));
    if (unclaimed.length > 0) {
      sections.push({ category, products: unclaimed });
    }

    return sections;
  }, [isHeaderCategory, level2Categories, products, category]);

  const openProduct = (product) => setSelectedProduct(product);
  const addProduct = (product) => addToCart(product);

  if (categoryLoading) {
    return (
      <div style={{ padding: '40px 0', textAlign: 'center', color: '#64748b', fontSize: 13 }}>
        Loading category info...
      </div>
    );
  }

  if (categoryError) {
    return (
      <div className="category-load-state" role="alert">
        <strong>Categories could not be loaded.</strong>
        <span>{categoryError}</span>
        <button type="button" onClick={retryCategories}>Try again</button>
      </div>
    );
  }

  if (!category) {
    return (
      <div className="category-load-state" role="status">
        <strong>This category is unavailable.</strong>
        <span>Please choose another category from the menu.</span>
      </div>
    );
  }

  return (
    <div className="landing-section-container" style={{ padding: '0 12px 20px 12px', boxSizing: 'border-box' }}>
      {loading ? (
        <div style={{ padding: '40px 0', textAlign: 'center', color: '#64748b', fontSize: 13 }}>
          Loading products...
        </div>
      ) : products.length === 0 ? (
        <div style={{ marginTop: 20, padding: '40px 0', textAlign: 'center', color: '#94a3b8', fontSize: 13, backgroundColor: '#ffffff', borderRadius: 16, border: '1.5px dashed #e2e8f0' }}>
          No products listed here yet.
        </div>
      ) : isHeaderCategory ? (
        <div className="level2-sections-wrapper" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {groupedSections.map((section) => {
            const catId = section.category._id || section.category.id;
            const isExpanded = Boolean(expandedSections[catId]);
            const hasMore = section.products.length > PREVIEW_COUNT;
            const shown = isExpanded ? section.products : section.products.slice(0, PREVIEW_COUNT);

            return (
              <div key={catId} className="level2-section-block">
                <div className="section-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '16px 0 10px 0' }}>
                  <h3 className="section-title" style={{ margin: 0, fontSize: 15, fontWeight: 800, color: '#0f172a', fontFamily: "'Outfit', sans-serif" }}>
                    {section.category.name}
                  </h3>
                  {hasMore && (
                    <button
                      onClick={() => setExpandedSections((prev) => ({ ...prev, [catId]: !prev[catId] }))}
                      style={{ background: 'none', border: 'none', color: 'var(--primary, #08b9e8)', fontWeight: 700, fontSize: 12, cursor: 'pointer', padding: 0 }}
                    >
                      {isExpanded ? 'Show Less' : `View All (${section.products.length})`}
                    </button>
                  )}
                </div>

                <ProductGrid products={shown} onOpen={openProduct} onAdd={addProduct} />
              </div>
            );
          })}
        </div>
      ) : (
        /* A Main or Sub category selected directly — nothing to group by. */
        <div style={{ marginTop: 16 }}>
          <ProductGrid products={products} onOpen={openProduct} onAdd={addProduct} />
        </div>
      )}
    </div>
  );
};

export default DynamicCategorySection;
