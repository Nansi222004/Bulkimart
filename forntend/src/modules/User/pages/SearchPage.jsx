import React, { useEffect, useRef, useState } from 'react';
import { useUser } from '../context/UserContext';
import { apiUrl } from '../../../utils/api';
import { formatCurrency } from '../utils/helpers';
import ImageSearchSheet, { ImageSearchButton } from '../components/ImageSearchSheet';
import { searchProductsByImage, validateSearchImage } from '../utils/imageSearch';
import { createLatestRequest } from '../../../components/services/serviceRequests';

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
 */
const SearchPage = () => {
  const {
    activeMode,
    setActiveNav,
    setSelectedProduct,
    openVoiceSearch,
    pendingVoiceQuery,
    setPendingVoiceQuery,
    imageSearchRequest, setImageSearchRequest,
  } = useUser();
  const searchType = activeMode === 'shop-all' ? 'ecommerce' : 'grocery';

  const [term, setTerm] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [recent, setRecent] = useState(readRecent);
  const [editingRecent, setEditingRecent] = useState(false);

  const [featured, setFeatured] = useState([]);
  const [defaultsLoading, setDefaultsLoading] = useState(true);
  const [imageSheetOpen, setImageSheetOpen] = useState(false), [imageMode, setImageMode] = useState(false);
  const [imageFile, setImageFile] = useState(null), [imagePreview, setImagePreview] = useState('');
  const [imageMeta, setImageMeta] = useState({ page: 1, limit: 20, total: 0 }), [searchError, setSearchError] = useState('');
  const [imageMaxBytes, setImageMaxBytes] = useState(5 * 1024 * 1024);
  const imageRequests = useRef(createLatestRequest());
  const closeImageSheet = () => { imageRequests.current.cancel(); if (imageMode) { setLoading(false); if (loading) { setImageMode(false); setImageFile(null); setResults([]); } } setImageSheetOpen(false); };
  const useTextSearch = value => { imageRequests.current.cancel(); setImageMode(false); setImageFile(null); setSearchError(''); setTerm(value); };
  useEffect(() => {
    if (imageSearchRequest) { setImageSheetOpen(true); setImageSearchRequest(0); }
  }, [imageSearchRequest, setImageSearchRequest]);
  useEffect(() => {
    const controller = new AbortController();
    fetch(apiUrl('/api/products/search-by-image/config'), { signal: controller.signal }).then(r => r.ok ? r.json() : null).then(body => { if (!controller.signal.aborted && body?.data?.maxBytes) setImageMaxBytes(body.data.maxBytes); }).catch(() => {});
    return () => controller.abort();
  }, []);
  useEffect(() => { imageRequests.current.cancel(); setImageMode(false); setImageFile(null); setResults([]); setSearchError(''); return () => imageRequests.current.cancel(); }, [searchType]);
  useEffect(() => { if (!imageFile) { setImagePreview(''); return; } const url = URL.createObjectURL(imageFile); setImagePreview(url); return () => URL.revokeObjectURL(url); }, [imageFile]);
  const runImageSearch = async (file, page = 1) => {
    validateSearchImage(file, imageMaxBytes);
    const task = imageRequests.current.start();
    setTerm(''); setImageMode(true); setLoading(true); setSearchError(''); setResults([]); setImageFile(file);
    try {
      const body = await searchProductsByImage(file, { type: searchType, page, signal: task.signal });
      if (!task.isCurrent()) return false;
      setResults(body.data || []); setImageMeta(body.meta); return true;
    } catch (error) {
      if (task.isCurrent()) { setSearchError(error.message || 'Image search failed. Please try again.'); throw error; }
      return false;
    } finally { if (task.isCurrent()) setLoading(false); }
  };

  const inputRef = useRef(null);
  useEffect(() => { inputRef.current?.focus(); }, []);

  // Handle incoming voice search queries from global mic button
  useEffect(() => {
    if (pendingVoiceQuery) {
      useTextSearch(pendingVoiceQuery);
      rememberSearch(pendingVoiceQuery, '');
      setPendingVoiceQuery('');
    }
  }, [pendingVoiceQuery]);

  // Default (no query yet) content — loaded once per storefront.
  useEffect(() => {
    let cancelled = false;
    setDefaultsLoading(true);
    fetch(apiUrl(`/api/products/featured?type=${searchType}`)).then((r) => (r.ok ? r.json() : [])).catch(() => []).then((featuredRes) => {
      if (cancelled) return;
      setFeatured(Array.isArray(featuredRes) ? featuredRes : []);
    }).finally(() => { if (!cancelled) setDefaultsLoading(false); });
    return () => { cancelled = true; };
  }, [searchType]);

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
    if (imageMode) return;
    const q = term.trim();
    if (q.length < 2) { setResults([]); setLoading(false); return; }
    setLoading(true);
    const controller = new AbortController();
    const handle = setTimeout(() => {
      fetch(apiUrl(`/api/products/search?q=${encodeURIComponent(q)}&type=${searchType}`), { signal: controller.signal })
        .then((r) => (r.ok ? r.json() : []))
        .then((rows) => { if (!controller.signal.aborted) setResults(Array.isArray(rows) ? rows : []); })
        .catch((err) => { if (!controller.signal.aborted && err.name !== 'AbortError') setResults([]); })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 300);
    return () => { clearTimeout(handle); controller.abort(); };
  }, [term, searchType, imageMode]);

  const rememberSearch = (label, image) => {
    const next = [{ label, image }, ...recent.filter((r) => r.label.toLowerCase() !== label.toLowerCase())].slice(0, MAX_RECENT);
    setRecent(next);
    writeRecent(next);
  };

  const openProduct = (p) => {
    rememberSearch(p.name, p.images?.[0]);
    setSelectedProduct({
      id: p._id, _id: p._id, name: p.name,
      image: p.matchedImageUrl || p.images?.[0] || '', images: p.images || [],
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

  const showingResults = imageMode || term.trim().length >= 2;

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
            onChange={(e) => useTextSearch(e.target.value)}
            placeholder={`Search ${activeMode === 'shop-all' ? 'Shop All' : 'Quick'} products or shops`}
            aria-label="Search"
          />
          {term ? (
            <button type="button" aria-label="Clear" onClick={() => useTextSearch('')} className="search-page-clear">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          ) : null}
          <ImageSearchButton onClick={() => setImageSheetOpen(true)} />
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
        {imageMode && <div className="image-search-summary">{imagePreview && <img src={imagePreview} alt="Image used for product search" />}<span>Similar product photos</span><button type="button" onClick={() => useTextSearch('')}>Remove image</button></div>}
        {searchError && <p className="image-search-error" role="alert">{searchError} {imageFile && <button disabled={loading} type="button" onClick={() => { void runImageSearch(imageFile, imageMeta.page).catch(() => {}); }}>Retry image search</button>}</p>}
        {showingResults ? (
          loading ? (
            <p className="search-page-empty">Searching…</p>
          ) : results.length === 0 ? (
            <p className="search-page-empty">{searchError ? 'Image search could not finish. Please try again.' : imageMode ? 'No similar product photos found. Try a clearer photo or search by name.' : `No results for "${term}"`}</p>
          ) : (
            <><div className="search-page-results-grid">
              {results.map((p) => (
                <div key={p._id} className="search-page-result-card" onClick={() => openProduct(p)}>
                  <div className="search-page-result-img-wrap">
                    <img src={p.matchedImageUrl || p.images?.[0]} alt={p.name} />
                  </div>
                  <p className="search-page-result-name">{p.name}</p>
                  <p className="search-page-result-shop">{p.sellerId?.storeDetails?.name || p.sellerId?.businessName || ''}</p>
                  <p className="search-page-result-price">{formatCurrency(p.price)}</p>
                </div>
              ))}
            </div>{imageMode && imageMeta.total > imageMeta.limit && <div className="image-search-pagination"><button disabled={loading || imageMeta.page <= 1} onClick={() => { void runImageSearch(imageFile, imageMeta.page - 1).catch(() => {}); }}>Previous</button><span>Page {imageMeta.page}</span><button disabled={loading || imageMeta.page * imageMeta.limit >= imageMeta.total} onClick={() => { void runImageSearch(imageFile, imageMeta.page + 1).catch(() => {}); }}>Next</button></div>}</>
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
      <ImageSearchSheet open={imageSheetOpen} onClose={closeImageSheet} onSearch={runImageSearch} loading={loading && imageMode} maxBytes={imageMaxBytes} />
    </div>
  );
};

export default SearchPage;
