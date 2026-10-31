// Port of modules/User/hooks/useProductWholesale.js. The purchase mode lives in the route params (`purchase`)
// instead of the URL query. Quotes are debounced, matched to the exact selection, and only a fresh quote can be
// bought; the offer refreshes every 30 s and when the app returns to the foreground.
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { boundedFetch } from '../api/client';
import { local } from '../lib/storage';
import { emit, EVENTS } from '../lib/events';
import { captureUserSession, isCurrentUserSession } from '../lib/session';

const TERMS = ['minimumQuantity', 'quantityIncrement', 'maxQuantity', 'availableStock', 'priceTiers'];

export function useProductWholesale({ productId, variantId, currentUser, enabled = true, retailAvailable = true, wholesaleDetail = false, initialMode = 'retail', onModeChange, openCart, onSignIn }) {
  const token = currentUser ? local.getItem('userToken') : null;
  const key = `${productId}:${token || ''}`;
  const [selection, setSelection] = useState(() => ({ productId, mode: initialMode }));
  const mode = !enabled ? 'retail' : !retailAvailable || wholesaleDetail ? 'wholesale' : selection.productId === productId ? selection.mode : initialMode;
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
  const chooseMode = next => {
    if (pending || (next === 'retail' && !retailAvailable)) return;
    setSelection({ productId, mode: next }); setError(''); setMessage('');
    onModeChange?.(next);
    if (next === 'wholesale') refresh();
  };
  useEffect(() => {
    const appState = AppState.addEventListener('change', state => { if (state === 'active') refresh(); });
    const timer = setInterval(() => { if (AppState.currentState === 'active') refresh(); }, 30000);
    return () => { appState.remove(); clearInterval(timer); };
  }, [refresh]);
  useEffect(() => {
    let active = true;
    const controller = new AbortController(), snapshot = captureUserSession();
    const hasCurrent = shownCatalogKey.current === key;
    if (!hasCurrent) setCatalog(null);
    setCatalogError(''); setLoading(Boolean(enabled && productId) && !hasCurrent);
    if (enabled && productId) {
      boundedFetch(`/api/products/wholesale/catalog?productId=${encodeURIComponent(productId)}`, { signal: controller.signal }).then(async response => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.message || `Wholesale availability could not be checked (${response.status}). Please retry.`);
        if (!Array.isArray(body.data)) throw new Error('Wholesale availability could not be checked. Please retry.');
        if (active && isCurrentUserSession(snapshot)) setCatalog({ key, variants: body.data?.[0]?.variants || [] });
      }).catch(err => {
        if (active && isCurrentUserSession(snapshot) && err.name !== 'AbortError') setCatalogError(err.message);
      }).finally(() => { if (active) setLoading(false); });
    }
    return () => { active = false; controller.abort(); };
  }, [key, enabled, revision, variantId, productId]);
  const variants = catalog?.key === key ? catalog.variants : [];
  const offer = variants.find(item => String(item.variantId) === String(variantId));
  const offerTerms = offer ? JSON.stringify(TERMS.map(field => offer[field])) : '';
  const offerRef = useRef(offer); offerRef.current = offer;
  const quantityKey = `${key}:${variantId}:${offer?.minimumQuantity}:${offer?.quantityIncrement}`;
  const quantity = quantityInput?.key === quantityKey ? quantityInput.value : (offer?.minimumQuantity || 0);
  const setQuantity = value => { setQuantityInput({ key: quantityKey, value }); setMessage(''); };
  const validQuantity = Boolean(offer && Number.isSafeInteger(quantity) && quantity >= offer.minimumQuantity && quantity <= offer.maxQuantity && (quantity - offer.minimumQuantity) % offer.quantityIncrement === 0);
  const quoteKey = `${quantityKey}:${quantity}:${revision}:${mode}:${offerTerms}`;
  const purchaseIdentity = `${identity}:${quantity}`;
  const latestPurchase = useRef(purchaseIdentity); latestPurchase.current = purchaseIdentity;
  useEffect(() => () => { latestPurchase.current = null; }, []);
  useEffect(() => {
    let active = true;
    const controller = new AbortController(), snapshot = captureUserSession();
    const current = offerRef.current;
    setQuoteLoading(false);
    let timer;
    if (mode === 'wholesale' && validQuantity && token && current) {
      setError(''); setQuoteLoading(true);
      timer = setTimeout(() => boundedFetch('/api/products/wholesale/quote', {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId, variantId, quantity }), signal: controller.signal,
      }).then(async response => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.message || 'Wholesale price could not be checked.');
        if (active && isCurrentUserSession(snapshot)) {
          const fresh = body.data;
          if (!fresh || (fresh.productId && String(fresh.productId) !== String(productId)) || (fresh.variantId && String(fresh.variantId) !== String(variantId)) || fresh.quantity !== quantity || !Number.isFinite(fresh.unitPrice) || fresh.unitPrice <= 0 || !Number.isFinite(fresh.subtotal) || fresh.subtotal <= 0) throw new Error('The Wholesale quote did not match this selection. Refresh the offer.');
          const changed = TERMS.some(field => JSON.stringify(fresh[field]) !== JSON.stringify(current[field]));
          if (changed) setCatalog(c => (c?.key === key ? { ...c, variants: c.variants.map(item => (String(item.variantId) === String(variantId) ? { ...item, ...Object.fromEntries(TERMS.map(field => [field, fresh[field]])) } : item)) } : c));
          else setPreview({ key: quoteKey, selectionKey: quantityKey, offerTerms, data: fresh });
        }
      }).catch(err => {
        if (active && isCurrentUserSession(snapshot) && err.name !== 'AbortError') setError(err.message);
      }).finally(() => { if (active) setQuoteLoading(false); }), 350);
    }
    return () => { active = false; clearTimeout(timer); controller.abort(); };
  }, [quoteKey, mode, validQuantity, token, offerTerms]); // eslint-disable-line react-hooks/exhaustive-deps
  const quote = mode === 'wholesale' && preview?.key === quoteKey && offer && !error && !catalogError ? preview.data : null;
  const shownQuote = quote || (mode === 'wholesale' && offer && preview?.selectionKey === quantityKey && preview.offerTerms === offerTerms ? preview.data : null);
  const canPurchase = Boolean(mode === 'wholesale' && validQuantity && (quote || !token) && !loading && !quoteLoading && !pending && !error && !catalogError);
  const [cart, setCart] = useState(null);
  const cartKey = `${key}:${variantId}`;
  useEffect(() => {
    if (!token || !productId || !variantId || mode !== 'wholesale') return undefined;
    const controller = new AbortController(), snapshot = captureUserSession();
    boundedFetch('/api/cart/wholesale', { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal })
      .then(response => (response.ok ? response.json() : null))
      .then(body => {
        if (!body || !isCurrentUserSession(snapshot)) return;
        const line = body.data?.items?.find(item => String(item.productId) === String(productId) && String(item.variantId) === String(variantId));
        setCart({ key: cartKey, qty: Number(line?.qty) || 0 });
      }).catch(() => {});
    return () => controller.abort();
  }, [cartKey, token, mode]); // eslint-disable-line react-hooks/exhaustive-deps
  const cartQty = cart?.key === cartKey ? cart.qty : 0;
  const add = async (buyNow = false) => {
    if (lock.current || !canPurchase) return;
    if (!token) { onSignIn?.(); return; }
    lock.current = true; setPending(true); setError(''); setMessage('');
    const snapshot = captureUserSession();
    try {
      const response = await boundedFetch('/api/cart/wholesale', {
        method: 'POST', headers: { Authorization: `Bearer ${snapshot.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId, variantId, qty: quantity }),
      });
      const body = await response.json();
      if (!isCurrentUserSession(snapshot) || latestPurchase.current !== purchaseIdentity) return;
      if (!response.ok) throw new Error(body.message || 'Could not add to the Wholesale cart.');
      const cartLine = body.data?.items?.find(item => String(item.productId) === String(productId) && String(item.variantId) === String(variantId));
      if (cartLine) setCart({ key: cartKey, qty: Number(cartLine.qty) || 0 });
      const changedPrice = cartLine && cartLine.price !== quote.unitPrice;
      setMessage(changedPrice ? 'Added to your cart. The current cart price has changed; review the updated quote before checkout.' : 'Added to your cart. Review the current quote and delivery charges before checkout.');
      emit(EVENTS.CART_CHANGED);
      if (buyNow) openCart();
    } catch (err) {
      if (isCurrentUserSession(snapshot) && latestPurchase.current === purchaseIdentity) { refresh(); setError(err.message); setMessage(err.message); }
    } finally { lock.current = false; setPending(false); }
  };
  const buyNow = () => { if (token && cartQty > 0 && !pending) { openCart(); return undefined; } return add(true); };
  const canBuyNow = canPurchase || Boolean(token && cartQty > 0 && mode === 'wholesale' && !pending);
  return { mode, chooseMode, retailAvailable, available: variants.length > 0, offer, quantity, setQuantity, validQuantity, quote, shownQuote, loading, quoteLoading, catalogError, error, message, pending, canPurchase, canBuyNow, cartQty, add, buyNow, refresh, openCart };
}
