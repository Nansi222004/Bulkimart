import React, { useMemo, useState } from 'react';
import { useUser } from '../context/UserContext';
import { useProducts } from '../hooks/useProducts';
import { useCategoryBranch, descendantIds } from '../hooks/useCategoryTree';
import ProductCard from './CategoryProductCard';
import SponsoredCategoryBlock from '../../../components/advertising/SponsoredCategoryBlock';

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
    exists,
  } = useCategoryBranch(channel, slug);

  const { products, loading } = useProducts({
    type: channel,
    category: categoryParam,
    limit: BRANCH_FETCH_LIMIT,
    enabled: exists,
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
      <SponsoredCategoryBlock channel={channel} categoryId={category._id} organicProducts={products} ready={!loading} />
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
                      style={{ background: 'none', border: 'none', color: 'var(--primary, var(--sf-action, #D91430))', fontWeight: 700, fontSize: 12, cursor: 'pointer', padding: 0 }}
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
