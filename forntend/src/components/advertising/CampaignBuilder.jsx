import React, { useEffect, useRef, useState } from 'react';
import { advertisingApi, advertisingMoney } from './advertisingApi';
import { TERM_LABELS, campaignGroups, campaignName, earliestStart, packagePrice, packagesFor, requestKey, validStart, defaultCategory } from './campaignGroups';

const STOREFRONT = { ECOMMERCE: 'Shop All', QUICK: 'Quick Commerce' };
const STEPS = ['Products', 'Groups', 'Packages', 'Review', 'Save & submit'];
const plural = (n, word) => `${n} ${n === 1 ? word : word.endsWith('y') ? `${word.slice(0, -1)}ies` : `${word}s`}`;
const categoryLabel = c => !c ? 'No category' : c.parentName ? `${c.parentName} › ${c.name}` : c.name;
const startText = value => value ? new Date(value).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—';

// Seller wizard for new campaigns: products from any categories of one storefront become one normal
// campaign per category, each saved, reviewed and paid on its own.
export default function CampaignBuilder({ onClose, onOpen }) {
  const [step, setStep] = useState(0), [module, setModule] = useState('ECOMMERCE'), [pendingModule, setPendingModule] = useState('');
  const [name, setName] = useState(''), [selected, setSelected] = useState([]), [assigned, setAssigned] = useState({});
  const [products, setProducts] = useState([]), [page, setPage] = useState(1), [pages, setPages] = useState(1);
  const [search, setSearch] = useState(''), [query, setQuery] = useState(''), [categoryFilter, setCategoryFilter] = useState(''), [knownCategories, setKnownCategories] = useState({});
  const [loading, setLoading] = useState(false), [loadError, setLoadError] = useState(''), [reload, setReload] = useState(0), [packages, setPackages] = useState([]);
  const [sameDate, setSameDate] = useState(true), [sharedStart, setSharedStart] = useState(''), [dateOf, setDateOf] = useState({}), [packageOf, setPackageOf] = useState({});
  const [results, setResults] = useState({}), [submits, setSubmits] = useState({}), [terms, setTerms] = useState({}), [confirming, setConfirming] = useState(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [limitNotice, setLimitNotice] = useState('');
  const keys = useRef({});

  useEffect(() => { const timer = setTimeout(() => { setQuery(search.trim()); setPage(1); }, 300); return () => clearTimeout(timer); }, [search]);
  useEffect(() => {
    let alive = true; setLoading(true); setLoadError('');
    const params = new URLSearchParams({ module, limit: '20', page: String(page), ...(query ? { q: query } : {}), ...(categoryFilter ? { category: categoryFilter } : {}) });
    advertisingApi(false, `/products?${params}`).then(b => {
      if (!alive) return;
      setProducts(b.data || []); setPages(b.meta?.pages || 1);
      setKnownCategories(known => { const next = { ...known }; for (const p of b.data || []) for (const c of p.adCategories || []) next[c.id] = c.parentName ? `${c.name} (${c.parentName})` : c.name; return next; });
    }).catch(e => alive && setLoadError(e.message || 'Could not load products')).finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [module, page, query, categoryFilter, reload]);
  useEffect(() => {
    let alive = true;
    advertisingApi(false, '/packages?limit=100').then(b => alive && setPackages(b.data || [])).catch(e => alive && setError(e.message));
    return () => { alive = false; };
  }, []);

  const groups = campaignGroups(selected, assigned);
  const plans = groups.map(group => {
    const { inCategory, fitting } = packagesFor(packages, module, group);
    const chosen = fitting.find(p => p.id === packageOf[group.categoryId]);
    const start = sameDate ? sharedStart : dateOf[group.categoryId] || '';
    const most = inCategory.length ? Math.max(...inCategory.map(p => p.maxProducts)) : 0;
    const problem = !inCategory.length ? 'No advertising package is available for this category.'
      : !fitting.length ? `Packages for this category allow up to ${plural(most, 'product')} per ad. Remove ${plural(group.items.length - most, 'product')} from this group.`
        : !chosen ? 'Choose a package.' : !validStart(start) ? 'Choose a start date and time from now onwards.' : '';
    return { ...group, name: campaignName(name || 'Campaign', group.label), fitting, chosen, start, problem, price: packagePrice(chosen) };
  });
  const saved = plans.filter(p => results[p.categoryId]?.status === 'saved');
  const locked = Object.keys(results).length > 0;
  const total = plans.reduce((sum, p) => sum + p.price.total, 0), totalTax = plans.reduce((sum, p) => sum + (p.price.tax || 0), 0);

  const switchModule = next => { setModule(next); setSelected([]); setAssigned({}); setPackageOf({}); setDateOf({}); setPage(1); setCategoryFilter(''); setKnownCategories({}); setPendingModule(''); setLimitNotice(''); };

  const categoryLimitFor = (product) => {
    const catId = defaultCategory(product);
    const inCategory = packages.filter(p =>
      p.module === module &&
      p.isActive &&
      !p.archivedAt &&
      (!p.categories?.length || p.categories.map(String).includes(String(catId)))
    );
    if (inCategory.length) return Math.max(...inCategory.map(p => p.maxProducts || 1));
    const inMod = packages.filter(p => p.module === module && p.isActive && !p.archivedAt);
    if (inMod.length) return Math.max(...inMod.map(p => p.maxProducts || 1));
    return 0;
  };

  const tick = (product, variant, checked) => {
    setLimitNotice('');
    if (checked) {
      const catId = defaultCategory(product);
      const isAlready = selected.some(i => i.product.id === product.id);
      if (!isAlready) {
        const limit = categoryLimitFor(product);
        const inCatCount = selected.filter(i => defaultCategory(i.product) === catId).length;
        if (limit > 0 && inCatCount >= limit) {
          setLimitNotice(`Packages for this category allow up to ${plural(limit, 'product')} per ad. You cannot select more than ${limit} products for this category.`);
          return;
        }
      }
      setSelected(list => [...list.filter(i => i.product.id !== product.id), { product, variantId: variant.id }]);
    } else {
      setSelected(list => list.filter(i => i.product.id !== product.id));
    }
  };
  const removeProducts = ids => setSelected(list => list.filter(i => !ids.includes(i.product.id)));
  const moveGroup = (group, categoryId) => setAssigned(a => ({ ...a, ...Object.fromEntries(group.items.map(i => [i.product.id, categoryId])) }));

  async function save(plan) {
    keys.current[plan.categoryId] ||= requestKey();
    setResults(r => ({ ...r, [plan.categoryId]: { status: 'saving' } }));
    try {
      const b = await advertisingApi(false, '/campaigns', { method: 'POST', body: { name: plan.name, module, categoryId: plan.categoryId,
        items: plan.items.map(i => ({ productId: i.product.id, ...(i.variantId ? { variantId: i.variantId } : {}) })),
        packageId: plan.chosen.id, requestedStartAt: new Date(plan.start).toISOString(), requestKey: keys.current[plan.categoryId] } });
      setResults(r => ({ ...r, [plan.categoryId]: { status: 'saved', campaign: b.data } }));
    } catch (e) { setResults(r => ({ ...r, [plan.categoryId]: { status: 'failed', error: e.message || 'Could not save this campaign' } })); }
  }
  async function saveAll(list) { setBusy(true); for (const plan of list) await save(plan); setBusy(false); }

  // Terms come from the server for each package before anything is submitted.
  async function review(ids) {
    setBusy(true); setError('');
    try {
      const missing = [...new Set(ids.map(id => results[id].campaign.packageId))].filter(id => !terms[id]);
      const loaded = await Promise.all(missing.map(id => advertisingApi(false, `/packages/${id}`).then(b => [id, b.data])));
      setTerms(t => ({ ...t, ...Object.fromEntries(loaded) })); setConfirming(ids);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function submit(ids) {
    setBusy(true); setConfirming(null);
    for (const id of ids) {
      const result = results[id], campaign = result?.campaign;
      if (result?.status !== 'saved' || isSubmitted(id)) continue;
      setSubmits(s => ({ ...s, [id]: { status: 'submitting' } }));
      try {
        const b = await advertisingApi(false, `/campaigns/${campaign.id}/submit`, { method: 'POST', body: { version: campaign.version, packageVersion: terms[campaign.packageId]?.version } });
        setResults(r => ({ ...r, [id]: { ...r[id], campaign: b.data } })); setSubmits(s => ({ ...s, [id]: { status: 'submitted' } }));
      } catch (e) { setSubmits(s => ({ ...s, [id]: { status: 'failed', error: e.message || 'Could not submit this campaign' } })); }
    }
    setBusy(false);
  }

  const failedSaves = plans.filter(p => results[p.categoryId]?.status === 'failed');
  // Submitted means this session sent it, or the server already moved it past draft.
  const isSubmitted = id => submits[id]?.status === 'submitted' || (Boolean(results[id]?.campaign?.review) && !['DRAFT', 'CHANGES_REQUESTED'].includes(results[id].campaign.review));
  const waiting = saved.filter(p => !isSubmitted(p.categoryId)).map(p => p.categoryId);
  const canContinue = step === 0 ? name.trim() && selected.length > 0 : step === 1 ? groups.length > 0 : step === 2 ? plans.every(p => !p.problem) : true;

  const groupFacts = plan => <>
    <p className="ad-group-meta">{STOREFRONT[module]} · {categoryLabel(plan.category)} · {plural(plan.items.length, 'product')}</p>
    <ul className="ad-group-products">{plan.items.map(i => <li key={i.product.id}>{i.product.name}{i.product.variants?.length > 1 ? ` · ${i.product.variants.find(v => v.id === i.variantId)?.name || ''}` : ''}</li>)}</ul>
  </>;
  const packageFacts = plan => plan.chosen && <p className="ad-group-meta">{plan.chosen.name} · {plan.chosen.durationDays} days · up to {plural(plan.chosen.maxProducts, 'product')} per ad · {advertisingMoney(plan.price.base)}{plan.price.tax === null ? ' (GST not set in this package)' : plan.price.tax === 0 ? ' · no GST' : ` + ${advertisingMoney(plan.price.tax)} GST = ${advertisingMoney(plan.price.total)}`}</p>;
  const packageField = plan => <label className="ad-field">
    <span className="ad-field-title">Package</span>
    <select value={plan.chosen ? plan.chosen.id : ''} onChange={e => setPackageOf(o => ({ ...o, [plan.categoryId]: e.target.value }))}>
      <option value="">Choose a package</option>
      {plan.fitting.map(p => <option key={p.id} value={p.id}>{p.name} · {p.durationDays} days · up to {plural(p.maxProducts, 'product')} · {advertisingMoney(p.amountPaise)}</option>)}
    </select>
  </label>;
  const dateField = (plan, label = 'Start date') => <label className="ad-field">
    <span className="ad-field-title">{label}</span>
    <input type="datetime-local" min={earliestStart()} value={plan.start} onChange={e => sameDate ? setSharedStart(e.target.value) : setDateOf(d => ({ ...d, [plan.categoryId]: e.target.value }))} />
  </label>;

  return <div className="ad-modal-backdrop" role="dialog" aria-modal="true" aria-label="New campaign" onClick={() => !busy && onClose(locked)}>
    <div className="ad-modal-dialog ad-builder" onClick={e => e.stopPropagation()}>
      <div className="ad-modal-header">
        <div className="ad-modal-header-text">
          <span className="ad-modal-badge">New campaign</span>
          <h3>Step {step + 1} of {STEPS.length}: {STEPS[step]}</h3>
        </div>
        <button type="button" className="ad-modal-close-btn" disabled={busy} onClick={() => onClose(locked)} aria-label="Close dialog">✕</button>
      </div>
      <div className="ad-modal-body">
        <div className="ad-wizard-stepper">
          {STEPS.map((label, i) => <div key={label} className={`ad-stepper-step ${i === step ? 'active' : i < step ? 'done' : ''}`}><div className="ad-step-number">{i < step ? '✓' : i + 1}</div><span className="ad-step-label">{label}</span></div>)}
        </div>
        {error && <p role="alert" className="ad-error">{error}</p>}

        {step === 0 && <>
          <div className="ad-form-grid">
            <label className="ad-field"><span className="ad-field-title">Campaign name</span>
              <input maxLength={150} placeholder="e.g. Diwali Sale" value={name} onChange={e => setName(e.target.value)} /></label>
            <label className="ad-field"><span className="ad-field-title">Storefront</span>
              <select value={pendingModule || module} onChange={e => e.target.value !== module && (selected.length ? setPendingModule(e.target.value) : switchModule(e.target.value))}>
                <option value="ECOMMERCE">Shop All</option><option value="QUICK">Quick Commerce</option>
              </select></label>
          </div>
          {pendingModule && <div className="ad-notice" role="alert">
            <p>Switching to {STOREFRONT[pendingModule]} clears the {plural(selected.length, 'product')} you picked in {STOREFRONT[module]}. One wizard advertises products from one storefront.</p>
            <div className="ad-toolbar"><button type="button" className="ad-primary" onClick={() => switchModule(pendingModule)}>Switch and clear</button><button type="button" onClick={() => setPendingModule('')}>{`Keep ${STOREFRONT[module]}`}</button></div>
          </div>}
          <div className="ad-section-divider">
            <h4>Choose products</h4>
            <p className="ad-section-hint">Tick products from any categories in {STOREFRONT[module]}. Each category becomes its own campaign. Only approved products that are in stock can be picked.</p>
            {selected.length > 0 && <p className="ad-section-hint" role="status">Picked {plural(selected.length, 'product')} in {plural(groups.length, 'category')}.</p>}
            {limitNotice && <div className="ad-notice" role="alert" style={{ marginTop: 8 }}><p>{limitNotice}</p></div>}
          </div>
          <div className="ad-form-grid">
            <label className="ad-field"><span className="ad-field-title">Search products</span><input type="search" placeholder="Name or SKU" value={search} onChange={e => setSearch(e.target.value)} /></label>
            <label className="ad-field"><span className="ad-field-title">Category filter</span>
              <select value={categoryFilter} onChange={e => { setCategoryFilter(e.target.value); setPage(1); }}>
                <option value="">All categories</option>
                {Object.entries(knownCategories).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
              </select></label>
          </div>
          {loadError && <p role="alert" className="ad-error">{loadError} <button type="button" onClick={() => setReload(n => n + 1)}>Retry</button></p>}
          {loading && <div className="ad-products-loading">Loading your products…</div>}
          {!loading && !products.length && !loadError && <div className="ad-no-products"><p><strong>No products found in {STOREFRONT[module]}.</strong></p><small>Try another search or category, or switch the storefront above.</small></div>}
          <div className="ad-product-selection-list">
            {products.map(p => {
              const catId = defaultCategory(p);
              const limit = categoryLimitFor(p);
              const inCatCount = selected.filter(i => defaultCategory(i.product) === catId).length;
              const isSelected = selected.some(i => i.product.id === p.id);
              const limitReached = limit > 0 && inCatCount >= limit && !isSelected;

              return (
                <div key={p.id} className={`ad-product-item ${isSelected ? 'selected' : ''}`}>
                  <div className="ad-product-row">
                    {p.image && <img src={p.image} alt="" className="ad-product-img" />}
                    <div className="ad-product-info">
                      <strong>{p.name}</strong>{p.sku && <> · <span className="ad-sku">{p.sku}</span></>}
                      <span className="ad-product-categories">{STOREFRONT[module]} · {categoryLabel((p.adCategories || p.categories || [])[0])}</span>
                      {limit > 0 && <span className="ad-product-categories" style={{ color: '#0369a1', marginLeft: 8 }}>· Max {limit} per ad</span>}
                      {p.reason && <span className="ad-product-ineligible"> ({p.reason})</span>}
                      {limitReached && <span className="ad-product-ineligible" style={{ color: '#b45309' }}> (Limit reached: max {limit} per ad)</span>}
                    </div>
                  </div>
                  <div className="ad-variant-options">
                    {p.variants.map(v => <label key={v.id || 'standard'} className="ad-variant-choice">
                      <input type="checkbox" disabled={!p.eligible || v.stock < 1 || !(p.adCategories || p.categories || []).length || limitReached}
                        checked={selected.some(i => i.product.id === p.id && i.variantId === v.id)} onChange={e => tick(p, v, e.target.checked)} />
                      <span>{v.name} · ₹{v.price} · {v.stock} available</span>
                    </label>)}
                  </div>
                </div>
              );
            })}
          </div>
          {pages > 1 && <div className="ad-toolbar ad-product-nav">
            <button type="button" disabled={page <= 1} onClick={() => setPage(n => n - 1)}>Previous products</button><span>Product page {page} of {pages}</span>
            <button type="button" disabled={page >= pages} onClick={() => setPage(n => n + 1)}>More products</button>
          </div>}
        </>}

        {step === 1 && <>
          <p className="ad-section-hint">Each group becomes one campaign shown as “Sponsored” on its category page in {STOREFRONT[module]}. Move a group to a parent category to join it with other groups there.</p>
          {!groups.length && <p className="ad-notice" role="alert">No products are left. Go back and pick products.</p>}
          {groups.map(group => <section key={group.categoryId} className="ad-group-card" aria-label={`Group ${group.label}`}>
            <div className="ad-group-head"><h4>{campaignName(name, group.label)}</h4>
              <button type="button" className="ad-link-btn" onClick={() => removeProducts(group.items.map(i => i.product.id))}>Remove group</button></div>
            <label className="ad-field"><span className="ad-field-title">Category</span>
              <select value={group.categoryId} onChange={e => moveGroup(group, e.target.value)}>
                {group.options.map(c => <option key={c.id} value={String(c.id)}>{categoryLabel(c)}</option>)}
              </select></label>
            <ul className="ad-group-products">{group.items.map(i => <li key={i.product.id}>{i.product.name}
              <button type="button" className="ad-link-btn" aria-label={`Remove ${i.product.name}`} onClick={() => removeProducts([i.product.id])}>Remove</button></li>)}</ul>
          </section>)}
          {Object.keys(assigned).length > 0 && <button type="button" onClick={() => setAssigned({})}>Undo category changes</button>}
        </>}

        {step === 2 && <>
          <label className="ad-check"><input type="checkbox" checked={sameDate} onChange={e => {
            if (!e.target.checked) setDateOf(Object.fromEntries(plans.map(p => [p.categoryId, sharedStart])));
            setSameDate(e.target.checked);
          }} />Use the same start date for all campaigns.</label>
          {sameDate && dateField({ start: sharedStart }, 'Start date for all campaigns')}
          {plans.map(plan => <section key={plan.categoryId} className="ad-group-card" aria-label={`Campaign ${plan.name}`}>
            <h4>{plan.name}</h4>{groupFacts(plan)}
            <div className="ad-form-grid">{packageField(plan)}{!sameDate && dateField(plan)}</div>
            {packageFacts(plan)}
            {plan.problem && plan.problem !== 'Choose a package.' && <p className="ad-notice" role="alert">{plan.problem}</p>}
          </section>)}
        </>}

        {step === 3 && <>
          {plans.map(plan => <section key={plan.categoryId} className="ad-group-card ad-summary-box" aria-label={`Summary ${plan.name}`}>
            <h4>{plan.name}</h4>{groupFacts(plan)}{packageFacts(plan)}<p className="ad-group-meta">Starts: {startText(plan.start)}</p>
          </section>)}
          <p className="ad-summary-total"><strong>Total for {plural(plans.length, 'campaign')}: {advertisingMoney(total)}</strong>{totalTax ? ` (includes ${advertisingMoney(totalTax)} GST)` : ''}</p>
          <p className="ad-notice">Each campaign is reviewed and paid separately. You pay only for campaigns approved by Bulkimart.</p>
        </>}

        {step === 4 && <>
          <p role="status" className={failedSaves.length ? 'ad-notice' : 'ad-section-hint'}>
            {Object.values(results).some(r => r.status === 'saving') ? 'Saving your campaigns…'
              : failedSaves.length ? `${saved.length} of ${plural(plans.length, 'campaign')} saved. ${plural(failedSaves.length, 'campaign')} could not be saved.`
                : `All ${plural(plans.length, 'campaign')} are saved as drafts. Submit them for review when you are ready.`}
          </p>
          {plans.map(plan => {
            const result = results[plan.categoryId] || {}, sent = submits[plan.categoryId] || {};
            return <section key={plan.categoryId} className="ad-group-card" aria-label={`Result ${plan.name}`}>
              <div className="ad-group-head"><h4>{plan.name}</h4>
                <span className={`ad-status-pill ad-status-${isSubmitted(plan.categoryId) ? 'pending_review' : result.status === 'failed' ? 'rejected' : 'draft'}`}>
                  {isSubmitted(plan.categoryId) ? 'Waiting for review' : sent.status === 'submitting' ? 'Submitting…' : result.status === 'saved' ? 'Draft saved' : result.status === 'failed' ? 'Not saved' : 'Saving…'}
                </span></div>
              {groupFacts(plan)}
              {result.status === 'failed' && <>
                <p role="alert" className="ad-error">{result.error}</p>
                <div className="ad-form-grid">{packageField(plan)}{dateField(plan)}</div>
                <button type="button" disabled={busy || Boolean(plan.problem)} onClick={() => saveAll([plan])}>Retry</button>
              </>}
              {sent.status === 'failed' && <p role="alert" className="ad-error">{sent.error}</p>}
              {result.status === 'saved' && <div className="ad-toolbar">
                {!isSubmitted(plan.categoryId) && <button type="button" disabled={busy} onClick={() => sent.status === 'failed' && terms[result.campaign.packageId] ? submit([plan.categoryId]) : review([plan.categoryId])}>{sent.status === 'failed' ? 'Retry submit' : 'Submit for review'}</button>}
                <button type="button" onClick={() => onOpen(result.campaign)}>Open campaign</button>
              </div>}
            </section>;
          })}
          {confirming && <div className="ad-notice ad-terms" aria-label="Package terms">
            {[...new Set(confirming.map(id => results[id].campaign.packageId))].map(id => terms[id] && <div key={id}>
              <h4>{terms[id].name}</h4>
              <p className="ad-terms-price">{terms[id].billingQuote ? <>{advertisingMoney(terms[id].billingQuote.totalPaise)}{terms[id].billingQuote.taxPaise ? ` (${advertisingMoney(terms[id].billingQuote.basePaise)} + ${advertisingMoney(terms[id].billingQuote.taxPaise)} GST)` : ''}</> : advertisingMoney(terms[id].amountPaise)} per campaign for {terms[id].durationDays} days, payable after Bulkimart approves it.</p>
              <dl className="ad-terms-list">
                {Object.entries(TERM_LABELS).filter(([key]) => terms[id].policies?.[key]).map(([key, label]) => <React.Fragment key={key}><dt>{label}</dt><dd>{terms[id].policies[key]}</dd></React.Fragment>)}
                {terms[id].policies?.tax?.treatment && <><dt>GST</dt><dd>{terms[id].policies.tax.treatment}</dd></>}
              </dl>
            </div>)}
            <div className="ad-toolbar">
              <button type="button" className="ad-primary" disabled={busy} onClick={() => submit(confirming)}>{confirming.length > 1 ? `Confirm terms and submit ${confirming.length} campaigns` : 'Confirm terms and submit'}</button>
              <button type="button" onClick={() => setConfirming(null)}>Not now</button>
            </div>
          </div>}
        </>}
      </div>
      <div className="ad-modal-footer">
        {step < 4 ? <>
          <button type="button" onClick={() => onClose(false)}>Cancel</button>
          <div className="ad-modal-buttons">
            {step > 0 && <button type="button" onClick={() => setStep(s => s - 1)}>Back</button>}
            {step < 3 && <button type="button" className="ad-primary" disabled={!canContinue} onClick={() => setStep(s => s + 1)}>Continue</button>}
            {step === 3 && <button type="button" className="ad-primary" disabled={busy || plans.some(p => p.problem)} onClick={() => { setStep(4); void saveAll(plans); }}>{plans.length > 1 ? `Save ${plans.length} campaigns` : 'Save campaign'}</button>}
          </div>
        </> : <>
          <button type="button" disabled={busy} onClick={() => onClose(true)}>Close</button>
          <div className="ad-modal-buttons">
            {waiting.length > 0 && plans.length > 1 && !confirming && <button type="button" className="ad-primary" disabled={busy} onClick={() => review(waiting)}>Submit all for review</button>}
          </div>
        </>}
      </div>
    </div>
  </div>;
}
