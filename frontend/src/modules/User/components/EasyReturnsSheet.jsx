import React, { useEffect, useState } from 'react';
import './EasyReturnsSheet.css';

/**
 * Purchase popup for products with Easy Returns (backend: services/easyReturns.service.js).
 * Prices shown here are a preview; the server recomputes the charge from the product at checkout.
 */
export const RETURN_OPTION = { EASY: 'EASY_RETURN', NO: 'NO_EASY_RETURN' };

const money = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const round2 = (n) => Math.round(Number(n) * 100) / 100;

export const easyReturnsActive = (cfg) => Boolean(cfg?.enabled);

export default function EasyReturnsSheet({
  open, onClose, product, image, variants = [], selectedVariantId, onVariantChange,
  basePrice, mrp, easyReturns, initialOption, actionLabel = 'Continue', pending = false, error = '', onConfirm,
}) {
  const [option, setOption] = useState(initialOption || '');
  const [showDetails, setShowDetails] = useState(false);
  const [touched, setTouched] = useState(false);

  useEffect(() => { if (open) { setOption(initialOption || ''); setShowDetails(false); setTouched(false); } }, [open, initialOption]);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape' && !pending) onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, pending, onClose]);

  if (!open || !easyReturns) return null;
  const charge = round2(easyReturns.extraCharge || 0);
  const hasPrice = basePrice != null && Number.isFinite(Number(basePrice));
  const prices = { [RETURN_OPTION.EASY]: hasPrice ? round2(Number(basePrice) + charge) : null, [RETURN_OPTION.NO]: hasPrice ? round2(basePrice) : null };
  const selectedPrice = option ? prices[option] : null;
  const multipleVariants = variants.length > 1;
  const selectedVariant = variants.find((v) => String(v.id || v._id) === String(selectedVariantId));
  const outOfStock = selectedVariant && !(Number(selectedVariant.stock) > 0);

  const confirm = () => {
    setTouched(true);
    if (!option || (multipleVariants && !selectedVariantId) || outOfStock) return;
    onConfirm?.(option);
  };

  const card = (value, title, subtitle) => {
    const active = option === value;
    return (
      <button type="button" role="radio" aria-checked={active} disabled={pending}
        className={`ers-option ${value === RETURN_OPTION.EASY ? 'is-easy' : 'is-no'} ${active ? 'is-active' : ''}`}
        onClick={() => setOption(value)}>
        <span className="ers-radio" aria-hidden="true">{active ? '✓' : ''}</span>
        <span className="ers-option-text">
          <strong>{title}</strong>
          <small>{subtitle}</small>
        </span>
        <span className="ers-option-price">{prices[value] != null ? money(prices[value]) : '—'}</span>
      </button>
    );
  };

  return (
    <div className="ers-backdrop" role="presentation" onClick={() => !pending && onClose?.()}>
      <div className="ers-sheet" role="dialog" aria-modal="true" aria-labelledby="ers-title" onClick={(e) => e.stopPropagation()}>
        <div className="ers-head">
          {image ? <img src={image} alt="" className="ers-thumb" /> : null}
          <div className="ers-head-text">
            <h3 id="ers-title">{product?.name}</h3>
            <div className="ers-head-price">
              {selectedPrice != null ? money(selectedPrice) : hasPrice ? money(basePrice) : ''}
              {mrp && hasPrice && Number(mrp) > Number(selectedPrice ?? basePrice) ? <s>{money(mrp)}</s> : null}
            </div>
          </div>
          <button type="button" className="ers-close" aria-label="Close" disabled={pending} onClick={onClose}>✕</button>
        </div>

        {multipleVariants && (
          <section className="ers-section">
            <h4>Select size / variant</h4>
            <div className="ers-variants" role="radiogroup" aria-label="Variant">
              {variants.map((v) => {
                const id = String(v.id || v._id);
                const active = id === String(selectedVariantId);
                const soldOut = !(Number(v.stock) > 0);
                return (
                  <button key={id} type="button" role="radio" aria-checked={active} disabled={pending || soldOut}
                    className={`ers-variant ${active ? 'is-active' : ''}`} onClick={() => onVariantChange?.(id)}>
                    {v.name && v.name !== 'Default' ? v.name : [v.weight ? `${v.weight} g` : '', v.unit].filter(Boolean).join(' ') || 'Standard'}
                    {soldOut ? <small>Sold out</small> : null}
                  </button>
                );
              })}
            </div>
            {touched && !selectedVariantId ? <p className="ers-error" role="alert">Choose a variant.</p> : null}
          </section>
        )}

        <section className="ers-section">
          <div className="ers-section-head">
            <h4>Easy Returns</h4>
            <button type="button" className="ers-link" aria-expanded={showDetails} onClick={() => setShowDetails((v) => !v)}>
              {showDetails ? 'Hide details' : 'View details'}
            </button>
          </div>
          {showDetails && (
            <div className="ers-details">
              <p>{easyReturns.policyText}</p>
              {easyReturns.conditions?.length ? <ul>{easyReturns.conditions.map((c) => <li key={c}>{c}</li>)}</ul> : null}
              <p className="ers-muted">Return window: {easyReturns.windowDays} day{easyReturns.windowDays === 1 ? '' : 's'} after delivery. Without Easy Returns, only a wrong, damaged or defective item can be returned.</p>
            </div>
          )}
          <div className="ers-options" role="radiogroup" aria-label="Return option">
            {card(RETURN_OPTION.EASY, 'Yes, I want Easy Returns', `Return for any reason within ${easyReturns.windowDays} days`)}
            {card(RETURN_OPTION.NO, 'No Easy Returns', 'Only wrong, damaged or defective item returns')}
          </div>
          {touched && !option ? <p className="ers-error" role="alert">Choose a return option to continue.</p> : null}
        </section>

        <div className="ers-breakdown" aria-live="polite">
          <div><span>Item price</span><span>{hasPrice ? money(basePrice) : '—'}</span></div>
          <div><span>Easy Returns charge</span><span>{option === RETURN_OPTION.EASY ? `+ ${money(charge)}` : option ? money(0) : '—'}</span></div>
          <div className="ers-total"><span>You pay (per unit)</span><span>{selectedPrice != null ? money(selectedPrice) : '—'}</span></div>
        </div>

        {outOfStock ? <p className="ers-error" role="alert">This variant is out of stock.</p> : null}
        {error ? <p className="ers-error" role="alert">{error}</p> : null}
        <button type="button" className="ers-continue" disabled={pending} onClick={confirm}>
          {pending ? 'Please wait…' : actionLabel}
        </button>
      </div>
    </div>
  );
}
