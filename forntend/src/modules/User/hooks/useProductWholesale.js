import { readProductRoute } from '../utils/productRoute';
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiUrl } from '../../../utils/api';
import { boundedFetch } from '../../../utils/portalRequests';
import { captureUserSession, isCurrentUserSession } from '../../../utils/userSession';

export function useProductWholesale({ productId, variantId, currentUser, enabled = true, retailAvailable = true, wholesaleDetail = false, openCart, onSignIn }) {
  const token = currentUser ? localStorage.getItem('userToken') : null;
  const key = `${productId}:${token || ''}`;
  const [selection, setSelection] = useState(() => ({ productId, mode: readProductRoute().id === String(productId) ? readProductRoute().mode : 'retail' }));
  const mode = !enabled ? 'retail' : !retailAvailable || wholesaleDetail ? 'wholesale' : selection.productId === productId ? selection.mode : readProductRoute().id === String(productId) ? readProductRoute().mode : 'retail';
  useEffect(() => {
    const restore = () => setSelection({ productId, mode: readProductRoute().id === String(productId) ? readProductRoute().mode : 'retail' });
    window.addEventListener('popstate', restore);window.addEventListener('app:locationchange',restore);
    return () => {window.removeEventListener('popstate',restore);window.removeEventListener('app:locationchange',restore);};
  }, [productId]);
  const [catalog, setCatalog] = useState(null), [catalogError, setCatalogError] = useState('');
  const shownCatalogKey = useRef(null);
  shownCatalogKey.current = catalog?.key ?? null;
  const [loading, setLoading] = useState(false), [revision, setRevision] = useState(0);
  const [quantityInput, setQuantityInput] = useState(null), [preview, setPreview] = useState(null);
  const [quoteLoading, setQuoteLoading] = useState(false), [error, setError] = useState('');
  const [pending, setPending] = useState(false), [message, setMessage] = useState('');
  const lock = useRef(false);
  const identity = `${key}:${variantId}:${mode}`;
  useEffect(() => { setError(''); setMessage(''); }, [identity]);
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  useEffect(() => {
    if (!variantId) return;
    const params = new URLSearchParams(window.location.search);
    if (!readProductRoute().present) return;
    params.set('variant', variantId);
    window.history.replaceState(window.history.state, '', `${window.location.pathname}?${params}`);
  }, [productId, variantId]);
  const chooseMode = next => {
    if (pending || (next === 'retail' && !retailAvailable)) return;
    setSelection({ productId, mode: next }); setError(''); setMessage('');
    const params = new URLSearchParams(window.location.search);
    if (next === 'wholesale') params.set('purchase','wholesale'); else if(readProductRoute().wholesalePath) params.set('purchase','retail'); else params.delete('purchase');
    window.history.pushState(window.history.state, '', `${window.location.pathname}?${params}`);
    window.dispatchEvent(new Event('app:locationchange'));
    if (next === 'wholesale') refresh();
  };
  useEffect(() => {
    window.addEventListener('focus', refresh);
    const timer = setInterval(refresh, 30000);
    return () => { window.removeEventListener('focus', refresh); clearInterval(timer); };
  }, [refresh]);
  useEffect(() => {
    let active = true;
    const controller = new AbortController(), session = captureUserSession();
    // A background refresh (every 30s, on focus) keeps the offer on screen;
    // clearing it first made the whole panel and its quantity box blink away.
    const hasCurrent = shownCatalogKey.current === key;
    if (!hasCurrent) setCatalog(null);
    setCatalogError(''); setLoading(Boolean(enabled && productId) && !hasCurrent);
    if (enabled && productId) {
      boundedFetch(apiUrl(`/api/products/wholesale/catalog?productId=${encodeURIComponent(productId)}`), {
        cache: 'no-store', signal: controller.signal,
      }).then(async response => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.message || `Wholesale availability could not be checked (${response.status}). Please retry.`);
        if (!Array.isArray(body.data)) throw new Error('Wholesale availability could not be checked. Please retry.');
        if (active && isCurrentUserSession(session)) setCatalog({ key, variants: body.data?.[0]?.variants || [] });
      }).catch(err => {
        if (active && isCurrentUserSession(session) && err.name !== 'AbortError') setCatalogError(err.message);
      }).finally(() => { if (active) setLoading(false); });
    }
    return () => { active = false; controller.abort(); };
  }, [key, enabled, revision, variantId]);
  const variants = catalog?.key === key ? catalog.variants : [];
  const offer = variants.find(item => String(item.variantId) === String(variantId));
  // The quote depends on the offer's terms, not on its object identity, which
  // changes on every background catalog refresh.
  const offerTerms = offer ? JSON.stringify(['minimumQuantity', 'quantityIncrement', 'maxQuantity', 'availableStock', 'priceTiers'].map(field => offer[field])) : '';
  const offerRef = useRef(offer); offerRef.current = offer;
  const quantityKey = `${key}:${variantId}:${offer?.minimumQuantity}:${offer?.quantityIncrement}`;
  const quantity = quantityInput?.key === quantityKey ? quantityInput.value : (offer?.minimumQuantity || 0);
  const setQuantity = value => { setQuantityInput({ key: quantityKey, value }); setMessage(''); };
  const validQuantity = Boolean(offer && Number.isSafeInteger(quantity) && quantity >= offer.minimumQuantity && quantity <= offer.maxQuantity && (quantity - offer.minimumQuantity) % offer.quantityIncrement === 0);
  const quoteKey = `${quantityKey}:${quantity}:${revision}:${mode}:${offerTerms}`;
  const purchaseIdentity = `${identity}:${quantity}`;
  const latestPurchase = useRef(purchaseIdentity);latestPurchase.current=purchaseIdentity;
  useEffect(()=>()=>{latestPurchase.current=null;},[]);
  useEffect(() => {
    let active = true;
    const controller = new AbortController(), session = captureUserSession();
    const offer = offerRef.current;
    // The last quote stays on screen while the next one is checked (it is
    // only purchasable once its key matches); clearing it made the panel jump
    // on every quantity step and every background refresh.
    setQuoteLoading(false);
    let timer;
    if (mode === 'wholesale' && validQuantity && token && offer) {
      setError(''); setQuoteLoading(true);
      // Wait for the shopper to stop stepping/typing before asking for a price.
      timer = setTimeout(() => boundedFetch(apiUrl('/api/products/wholesale/quote'), {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId, variantId, quantity }), signal: controller.signal, cache: 'no-store',
      }).then(async response => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.message || 'Wholesale price could not be checked.');
        if (active && isCurrentUserSession(session)) {
          const fresh = body.data;
          if(!fresh || (fresh.productId && String(fresh.productId)!==String(productId)) || (fresh.variantId && String(fresh.variantId)!==String(variantId)) || fresh.quantity!==quantity || !Number.isFinite(fresh.unitPrice) || fresh.unitPrice<=0 || !Number.isFinite(fresh.subtotal) || fresh.subtotal<=0) throw new Error('The Wholesale quote did not match this selection. Refresh the offer.');
          const changed = ['minimumQuantity', 'quantityIncrement', 'maxQuantity', 'availableStock', 'priceTiers'].some(field => JSON.stringify(fresh[field]) !== JSON.stringify(offer[field]));
          if (changed) setCatalog(current => current?.key === key ? { ...current, variants: current.variants.map(item => String(item.variantId) === String(variantId) ? { ...item, ...Object.fromEntries(['minimumQuantity', 'quantityIncrement', 'maxQuantity', 'availableStock', 'priceTiers'].map(field => [field, fresh[field]])) } : item) } : current);
          else setPreview({ key: quoteKey, selectionKey: quantityKey, offerTerms, data: fresh });
        }
      }).catch(err => {
        // Keep the offer on screen; the error carries its own Refresh action.
        if (active && isCurrentUserSession(session) && err.name !== 'AbortError') setError(err.message);
      }).finally(() => { if (active) setQuoteLoading(false); }), 350);
    }
    return () => { active = false; clearTimeout(timer); controller.abort(); };
  }, [quoteKey, mode, validQuantity, token, offerTerms]);
  const quote = mode === 'wholesale' && preview?.key === quoteKey && offer && !error && !catalogError ? preview.data : null;
  // Retain the previous layout during quantity checks. The component hides its
  // amounts if the quantity changed; only a matching fresh quote can be bought.
  const shownQuote = quote || (mode === 'wholesale' && offer && preview?.selectionKey === quantityKey && preview.offerTerms === offerTerms ? preview.data : null);
  const canPurchase = Boolean(mode === 'wholesale' && validQuantity && (quote || !token) && !loading && !quoteLoading && !pending && !error && !catalogError);
  // How many of this variant are already in the shopper's Wholesale cart, so
  // Buy Now can go straight there instead of adding the same quantity again
  // (which fails once it would exceed stock or the maximum order).
  const [cart, setCart] = useState(null);
  const cartKey = `${key}:${variantId}`;
  useEffect(() => {
    if (!token || !productId || !variantId || mode !== 'wholesale') return;
    const controller = new AbortController(), session = captureUserSession();
    boundedFetch(apiUrl('/api/cart/wholesale'), { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal, cache: 'no-store' })
      .then(response => response.ok ? response.json() : null)
      .then(body => {
        if (!body || !isCurrentUserSession(session)) return;
        const line = body.data?.items?.find(item => String(item.productId) === String(productId) && String(item.variantId) === String(variantId));
        setCart({ key: cartKey, qty: Number(line?.qty) || 0 });
      })
      .catch(() => { /* unknown cart state only means Buy Now adds as before */ });
    return () => controller.abort();
  }, [cartKey, token, mode]);
  const cartQty = cart?.key === cartKey ? cart.qty : 0;
  const add = async (buyNow = false) => {
    if (lock.current || !canPurchase) return;
    if (!token) { onSignIn?.(); return; }
    lock.current = true; setPending(true); setError(''); setMessage('');
    const session = captureUserSession();
    try {
      const response = await boundedFetch(apiUrl('/api/cart/wholesale'), {
        method: 'POST', headers: { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId, variantId, qty: quantity }),
      });
      const body = await response.json();
      if (!isCurrentUserSession(session) || latestPurchase.current !== purchaseIdentity) return;
      if (!response.ok) throw new Error(body.message || 'Could not add to the Wholesale cart.');
      const cartLine = body.data?.items?.find(item => String(item.productId) === String(productId) && String(item.variantId) === String(variantId));
      if (cartLine) setCart({ key: cartKey, qty: Number(cartLine.qty) || 0 });
      const changedPrice = cartLine && cartLine.price !== quote.unitPrice;
      setMessage(changedPrice ? 'Added to your cart. The current cart price has changed; review the updated quote before checkout.' : 'Added to your cart. Review the current quote and delivery charges before checkout.');
      window.dispatchEvent(new Event('cart:changed'));
      if (buyNow) openCart();
    } catch (err) {
      if (isCurrentUserSession(session) && latestPurchase.current === purchaseIdentity) { refresh(); setError(err.message); setMessage(err.message); }
    } finally { lock.current = false; setPending(false); }
  };
  // Buy Now: an item already in the cart goes straight to it; otherwise add, then go.
  const buyNow = () => { if (token && cartQty > 0 && !pending) { openCart(); return; } return add(true); };
  const canBuyNow = canPurchase || Boolean(token && cartQty > 0 && mode === 'wholesale' && !pending);
  return { mode, chooseMode, retailAvailable, available: variants.length > 0, offer, quantity, setQuantity, validQuantity, quote, shownQuote, loading, quoteLoading, catalogError, error, message, pending, canPurchase, canBuyNow, cartQty, add, buyNow, refresh, openCart };
}
