import React from 'react';
const formatCurrency = value => `₹${Number(value).toLocaleString('en-IN',{maximumFractionDigits:2})}`;

export default function ProductWholesaleOffer({ wholesale: w }) {
  const quote = w.shownQuote || w.quote;
  const changingQuantity = Boolean(quote && quote.quantity !== w.quantity);
  const nextTier = w.offer?.priceTiers.find(tier => tier.minimumQuantity > (quote?.quantity ?? w.quantity));
  const offer = w.offer;
  // The stepper moves in the seller's increments and stays inside the order limits.
  const step = direction => {
    if (!offer) return;
    const current = Number.isSafeInteger(w.quantity) && w.quantity >= offer.minimumQuantity ? w.quantity : offer.minimumQuantity;
    w.setQuantity(Math.min(offer.maxQuantity, Math.max(offer.minimumQuantity, current + direction * offer.quantityIncrement)));
  };
  return <div className="pd-wholesale">
    {w.mode === 'wholesale' && <p className="pd-wholesale-mode">Wholesale (B2B)</p>}
    {w.available && <>
      {w.mode !== 'wholesale' && <button type="button" className="pd-wholesale-indicator" onClick={() => w.chooseMode('wholesale')}>Wholesale available — View bulk prices</button>}
      <div className="pd-channel-selector" role="group" aria-label="Purchase channel">
        {(w.retailAvailable === false ? ['wholesale'] : ['retail', 'wholesale']).map(mode => <button type="button" key={mode} aria-pressed={w.mode === mode} disabled={w.pending} onClick={() => w.chooseMode(mode)}>{mode === 'retail' ? 'Retail' : 'Wholesale'}</button>)}
      </div>
    </>}
    {w.loading && <p role="status">Checking wholesale availability…</p>}
    {w.catalogError && <p role="alert">{w.catalogError} <button type="button" onClick={w.refresh}>Retry</button></p>}
    {w.mode === 'wholesale' && <section aria-label="Wholesale purchase">
      {!w.available && !w.loading && <>{!w.catalogError && !w.error && <p>Wholesale is currently unavailable for this product.</p>}{w.retailAvailable !== false && <button type="button" onClick={() => w.chooseMode('retail')}>Return to Retail</button>}</>}
      {w.available && !offer && <p>This variant has no available wholesale offer. {w.retailAvailable === false ? 'Choose another available variant.' : 'Choose another variant or Retail.'}</p>}
      {offer && <>
        <div className="pd-price-row"><span className="pd-price">From {formatCurrency(offer.startingPrice ?? Math.min(...offer.priceTiers.map(t=>t.unitPrice)))}</span><span>per {offer.unit || 'unit'}</span></div>
        <ul className="pd-wholesale-terms" aria-label="Order terms">
          <li>Min order <strong>{offer.minimumQuantity}</strong></li>
          {offer.quantityIncrement > 1 && <li>Steps of <strong>{offer.quantityIncrement}</strong></li>}
          <li><strong>{offer.availableStock}</strong> in stock</li>
          <li>Max <strong>{offer.maxQuantity}</strong></li>
        </ul>
        <div className="pd-wholesale-tiers">
          <table><caption>Seller’s quantity prices</caption><thead><tr><th scope="col">Quantity</th><th scope="col">Per unit</th></tr></thead>
            <tbody>{offer.priceTiers.map((tier, index, tiers) => <tr key={tier.minimumQuantity} className={!changingQuantity && quote?.tierMinimumQuantity === tier.minimumQuantity ? 'is-active' : ''}>
              <td>{tier.minimumQuantity}{index + 1 < tiers.length ? `–${tiers[index + 1].minimumQuantity - 1}` : '+'}{!changingQuantity && quote?.tierMinimumQuantity === tier.minimumQuantity ? ' · Applied' : ''}</td><td>{formatCurrency(tier.unitPrice)}</td>
            </tr>)}</tbody>
          </table>
        </div>
        <label htmlFor="pd-wholesale-quantity">Wholesale quantity</label>
        <div className="pd-wholesale-stepper">
          <button type="button" aria-label="Decrease quantity" disabled={w.pending || !(w.quantity > offer.minimumQuantity)} onClick={() => step(-1)}>−</button>
          <input id="pd-wholesale-quantity" type="number" inputMode="numeric" min={offer.minimumQuantity} max={offer.maxQuantity} step={offer.quantityIncrement} value={w.quantity || ''} disabled={w.pending} onChange={event => w.setQuantity(Number(event.target.value))} />
          <button type="button" aria-label="Increase quantity" disabled={w.pending || !(w.quantity < offer.maxQuantity)} onClick={() => step(1)}>+</button>
        </div>
        {!w.validQuantity && <p role="alert">Order at least {offer.minimumQuantity}{offer.quantityIncrement > 1 ? `, in steps of ${offer.quantityIncrement}` : ''}, up to {offer.maxQuantity}.</p>}
        <p role={w.quoteLoading ? 'status' : undefined} aria-hidden={!w.quoteLoading} className="pd-wholesale-checking" style={{ visibility: w.quoteLoading ? 'visible' : 'hidden' }}>Checking current price and stock…</p>
        {(quote || w.quoteLoading || w.error) && <div className="pd-wholesale-total" aria-live="polite" aria-busy={w.quoteLoading} style={{ position: 'relative' }}>
          {quote ? <div aria-hidden={changingQuantity || undefined} style={changingQuantity ? { visibility: 'hidden' } : undefined}>
          <span className="pd-wholesale-total-label">Item subtotal</span>
          <strong>{quote.quantity} units × {formatCurrency(quote.unitPrice)} = {formatCurrency(quote.subtotal)}</strong>
          <p>Estimated item subtotal. Delivery and final totals are confirmed in the Wholesale cart.</p>
          {quote.savings > 0 && <p className="pd-wholesale-savings">Save {formatCurrency(quote.savings)} compared with {formatCurrency(quote.retailUnitPrice)} per unit in Retail for this variant.</p>}
          {nextTier && <p>Next price tier starts at {nextTier.minimumQuantity} units.</p>}
          </div> : null}
          {(changingQuantity || !quote) && <p role="status" style={changingQuantity ? { position: 'absolute', inset: 12, margin: 0 } : undefined}>{!w.validQuantity ? 'Enter a valid quantity to check the item subtotal.' : w.error ? 'The current item subtotal could not be checked. Please retry.' : `Updating item subtotal for ${w.quantity} units…`}</p>}
        </div>}
      </>}
      {w.error && <p role="alert">{w.error} <button type="button" onClick={w.refresh}>Refresh offer</button></p>}
      {w.available && <button type="button" className="pd-wholesale-view-cart" disabled={w.pending} onClick={w.openCart}>View Cart</button>}
    </section>}
  </div>;
}
