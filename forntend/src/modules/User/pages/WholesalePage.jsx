import React, { useEffect, useMemo, useState, useRef } from 'react';
import { apiUrl } from '../../../utils/api';
import { useUser } from '../context/UserContext';
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
    ? <img src={src} alt={alt} onError={() => setFailed(true)} />
    : <span className="wholesale-image-fallback" aria-label={alt || 'Product image unavailable'}>BM</span>;
};

const attributeText = (variant) => (variant.attributes || [])
  .map((attribute) => `${attribute.name || attribute.key || ''}: ${attribute.value || ''}`.trim())
  .filter(Boolean)
  .join(' · ');

const WholesalePage = () => {
  const { currentUser } = useUser();
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [variantId, setVariantId] = useState('');
  const [quantity, setQuantity] = useState(0);
  const [productId, setProductId] = useState(routeProductId);
  const [adding, setAdding] = useState(false), [cartMessage, setCartMessage] = useState(''), [page, setPage] = useState(1), [pages, setPages] = useState(1);
  const addLock = useRef(false);

  useEffect(() => {
    const syncProductRoute = () => setProductId(routeProductId());
    window.addEventListener('popstate', syncProductRoute);
    return () => window.removeEventListener('popstate', syncProductRoute);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setLoading(true);
    setError('');

    const params = new URLSearchParams({ page: String(page), limit: '24' });
    if (productId && productId !== 'cart') params.set('productId', productId);
    if (!productId && query.trim()) params.set('q', query.trim());
    if (!productId && category) params.set('category', category);
    fetch(apiUrl(`/api/products/wholesale/catalog?${params}`), {
      headers: { Authorization: `Bearer ${localStorage.getItem('userToken') || ''}` },
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
          const message = response.status === 401 || response.status === 403
            ? 'Please sign in with a customer account to view Wholesale offers.'
            : body.message || `Wholesale offers could not be loaded (${response.status}).`;
          throw new Error(message);
        }
        if (active) setPages(body.meta?.pages || 1);
        return body.data || [];
      })
      .then((data) => { if (active) setProducts(Array.isArray(data) ? data : []); })
      .catch((requestError) => {
        if (!active || requestError.name === 'AbortError') return;
        setProducts([]);
        setError(requestError.message || 'Wholesale offers could not be loaded.');
      })
      .finally(() => { if (active) setLoading(false); });

    return () => { active = false; controller.abort(); };
  }, [attempt, currentUser, page, productId, query, category]);

  const categories = useMemo(() => [...new Set(products.map((product) => product.category?.name).filter(Boolean))].sort(), [products]);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return products.filter((product) => {
      const matchesCategory = !category || product.category?.name === category;
      const text = [product.name, product.seller?.name, product.category?.name].filter(Boolean).join(' ').toLowerCase();
      return matchesCategory && (!needle || text.includes(needle));
    });
  }, [products, query, category]);
  const selectedProduct = productId ? products.find((product) => String(product._id) === productId) : null;

  useEffect(() => {
    if (!selectedProduct) return;
    const firstAvailable = selectedProduct.variants?.find((variant) => variant.available) || selectedProduct.variants?.[0];
    setVariantId((current) => selectedProduct.variants?.some((variant) => String(variant.variantId) === current)
      ? current
      : String(firstAvailable?.variantId || ''));
  }, [selectedProduct]);

  const selectedVariant = selectedProduct?.variants?.find((variant) => String(variant.variantId) === variantId);
  useEffect(() => {
    if (selectedVariant) setQuantity(selectedVariant.minimumQuantity);
  }, [variantId, selectedVariant?.minimumQuantity]);

  const openProduct = (id) => {
    setPage(1);
    window.history.pushState(null, '', `/wholesale/${id}`);
    setProductId(String(id));
  };
  const closeProduct = () => {
    setPage(1);
    window.history.pushState(null, '', '/wholesale');
    setProductId('');
  };
  const productImage = (product) => imageUrl(product) || '';
  const validQuantity = selectedVariant && Number.isSafeInteger(quantity) && quantity >= selectedVariant.minimumQuantity && quantity <= selectedVariant.maxQuantity && (quantity - selectedVariant.minimumQuantity) % selectedVariant.quantityIncrement === 0;
  const selectedTier = selectedVariant?.priceTiers?.filter(tier => quantity >= tier.minimumQuantity).at(-1);
  const addToWholesale = async () => {
    if (addLock.current || !validQuantity) return;
    addLock.current = true;
    setAdding(true); setCartMessage('');
    try {
      const response = await fetch(apiUrl('/api/cart/wholesale'), { method: 'POST', headers: { Authorization: `Bearer ${localStorage.getItem('userToken') || ''}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ productId: selectedProduct._id, variantId, qty: quantity }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.message || 'Could not add Wholesale offer');
      setCartMessage('Added to your separate Wholesale cart.');
    } catch (err) { setCartMessage(err.message); }
    finally { addLock.current = false; setAdding(false); }
  };
  if (productId === 'cart') return <WholesaleCartPage />;

  return (
    <section className="wholesale-page" aria-labelledby="wholesale-title">
      <header className="wholesale-header">
        <div>
          <p className="wholesale-eyebrow">Bulkimart · Bulk buying</p>
          <h1 id="wholesale-title">Wholesale</h1>
          <p>Explore quantity-based offers from approved sellers.</p>
        </div>
        <span className="wholesale-access-label">Customer account</span>
      </header>
      <button type="button" onClick={() => { window.history.pushState(null, '', '/wholesale/cart'); setProductId('cart'); }}>Wholesale cart</button>

      {selectedProduct ? (
        <article className="wholesale-detail">
          <button type="button" className="wholesale-back" onClick={closeProduct}>← All Wholesale offers</button>
          <div className="wholesale-detail-grid">
            <div className="wholesale-detail-art">
              <WholesaleArtwork product={selectedProduct} alt={selectedProduct.name} />
            </div>
            <div className="wholesale-detail-info">
              <p className="wholesale-eyebrow">{selectedProduct.category?.name || 'Wholesale product'}</p>
              <h2>{selectedProduct.name}</h2>
              <p className="wholesale-seller">Sold by {selectedProduct.seller?.name || 'Bulkimart seller'}</p>
              {selectedProduct.description && <p className="wholesale-description">{selectedProduct.description}</p>}
              <label className="wholesale-label" htmlFor="wholesale-variant">Pack / variant</label>
              <select id="wholesale-variant" value={variantId} onChange={(event) => setVariantId(event.target.value)}>
                {(selectedProduct.variants || []).map((variant) => (
                  <option key={variant.variantId} value={variant.variantId}>
                    {[variant.name, attributeText(variant), variant.available ? 'Available' : 'Out of stock'].filter(Boolean).join(' · ')}
                  </option>
                ))}
              </select>
              {selectedVariant && (
                <>
                  <div className={`wholesale-stock ${selectedVariant.available ? 'is-available' : 'is-unavailable'}`}>
                    {selectedVariant.available ? `${selectedVariant.availableStock} available` : 'Currently out of stock'}
                    {selectedVariant.sku ? ` · SKU ${selectedVariant.sku}` : ''}
                  </div>
                  <div className="wholesale-terms">
                    <div><span>Minimum order</span><strong>{selectedVariant.minimumQuantity} {selectedVariant.unit || 'units'}</strong></div>
                    <div><span>Order increment</span><strong>{selectedVariant.quantityIncrement} {selectedVariant.unit || 'units'}</strong></div>
                  </div>
                  <label className="wholesale-label" htmlFor="wholesale-quantity">Quantity preview</label>
                  <input
                    id="wholesale-quantity"
                    type="number"
                    min={selectedVariant.minimumQuantity}
                    max={selectedVariant.maxQuantity}
                    step={selectedVariant.quantityIncrement}
                    value={quantity || selectedVariant.minimumQuantity}
                    disabled={!selectedVariant.available}
                    onChange={(event) => setQuantity(Math.max(0, Number(event.target.value) || 0))}
                  />
                  <h3>Quantity pricing</h3>
                  <div className="wholesale-tier-list">
                    {selectedVariant.priceTiers.map((tier) => (
                      <div key={`${tier.minimumQuantity}-${tier.unitPrice}`}>
                        <span>{tier.minimumQuantity}+ {selectedVariant.unit || 'units'}</span>
                        <strong>{formatPrice(tier.unitPrice)} / {selectedVariant.unit || 'unit'}</strong>
                      </div>
                    ))}
                  </div>
                  {quantity > 0 && (quantity < selectedVariant.minimumQuantity
                    || (quantity - selectedVariant.minimumQuantity) % selectedVariant.quantityIncrement !== 0
                    || quantity > selectedVariant.availableStock) && (
                    <p className="wholesale-validation" role="status">
                      Choose at least {selectedVariant.minimumQuantity}, in increments of {selectedVariant.quantityIncrement}, up to {selectedVariant.availableStock}.
                    </p>
                  )}
                </>
              )}
              {selectedTier && validQuantity && <p>{formatPrice(selectedTier.unitPrice)} per unit · Total {formatPrice(Math.round(selectedTier.unitPrice * 100) * quantity / 100)}</p>}
              <button type="button" disabled={adding || !validQuantity} onClick={addToWholesale}>{adding ? 'Adding…' : 'Add to Wholesale cart'}</button>
              {cartMessage && <p role="status">{cartMessage}</p>}
            </div>
          </div>
        </article>
      ) : productId && !loading && !error ? (
        <div className="wholesale-state">
          <h2>Offer not found</h2>
          <p>This offer is no longer available in the approved Wholesale catalog.</p>
          <button type="button" onClick={closeProduct}>View all offers</button>
        </div>
      ) : (
        <>
          <div className="wholesale-filters">
            <nav aria-label="Wholesale catalog pages"><button disabled={page <= 1} onClick={() => setPage(value => value - 1)}>Previous</button><span> Page {page} of {pages} </span><button disabled={page >= pages} onClick={() => setPage(value => value + 1)}>Next</button></nav>
            <label className="visually-hidden" htmlFor="wholesale-search">Search Wholesale offers</label>
            <input id="wholesale-search" type="search" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="Search products, sellers, categories" />
            <label className="visually-hidden" htmlFor="wholesale-category">Filter by category</label>
            <select id="wholesale-category" value={category} onChange={(event) => { setCategory(event.target.value); setPage(1); }}>
              <option value="">All categories</option>
              {categories.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </div>
          {loading ? (
            <div className="wholesale-loading" role="status">Loading approved Wholesale offers…</div>
          ) : error ? (
            <div className="wholesale-state wholesale-error" role="alert">
              <p>{error}</p>
              <button type="button" onClick={() => setAttempt((value) => value + 1)}>Try again</button>
            </div>
          ) : !filtered.length ? (
            <div className="wholesale-state"><h2>{products.length ? 'No matching offers' : 'No Wholesale offers available'}</h2><p>{products.length ? 'Try another search or category.' : 'Approved sellers’ available offers will appear here.'}</p></div>
          ) : (
            <div className="wholesale-grid">
              {filtered.map((product) => {
                const available = product.variants?.filter((variant) => variant.available) || [];
                const fromPrice = Math.min(...available.flatMap((variant) => variant.priceTiers.map((tier) => Number(tier.unitPrice))));
                return (
                  <button className="wholesale-card" type="button" key={product._id} onClick={() => openProduct(product._id)}>
                    <span className="wholesale-card-art">
                      <WholesaleArtwork product={product} />
                    </span>
                    <span className="wholesale-card-copy">
                      <span className="wholesale-card-category">{product.category?.name || 'Wholesale'}</span>
                      <strong>{product.name}</strong>
                      <span className="wholesale-card-seller">{product.seller?.name || 'Bulkimart seller'}</span>
                      <span className="wholesale-card-price">From {Number.isFinite(fromPrice) ? formatPrice(fromPrice) : '—'} / unit</span>
                      <span className="wholesale-card-moq">{available.length} available option{available.length === 1 ? '' : 's'} · MOQ from {Math.min(...available.map((variant) => variant.minimumQuantity))}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </>
      )}
    </section>
  );
};

export default WholesalePage;
