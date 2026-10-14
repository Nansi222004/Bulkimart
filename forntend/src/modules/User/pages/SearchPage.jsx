import React, { useEffect, useRef, useState } from 'react';
import { useUser } from '../context/UserContext';
import { apiUrl } from '../../../utils/api';
import { formatCurrency } from '../utils/helpers';

const RECENT_KEY = 'nhcone_recent_searches';
const MAX_RECENT = 10;

const readRecent = () => {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch { return []; }
};
const writeRecent = (list) => {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, MAX_RECENT))); } catch { /* private mode etc — just skip persisting */ }
};

/**
 * The dedicated full-screen search experience — what tapping the header
 * search bar now opens (it used to be a small inline dropdown; that logic
 * moved here wholesale, same debounce/endpoint, bigger canvas).
 *
 * "Recommended Stores" is real, not a mock section copied from a reference
 * screenshot: it's this module's own paid Seller Promotion system —
 * `GET /api/promotions?module=...` only ever returns a promotion that is
 * genuinely ACTIVE (admin-approved AND paid), scoped to the storefront the
 * shopper is currently in. "Trending Today" in a reference app is usually a
 * real order-velocity computation NHCONE doesn't have yet — rather than
 * fake that number, this reuses the existing `isFeatured`/`isSponsored`
 * admin-curated strip (`GET /api/products/featured`) under an honest label.
 */
