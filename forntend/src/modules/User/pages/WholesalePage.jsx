import { openWholesaleProduct } from '../utils/productRoute';
import { boundedFetch } from '../../../utils/portalRequests';
import React, { useEffect, useState } from 'react';
import { apiUrl } from '../../../utils/api';
import WholesaleCartPage from './WholesaleCartPage';

import './WholesalePage.css';

const routeProductId = () => {
  const parts = window.location.pathname.split('/').filter(Boolean);
  return parts[0] === 'wholesale' ? parts[1] || '' : '';
};

const imageUrl = (product) => {
  const first = product?.images?.[0];
  return typeof first === 'string' ? first : first?.url || first?.secure_url || '';
};

const formatPrice = (price) => `₹${Number(price).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

const WholesaleArtwork = ({ product, alt = '' }) => {
  const [failed, setFailed] = useState(false);
  const src = imageUrl(product);
  return src && !failed
    ? <img src={src} alt={alt} onError={() => setFailed(true)} loading="lazy" />
    : <span className="wholesale-image-fallback" aria-label={alt || 'Product image unavailable'}>BM</span>;
};

const WholesalePage = () => {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState(() => new URLSearchParams(window.location.search).get('q') || '');
  const [category, setCategory] = useState(() => new URLSearchParams(window.location.search).get('category') || '');
  const [productId, setProductId] = useState(routeProductId);
  const [page, setPage] = useState(() => Math.max(1, Number(new URLSearchParams(window.location.search).get('page')) || 1));
  const [pages, setPages] = useState(1);
  const [categories, setCategories] = useState([]);
  const [sort, setSort] = useState(() => new URLSearchParams(window.location.search).get('sort') || 'default');

  useEffect(() => {
    const syncProductRoute = () => {
      setProductId(routeProductId());
      const params = new URLSearchParams(window.location.search);
      setQuery(params.get('q') || '');
      setCategory(params.get('category') || '');
      setSort(params.get('sort') || 'default');
      setPage(Math.max(1, Number(params.get('page')) || 1));
    };
    window.addEventListener('popstate', syncProductRoute);
    window.addEventListener('app:locationchange', syncProductRoute);
    return () => {
      window.removeEventListener('popstate', syncProductRoute);
      window.removeEventListener('app:locationchange', syncProductRoute);
    };
  }, []);

  useEffect(() => {
    if (productId === 'cart') return;
    const controller = new AbortController();
    let active = true;
    setLoading(true);
    setError('');

    const params = new URLSearchParams({ page: String(page), limit: '24' });
    if (query.trim()) params.set('q', query.trim());
    if (category) params.set('category', category);
    if (sort !== 'default') params.set('sort', sort);
    boundedFetch(apiUrl(`/api/products/wholesale/catalog?${params}`), {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
          const message = body.message || `Wholesale offers could not be loaded (${response.status}).`;
          throw new Error(message);
        }
        if (!Array.isArray(body.data)) throw new Error('Invalid Wholesale catalog response. Please retry.');
        if (active) {
          setPages(body.meta?.pages || 1);
          setCategories(body.meta?.categories || []);
        }
        return body.data;
      })
      .then((data) => { if (active) setProducts(Array.isArray(data) ? data : []); })
      .catch((requestError) => {
        if (!active || requestError.name === 'AbortError') return;
        setProducts([]);
        setError(requestError.message || 'Wholesale offers could not be loaded.');
      })
      .finally(() => { if (active) setLoading(false); });

    return () => { active = false; controller.abort(); };
  }, [attempt, page, productId, query, category, sort]);

  const filtered = products;

  const openProduct = (product) => openWholesaleProduct(product._id, product.variants?.find((v) => v.available)?.variantId);

  const updateFilter = (key, value) => {
    const params = new URLSearchParams(window.location.search);
    if (value) params.set(key, value);
    else params.delete(key);
    if (key !== 'page') params.set('page', '1');
    window.history.replaceState(null, '', '/wholesale' + (params.size ? '?' + params : ''));
    if (key === 'q') setQuery(value);
    if (key === 'category') setCategory(value);
    if (key === 'sort') setSort(value);
    setPage(key === 'page' ? Number(value) : 1);
  };

  if (productId === 'cart') return <WholesaleCartPage />;

  return (
    <section className="wholesale-page" aria-labelledby="wholesale-title">
      {/* Header Banner */}
      <header className="wholesale-header">
        <div className="wholesale-header-content">
          <div className="wholesale-header-titles">
            <p className="wholesale-eyebrow">
              <span className="wholesale-eyebrow-dot" aria-hidden="true" />
              Bulkimart · Bulk Buying
            </p>
            <h1 id="wholesale-title">Wholesale / Bulk Buying</h1>
            <p className="wholesale-subtitle">Buy in bulk from approved sellers with quantity-based pricing.</p>
          </div>

        </div>
      </header>

      {/* Toolbar: Search, Category, Pagination */}
      <div className="wholesale-toolbar">
        <div className="wholesale-filters-row">
          <div className="wholesale-search-wrapper">
            <svg className="wholesale-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <label className="visually-hidden" htmlFor="wholesale-search">Search Wholesale offers</label>
            <input
              id="wholesale-search"
              type="search"
              value={query}
              onChange={(event) => updateFilter('q', event.target.value)}
              placeholder="Search products, sellers or categories"
            />
            {query && (
              <button
                type="button"
                className="wholesale-search-clear"
                onClick={() => updateFilter('q', '')}
                aria-label="Clear search"
              >
                ✕
              </button>
            )}
          </div>

          <div className="wholesale-category-wrapper">
            <label className="visually-hidden" htmlFor="wholesale-category">Filter by category</label>
            <select
              id="wholesale-category"
              value={category}
              onChange={(event) => updateFilter('category', event.target.value)}
            >
              <option value="">All Categories</option>
              {categories.map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
            <svg className="wholesale-select-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </div>
        </div>

        <div className="wholesale-meta-row">
          <label>Sort by{' '}
            <select aria-label="Sort Wholesale offers" value={sort} onChange={event => updateFilter('sort', event.target.value)}>
              <option value="default">Default order</option>
              <option value="name">Name</option>
              <option value="price-asc">Bulk price: low to high</option>
              <option value="price-desc">Bulk price: high to low</option>
            </select>
          </label>
          <span className="wholesale-results-count">
            {loading ? 'Loading offers…' : error ? 'Offers unavailable' : <>Showing <strong>{filtered.length}</strong> {filtered.length === 1 ? 'offer' : 'offers'}</>}
            {category && <span> in <em>{category}</em></span>}
          </span>

          <nav aria-label="Wholesale catalog pages" className="wholesale-pagination">
            <button
              type="button"
              className="wholesale-page-btn"
              disabled={loading || !!error || page <= 1}
              onClick={() => updateFilter('page', String(page - 1))}
              aria-label="Previous page"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="15 18 9 12 15 6" />
              </svg>
              <span>Previous</span>
            </button>
            <span className="wholesale-page-indicator">
              Page <strong>{page}</strong> of <strong>{pages}</strong>
            </span>
            <button
              type="button"
              className="wholesale-page-btn"
              disabled={loading || !!error || page >= pages}
              onClick={() => updateFilter('page', String(page + 1))}
              aria-label="Next page"
            >
              <span>Next</span>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          </nav>
        </div>
      </div>

      {/* Main Content Area */}
      {loading ? (
        <div className="wholesale-loading" role="status">
          <div className="wholesale-spinner" aria-hidden="true" />
          <p>Loading approved Wholesale offers…</p>
        </div>
      ) : error ? (
        <div className="wholesale-state wholesale-error" role="alert">
          <div className="wholesale-error-icon" aria-hidden="true">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
          <p>{error}</p>
          <div className="wholesale-state-actions">
            <button type="button" className="wholesale-primary-btn" onClick={() => setAttempt((value) => value + 1)}>
              Try again
            </button>
          </div>
        </div>
      ) : !filtered.length ? (
        <div className="wholesale-state wholesale-empty">
          <div className="wholesale-empty-icon" aria-hidden="true">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
              <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
            </svg>
          </div>
          <h2>{query || category ? 'No matching offers found' : 'No Wholesale offers available'}</h2>
          <p>{query || category ? 'Try another search or select a different category.' : 'Approved sellers’ available bulk offers will appear here.'}</p>
          {(query || category) && (
            <button
              type="button"
              className="wholesale-secondary-btn"
              onClick={() => { updateFilter('q', ''); updateFilter('category', ''); }}
            >
              Clear filters
            </button>
          )}
        </div>
      ) : (
        <div className="wholesale-grid">
          {filtered.map((product) => {
            const available = product.variants?.filter((variant) => variant.available) || [];
            const fromPrice = Math.min(...available.flatMap((variant) => (variant.priceTiers || []).map((tier) => Number(tier.unitPrice))));
            const minMoq = available.length ? Math.min(...available.map((variant) => variant.minimumQuantity || 1)) : 1;
            return (
              <button
                className="wholesale-card"
                type="button"
                key={product._id}
                onClick={() => openProduct(product)}
                aria-label={`View wholesale details for ${product.name}`}
              >
                <span className="wholesale-card-art">
                  <WholesaleArtwork product={product} alt={product.name} />
                  {product.category?.name && (
                    <span className="wholesale-card-tag">{product.category.name}</span>
                  )}
                </span>
                <span className="wholesale-card-copy">
                  <span className="wholesale-card-seller">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                      <polyline points="9 22 9 12 15 12 15 22" />
                    </svg>
                    <span>{product.seller?.name || 'Approved seller'}</span>
                  </span>
                  <strong className="wholesale-card-title">{product.name}</strong>
                  <span className="wholesale-card-pricing-block">
                    <span className="wholesale-card-price-label">Wholesale Price</span>
                    <span className="wholesale-card-price">
                      From {Number.isFinite(fromPrice) ? formatPrice(fromPrice) : '—'} <span className="wholesale-card-unit">/ unit</span>
                    </span>
                  </span>
                  <span className="wholesale-card-meta-row">
                    <span className="wholesale-card-moq">
                      MOQ: {minMoq} {minMoq === 1 ? 'unit' : 'units'}
                    </span>
                    <span className="wholesale-card-variants">
                      {available.length === 1 ? '1 variant' : `${available.length} variants`}
                    </span>
                  </span>
                  <span className="wholesale-card-cta">
                    <span>View Product</span>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
};

export default WholesalePage;
