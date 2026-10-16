import { useCallback, useEffect, useRef, useState } from 'react';
import { apiUrl } from '../../../utils/api';
import { boundedFetch } from '../../../utils/portalRequests';
import { captureUserSession, isCurrentUserSession } from '../../../utils/userSession';

export function useProductWholesale({ productId, variantId, currentUser, enabled = true, openCart }) {
  const token = currentUser ? localStorage.getItem('userToken') : null;
  const key = `${productId}:${token || ''}`;
  const [selection, setSelection] = useState(() => ({ productId, mode: new URLSearchParams(window.location.search).get('purchase') === 'wholesale' ? 'wholesale' : 'retail' }));
  const mode = selection.productId === productId ? selection.mode : 'retail';
  useEffect(() => {
    const restore = () => setSelection({ productId, mode: new URLSearchParams(window.location.search).get('purchase') === 'wholesale' ? 'wholesale' : 'retail' });
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, [productId]);
  const [catalog, setCatalog] = useState(null), [catalogError, setCatalogError] = useState('');
  const [loading, setLoading] = useState(false), [revision, setRevision] = useState(0);
  const [quantityInput, setQuantityInput] = useState(null), [preview, setPreview] = useState(null);
  const [quoteLoading, setQuoteLoading] = useState(false), [error, setError] = useState('');
  const [pending, setPending] = useState(false), [message, setMessage] = useState('');
  const lock = useRef(false);
  const identity = `${key}:${variantId}`;
  const currentIdentity = useRef(identity);
  currentIdentity.current = identity;
  useEffect(() => { currentIdentity.current = identity; return () => { currentIdentity.current = null; }; }, [identity]);
  useEffect(() => { setError(''); setMessage(''); }, [identity]);
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  useEffect(() => {
    if (!variantId) return;
    const params = new URLSearchParams(window.location.search);
    if (!params.has('product')) return;
    params.set('variant', variantId);
    window.history.replaceState(null, '', `${window.location.pathname}?${params}`);
  }, [productId, variantId]);
  const chooseMode = next => {
    setSelection({ productId, mode: next }); setError(''); setMessage('');
    const params = new URLSearchParams(window.location.search);
    if (next === 'wholesale') params.set('purchase', 'wholesale'); else params.delete('purchase');
    window.history.replaceState(null, '', `${window.location.pathname}?${params}`);
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
    setCatalog(null); setCatalogError(''); setLoading(Boolean(enabled && token && productId));
    if (enabled && token && productId) {
      boundedFetch(apiUrl(`/api/products/wholesale/catalog?productId=${encodeURIComponent(productId)}`), {
        headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal: controller.signal,
      }).then(async response => {
        const body = await response.json();
        if (!response.ok) throw new Error(response.status === 401 || response.status === 403
          ? 'Please sign in with a customer account to view Wholesale offers.'
          : `Wholesale availability could not be checked (${response.status}). Please retry.`);
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
  const quantityKey = `${key}:${variantId}:${offer?.minimumQuantity}:${offer?.quantityIncrement}`;
  const quantity = quantityInput?.key === quantityKey ? quantityInput.value : (offer?.minimumQuantity || 0);
  const setQuantity = value => { setQuantityInput({ key: quantityKey, value }); setMessage(''); };
  const validQuantity = Boolean(offer && Number.isSafeInteger(quantity) && quantity >= offer.minimumQuantity && quantity <= offer.maxQuantity && (quantity - offer.minimumQuantity) % offer.quantityIncrement === 0);
  const quoteKey = `${quantityKey}:${quantity}:${revision}`;
  useEffect(() => {
    let active = true;
    const controller = new AbortController(), session = captureUserSession();
    setPreview(null); setQuoteLoading(false);
    if (mode === 'wholesale' && validQuantity && token) {
      setError(''); setQuoteLoading(true);
      fetch(apiUrl('/api/products/wholesale/quote'), {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId, variantId, quantity }), signal: controller.signal, cache: 'no-store',
      }).then(async response => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.message || 'Wholesale price could not be checked.');
        if (active && isCurrentUserSession(session)) {
          const fresh = body.data;
          const changed = ['minimumQuantity', 'quantityIncrement', 'maxQuantity', 'availableStock', 'priceTiers'].some(field => JSON.stringify(fresh[field]) !== JSON.stringify(offer[field]));
          if (changed) setCatalog(current => current?.key === key ? { ...current, variants: current.variants.map(item => String(item.variantId) === String(variantId) ? { ...item, ...Object.fromEntries(['minimumQuantity', 'quantityIncrement', 'maxQuantity', 'availableStock', 'priceTiers'].map(field => [field, fresh[field]])) } : item) } : current);
          else setPreview({ key: quoteKey, data: fresh });
        }
      }).catch(err => {
        if (active && isCurrentUserSession(session) && err.name !== 'AbortError') { setCatalog(null); setError(err.message); }
      }).finally(() => { if (active) setQuoteLoading(false); });
    }
    return () => { active = false; controller.abort(); };
  }, [quoteKey, mode, validQuantity, token, offer]);
  const quote = preview?.key === quoteKey && offer ? preview.data : null;
  const canPurchase = Boolean(mode === 'wholesale' && validQuantity && quote && !loading && !quoteLoading && !pending && !error);
  const add = async (buyNow = false) => {
    if (lock.current || !canPurchase) return;
    lock.current = true; setPending(true); setError(''); setMessage('');
    const session = captureUserSession();
    try {
      const response = await fetch(apiUrl('/api/cart/wholesale'), {
        method: 'POST', headers: { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId, variantId, qty: quantity }),
      });
      const body = await response.json();
      if (!isCurrentUserSession(session) || currentIdentity.current !== identity) return;
      if (!response.ok) throw new Error(body.message || 'Could not add to the Wholesale cart.');
      const cartLine = body.data?.items?.find(item => String(item.productId) === String(productId) && String(item.variantId) === String(variantId));
      const changedPrice = cartLine && cartLine.price !== quote.unitPrice;
      setMessage(changedPrice ? 'Added to your separate Wholesale cart. The current cart price has changed; review the updated quote before checkout.' : 'Added to your separate Wholesale cart. Review the current quote and delivery charges before checkout.');
      if (buyNow) openCart();
    } catch (err) {
      if (isCurrentUserSession(session) && currentIdentity.current === identity) { refresh(); setError(err.message); setMessage(err.message); }
    } finally { lock.current = false; setPending(false); }
  };
  return { mode, chooseMode, available: variants.length > 0, offer, quantity, setQuantity, validQuantity, quote, loading, quoteLoading, catalogError, error, message, pending, canPurchase, add, refresh, openCart };
}
