import React, { useState } from 'react';
import { useSeller } from '../context/SellerContext';
import { eligibleWholesaleProduct, eligibleWholesaleVariant, hasWholesaleAccess } from '../utils/wholesaleEligibility';

// Mode-specific rows only. ProductsTab owns the heading, toolbar, tabs and editor.
export default function SellerWholesaleProducts() {
  const { products = [], productsLoading, productsError, fetchMyProducts, sellerProfile, profileLoading, fetchSellerProfile, startEditProduct, requestWholesaleChannel, wholesaleRequestBusy } = useSeller();
  const [search, setSearch] = useState(''), [category, setCategory] = useState(''), [state, setState] = useState('all'), [page, setPage] = useState(1);
  const approved = hasWholesaleAccess(sellerProfile);
  const physical = products.filter(p => p.raw?.fulfillmentType !== 'digital' && ['ecommerce', 'grocery'].includes(p.raw?.type));
  const rows = physical.flatMap(p => (p.raw?.variants || []).map(v => ({ p, v })));
  const filtered = rows.filter(({ p, v }) => (!category || p.category === category) && `${p.name} ${p.raw.sku || ''} ${v.name} ${v.sku || ''}`.toLowerCase().includes(search.toLowerCase()) && (state === 'all' || (state === 'enabled') === Boolean(v.wholesalePricing?.enabled)));
  const pages = Math.max(1, Math.ceil(filtered.length / 10)), current = Math.min(page, pages);
  const change = setter => e => { setter(e.target.value); setPage(1); };
  const status = sellerProfile?.wholesaleChannel?.status || 'not_requested';
  return <section className="seller-wholesale-list" aria-label="Wholesale product offers">
    {!approved ? <div className="seller-products-state" role="status"><p>{profileLoading ? 'Checking Wholesale access…' : status === 'pending' ? 'Wholesale approval pending review.' : status === 'suspended' ? 'Wholesale access is suspended.' : status === 'rejected' ? 'Wholesale access was rejected.' : 'Wholesale access is unavailable or has not been requested.'}</p><p>{sellerProfile?.wholesaleChannel?.rejectionReason || sellerProfile?.wholesaleChannel?.suspensionReason}</p><button className="seller-products-button" onClick={() => fetchSellerProfile({ fresh: true })}>Refresh access</button>
      {/* Wholesale is requested here, in the Wholesale (B2B) products mode, rather than from a banner on every seller page. */}
      {!profileLoading && sellerProfile?.status === 'approved' && ['not_requested', 'rejected'].includes(status) && <button className="seller-products-button" onClick={requestWholesaleChannel} disabled={wholesaleRequestBusy}>{wholesaleRequestBusy ? 'Requesting…' : 'Request Wholesale Access'}</button>}</div> : <>
      <div className="seller-products-filters">
        <label className="seller-products-search">Search<input className="onboarding-input" type="search" placeholder="Product, SKU or variant" aria-label="Search Wholesale products" value={search} onChange={change(setSearch)} /></label>
        <label>Category<select className="onboarding-select" aria-label="Wholesale category" value={category} onChange={change(setCategory)}><option value="">All categories</option>{[...new Set(physical.map(p => p.category))].map(c => <option key={c}>{c}</option>)}</select></label>
        <label>Offers<select className="onboarding-select" aria-label="Wholesale offer filter" value={state} onChange={change(setState)}><option value="all">All variants</option><option value="enabled">Enabled</option><option value="disabled">Disabled / not configured</option></select></label>
      </div>
      <div className="seller-products-results">
        {productsLoading ? <p className="seller-products-state" role="status">Loading Wholesale products…</p> : productsError ? <div className="seller-products-state" role="alert">{productsError}<button className="seller-products-button" onClick={fetchMyProducts}>Retry products</button></div> : !rows.length ? <p className="seller-products-state">No eligible physical products. Create or activate a physical listing in E-Commerce or Quick Commerce and add variant stock first.</p> : <>
          {!rows.some(({ v }) => v.wholesalePricing?.enabled) && <p className="seller-products-hint">No Wholesale offers configured. Use Add Product to create a Wholesale-only listing, or add an offer to an existing product.</p>}
          {!filtered.length ? <p className="seller-products-state">No variants match these filters.</p> : <div className="seller-wholesale-table" role="region" aria-label="Wholesale variants" tabIndex={0}><table><caption className="sr-only">Wholesale terms and shared stock by product variant</caption><thead><tr>{['Product / SKU', 'Variant', 'Wholesale state', 'MOQ / increment', 'Price tiers', 'Stock', 'Eligibility', 'Action'].map(t => <th scope="col" className="prod-th" key={t}>{t}</th>)}</tr></thead><tbody>{filtered.slice((current - 1) * 10, current * 10).map(({ p, v }) => {
            const pricing = v.wholesalePricing, eligible = eligibleWholesaleProduct(p.raw);
            return <tr className="prod-table-row" key={`${p.id}:${v._id}`}><td className="prod-td"><div className="seller-products-identity">{p.img && <img src={p.img} alt="" width="44" height="44" />}<div><strong>{p.name}</strong><div>{v.sku || p.raw.sku || 'SKU unavailable'}</div><small>{p.raw.type === 'grocery' ? 'Quick Commerce' : 'E-Commerce'}</small></div></div></td><td className="prod-td">{v.name}</td><td className="prod-td"><span className={`seller-products-badge ${pricing?.enabled ? 'enabled' : ''}`}>{pricing?.enabled ? 'Enabled' : 'Disabled'}</span></td><td className="prod-td">{pricing?.enabled ? `${pricing.minimumQuantity} / ${pricing.quantityIncrement}` : '—'}</td><td className="prod-td">{pricing?.enabled ? pricing.priceTiers.map(t => `${t.minimumQuantity}+ ₹${Number(t.unitPrice).toFixed(2)}`).join(' / ') : 'Not configured'}</td><td className="prod-td">{v.stock}</td><td className="prod-td">{!eligible ? 'Product/category unavailable' : pricing?.enabled && v.stock < pricing.minimumQuantity ? 'Stock below MOQ' : v.stock < 1 ? 'Out of stock' : 'Eligible physical variant'}</td><td className="prod-td">{p.raw.sellingChannels?.length===1&&p.raw.sellingChannels[0]==='wholesale'&&<button className="seller-products-button" type="button" onClick={()=>startEditProduct(p.raw)}>Edit product</button>}<button className="seller-products-button" type="button" disabled={!v._id || (!v.wholesalePricing?.enabled && !eligibleWholesaleVariant(p.raw, v))} onClick={() => startEditProduct(p.raw, v._id)}>Edit offer</button></td></tr>;
          })}</tbody></table></div>}
          <div className="seller-products-pagination"><button className="seller-products-button" disabled={current === 1} onClick={() => setPage(current - 1)}>Previous</button><span>Page {current} of {pages} · {filtered.length} variants</span><button className="seller-products-button" disabled={current === pages} onClick={() => setPage(current + 1)}>Next</button></div>
        </>}
      </div>
    </>}
  </section>;
}
