import React from 'react';
const formatCurrency = value => `₹${Number(value).toLocaleString('en-IN',{maximumFractionDigits:2})}`;

export default function ProductWholesaleOffer({ wholesale: w }) {
  const quote = w.shownQuote || w.quote;
  const changingQuantity = Boolean(quote && quote.quantity !== w.quantity);
  const nextTier = w.offer?.priceTiers.find(tier => tier.minimumQuantity > (quote?.quantity ?? w.quantity));
  return <div className="pd-wholesale">
    {w.mode === 'wholesale' && <p className="pd-wholesale-mode">Wholesale (B2B)</p>}
    {w.available && <>
      <button type="button" className="pd-wholesale-indicator" onClick={() => w.chooseMode('wholesale')}>Wholesale available — View bulk prices</button>
      <div className="pd-channel-selector" role="group" aria-label="Purchase channel">
        {(w.retailAvailable === false ? ['wholesale'] : ['retail', 'wholesale']).map(mode => <button type="button" key={mode} aria-pressed={w.mode === mode} disabled={w.pending} onClick={() => w.chooseMode(mode)}>{mode === 'retail' ? 'Retail' : 'Wholesale'}</button>)}
      </div>
    </>}
    {w.loading && <p role="status">Checking wholesale availability…</p>}
    {w.catalogError && <p role="alert">{w.catalogError} <button type="button" onClick={w.refresh}>Retry</button></p>}
    {w.mode === 'wholesale' && <section aria-label="Wholesale purchase">
      {!w.available && !w.loading && <>{!w.catalogError && !w.error && <p>Wholesale is currently unavailable for this product.</p>}{w.retailAvailable !== false && <button type="button" onClick={() => w.chooseMode('retail')}>Return to Retail</button>}</>}
      {w.available && !w.offer && <p>This variant has no available wholesale offer. {w.retailAvailable === false ? 'Choose another available variant.' : 'Choose another variant or Retail.'}</p>}
      {w.offer && <>
        <div className="pd-price-row"><span className="pd-price">From {formatCurrency(w.offer.startingPrice ?? Math.min(...w.offer.priceTiers.map(t=>t.unitPrice)))}</span><span>per {w.offer.unit || 'unit'}</span></div>
        <p>Minimum order: <strong>{w.offer.minimumQuantity}</strong> · Increments of <strong>{w.offer.quantityIncrement}</strong></p>
        <p>{w.offer.availableStock} in stock · Maximum order: {w.offer.maxQuantity}</p>
        <table><caption>Seller’s quantity prices</caption><thead><tr><th scope="col">Quantity</th><th scope="col">Per unit</th></tr></thead>
          <tbody>{w.offer.priceTiers.map((tier, index, tiers) => <tr key={tier.minimumQuantity} className={!changingQuantity && quote?.tierMinimumQuantity === tier.minimumQuantity ? 'is-active' : ''}>
            <td>{tier.minimumQuantity}{index + 1 < tiers.length ? `–${tiers[index + 1].minimumQuantity - 1}` : '+'}{!changingQuantity && quote?.tierMinimumQuantity === tier.minimumQuantity ? ' · Applied' : ''}</td><td>{formatCurrency(tier.unitPrice)}</td>
          </tr>)}</tbody>
        </table>
        <label htmlFor="pd-wholesale-quantity">Wholesale quantity</label>
        <input id="pd-wholesale-quantity" type="number" inputMode="numeric" min={w.offer.minimumQuantity} max={w.offer.maxQuantity} step={w.offer.quantityIncrement} value={w.quantity || ''} disabled={w.pending} onChange={event => w.setQuantity(Number(event.target.value))} />
        {!w.validQuantity && <p role="alert">Order at least {w.offer.minimumQuantity}, in increments of {w.offer.quantityIncrement}, up to {w.offer.maxQuantity}.</p>}
        <p role={w.quoteLoading ? 'status' : undefined} aria-hidden={!w.quoteLoading} style={{ visibility: w.quoteLoading ? 'visible' : 'hidden' }}>Checking current price and stock…</p>
        {(quote || w.quoteLoading || w.error) && <div className="pd-wholesale-total" aria-live="polite" aria-busy={w.quoteLoading} style={{ position: 'relative' }}>
          {quote ? <div aria-hidden={changingQuantity || undefined} style={changingQuantity ? { visibility: 'hidden' } : undefined}>
          <strong>{quote.quantity} units × {formatCurrency(quote.unitPrice)} = {formatCurrency(quote.subtotal)}</strong>
          <p>Estimated item subtotal. Delivery and final totals are confirmed in the Wholesale cart.</p>
          {quote.savings > 0 && <p>Save {formatCurrency(quote.savings)} compared with {formatCurrency(quote.retailUnitPrice)} per unit in Retail for this variant.</p>}
          {nextTier && <p>Next price tier starts at {nextTier.minimumQuantity} units.</p>}
          </div> : null}
          {(changingQuantity || !quote) && <p role="status" style={changingQuantity ? { position: 'absolute', inset: 12, margin: 0 } : undefined}>{!w.validQuantity ? 'Enter a valid quantity to check the item subtotal.' : w.error ? 'The current item subtotal could not be checked. Please retry.' : `Updating item subtotal for ${w.quantity} units…`}</p>}
        </div>}
      </>}
      {w.error && <p role="alert">{w.error} <button type="button" onClick={w.refresh}>Refresh offer</button></p>}
      {w.message && <p role="status">{w.message}</p>}
      {w.available && <button type="button" disabled={w.pending} onClick={w.openCart}>View Cart</button>}
    </section>}
  </div>;
}
