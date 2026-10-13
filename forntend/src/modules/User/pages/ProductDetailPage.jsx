import React, { useState, useEffect, useCallback } from 'react';
import { useUser } from '../context/UserContext';
import { useProducts } from '../hooks/useProducts';
import { useProductDeliveryOptions } from '../hooks/useDeliveryOptions';
import { formatCurrency } from '../utils/helpers';
import { apiUrl } from '../../../utils/api';
import UnavailableBadge from '../components/UnavailableBadge';

// Star component
const Stars = ({ rating, size = 14 }) => {
  const full = Math.floor(rating);
  const half = rating % 1 >= 0.5;
  return (
    <span style={{ display: 'inline-flex', gap: 1 }}>
      {[1, 2, 3, 4, 5].map(i => (
        <svg key={i} width={size} height={size} viewBox="0 0 24 24" fill={i <= full ? '#f59e0b' : i === full + 1 && half ? 'url(#half)' : '#e2e8f0'} stroke="none">
          <defs>
            <linearGradient id="half">
              <stop offset="50%" stopColor="#f59e0b" />
              <stop offset="50%" stopColor="#e2e8f0" />
            </linearGradient>
          </defs>
          <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26" />
        </svg>
      ))}
    </span>
  );
};

// Rating bar row
const RatingBar = ({ label, pct, count }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
    <span style={{ fontSize: 11, fontWeight: 700, color: '#475569', width: 14 }}>{label}</span>
    <svg width="10" height="10" viewBox="0 0 24 24" fill="#f59e0b"><polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26" /></svg>
    <div style={{ flex: 1, height: 5, backgroundColor: '#e2e8f0', borderRadius: 99, overflow: 'hidden' }}>
      <div style={{ width: `${pct}%`, height: '100%', backgroundColor: 'var(--primary)', borderRadius: 99 }} />
    </div>
    <span style={{ fontSize: 10, color: '#94a3b8', width: 28, textAlign: 'right' }}>{count}</span>
  </div>
);

// Shared by both states of the bottom bar's left button — Add to Cart and
// Go to Cart are the same basket, so they carry the same mark.
const CartIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
    <circle cx="9" cy="21" r="1" /><circle cx="20" cy="21" r="1" />
    <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
  </svg>
);

