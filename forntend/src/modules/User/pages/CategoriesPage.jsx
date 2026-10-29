import CategoryArtwork from '../components/CategoryArtwork';
import React, { useEffect, useMemo, useState } from 'react';
import { useUser } from '../context/UserContext';
import { descendantIds, useCategoryTree } from '../hooks/useCategoryTree';
import { useProducts } from '../hooks/useProducts';
import { formatCurrency } from '../utils/helpers';
import WishlistHeartButton from '../components/WishlistHeartButton';
import SponsoredCategoryBlock from '../../../components/advertising/SponsoredCategoryBlock';

const customerRoots = (tree) => (tree || []).flatMap((category) => {
  if (!category.isSystem) return [category];
  return category.children || [];
});

const branchMatches = (category, query) => {
  if (!query) return true;
  if (String(category.name || '').toLowerCase().includes(query)) return true;
  return (category.children || []).some((child) => branchMatches(child, query));
};

// Parent of a category inside the tree, for the category page's back step and eyebrow.
const parentOf = (nodes, id, parent = null) => {
  for (const category of nodes || []) {
    if (category._id === id) return parent;
    const found = parentOf(category.children, id, category);
    if (found !== undefined) return found;
  }
  return undefined;
};

const CategoriesPage = () => {
  const { activeMode, setActiveMode, addToCart, setSelectedProduct, selectedCategoryFilter, setSelectedCategoryFilter } = useUser();
  const channel = activeMode === 'shop-all' ? 'ecommerce' : 'grocery';
  const { tree, loading, error, retry } = useCategoryTree(channel);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(null);
  // Products shown in the Sponsored row above; the list below leaves them out so none appears twice.
  const [sponsoredIds, setSponsoredIds] = useState([]);
  const categoryIds = selected ? descendantIds(selected).join(',') : null;
  const { products, loading: productsLoading, error: productsError, retry: retryProducts } = useProducts({
    type: channel, category: categoryIds, limit: 60, enabled: selected?.type === channel && !loading,
  });

  const roots = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return customerRoots(tree).filter((category) => branchMatches(category, needle));
  }, [tree, query]);

  useEffect(() => {
    setSelected(null);
  }, [channel]);

  useEffect(() => {
    const slug = selectedCategoryFilter?.slug || selectedCategoryFilter?._id;
    const find = nodes => { for (const category of nodes || []) { if (category.slug === slug || String(category._id) === slug) return category; const child = find(category.children); if (child) return child; } return null; };
    const category = slug ? find(tree) : null;
    setSelected(category);
  }, [tree, selectedCategoryFilter?.slug, selectedCategoryFilter?._id, channel]);

  // Each category is its own page (/categories/<slug>); the grid stays a grid.
  const openCategory = (category) => {
    setSelectedCategoryFilter(category);
    setSelected(category);
    const path = `/categories/${category.slug || category._id}`;
    if (window.location.pathname !== path) window.history.pushState({ fromCategories: true }, '', path);
  };
  const parent = selected ? parentOf(tree, selected._id) : null;
  const shownParent = parent && !parent.isSystem ? parent : null;
  // Back follows how the shopper arrived; a deep link steps up to the parent, then the grid.
  const closeCategory = () => {
    if (window.history.state?.fromCategories) { window.history.back(); return; }
    if (shownParent) { setSelectedCategoryFilter(shownParent); setSelected(shownParent); window.history.replaceState(null, '', `/categories/${shownParent.slug || shownParent._id}`); return; }
    setSelected(null); setSelectedCategoryFilter(null);
    window.history.replaceState(null, '', '/categories');
  };

  if (selected) return (
    <section className="all-categories-page category-detail-page" aria-labelledby="category-detail-title">
      <header className="category-detail-header">
        <button type="button" className="category-detail-back" aria-label={`Back to ${shownParent ? shownParent.name : 'all categories'}`} onClick={closeCategory}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>
        </button>
        <div>
          <p className="all-categories-eyebrow">{shownParent ? shownParent.name : 'Categories'}</p>
          <h1 id="category-detail-title">{selected.name}</h1>
        </div>
      </header>
      {selected.children?.length > 0 && (
        <nav className="category-detail-chips" aria-label={`Subcategories of ${selected.name}`}>
          {selected.children.map(child => (
            <button type="button" key={child._id} onClick={() => openCategory(child)}><CategoryArtwork category={child} /><span>{child.name}</span></button>
          ))}
        </nav>
      )}
      <section className="category-results-section" aria-label={`Products in ${selected.name}`}>
        {!productsLoading && !productsError && products.length > 0 && <p className="category-detail-count">{products.length} {products.length === 1 ? 'product' : 'products'}</p>}
        <SponsoredCategoryBlock key={`${channel}:${selected._id}`} channel={channel} categoryId={selected._id} ready={!productsLoading && !productsError} onShown={setSponsoredIds} />
        {productsLoading ? (
          <div className="category-products-grid">{Array.from({ length: 4 }, (_, index) => <div className="category-result-card skeleton" key={index} />)}</div>
        ) : productsError ? (
          <div className="all-categories-state compact" role="alert"><span>{productsError}</span><button type="button" onClick={retryProducts}>Retry</button></div>
        ) : products.length === 0 ? (
          <div className="all-categories-state compact"><strong>No available products</strong><span>This category is active but currently has no published stock.</span></div>
        ) : (
          <div className="category-products-grid">
            {products.filter((product) => !sponsoredIds.includes(String(product._id))).map((product) => (
              <article className="category-result-card" key={product._id}>
                <button type="button" className="category-result-open" onClick={() => setSelectedProduct(product)}>
                  <img src={product.images?.[0] || ''} alt={product.name} loading="lazy" />
                  <strong>{product.name}</strong>
                  <span>{formatCurrency(product.price)}</span>
                </button>
                <WishlistHeartButton productId={product._id} size={14} />
                <button type="button" className="category-result-add" onClick={() => addToCart(product)}>Add</button>
              </article>
            ))}
          </div>
        )}
      </section>
    </section>
  );

  return (
    <section className="all-categories-page">
      <header className="all-categories-header">
        <div>
          <p className="all-categories-eyebrow">Bulkimart catalogue</p>
          <h1>Categories</h1>
          <p>Explore all categories</p>
        </div>
        <label className="all-categories-search">
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
          </svg>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a category" aria-label="Find a category" />
        </label>
        <div className="all-categories-channel-tabs" role="tablist" aria-label="Storefront">
          <button type="button" role="tab" aria-selected={channel === 'grocery'} className={channel === 'grocery' ? 'active' : ''} onClick={() => setActiveMode('quick')}>⚡ Quick</button>
          <button type="button" role="tab" aria-selected={channel === 'ecommerce'} className={channel === 'ecommerce' ? 'active' : ''} onClick={() => setActiveMode('shop-all')}>ShopAll</button>
        </div>
      </header>

      {loading ? (
        <div className="all-categories-grid" aria-label="Loading categories">
          {Array.from({ length: 8 }, (_, index) => <div className="all-category-card skeleton" key={index} />)}
        </div>
      ) : error ? (
        <div className="all-categories-state" role="alert">
          <strong>Categories could not be loaded</strong>
          <span>{error}</span>
          <button type="button" onClick={retry}>Try again</button>
        </div>
      ) : roots.length === 0 ? (
        <div className="all-categories-state">
          <strong>{query ? 'No matching categories' : 'No categories are published yet'}</strong>
          <span>{query ? 'Try a different search.' : 'Active admin-managed categories will appear here.'}</span>
        </div>
      ) : (
        <div className="all-categories-grid">
          {roots.map((category) => (
            <article key={category._id} className="all-category-card">
              <button type="button" className="all-category-main" onClick={() => openCategory(category)}>
                <span className="all-category-art"><CategoryArtwork category={category} /></span>
                <span className="all-category-copy">
                  <strong>{category.name}</strong>
                  <small>{category.children?.length ? `${category.children.length} subcategories` : 'Browse products'}</small>
                </span>
                <span className="all-category-arrow" aria-hidden="true">›</span>
              </button>
            </article>
          ))}
        </div>
      )}

    </section>
  );
};

export default CategoriesPage;
