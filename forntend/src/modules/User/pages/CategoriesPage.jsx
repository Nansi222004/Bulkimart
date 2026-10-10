import React, { useEffect, useMemo, useState } from 'react';
import { apiUrl } from '../../../utils/api';
import { useUser } from '../context/UserContext';
import { descendantIds, useCategoryTree } from '../hooks/useCategoryTree';
import { formatCurrency } from '../utils/helpers';
import WishlistHeartButton from '../components/WishlistHeartButton';

const customerRoots = (tree) => (tree || []).flatMap((category) => {
  if (!category.isSystem) return [category];
  return category.children || [];
});

const branchMatches = (category, query) => {
  if (!query) return true;
  if (String(category.name || '').toLowerCase().includes(query)) return true;
  return (category.children || []).some((child) => branchMatches(child, query));
};

const CategoryArtwork = ({ category }) => {
  const [failed, setFailed] = useState(false);
  const image = category.image || category.icon;
  if (image && !failed) {
    return <img src={image} alt="" loading="lazy" onError={() => setFailed(true)} />;
  }
  return (
    <span className="all-category-fallback" aria-hidden="true">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <rect x="3" y="3" width="7" height="7" rx="2" />
        <rect x="14" y="3" width="7" height="7" rx="2" />
        <rect x="3" y="14" width="7" height="7" rx="2" />
        <rect x="14" y="14" width="7" height="7" rx="2" />
      </svg>
    </span>
  );
};

const CategoriesPage = () => {
  const { activeMode, setActiveMode, addToCart, setSelectedProduct } = useUser();
  const channel = activeMode === 'shop-all' ? 'ecommerce' : 'grocery';
  const { tree, loading, error, retry } = useCategoryTree(channel);
  const [query, setQuery] = useState('');
  const [expandedId, setExpandedId] = useState(null);
  const [selected, setSelected] = useState(null);
  const [products, setProducts] = useState([]);
  const [productsLoading, setProductsLoading] = useState(false);
  const [productsError, setProductsError] = useState('');
  const [productsAttempt, setProductsAttempt] = useState(0);

  const roots = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return customerRoots(tree).filter((category) => branchMatches(category, needle));
  }, [tree, query]);

  useEffect(() => {
    setExpandedId(null);
    setSelected(null);
    setProducts([]);
    setProductsError('');
  }, [channel]);

  useEffect(() => {
    if (!selected) return undefined;
    const controller = new AbortController();
    const ids = descendantIds(selected).join(',');
    setProductsLoading(true);
    setProductsError('');

    fetch(apiUrl(`/api/products?type=${channel}&category=${encodeURIComponent(ids)}&limit=60`), { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.message || `Products unavailable (${response.status})`);
        return body.products || body.data || [];
      })
      .then(setProducts)
      .catch((requestError) => {
        if (requestError.name === 'AbortError') return;
        setProducts([]);
        setProductsError(requestError.message || 'Could not load products');
      })
      .finally(() => {
        if (!controller.signal.aborted) setProductsLoading(false);
      });

    return () => controller.abort();
  }, [selected, channel, productsAttempt]);

  const chooseCategory = (category) => {
    setSelected(category);
    if (category.children?.length) setExpandedId((value) => value === category._id ? null : category._id);
    const path = `/categories/${category.slug || category._id}`;
    if (window.location.pathname !== path) window.history.pushState(null, '', path);
  };

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
            <article key={category._id} className={`all-category-card ${selected?._id === category._id ? 'selected' : ''}`}>
              <button type="button" className="all-category-main" onClick={() => chooseCategory(category)}>
                <span className="all-category-art"><CategoryArtwork category={category} /></span>
                <span className="all-category-copy">
                  <strong>{category.name}</strong>
                  <small>{category.children?.length ? `${category.children.length} subcategories` : 'Browse products'}</small>
                </span>
                <span className="all-category-arrow" aria-hidden="true">›</span>
              </button>
              {expandedId === category._id && category.children?.length > 0 && (
                <div className="all-subcategory-list">
                  {category.children.map((child) => (
                    <button type="button" key={child._id} onClick={() => chooseCategory(child)}>
                      <CategoryArtwork category={child} />
                      <span>{child.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </article>
          ))}
        </div>
      )}

      {selected && (
        <section className="category-results-section">
          <div className="category-results-heading">
            <div><span>Products in</span><h2>{selected.name}</h2></div>
            <button type="button" onClick={() => { setSelected(null); setProducts([]); }}>Close</button>
          </div>
          {productsLoading ? (
            <div className="category-products-grid">{Array.from({ length: 4 }, (_, index) => <div className="category-result-card skeleton" key={index} />)}</div>
          ) : productsError ? (
            <div className="all-categories-state compact" role="alert"><span>{productsError}</span><button type="button" onClick={() => setProductsAttempt((value) => value + 1)}>Retry</button></div>
          ) : products.length === 0 ? (
            <div className="all-categories-state compact"><strong>No available products</strong><span>This category is active but currently has no published stock.</span></div>
          ) : (
            <div className="category-products-grid">
              {products.map((product) => (
                <article className="category-result-card" key={product._id}>
                  <button type="button" className="category-result-open" onClick={() => setSelectedProduct(product)}>
                    <img src={product.images?.[0] || ''} alt={product.name} loading="lazy" />
                    <strong>{product.name}</strong>
                    <span>{formatCurrency(product.price)}</span>
                  </button>
                  <WishlistHeartButton productId={product._id} size={14} />
                  <button type="button" className="category-result-add" onClick={() => addToCart(product._id)}>Add</button>
                </article>
              ))}
            </div>
          )}
        </section>
      )}
    </section>
  );
};

export default CategoriesPage;
