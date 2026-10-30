import ModalPortal from '../../../components/ModalPortal';
import React, { useRef, useState } from 'react';
import useSellerDialog from '../hooks/useSellerDialog';
import { useSeller } from '../context/SellerContext';
import { eligibleWholesaleVariant, hasWholesaleAccess } from '../utils/wholesaleEligibility';

export default function WholesaleOfferSelector({ onClose }) {
  const { products = [], productsLoading, productsError, fetchMyProducts, sellerProfile, startEditProduct } = useSeller();
  const [productId, setProductId] = useState(''), [variantId, setVariantId] = useState('');
  const dialog = useRef(null), opened = useRef(false);
  useSellerDialog(dialog, true);
  const eligible = products.filter(p => p.raw?.variants?.some(v => eligibleWholesaleVariant(p.raw, v)));
  const selected = eligible.find(p => String(p.id) === productId);
  const variants = selected?.raw.variants.filter(v => eligibleWholesaleVariant(selected.raw, v)) || [];
  const variant = variants.find(v => String(v._id) === variantId);
  const authorized = hasWholesaleAccess(sellerProfile);
  const submit = event => {
    event.preventDefault();
    if (opened.current || !authorized || productsLoading || productsError || !selected || !variant) return;
    opened.current = true; startEditProduct(selected.raw, variant._id); onClose();
  };
  return <ModalPortal className="seller-modal-overlay seller-wholesale-overlay" onClick={onClose} onKeyDown={event => { if (event.key === 'Escape') onClose(); }}>
    <form ref={dialog} className="seller-offer-selector seller-modal-sheet" role="dialog" aria-modal="true" aria-labelledby="wholesale-selector-title" onClick={e => e.stopPropagation()} onSubmit={submit}>
      <div className="seller-products-dialog-heading"><h2 id="wholesale-selector-title">Add Wholesale Offer</h2><button className="seller-products-button" type="button" aria-label="Close offer selection" onClick={onClose}>×</button></div>
      <p>Choose an existing physical product and variant. No new product or inventory is created.</p>
      {!authorized ? <p role="alert">Approved Wholesale access is required. Refresh your access from the seller header.</p>
        : productsLoading ? <p role="status">Loading eligible products…</p>
          : productsError ? <div role="alert">{productsError}<button className="seller-products-button" type="button" onClick={fetchMyProducts}>Retry products</button></div>
            : !eligible.length ? <p>No eligible physical variants. Create or activate a physical listing in E-Commerce or Quick Commerce, ensure its category is active, and add stock before configuring Wholesale.</p>
              : <>
                <label>Product<select className="onboarding-select" value={productId} onChange={e => { setProductId(e.target.value); setVariantId(''); }} required><option value="">Select a physical product</option>{eligible.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
                <label>Variant<select className="onboarding-select" value={variantId} disabled={!selected} onChange={e => setVariantId(e.target.value)} required><option value="">Select a variant</option>{variants.map(v => <option key={String(v._id)} value={String(v._id)}>{v.name}{v.sku ? ` · ${v.sku}` : ''} · Stock {v.stock}</option>)}</select></label>
                {variant && <dl className="seller-offer-reference"><div><dt>Product</dt><dd>{selected.name}</dd></div><div><dt>Variant</dt><dd>{variant.name}</dd></div><div><dt>SKU</dt><dd>{variant.sku || selected.raw.sku || 'Unavailable'}</dd></div><div><dt>Shared stock</dt><dd>{variant.stock}</dd></div></dl>}
              </>}
      <div className="seller-products-dialog-actions"><button className="seller-products-button" type="button" onClick={onClose}>Cancel</button><button className="seller-products-button seller-products-primary" type="submit" disabled={!authorized || !variant || productsLoading || !!productsError}>Configure Wholesale Terms</button></div>
    </form>
  </ModalPortal>;
}