const ProductDetailPage = () => {
  const {
    selectedProduct, setSelectedProduct, addToCart, getItemQty,
    getDeliveryPoint, getSelectedAddress, getLocationDisplayName, setActiveNav,
    isWishlisted, toggleWishlist,
  } = useUser();
  const product = selectedProduct;
  const [loadedVariants, setLoadedVariants] = useState([]);
  const [loadedProductId, setLoadedProductId] = useState('');
  const productVariants = loadedProductId === String(product?.id)
    ? loadedVariants
    : (product?.variants || product?.raw?.variants || []);
  const [selectedVariantId, setSelectedVariantId] = useState(() => productVariants[0]?.id || productVariants[0]?._id || '');
  const selectedVariant = productVariants.find((variant) => String(variant.id || variant._id) === String(selectedVariantId)) || productVariants[0] || null;
  const selectedPrice = selectedVariant?.price ?? product?.price;
  const selectedMrp = selectedVariant?.mrp ?? product?.mrp;
  const selectedStock = selectedVariant?.stock ?? product?.stock;
  const [qty, setQty] = useState(() => getItemQty(product?.id, selectedVariantId));
  const [cartActionPending, setCartActionPending] = useState(false);
  const [cartActionError, setCartActionError] = useState('');
  const [activeTab, setActiveTab] = useState('desc');
  const [activeImageIndex, setActiveImageIndex] = useState(0);

  /**
   * Reviews, and the score built from them.
   *
   * Both come from GET /api/products/:id/reviews, which returns approved
   * reviews only and computes the summary from that same list — so the bars
   * can never claim something the reviews underneath them don't show. The
   * `product.rating` carried on the list row is not used here: it is a
   * snapshot from whenever the card was fetched.
   */
  const [reviews, setReviews] = useState([]);
  const [ratingSummary, setRatingSummary] = useState({ average: 0, count: 0, breakdown: [] });
  const [reviewsLoading, setReviewsLoading] = useState(true);

  const [myRating, setMyRating] = useState(0);
  const [myComment, setMyComment] = useState('');
  const [submittingReview, setSubmittingReview] = useState(false);
  const [reviewError, setReviewError] = useState('');

  const loadReviews = useCallback(async () => {
    if (!product?.id) return;
    setReviewsLoading(true);
    try {
      const res = await fetch(apiUrl(`/api/products/${product.id}/reviews`));
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message || 'Could not load reviews');
      setReviews(body.data?.reviews || []);
      setRatingSummary(body.data?.summary || { average: 0, count: 0, breakdown: [] });
    } catch {
      setReviews([]);
      setRatingSummary({ average: 0, count: 0, breakdown: [] });
    } finally {
      setReviewsLoading(false);
    }
  }, [product?.id]);

  useEffect(() => { loadReviews(); }, [loadReviews]);

  const submitReview = async () => {
    if (!myRating) return;
    setSubmittingReview(true);
    setReviewError('');
    try {
      const token = localStorage.getItem('userToken');
      if (!token) throw new Error('Please sign in to review this product.');

      const res = await fetch(apiUrl(`/api/products/${product.id}/reviews`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ rating: myRating, comment: myComment.trim() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message || 'Could not submit your review');

      setMyRating(0);
      setMyComment('');
      // Refetch reviews immediately so the newly published review appears live!
      loadReviews();
    } catch (err) {
      setReviewError(err.message);
    } finally {
      setSubmittingReview(false);
    }
  };

  /**
   * Answered Q&A, and the shopper's own pending question.
   *
   * Answered list comes from GET /api/products/:id/faqs (public, answered
   * only — an unanswered question is between the shopper and the seller
   * until there is something to show for it). Asking is a small modal
   * rather than inline, so it doesn't compete with the star-rating form a
   * few sections down.
   */
  const [faqs, setFaqs] = useState([]);
  const [faqsLoading, setFaqsLoading] = useState(true);
  const [showAskModal, setShowAskModal] = useState(false);
  const [questionText, setQuestionText] = useState('');
  const [submittingQuestion, setSubmittingQuestion] = useState(false);
  const [questionError, setQuestionError] = useState('');
  const [questionSent, setQuestionSent] = useState(false);

  const loadFaqs = useCallback(async () => {
    if (!product?.id) return;
    setFaqsLoading(true);
    try {
      const res = await fetch(apiUrl(`/api/products/${product.id}/faqs`));
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message || 'Could not load Q&A');
      setFaqs(body.data?.faqs || []);
    } catch {
      setFaqs([]);
    } finally {
      setFaqsLoading(false);
    }
  }, [product?.id]);

  useEffect(() => { loadFaqs(); }, [loadFaqs]);

  const openAskModal = () => {
    setQuestionText('');
    setQuestionError('');
    setQuestionSent(false);
    setShowAskModal(true);
  };

  const submitQuestion = async () => {
    const question = questionText.trim();
    if (!question) return;
    setSubmittingQuestion(true);
    setQuestionError('');
    try {
      const token = localStorage.getItem('userToken');
      if (!token) throw new Error('Please sign in to ask a question.');

      const res = await fetch(apiUrl(`/api/products/${product.id}/faqs`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ question }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message || 'Could not submit your question');

      setQuestionSent(true);
    } catch (err) {
      setQuestionError(err.message);
    } finally {
      setSubmittingQuestion(false);
    }
  };

  const allImages = Array.isArray(product?.images) && product.images.length > 0
    ? product.images
    : [product?.image].filter(Boolean);
  const activeImage = allImages[activeImageIndex] || product?.image;

  /**
   * Whether this listing's SHG seller currently has an active subscription.
   *
   * Browse feeds already exclude these products server-side, so this only
   * matters for a product reached by a direct link or one still sitting in
   * an older cart. Asked of the server rather than derived from the list
   * row, because the list row never carries the flag.
   */
  const [unavailable, setUnavailable] = useState(false);
  // A live Campaign deal, if this product has one right now — never
  // trusted from whatever the card that opened this page already had in
  // memory, since a deal can start or end between browsing and opening.
  const [campaignDeal, setCampaignDeal] = useState(null);
  const campaignPriceForVariant = campaignDeal?.discountValue != null && selectedPrice != null
    ? Math.round(Number(selectedPrice) * (1 - Number(campaignDeal.discountValue) / 100) * 100) / 100
    : campaignDeal?.price;
  // QUICK COMMERCE ONLY — `returnPolicy` is only ever present on a
  // `type: "grocery"` product's own GET /api/products/:id response (see
  // product.controller.js::getProductById); an E-commerce product's
  // response never carries it, so this stays null there and the block
  // below never renders.
  const [returnInfo, setReturnInfo] = useState(null);
  useEffect(() => {
    if (!product?.id) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(apiUrl(`/api/products/${product.id}`));
        const data = await res.json();
        if (!cancelled) {
          if (Array.isArray(data?.variants)) {
            setLoadedVariants(data.variants.map((variant) => ({ ...variant, id: String(variant._id) })));
            setLoadedProductId(String(product.id));
          }
          setUnavailable(Boolean(data?.subscriptionUnavailable));
          setCampaignDeal(data?.campaignPrice ? {
            price: data.campaignPrice, discountValue: data.campaignDiscountValue, title: data.campaignTitle,
          } : null);
          setReturnInfo(data?.returnPolicy || null);
        }
      } catch { /* leave it purchasable rather than blocking on a network blip */ }
    })();
    return () => { cancelled = true; };
  }, [product?.id]);

  /**
   * What delivery this customer can actually get for this item.
   *
   * Asked with the quantity on screen, because three of something is a
   * different question from one when only two are in stock — which is exactly
   * the sort of promise a listing badge cannot make and a product page must.
   */
  const deliveryPoint = getDeliveryPoint();
  const isEcom = product?.type === 'ecommerce';
  const { options: deliveryOptions, loading: deliveryLoading } =
    useProductDeliveryOptions(isEcom ? product?.id : null, deliveryPoint, Math.max(1, qty), selectedVariantId || null);
  const sameDay = deliveryOptions?.sameDay;

  useEffect(() => {
    const first = productVariants[0];
    setSelectedVariantId(first ? String(first.id || first._id || '') : '');
  }, [product?.id, loadedProductId]);
  useEffect(() => setQty(getItemQty(product?.id, selectedVariantId)), [product?.id, selectedVariantId]);

  // Related products (others)
  // Related items come from the same storefront as the product being viewed.
  const { products: catalogue } = useProducts({ type: selectedProduct?.type, limit: 12 });
  const related = (catalogue || []).filter((p) => p.id !== product?.id).slice(0, 8);

  if (!product) return null;

  const handleAddToCart = async () => {
    if (cartActionPending) return;
    setCartActionPending(true);
    setCartActionError('');
    const result = await addToCart(product.id, 1, selectedVariantId || undefined);
    setCartActionPending(false);
    if (!result?.ok) {
      setCartActionError(result?.message || 'Could not add this item to your cart. Please try again.');
      return;
    }
    // Only reflect a quantity the server actually accepted. The previous
    // optimistic increment turned the CTA into “GO TO CART (1)” after a failed
    // request, which then led to an empty basket.
    setQty(result.data?.items?.find((item) => String(item.productId) === String(product.id)
      && String(item.variantId || '') === String(result.variantId || ''))?.qty || 1);
  };

  /** Close the detail view and land on the basket. */
  const goToCart = () => {
    setSelectedProduct(null);
    setActiveNav('cart');
  };

  /**
   * Buy Now is Add to Cart followed by going straight there — so the add is
   * awaited rather than fired off. Navigating first would open the basket
   * before the server had the line, and the shopper would see it empty for
   * the moment it took to arrive.
   */
  const handleBuyNow = async () => {
    if (cartActionPending) return;
    setCartActionPending(true);
    setCartActionError('');
    if (qty === 0) {
      const result = await addToCart(product.id, 1, selectedVariantId || undefined);
      if (!result?.ok) {
        setCartActionPending(false);
        setCartActionError(result?.message || 'Could not add this item to your cart. Please try again.');
        return;
      }
    }
    setCartActionPending(false);
    setSelectedProduct(null);
    setActiveNav('checkout');
  };

  return (
    <div className="product-detail-page">
      {/* Sticky header bar */}
      <div className="pd-sticky-header">
        <button className="pd-back-btn" onClick={() => setSelectedProduct(null)} aria-label="Go back">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <div className="pd-header-actions">
          <button className="pd-icon-btn" aria-label="Share" onClick={() => {}}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
              <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" /><line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
            </svg>
          </button>
          <button
            className="pd-icon-btn"
            aria-label={isWishlisted(product.id) ? 'Remove from Wishlist' : 'Add to Wishlist'}
            aria-pressed={isWishlisted(product.id)}
            onClick={async () => {
              const r = await toggleWishlist(product.id);
              if (r && r.ok === false) alert(r.message || 'Could not update your wishlist.');
            }}
          >
            <svg
              width="18" height="18" viewBox="0 0 24 24"
              fill={isWishlisted(product.id) ? '#ef4444' : 'none'}
              stroke={isWishlisted(product.id) ? '#ef4444' : 'currentColor'}
              strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
            >
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
            </svg>
          </button>
        </div>
      </div>

      {/* Product image hero */}
      <div className="pd-image-hero">
        <img src={activeImage} alt={product.name} className="pd-hero-img" />
        {/* Offer badge */}
        <div className="pd-offer-badge">5% OFF</div>
      </div>

      {/* Horizontal thumbnail gallery carousel */}
      {allImages.length > 1 && (
        <div className="pd-thumbnails-container">
          {allImages.map((imgUrl, idx) => (
            <button
              key={idx}
              type="button"
              className={`pd-thumbnail-btn ${activeImageIndex === idx ? 'active' : ''}`}
              onClick={() => setActiveImageIndex(idx)}
            >
              <img src={imgUrl} alt={`${product.name} ${idx + 1}`} />
            </button>
          ))}
        </div>
      )}

      {/* Product info card */}
      <div className="pd-info-card">
        <div className="pd-info-top">
          <div>
            <h1 className="pd-product-name">{product.name}</h1>
            <p className="pd-pack-info">1 Pack • 250g</p>
          </div>
          <button className="pd-view-details-btn">View details</button>
        </div>

        {productVariants.length > 1 && (
          <label style={{ display: 'grid', gap: 6, margin: '12px 0', color: '#172B4D', fontWeight: 700, fontSize: 13 }}>
            Choose pack / variant
            <select value={selectedVariantId} onChange={(event) => setSelectedVariantId(event.target.value)} style={{ minHeight: 42, border: '1px solid #E2E8F0', borderRadius: 10, padding: '0 12px', background: '#fff', color: '#172B4D' }}>
              {productVariants.map((variant) => {
                const id = String(variant.id || variant._id || '');
                const attrs = (variant.attributes || []).map((attribute) => `${attribute.name}: ${attribute.value}`).join(', ');
                return <option key={id} value={id} disabled={Number(variant.stock) < 1}>{variant.name}{attrs ? ` · ${attrs}` : ''} · {formatCurrency(variant.price)}{Number(variant.stock) < 1 ? ' · Out of stock' : ''}</option>;
              })}
            </select>
          </label>
        )}

        {/* Rating row */}
        <div className="pd-rating-row">
          <Stars rating={product.rating} size={13} />
          <span className="pd-rating-count">{product.rating} ({Math.floor(Math.random() * 200 + 100)} ratings)</span>
        </div>

        {/* Price row */}
        <div className="pd-price-row">
          {campaignDeal ? (
            <>
              <span className="pd-price" style={{ color: '#b91c1c' }}>{formatCurrency(campaignPriceForVariant)}</span>
              <span className="pd-mrp"><s style={{ color: '#94a3b8' }}>{formatCurrency(selectedPrice)}</s></span>
              <span style={{ fontSize: 11.5, fontWeight: 900, color: '#b91c1c' }}>{campaignDeal.discountValue}% OFF</span>
            </>
          ) : (
            <>
              <span className="pd-price">{formatCurrency(selectedPrice)}</span>
              {selectedMrp > selectedPrice && (
                <span className="pd-mrp">MRP <s style={{ color: '#94a3b8' }}>{formatCurrency(selectedMrp)}</s></span>
              )}
            </>
          )}
        </div>
        {campaignDeal?.title && (
          <p style={{ margin: '2px 0 0', fontSize: 11, fontWeight: 700, color: '#b91c1c' }}>🔥 {campaignDeal.title}</p>
        )}

        {/* Seller */}
        <p className="pd-seller-info">Sold by <strong>{product.shg}</strong></p>

        {unavailable && <UnavailableBadge style={{ marginTop: 10 }} />}
        <p style={{ margin: '8px 0 0', color: selectedStock > 0 ? '#64748B' : '#DC2626', fontSize: 12 }}>{selectedStock > 0 ? `${selectedStock} available` : 'Currently out of stock'}</p>
      </div>

      {/* Offers section */}
      <div className="pd-section-card">
        <h3 className="pd-section-title">
          <span style={{ color: '#FF8500' }}>%</span> Offers &amp; Coupons
        </h3>
        <div className="pd-offer-row">
          <div className="pd-offer-icon">🎁</div>
          <div>
            <p className="pd-offer-headline">Promotions &amp; Coupons</p>
            <p className="pd-offer-subtext">Buy 2 get 1 free · Get ₹50 cashback (Min. ₹199)</p>
          </div>
        </div>
        <button className="pd-see-all-btn">See all offers →</button>
      </div>

      {/*
        Delivery, for this address and this product.

        Everything here used to be painted in — "New Delhi, 110001", "Express
        30–60 min", "Standard 2–4 days" — regardless of who was looking or what
        they were looking at. It now shows the customer's own address and the
        server's verdict, including the reason when same-day is not on offer.
        A refusal with a reason is worth more than a missing row.
      */}
      <div className="pd-section-card">
        <h3 className="pd-section-title">🚚 Delivery Details</h3>
        <div className="pd-delivery-row">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--primary-hover)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></svg>
          <div style={{ flex: 1 }}>
            <span className="pd-delivery-label">Deliver to</span>
            <span className="pd-delivery-address">
              {getLocationDisplayName(getSelectedAddress()) || 'Set your location'}
            </span>
          </div>
          <button className="pd-change-btn" onClick={() => setActiveNav('account')}>Change</button>
        </div>

        {isEcom && (
          deliveryPoint ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
              {/*
                Same-Day is shown only when it is genuinely on offer.

                It used to render greyed-out with the server's reason attached,
                on the theory that a stated refusal beats a missing row. For a
                product the customer is deciding about, that reads as a service
                being withheld — most of the reasons ("this store is not
                offering same-day delivery") are about a shop that simply never
                opted in, which is not news the shopper needs. Absent is the
                honest default; Scheduled below is what they actually get.
              */}
              {sameDay?.available && (
                <div style={{
                  display: 'flex', alignItems: 'flex-start', gap: 9, padding: '9px 11px',
                  borderRadius: 10, background: '#dcfce7',
                }}>
                  <span style={{ fontSize: 14 }}>⚡</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 800, color: '#166534' }}>
                      Same-day delivery
                    </div>
                    <div style={{ fontSize: 10.5, color: '#166534', marginTop: 1 }}>
                      Arrives by {new Date(sameDay.promisedBy).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}
                      {/* The premium, not the whole delivery line — same reason
                          the checkout writes it with a plus. */}
                      {' · +₹'}{sameDay.customerDeliveryCharge} for same-day
                    </div>
                  </div>
                </div>
              )}

              <div style={{
                display: 'flex', alignItems: 'flex-start', gap: 9, padding: '9px 11px',
                borderRadius: 10, background: '#f1f5f9',
              }}>
                <span style={{ fontSize: 14 }}>📦</span>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 800, color: '#334155' }}>Scheduled delivery</div>
                  <div style={{ fontSize: 10.5, color: '#64748b', marginTop: 1 }}>
                    Sent by courier, usually 2–4 days
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div style={{
              padding: '10px 12px', borderRadius: 10, background: '#f1f5f9',
              fontSize: 11, color: '#64748b', fontWeight: 600, marginTop: 4,
            }}>
              Add a delivery address to see whether this can reach you today.
            </div>
          )
        )}
      </div>

      {/*
        Return Policy — QUICK COMMERCE ONLY.
        `returnInfo` (= product.returnPolicy from the API) is only ever set
        for a grocery-type product, so this block simply never renders on
        an E-commerce product page. The day count is never computed here —
        it's whatever the server already resolved from Admin's Category
        Return Policy (product.controller.js::getProductById).
      */}
      {!isEcom && returnInfo && (
        <div className="pd-section-card">
          <h3 className="pd-section-title">Return Policy</h3>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 9, padding: '9px 11px',
            borderRadius: 10, background: returnInfo.eligible ? '#dcfce7' : '#fee2e2',
          }}>
            <span style={{ fontSize: 14 }}>{returnInfo.eligible ? '✓' : '✕'}</span>
            <span style={{ fontSize: 12.5, fontWeight: 800, color: returnInfo.eligible ? '#166534' : '#991b1b' }}>
              {returnInfo.eligible ? `${returnInfo.returnWindowDays} Days Return Available` : 'Non-Returnable'}
            </span>
          </div>
        </div>
      )}

      {/* Tabs for description / details */}
      <div className="pd-section-card" style={{ paddingBottom: 0 }}>
        <div className="pd-tabs-row">
          {['desc', 'details'].map(t => (
            <button
              key={t}
              className={`pd-tab-btn ${activeTab === t ? 'active' : ''}`}
              onClick={() => setActiveTab(t)}
            >
              {t === 'desc' ? 'Description' : 'Product Info'}
            </button>
          ))}
        </div>

        <div className="pd-tab-content">
          {activeTab === 'desc' && (
            <p className="pd-description-text">
              {product.description || `Experience authentic products by ${product.shg || 'our sellers'}. 100% genuine quality sourced directly for you.`}
            </p>
          )}
          {activeTab === 'details' && (
            <div>
              {[
                ['Seller', product.shg || 'Partner Seller'],
                ['Category', product.category || 'General'],
                ['Fulfillment', product.type === 'grocery' ? '30-Min Express' : 'Standard Shipping'],
                ['Country of Origin', 'India'],
              ].map(([k, v]) => (
                <div key={k} className="pd-info-row">
                  <span className="pd-info-key">{k}</span>
                  <span className="pd-info-val">{v}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* You may also like */}
      <div className="pd-section-card">
        <h3 className="pd-section-title">You may also like</h3>
        <div className="pd-related-scroll">
          {related.map(rp => (
            <div
              key={rp.id}
              className="pd-related-card"
              onClick={() => setSelectedProduct(rp)}
            >
              <div className="pd-related-img-wrap">
                <img src={rp.image} alt={rp.name} className="pd-related-img" />
              </div>
              <div className="pd-related-info">
                <p className="pd-related-name">{rp.name}</p>
                <p className="pd-related-pack">250g</p>
                <div className="pd-related-footer">
                  <span className="pd-related-price">{formatCurrency(rp.price)}</span>
                  <button
                    className="pd-related-add"
                    onClick={e => { e.stopPropagation(); addToCart(rp); }}
                    aria-label={`Add ${rp.name}`}
                  >
                    +
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Q&A Section */}
      <div className="pd-section-card">
        <h3 className="pd-section-title">Questions &amp; Answers</h3>
        {faqsLoading ? (
          <p style={{ fontSize: 12.5, color: '#64748b', textAlign: 'center', padding: '12px 0' }}>
            Loading questions…
          </p>
        ) : faqs.length === 0 ? (
          <p style={{ fontSize: 12.5, color: '#94a3b8', padding: '4px 0 8px' }}>
            No questions answered yet — be the first to ask.
          </p>
        ) : (
          faqs.map((faq) => (
            <div key={faq._id} className="pd-faq-item">
              <p className="pd-faq-q">Q. {faq.question}</p>
              <p className="pd-faq-a">{faq.answer}</p>
            </div>
          ))
        )}
        <button className="pd-see-all-btn" onClick={openAskModal}>Ask a question →</button>
      </div>

      {/* Ratings & Reviews — approved reviews only, straight from the server */}
      <div className="pd-section-card">
        <h3 className="pd-section-title">Ratings &amp; Reviews</h3>

        <div className="pd-rating-summary">
          <div className="pd-rating-big">
            <span className="pd-rating-score">{ratingSummary.count ? ratingSummary.average : '—'}</span>
            <Stars rating={ratingSummary.average} size={16} />
            <span className="pd-rating-total">
              {ratingSummary.count} {ratingSummary.count === 1 ? 'rating' : 'ratings'}
            </span>
          </div>
          <div className="pd-rating-bars">
            {ratingSummary.breakdown.map(rd => (
              <RatingBar key={rd.star} label={String(rd.star)} pct={rd.percent} count={rd.count} />
            ))}
          </div>
        </div>

        {/* Write a review */}
        <p className="pd-rate-prompt">
          {myRating ? 'Your rating — add a comment below' : 'Tap to rate this product'}
        </p>
        <div className="pd-rate-stars">
          {[1, 2, 3, 4, 5].map(i => (
            <svg
              key={i}
              onClick={() => setMyRating(i)}
              role="button"
              aria-label={`Rate ${i} star${i === 1 ? '' : 's'}`}
              width="32" height="32" viewBox="0 0 24 24"
              fill={i <= myRating ? '#f59e0b' : '#e2e8f0'}
              stroke="none"
              style={{ cursor: 'pointer' }}
            >
              <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26" />
            </svg>
          ))}
        </div>

        {myRating > 0 && (
          <div style={{ marginTop: 12 }}>
            <textarea
              value={myComment}
              onChange={(e) => setMyComment(e.target.value)}
              placeholder="What did you think of it? (optional)"
              rows={3}
              style={{
                width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 12,
                border: '1.5px solid #e2e8f0', fontSize: 13, fontFamily: 'inherit', resize: 'vertical',
              }}
            />
            {reviewError && (
              <p style={{ margin: '8px 0 0', fontSize: 12, color: '#b91c1c' }}>{reviewError}</p>
            )}
            <button
              onClick={submitReview}
              disabled={submittingReview}
              style={{
                marginTop: 10, width: '100%', padding: '12px 0', borderRadius: 12, border: 'none',
                background: submittingReview ? '#94a3b8' : 'var(--primary)', color: '#fff',
                fontSize: 13, fontWeight: 900, cursor: submittingReview ? 'not-allowed' : 'pointer',
              }}
            >
              {submittingReview ? 'Submitting…' : 'Submit Review'}
            </button>
          </div>
        )}

        {/* Individual reviews */}
        <div style={{ marginTop: 16 }}>
          {reviewsLoading ? (
            <p style={{ fontSize: 12.5, color: '#64748b', textAlign: 'center', padding: '16px 0' }}>
              Loading reviews…
            </p>
          ) : reviews.length === 0 ? (
            <p style={{ fontSize: 12.5, color: '#94a3b8', textAlign: 'center', padding: '16px 0' }}>
              No reviews yet — be the first to review this product.
            </p>
          ) : (
            reviews.map((rev) => (
              <div key={rev._id} className="pd-review-item">
                <div className="pd-review-header">
                  <div className="pd-reviewer-avatar">{(rev.userName || 'S').charAt(0).toUpperCase()}</div>
                  <div>
                    <span className="pd-reviewer-name">{rev.userName}</span>
                    <Stars rating={rev.rating} size={11} />
                  </div>
                  <span className="pd-review-date">
                    {rev.createdAt
                      ? new Date(rev.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
                      : ''}
                  </span>
                </div>
                {rev.comment && <p className="pd-review-text">{rev.comment}</p>}

                {Array.isArray(rev.images) && rev.images.length > 0 && (
                  <div style={{ display: 'flex', gap: 8, marginTop: 10, overflowX: 'auto', paddingBottom: 4 }}>
                    {rev.images.map((imgUrl, imgIdx) => (
                      <img
                        key={imgIdx}
                        src={imgUrl}
                        alt={`Review photo ${imgIdx + 1}`}
                        style={{
                          width: 72,
                          height: 72,
                          borderRadius: 10,
                          objectFit: 'cover',
                          border: '1.5px solid #e2e8f0',
                          cursor: 'pointer',
                          boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
                        }}
                        onClick={() => window.open(imgUrl, '_blank')}
                      />
                    ))}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {/* Spacer for sticky CTA */}
      <div style={{ height: 90 }} />

      {/* Sticky bottom CTA — the price is not repeated here; it already sits
          in the product header a few hundred pixels up, and this bar is for
          the two decisions a shopper makes at this point. */}
      {cartActionError && (
        <div className="cart-action-feedback" role="alert" style={{ position: 'absolute', left: 12, right: 12, bottom: 72, zIndex: 101 }}>
          {cartActionError}
        </div>
      )}
      <div className="pd-sticky-cta">
        {unavailable ? (
          <button className="pd-flipkart-btn disabled" disabled>
            CURRENTLY UNAVAILABLE
          </button>
        ) : (
          <>
            {qty === 0 ? (
              <button className="pd-flipkart-btn add-cart" onClick={handleAddToCart} disabled={cartActionPending || !(selectedStock > 0) || (productVariants.length > 1 && !selectedVariantId)}>
                <CartIcon />
                {cartActionPending ? 'ADDING…' : 'ADD TO CART'}
              </button>
            ) : (
              <button className="pd-flipkart-btn go-cart" onClick={goToCart}>
                <CartIcon />
                GO TO CART ({qty})
              </button>
            )}

            <button className="pd-flipkart-btn buy-now" onClick={handleBuyNow} disabled={cartActionPending || !(selectedStock > 0) || (productVariants.length > 1 && !selectedVariantId)}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
              </svg>
              {cartActionPending ? 'PLEASE WAIT…' : 'BUY NOW'}
            </button>
          </>
        )}
      </div>

      {/* Ask a Question modal */}
      {showAskModal && (
        <div
          onClick={() => !submittingQuestion && setShowAskModal(false)}
          style={{
            position: 'absolute',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.65)',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'center',
            padding: '16px 12px 16px 12px',
            boxSizing: 'border-box',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%',
              maxWidth: 440,
              background: '#fff',
              borderRadius: 20,
              padding: 18,
              boxSizing: 'border-box',
              maxHeight: '90%',
              overflowY: 'auto',
              boxShadow: '0 8px 30px rgba(0,0,0,0.25)',
              scrollbarWidth: 'none',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800, color: '#0f172a' }}>Ask a question</h3>
              <button
                onClick={() => setShowAskModal(false)}
                style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: '#64748b' }}
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            {questionSent ? (
              <div style={{ textAlign: 'center', padding: '20px 0' }}>
                <p style={{ fontSize: 13.5, color: '#166534', fontWeight: 700, margin: '0 0 16px' }}>
                  Thank you! Your question has been submitted and a seller will answer it soon.
                </p>
                <button
                  onClick={() => setShowAskModal(false)}
                  style={{ padding: '10px 20px', borderRadius: 10, border: 'none', background: 'var(--primary)', color: '#fff', fontWeight: 800, cursor: 'pointer' }}
                >
                  Close
                </button>
              </div>
            ) : (
              <>
                <p style={{ fontSize: 12, color: '#64748b', margin: '0 0 10px' }}>
                  Asking about <strong>{product.name}</strong>
                </p>
                <textarea
                  value={questionText}
                  onChange={(e) => setQuestionText(e.target.value)}
                  placeholder="e.g. Does this come with a warranty?"
                  rows={3}
                  style={{
                    width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 12,
                    border: '1.5px solid #e2e8f0', fontSize: 13, fontFamily: 'inherit', resize: 'vertical',
                  }}
                />
                {questionError && (
                  <p style={{ margin: '8px 0 0', fontSize: 12, color: '#b91c1c' }}>{questionError}</p>
                )}
                <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
                  <button
                    onClick={() => setShowAskModal(false)}
                    disabled={submittingQuestion}
                    style={{
                      flex: 1, padding: '12px 0', borderRadius: 12, border: '1.5px solid #e2e8f0',
                      background: '#fff', color: '#475569', fontSize: 13, fontWeight: 800, cursor: 'pointer',
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={submitQuestion}
                    disabled={submittingQuestion || !questionText.trim()}
                    style={{
                      flex: 1, padding: '12px 0', borderRadius: 12, border: 'none',
                      background: submittingQuestion || !questionText.trim() ? '#94a3b8' : 'var(--primary)',
                      color: '#fff', fontSize: 13, fontWeight: 900,
                      cursor: submittingQuestion || !questionText.trim() ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {submittingQuestion ? 'Submitting…' : 'Submit Question'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default ProductDetailPage;
