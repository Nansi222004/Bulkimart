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
  const quoteKey = `${quantityKey}:${quantity}:${revision}:${mode}`;
  const purchaseIdentity = `${identity}:${quantity}`;
  const latestPurchase = useRef(purchaseIdentity);latestPurchase.current=purchaseIdentity;
  useEffect(()=>()=>{latestPurchase.current=null;},[]);
  useEffect(() => {
    let active = true;
    const controller = new AbortController(), session = captureUserSession();
    const offer = offerRef.current;
    setPreview(null); setQuoteLoading(false);
    if (mode === 'wholesale' && validQuantity && token && offer) {
      setError(''); setQuoteLoading(true);
      boundedFetch(apiUrl('/api/products/wholesale/quote'), {
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
          else setPreview({ key: quoteKey, data: fresh });
        }
      }).catch(err => {
        if (active && isCurrentUserSession(session) && err.name !== 'AbortError') { setCatalog(null); setError(err.message); }
      }).finally(() => { if (active) setQuoteLoading(false); });
    }
    return () => { active = false; controller.abort(); };
  }, [quoteKey, mode, validQuantity, token, offerTerms]);
  const quote = mode === 'wholesale' && preview?.key === quoteKey && offer ? preview.data : null;
  const canPurchase = Boolean(mode === 'wholesale' && validQuantity && (quote || !token) && !loading && !quoteLoading && !pending && !error);
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
      const changedPrice = cartLine && cartLine.price !== quote.unitPrice;
      setMessage(changedPrice ? 'Added to your cart. The current cart price has changed; review the updated quote before checkout.' : 'Added to your cart. Review the current quote and delivery charges before checkout.');
      window.dispatchEvent(new Event('cart:changed'));
      if (buyNow) openCart();
    } catch (err) {
      if (isCurrentUserSession(session) && latestPurchase.current === purchaseIdentity) { refresh(); setError(err.message); setMessage(err.message); }
    } finally { lock.current = false; setPending(false); }
  };
  return { mode, chooseMode, retailAvailable, available: variants.length > 0, offer, quantity, setQuantity, validQuantity, quote, loading, quoteLoading, catalogError, error, message, pending, canPurchase, add, refresh, openCart };
}