const SearchPage = () => {
  const {
    activeMode,
    setActiveNav,
    setSelectedProduct,
    setSelectedPromotionId,
    openVoiceSearch,
    pendingVoiceQuery,
    setPendingVoiceQuery,
  } = useUser();
  const searchType = activeMode === 'shop-all' ? 'ecommerce' : 'grocery';
  const module = activeMode === 'shop-all' ? 'ECOMMERCE' : 'QUICK';

  const [term, setTerm] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [recent, setRecent] = useState(readRecent);
  const [editingRecent, setEditingRecent] = useState(false);

  const [stores, setStores] = useState([]);
  const [featured, setFeatured] = useState([]);
  const [defaultsLoading, setDefaultsLoading] = useState(true);

  const inputRef = useRef(null);
  useEffect(() => { inputRef.current?.focus(); }, []);

  // Handle incoming voice search queries from global mic button
  useEffect(() => {
    if (pendingVoiceQuery) {
      setTerm(pendingVoiceQuery);
      rememberSearch(pendingVoiceQuery, '');
      setPendingVoiceQuery('');
    }
  }, [pendingVoiceQuery]);

  // Default (no query yet) content — loaded once per storefront.
  useEffect(() => {
    let cancelled = false;
    setDefaultsLoading(true);
    Promise.all([
      fetch(apiUrl(`/api/promotions?module=${module}`)).then((r) => (r.ok ? r.json() : { data: [] })).catch(() => ({ data: [] })),
      fetch(apiUrl(`/api/products/featured?type=${searchType}`)).then((r) => (r.ok ? r.json() : [])).catch(() => []),
    ]).then(([promoRes, featuredRes]) => {
      if (cancelled) return;
      setStores(promoRes?.data || []);
      setFeatured(Array.isArray(featuredRes) ? featuredRes : []);
    }).finally(() => { if (!cancelled) setDefaultsLoading(false); });
    return () => { cancelled = true; };
  }, [module, searchType]);

  /**
   * Debounced live search.
   *
   * Debouncing controls WHEN a request is sent: every keystroke restarts a
   * 300ms timer via this effect's cleanup (`clearTimeout`) re-running before
   * the previous one fires, so typing "mango" at normal speed sends one
   * request, not five ("m", "ma", "man", "mang", "mango").
   *
   * It does NOT control when a response ARRIVES. On a slow connection the
   * request for "man" can resolve after the request for "mango" and
   * overwrite fresher results with stale ones — the classic race condition
   * debouncing alone doesn't fix. `AbortController` closes that gap: a new
   * keystroke cancels whatever request is still in flight, so an aborted
   * fetch's `.catch` never gets to call `setResults` with stale data (a
   * caught AbortError is deliberately swallowed, not shown as "no results").
   */
  useEffect(() => {
    const q = term.trim();
    if (q.length < 2) { setResults([]); setLoading(false); return; }
    setLoading(true);
    const controller = new AbortController();
    const handle = setTimeout(() => {
      fetch(apiUrl(`/api/products/search?q=${encodeURIComponent(q)}&type=${searchType}`), { signal: controller.signal })
        .then((r) => (r.ok ? r.json() : []))
        .then((rows) => setResults(Array.isArray(rows) ? rows : []))
        .catch((err) => { if (err.name !== 'AbortError') setResults([]); })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 300);
    return () => { clearTimeout(handle); controller.abort(); };
  }, [term, searchType]);

  const rememberSearch = (label, image) => {
    const next = [{ label, image }, ...recent.filter((r) => r.label.toLowerCase() !== label.toLowerCase())].slice(0, MAX_RECENT);
    setRecent(next);
    writeRecent(next);
  };

  const openProduct = (p) => {
    rememberSearch(p.name, p.images?.[0]);
    setSelectedProduct({
      id: p._id, _id: p._id, name: p.name,
      image: p.images?.[0] || '', images: p.images || [],
      price: p.price, mrp: p.mrp, discountPercent: p.discountPercent,
      stock: p.fulfillmentType === 'digital' ? 1 : p.stock, type: p.type,
      fulfillmentType: p.fulfillmentType || 'physical',
      digital: p.digital || null,
      raw: p,
    });
  };

  const removeRecent = (label) => {
    const next = recent.filter((r) => r.label !== label);
    setRecent(next);
    writeRecent(next);
  };

  const showingResults = term.trim().length >= 2;

  return (
    <div className="search-page">
      <div className="search-page-header">
        <button className="pd-back-btn" onClick={() => setActiveNav('home')} aria-label="Go back">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <div className="search-page-input-wrap">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line>
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder={`Search ${activeMode === 'shop-all' ? 'Shop All' : 'Quick'} products or shops`}
            aria-label="Search"
          />
          {term ? (
            <button type="button" aria-label="Clear" onClick={() => setTerm('')} className="search-page-clear">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          ) : null}
          <button
            type="button"
            aria-label="Voice search"
            onClick={() => openVoiceSearch()}
            className="search-page-mic-btn"
            title="Search by voice"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
              <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
              <line x1="12" y1="19" x2="12" y2="23"></line>
              <line x1="8" y1="23" x2="16" y2="23"></line>
            </svg>
          </button>
        </div>
      </div>

      <div className="search-page-body">
        {showingResults ? (
          loading ? (
            <p className="search-page-empty">Searching…</p>
          ) : results.length === 0 ? (
            <p className="search-page-empty">No results for "{term}"</p>
          ) : (
            <div className="search-page-results-grid">
              {results.map((p) => (
                <div key={p._id} className="search-page-result-card" onClick={() => openProduct(p)}>
                  <div className="search-page-result-img-wrap">
                    <img src={p.images?.[0]} alt={p.name} />
                    {(p.searchBoostRank !== undefined && p.searchBoostRank !== null) && (
                      <span className="search-result-promoted" style={{ position: 'absolute', top: 6, left: 6 }}>Promoted</span>
                    )}
                  </div>
                  <p className="search-page-result-name">{p.name}</p>
                  <p className="search-page-result-shop">{p.sellerId?.storeDetails?.name || p.sellerId?.businessName || ''}</p>
                  <p className="search-page-result-price">{formatCurrency(p.price)}</p>
                </div>
              ))}
            </div>
          )
        ) : (
          <>
            {recent.length > 0 && (
              <section className="search-page-section">
                <div className="search-page-section-head">
                  <h3>Recent Searches</h3>
                  <button type="button" className="search-page-edit-link" onClick={() => setEditingRecent((v) => !v)}>
                    {editingRecent ? 'Done' : 'Edit'}
                  </button>
                </div>
                <div className="search-page-chip-scroll">
                  {recent.map((r) => (
                    <div key={r.label} className="search-page-chip" onClick={() => !editingRecent && setTerm(r.label)}>
                      {editingRecent && (
                        <button type="button" className="search-page-chip-remove" onClick={(e) => { e.stopPropagation(); removeRecent(r.label); }} aria-label={`Remove ${r.label}`}>✕</button>
                      )}
                      {r.image ? <img src={r.image} alt="" /> : <div className="search-page-chip-placeholder" />}
                      <span>{r.label}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            <section className="search-page-section">
              <h3>Recommended Stores</h3>
              {defaultsLoading ? (
                <p className="search-page-empty" style={{ padding: '10px 0' }}>Loading…</p>
              ) : stores.length === 0 ? (
                <p className="search-page-empty" style={{ padding: '10px 0' }}>No promoted stores right now.</p>
              ) : (
                <div className="search-page-store-scroll">
                  {stores.map((s) => (
                    <div key={s.id} className="search-page-store-card" onClick={() => setSelectedPromotionId(s.id)}>
                      <div className="search-page-store-img-wrap">
                        {s.bannerImage ? <img src={s.bannerImage} alt={s.shopName} /> : <div className="search-page-chip-placeholder" />}
                      </div>
                      <span>{s.shopName || s.sellerName}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="search-page-section">
              <h3>Featured Products</h3>
              {defaultsLoading ? (
                <p className="search-page-empty" style={{ padding: '10px 0' }}>Loading…</p>
              ) : featured.length === 0 ? (
                <p className="search-page-empty" style={{ padding: '10px 0' }}>Nothing featured yet.</p>
              ) : (
                <div className="search-page-results-grid">
                  {featured.map((p) => (
                    <div key={p._id} className="search-page-result-card" onClick={() => openProduct(p)}>
                      <div className="search-page-result-img-wrap"><img src={p.images?.[0]} alt={p.name} /></div>
                      <p className="search-page-result-name">{p.name}</p>
                      <p className="search-page-result-price">{formatCurrency(p.price)}</p>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
};

export default SearchPage;
