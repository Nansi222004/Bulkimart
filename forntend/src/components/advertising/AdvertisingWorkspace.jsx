import React, { useEffect, useRef, useState } from 'react';
import { advertisingApi, advertisingMoney, blankPackageForm, campaignLabel, campaignStatusClass, packageFormFromRow, packagePayload, plainStatus } from './advertisingApi';
import './advertising.css';
import AdvertisingBillingPanel from './AdvertisingBillingPanel';
import AdvertisingFinancePanel from './AdvertisingFinancePanel';
import AdvertisingMetrics from './AdvertisingMetrics';
import AdvertisingPackageForm from './AdvertisingPackageForm';
import { advertisingNotificationId } from './advertisingNotifications';
import CampaignBuilder from './CampaignBuilder';
import { TERM_LABELS, earliestStart, localInput } from './campaignGroups';

const reviews = { DRAFT: 'Draft', PENDING_REVIEW: 'Waiting for review', CHANGES_REQUESTED: 'Changes requested', APPROVED: 'Approved', REJECTED: 'Rejected' };
const STOREFRONT = { ECOMMERCE: 'Shop All', QUICK: 'Quick Commerce' };
// Admin only: the store that sent the campaign, as the server names it.
const sellerName = seller => seller?.storeName || seller?.businessName || 'Unknown seller';
const STEPS = ['Products', 'Category', 'Package', 'Review'];
// Seller-facing names for the package terms shown before submitting.
// Plain names for campaign history entries; unknown actions fall back to their own name.
const HISTORY_LABELS = { create: 'Campaign created', edit: 'Campaign edited', submit: 'Submitted for review', approve: 'Approved by Bulkimart',
  'request-changes': 'Changes requested', reject: 'Not approved', cancel: 'Cancelled', suspend: 'Suspended by Bulkimart', pilot: 'Free trial run updated',
  'billing-authorize': 'Payment opened', 'payment-captured': 'Payment received', refund: 'Refund started', recognize: 'Campaign completed' };
// The category a campaign runs in, with its parent when the server names one.
const categoryText = c => !c ? '—' : c.parentName ? `${c.parentName} › ${c.name}` : c.name;
const dateText = value => new Date(value).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
// Where shoppers see the campaign: its category page (and the page of the category above it, which
// lists its sub-categories' products) in its storefront, limited to shoppers the seller delivers to.
const placementText = c => `In the “Sponsored” row at the top of ${c.category ? `the “${c.category.name}” category page` : 'its category page'}${c.category?.parentName ? ` and the “${c.category.parentName}” page` : ''} in ${STOREFRONT[c.module] || c.module}, for shoppers the seller delivers to.`;
// When it shows, from the campaign's own state and dates.
function timingText(c) {
  const now = Date.now(), start = c.paid?.startAt && new Date(c.paid.startAt), end = c.paid?.endAt && new Date(c.paid.endAt);
  if (c.pilot?.enabled && new Date(c.pilot.endAt) > now) return `Free test run until ${dateText(c.pilot.endAt)}.`;
  if (c.delivery === 'CANCELLED' && c.funding === 'REFUNDED') return 'Not showing: cancelled and refunded.';
  if (c.delivery === 'CANCELLED' && c.funding === 'PARTIALLY_REFUNDED') return 'Not showing: cancelled and partly refunded.';
  if (['COMPLETED', 'EXHAUSTED', 'CANCELLED', 'ADMIN_SUSPENDED', 'SELLER_PAUSED', 'UNAVAILABLE'].includes(c.delivery)) return `Not showing: ${plainStatus('delivery', c.delivery).toLowerCase()}.`;
  if (start && end) return start <= now && now < end ? `Showing now, until ${dateText(end)}.` : start > now ? `Starts ${dateText(start)} and runs until ${dateText(end)}.` : `Ended ${dateText(end)}.`;
  if (c.review === 'APPROVED') return `Starts once the seller pays: on ${c.requestedStartAt ? dateText(c.requestedStartAt) : 'the chosen start date'}, or on the payment date if that is later${c.terms?.durationDays ? `, for ${c.terms.durationDays} days` : ''}.`;
  if (c.review === 'REJECTED') return 'Not showing: not approved.';
  return 'Not showing yet: it starts after Bulkimart approves it and the seller pays.';
}

export default function AdvertisingWorkspace({ admin = false }) {
  const [cap, setCap] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [capabilityRetry, setCapabilityRetry] = useState(0);
  const [financeOpen, setFinanceOpen] = useState(false);
  const [tab, setTab] = useState('campaigns'), [rows, setRows] = useState([]), [meta, setMeta] = useState({ page: 1, pages: 1, total: 0 });
  const [page, setPage] = useState(1), [review, setReview] = useState(''), [refresh, setRefresh] = useState(0), [detail, setDetail] = useState(null);
  const [reason, setReason] = useState(''), [packageForm, setPackageForm] = useState(null), [draft, setDraft] = useState(null), [step, setStep] = useState(0);
  const [paymentNotice, setPaymentNotice] = useState(''), [building, setBuilding] = useState(false);
  const [submissionOffer, setSubmissionOffer] = useState(null);
  const [pilotStart, setPilotStart] = useState(''), [pilotEnd, setPilotEnd] = useState('');
  const [products, setProducts] = useState([]), [productPage, setProductPage] = useState(1), [productPages, setProductPages] = useState(1), [packages, setPackages] = useState([]);
  const [productsLoading, setProductsLoading] = useState(false), [productsError, setProductsError] = useState('');
  const generation = useRef(0), detailGeneration = useRef(0);
  const token = localStorage.getItem(admin ? 'adminToken' : 'sellerToken');
  const canReview = !admin || cap?.permissions?.includes('advertising_review');
  const canConfigure = admin && cap?.permissions?.includes('advertising_configure');
  const canFinanceRead = admin && cap?.permissions?.some(p => ['advertising_finance', 'advertising_reconcile', 'advertising_refund'].includes(p));

  useEffect(() => {
    let alive = true; setError(''); setCap(null); setDetail(null); setRows([]); setDraft(null); setPackageForm(null); setSubmissionOffer(null);
    advertisingApi(admin, '/capabilities').then(b => {
      if (alive) {
        setCap(b.data);
        if (admin && !b.data.permissions.includes('advertising_review')) setTab('packages');
      }
    }).catch(e => alive && setError(e.message));
    return () => { alive = false; detailGeneration.current++; };
  }, [admin, token, capabilityRetry]);

  useEffect(() => {
    if (!cap?.managementEnabled || (tab === 'campaigns' ? !canReview : !canConfigure)) return;
    const current = ++generation.current; setBusy(true); setError(''); setRows([]);
    const filterParam = !review ? ''
      : review === 'REFUNDED' ? 'funding=REFUNDED'
      : review === 'CANCELLED' ? 'delivery=CANCELLED'
      : `review=${review}`;
    advertisingApi(admin, `/${tab}?page=${page}&limit=20${tab === 'campaigns' && filterParam ? `&${filterParam}` : ''}`)
      .then(b => { if (current === generation.current) { setRows(b.data); setMeta(b.meta); } })
      .catch(e => { if (current === generation.current) setError(e.message); }).finally(() => { if (current === generation.current) setBusy(false); });
    return () => { generation.current++; };
  }, [admin, token, cap, tab, page, review, refresh]);

  useEffect(() => {
    if (!draft) return;
    let alive = true;
    setProducts([]);
    setProductsLoading(true);
    setProductsError('');
    advertisingApi(false, `/products?module=${draft.module}&limit=20&page=${productPage}`)
      .then(b => {
        if (alive) {
          setProducts(b.data || []);
          setProductPages(b.meta?.pages || 1);
        }
      })
      .catch(e => {
        if (alive) {
          setProductsError(e.message || 'Could not load products');
          setError(e.message);
        }
      })
      .finally(() => {
        if (alive) setProductsLoading(false);
      });
    advertisingApi(false, '/packages?limit=100')
      .then(b => alive && setPackages(b.data || []))
      .catch(e => alive && setError(e.message));
    return () => { alive = false; };
  }, [draft?.module, productPage, !!draft, token, refresh]);

  async function perform(work) {
    setBusy(true); setError('');
    try { await work(); setRefresh(n => n + 1); } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  async function open(row) {
    const seq = ++detailGeneration.current; setSubmissionOffer(null); setError(''); setPaymentNotice('');
    try {
      const b = await advertisingApi(admin, `/campaigns/${row.id}`);
      if (seq === detailGeneration.current) { setDetail(b.data); setReason(''); }
    } catch (e) { if (seq === detailGeneration.current) setError(e.message); }
  }

  useEffect(() => {
    if (!cap?.managementEnabled || !canReview) return;
    const fromLink = () => {
      const id = advertisingNotificationId({ route: window.location.pathname + window.location.search }, admin);
      if (id) { setTab('campaigns'); setDraft(null); void open({ id }); }
    };
    fromLink();
    window.addEventListener('advertising-campaign-open', fromLink);
    window.addEventListener('popstate', fromLink);
    return () => { window.removeEventListener('advertising-campaign-open', fromLink); window.removeEventListener('popstate', fromLink); };
  }, [admin, token, cap, canReview]);

  // Decision responses carry the campaign only; the names (seller, category, products) stay on screen.
  const showUpdate = next => setDetail(current => next && current?.id === next.id
    ? { ...next, ...Object.fromEntries(['seller', 'category', 'products'].filter(key => current[key] !== undefined && next[key] === undefined).map(key => [key, current[key]])) }
    : next);

  const change = (action) => perform(async () => {
    const path = admin ? `/campaigns/${detail.id}/${action}` : `/campaigns/${detail.id}/${action === 'submit' ? 'submit' : 'actions'}`;
    const b = await advertisingApi(admin, path, {
      method: 'POST',
      body: { version: detail.version, ...(admin ? { reason } : action === 'submit' ? { packageVersion: submissionOffer?.version } : { action }) }
    });
    showUpdate(b.data); setSubmissionOffer(null);
  });

  const savePilot = enabled => perform(async () => {
    const body = {
      version: detail.version, reason, enabled,
      ...(enabled ? { startAt: new Date(pilotStart).toISOString(), endAt: new Date(pilotEnd).toISOString() } : {})
    };
    const b = await advertisingApi(true, `/campaigns/${detail.id}/pilot`, { method: 'POST', body });
    showUpdate(b.data);
  });

  const offered = packages.filter(p => p.module === draft?.module && p.isActive && !p.archivedAt);
  const inCategory = offered.filter(p => !p.categories.length || p.categories.includes(draft?.categoryId));
  // A package can only be chosen when its "Products per ad" covers the ticked products.
  const candidates = inCategory.filter(p => p.maxProducts >= (draft?.items.length || 0));
  const chosen = candidates.find(p => p.id === draft?.packageId);
  // Only categories every ticked product belongs to: the server rejects a product outside the
  // campaign's category. A ticked product's categories are remembered when it is ticked, so a
  // tick on another page of the product list still counts; otherwise the loaded list is used.
  const pickedIds = [...new Set((draft?.items || []).map(i => i.productId))];
  const pickedLists = pickedIds.map(id => draft?.pickedCategories?.[id] || (p => p?.adCategories || p?.categories)(products.find(p => p.id === id))).filter(Boolean);
  const categories = pickedLists.length ? pickedLists.reduce((common, list) => common.filter(c => list.some(x => x.id === c.id)), [...new Map(pickedLists[0].map(c => [c.id, c])).values()]) : [];
  const categoryKey = categories.map(c => c.id).join('|');
  // Ticking stops at the "Products per ad" of the package that will apply: the chosen one, else the
  // largest among packages that serve the ticked products' categories (not every package in the storefront).
  const chosenPackage = offered.find(p => p.id === draft?.packageId);
  const applicable = draft?.categoryId ? inCategory
    : offered.filter(p => !p.categories.length || !categories.length || categories.some(c => p.categories.includes(c.id)));
  const productLimit = chosenPackage ? chosenPackage.maxProducts : applicable.length ? Math.max(...applicable.map(p => p.maxProducts)) : 0;
  const overLimit = productLimit > 0 && (draft?.items.length || 0) > productLimit;
  // One shared category is chosen for the seller; a choice that no longer fits is cleared.
  useEffect(() => {
    if (!draft) return;
    const next = categories.length === 1 ? categories[0].id : categories.some(c => c.id === draft.categoryId) ? draft.categoryId : '';
    if (next !== draft.categoryId) setDraft(d => d && ({ ...d, categoryId: next, packageId: '' }));
  }, [categoryKey, !!draft]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <section className="advertising-workspace" aria-label={admin ? 'Admin advertising' : 'Seller advertising'}>
      <header className="ad-header">
        <div className="ad-header-main">
          {admin && <div className="ad-header-badge">
            <span className="ad-badge-dot" aria-hidden="true"></span>
            Administration & Governance
          </div>}
          <h2>Advertising</h2>
          <p className="ad-subtitle">{admin ? 'Manage sponsored category campaigns separately from sales and payouts.' : 'Show your products at the top of a category page. You pay only after Bulkimart approves your campaign.'}</p>
        </div>
      </header>

      {admin && <div className="ad-policy-banner">
        <div className="ad-policy-icon" aria-hidden="true">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <path d="M12 16v-4"/>
            <path d="M12 8h.01"/>
          </svg>
        </div>
        <div className="ad-policy-text">
          <strong className="ad-policy-title">Compliance & Financial Snapshot</strong>
          <p className="ad-notice">Review the seller’s campaign and accepted package. Approval opens payment for standard packages and notifies the seller. Packages requiring an external invoice need finance to enter the invoice reference first.</p>
        </div>
      </div>}

      {error && <p role="alert" className="ad-error">{error} <button onClick={() => cap ? setRefresh(n => n + 1) : setCapabilityRetry(n => n + 1)}>Retry</button></p>}
      {!cap && !error && <p role="status">Loading advertising…</p>}
      {cap && !cap.managementEnabled && <p role="status">Advertising is not available right now.</p>}
      {canFinanceRead && <button onClick={() => setFinanceOpen(v => !v)}>Advertising finance and reconciliation</button>}
      {financeOpen && canFinanceRead && <AdvertisingFinancePanel permissions={cap.permissions} capabilities={cap} />}

      {cap?.managementEnabled && (
        <>
          {admin && !canReview && !canConfigure && <p>Your permissions do not include campaign review or package configuration. Use the finance workspace for authorized operations.</p>}

          <div className="ad-toolbar">
            {admin && <div className="ad-tabs-group">
              {canReview && (
                <button
                  className={`ad-tab-btn ${tab === 'campaigns' ? 'active' : ''}`}
                  onClick={() => { setTab('campaigns'); setPage(1); }}
                >
                  Campaigns
                </button>
              )}
              {canConfigure && (
                <button
                  className={`ad-tab-btn ${tab === 'packages' ? 'active' : ''}`}
                  onClick={() => { setTab('packages'); setPage(1); }}
                >
                  Packages and policies
                </button>
              )}
            </div>}

            <div className="ad-toolbar-actions">
              {tab === 'campaigns' && (
                <label className="ad-filter-label">
                  <span className="ad-filter-text">Status</span>
                  <select value={review} onChange={e => { setReview(e.target.value); setPage(1); }}>
                    <option value="">All campaigns</option>
                    {Object.entries(reviews).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    <option value="CANCELLED">Cancelled</option>
                    <option value="REFUNDED">Refunded</option>
                  </select>
                </label>
              )}
              {!admin && (
                <button className="ad-primary" onClick={() => { setBuilding(true); setDraft(null); setDetail(null); }}>
                  Create campaign
                </button>
              )}
              {tab === 'packages' && canConfigure && (
                <button className="ad-primary" onClick={() => setPackageForm(blankPackageForm())}>
                  Create package
                </button>
              )}
            </div>
          </div>

          {busy && <p role="status">Updating advertising…</p>}

          {!busy && !rows.length && (
            <div className="ad-empty-state">
              <div className="ad-empty-icon" aria-hidden="true">
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m3 11 18-5v12L3 14v-3z"/>
                  <path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/>
                </svg>
              </div>
              <h3 className="ad-empty-title">{tab === 'packages' ? 'No packages yet' : review ? 'No campaigns with this status' : 'No campaigns yet'}</h3>
              <p className="ad-empty-desc">
                {tab === 'packages' ? 'Click Create package to add one.'
                  : review ? 'Choose "All campaigns" to see every campaign.'
                  : admin ? 'Seller campaigns appear here for review.' : 'Create a campaign to feature your products at the top of a category page.'}
              </p>
              {!admin && tab === 'campaigns' && !review && (
                <ol className="ad-how-steps">
                  <li><strong>Choose products and a package</strong><span>Pick what to advertise, the category and how long.</span></li>
                  <li><strong>Bulkimart reviews it</strong><span>We check that your campaign follows the marketplace rules.</span></li>
                  <li><strong>Pay and go live</strong><span>Pay online and your products show as “Sponsored”.</span></li>
                </ol>
              )}
            </div>
          )}

          <div className="ad-grid">
            {rows.map(row => (
              <article className="ad-card ad-campaign-card" key={row.id}>
                <div className="ad-card-header">
                  <span className={`ad-status-pill ad-status-${tab === 'campaigns' ? campaignStatusClass(row) : (row.isActive ? 'approved' : 'draft')}`}>
                    {tab === 'campaigns' ? campaignLabel(row) : (row.archivedAt ? 'Archived' : row.isActive ? 'Available for submission' : 'Inactive')}
                  </span>
                  <span className="ad-module-pill">{row.module}</span>
                </div>
                <h3 className="ad-card-title">{row.name}</h3>
                {tab === 'campaigns' ? (
                  <>
                    {admin && <p className="ad-card-seller">Seller: <strong>{sellerName(row.seller)}</strong>{row.seller?.city ? ` · ${row.seller.city}` : ''}</p>}
                    <div className="ad-card-meta">
                      <span className="ad-placement-tag">{STOREFRONT[row.module] || row.module} · {row.category ? categoryText(row.category) : 'Sponsored category'}</span>
                      <span className="ad-price-tag">{advertisingMoney(row.terms?.amountPaise)}</span>
                    </div>
                    <div className="ad-card-footer">
                      <button className="ad-view-btn" onClick={() => open(row)}>View campaign</button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="ad-card-meta">{row.module} · {row.durationDays} days · {advertisingMoney(row.amountPaise)}</p>
                    <p>Version {row.version}</p>
                    <p>{row.description}</p>
                    {!row.archivedAt && (
                      <button onClick={() => setPackageForm(packageFormFromRow(row))}>
                        Edit package
                      </button>
                    )}
                  </>
                )}
              </article>
            ))}
          </div>

          {meta.pages > 1 && <nav className="ad-toolbar ad-pagination" aria-label="Advertising pages">
            <button className="ad-page-btn" disabled={busy || page <= 1} onClick={() => setPage(p => p - 1)}>Previous</button>
            <span className="ad-page-counter">Page {meta.page} of {meta.pages} · {meta.total} results</span>
            <button className="ad-page-btn" disabled={busy || page >= meta.pages} onClick={() => setPage(p => p + 1)}>Next</button>
          </nav>}

          {/* Campaign Details Modal */}
          {detail && (
            <div className="ad-modal-backdrop" role="dialog" aria-modal="true" onClick={() => { detailGeneration.current++; setDetail(null); }}>
              <div className="ad-modal-dialog" onClick={e => e.stopPropagation()}>
                <div className="ad-modal-header">
                  <div className="ad-modal-header-text">
                    <span className={`ad-status-pill ad-status-${campaignStatusClass(detail)}`}>
                      {campaignLabel(detail)}
                    </span>
                    <h3>{detail.name}</h3>
                    {admin && (
                      <p className="ad-detail-sub">
                        Version {detail.revision} · Payment: {plainStatus('funding', detail.funding)} · Ad: {plainStatus('delivery', detail.delivery)}
                        {detail.funding === 'REFUNDED' && <strong className="ad-detail-refunded-badge"> · Refunded</strong>}
                        {detail.funding === 'PARTIALLY_REFUNDED' && <strong className="ad-detail-refunded-badge"> · Partly refunded</strong>}
                      </p>
                    )}
                  </div>
                  <button type="button" className="ad-modal-close-btn" aria-label="Close details" onClick={() => { detailGeneration.current++; setDetail(null); }}>✕</button>
                </div>

                <div className="ad-modal-body">
                  <div className="ad-detail-meta-strip">
                    {admin && (
                      <div className="ad-meta-item">
                        <span className="ad-meta-label">Seller</span>
                        <p>{sellerName(detail.seller)}{detail.seller?.businessName && detail.seller.businessName !== detail.seller.storeName ? ` (${detail.seller.businessName})` : ''}{detail.seller?.city ? ` · ${detail.seller.city}` : ''}</p>
                      </div>
                    )}
                    <div className="ad-meta-item">
                      <span className="ad-meta-label">Storefront and category</span>
                      <p>{STOREFRONT[detail.module] || detail.module} · {categoryText(detail.category)}</p>
                    </div>
                    <div className="ad-meta-item ad-meta-wide">
                      <span className="ad-meta-label">Where and when it shows</span>
                      <p>{placementText(detail)}</p>
                      <p>{timingText(detail)}</p>
                    </div>
                    {detail.products?.length > 0 && (
                      <div className="ad-meta-item">
                        <span className="ad-meta-label">Products ({detail.products.length})</span>
                        <p>{detail.products.map(p => p.variant && p.variant !== 'Standard' ? `${p.name} (${p.variant})` : p.name).join(', ')}</p>
                      </div>
                    )}
                    <div className="ad-meta-item">
                      <span className="ad-meta-label">Start date</span>
                      <p>{detail.requestedStartAt ? new Date(detail.requestedStartAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : 'Not selected'}{!admin && ' (or when your payment is received, if later)'}</p>
                    </div>
                    {detail.terms && (
                      <div className="ad-meta-item">
                        <span className="ad-meta-label">Package</span>
                        <p>{detail.terms.name}: {advertisingMoney(detail.terms.amountPaise)} for {detail.terms.durationDays} days · up to {detail.terms.maxProducts === 1 ? '1 product' : `${detail.terms.maxProducts} products`} per ad</p>
                      </div>
                    )}
                  </div>

                  {admin && detail.review === 'APPROVED' && ['UNPAID', 'PAYMENT_FAILED'].includes(detail.funding) && detail.delivery === 'NOT_SCHEDULED' && (
                    <section className="ad-payment-request" aria-label="Request seller payment">
                      <h4>{detail.paid?.authorized ? 'Awaiting seller payment' : 'Payment setup required'}</h4>
                      <p>{detail.paid?.authorized ? 'The seller can open Advertising, select this campaign and pay online. Send a reminder if payment is still pending.' : detail.terms?.policies?.billing?.invoiceMode === 'EXTERNAL_REFERENCE' ? 'Finance must add the external invoice reference in Campaign billing below, then request payment.' : 'The accepted package has incomplete billing terms. Request a new campaign with a configured package before collecting payment.'}</p>
                      {detail.paid?.authorized && canReview && <button className="ad-primary" disabled={busy || !!paymentNotice || !!detail.pilot?.enabled || !cap.paymentsEnabled} onClick={() => perform(async () => {
                        await advertisingApi(true, `/campaigns/${detail.id}/request-payment`, { method: 'POST', body: { version: detail.version } });
                        setPaymentNotice('Payment reminder sent to the seller’s notifications.');
                      })}>Send payment reminder</button>}
                      {!cap.paymentsEnabled && <p>Online payments are currently unavailable. Configure and enable advertising payments before collecting payment.</p>}
                      {detail.pilot?.enabled && <p>Stop the free trial run before requesting payment.</p>}
                      {!detail.paid?.authorized && !canFinanceRead && <p>An administrator with advertising finance permission can complete payment setup.</p>}
                      {paymentNotice && <p role="status">{paymentNotice}</p>}
                    </section>
                  )}
                  {error && <p role="alert" className="ad-error">{error}</p>}
                  {(!admin || canFinanceRead) && (
                    <AdvertisingBillingPanel
                      key={`${detail.id}:${detail.version}`}
                      id={detail.id}
                      admin={admin}
                      permissions={cap.permissions || []}
                      capabilities={cap}
                      onChanged={() => { setRefresh(n => n + 1); void open(detail); }}
                    />
                  )}
                  {canReview && <AdvertisingMetrics key={`metrics:${detail.id}`} id={detail.id} admin={admin} />}

                  {admin && detail.pilot && (
                    <p className="ad-notice">
                      Separate non-billable pilot: {detail.pilot.enabled ? 'Authorized' : 'Stopped'} · {new Date(detail.pilot.startAt).toLocaleString()} – {new Date(detail.pilot.endAt).toLocaleString()}. This is not paid or funded service.
                    </p>
                  )}

                  {admin && canReview && cap.pilotEnabled && detail.review === 'APPROVED' && detail.delivery === 'NOT_SCHEDULED' && detail.funding === 'UNPAID' && (
                    <div className="ad-notice">
                      <h4>Non-billable category pilot</h4>
                      <p>Explicit test authorization only; funding and paid service remain unchanged. Enter a decision reason below.</p>
                      <label>Pilot start<input type="datetime-local" value={pilotStart} onChange={e => setPilotStart(e.target.value)} /></label>
                      <label>Pilot end<input type="datetime-local" value={pilotEnd} onChange={e => setPilotEnd(e.target.value)} /></label>
                      <button disabled={busy || !reason.trim() || !pilotStart || !pilotEnd} onClick={() => savePilot(true)}>
                        Authorize non-billable pilot
                      </button>
                    </div>
                  )}

                  {admin && canReview && detail.pilot?.enabled && (
                    <button disabled={busy || !reason.trim()} onClick={() => savePilot(false)}>Stop non-billable pilot</button>
                  )}

                  <div className="ad-history-section">
                    <h4>History</h4>
                    <ul className="ad-history-list">
                      {detail.history.map((h, i) => (
                        <li key={i}>{new Date(h.at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })} · {HISTORY_LABELS[h.action] || String(h.action).replaceAll('-', ' ')}{h.reason ? ` · ${h.reason}` : ''}</li>
                      ))}
                    </ul>
                  </div>

                  {/* Hidden while the terms are open, and gone once the campaign is submitted (waiting for review). */}
                  {!admin && !submissionOffer && ['DRAFT', 'CHANGES_REQUESTED'].includes(detail.review) && detail.delivery === 'NOT_SCHEDULED' && (
                    <div className="ad-toolbar">
                      <button
                        disabled={busy}
                        onClick={() => {
                          setDraft({
                            ...detail,
                            items: detail.items.map(i => ({ productId: i.productId, ...(i.variantId ? { variantId: i.variantId } : {}) })),
                            requestedStartAt: detail.requestedStartAt ? localInput(new Date(detail.requestedStartAt)) : ''
                          });
                          setStep(0);
                        }}
                      >
                        Edit campaign
                      </button>
                      <button
                        disabled={busy}
                        onClick={() => perform(async () => setSubmissionOffer((await advertisingApi(false, `/packages/${detail.packageId}`)).data))}
                      >
                        Submit for review
                      </button>
                    </div>
                  )}

                  {submissionOffer && (
                    <div className="ad-notice ad-terms">
                      <h4>{submissionOffer.name}</h4>
                      <p className="ad-terms-price">{submissionOffer.billingQuote
                        ? <>You will pay <strong>{advertisingMoney(submissionOffer.billingQuote.totalPaise)}</strong>{submissionOffer.billingQuote.taxPaise ? ` (${advertisingMoney(submissionOffer.billingQuote.basePaise)} + ${advertisingMoney(submissionOffer.billingQuote.taxPaise)} GST)` : ''} for {submissionOffer.durationDays} days, after Bulkimart approves your campaign.</>
                        : <>{advertisingMoney(submissionOffer.amountPaise)} for {submissionOffer.durationDays} days. Payment opens after Bulkimart approves your campaign.</>}</p>
                      {submissionOffer.description && <p>{submissionOffer.description}</p>}
                      <dl className="ad-terms-list">
                        {Object.entries(TERM_LABELS).filter(([key]) => submissionOffer.policies?.[key]).map(([key, label]) => <React.Fragment key={key}><dt>{label}</dt><dd>{submissionOffer.policies[key]}</dd></React.Fragment>)}
                        {submissionOffer.policies?.tax?.treatment && <><dt>GST</dt><dd>{submissionOffer.policies.tax.treatment}</dd></>}
                      </dl>
                      <button className="ad-primary" disabled={busy} onClick={() => change('submit')}>Confirm terms and submit</button>
                    </div>
                  )}

                  {!admin && detail.funding === 'UNPAID' && detail.delivery === 'NOT_SCHEDULED' && (
                    <button className="ad-cancel-campaign" disabled={busy} onClick={() => change('cancel')}>Cancel campaign</button>
                  )}

                  {admin && canReview && (
                    <section className="ad-review-actions" aria-label="Campaign decision">
                      <label>Decision reason<textarea placeholder="Explain your decision to the seller" value={reason} maxLength={2000} onChange={e => setReason(e.target.value)} /></label>
                      <div className="ad-decision-buttons">
                        {(detail.review === 'PENDING_REVIEW' ? ['approve', 'request-changes', 'reject', 'suspend', 'cancel'] : ['suspend', 'cancel']).map(action => (
                          <button
                            key={action}
                            className={action === 'approve' ? 'ad-primary' : ['reject', 'cancel', 'suspend'].includes(action) ? 'ad-danger' : ''}
                            disabled={busy || !reason.trim() || ['ADMIN_SUSPENDED', 'CANCELLED', 'COMPLETED'].includes(detail.delivery)}
                            onClick={() => change(action)}
                          >
                            {{ approve: detail.terms?.policies?.billing && detail.terms.policies.billing.invoiceMode !== 'EXTERNAL_REFERENCE' ? 'Approve & request payment' : 'Approve campaign', 'request-changes': 'Request changes', reject: 'Reject campaign', suspend: 'Suspend campaign', cancel: 'Cancel campaign' }[action]}
                          </button>
                        ))}
                      </div>
                    </section>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* New campaigns: products from several categories become one campaign per category. */}
          {building && !admin && (
            <CampaignBuilder
              onClose={changed => { setBuilding(false); if (changed) setRefresh(n => n + 1); }}
              onOpen={campaign => { setBuilding(false); setRefresh(n => n + 1); void open(campaign); }}
            />
          )}

          {/* Editing a saved campaign (one category) */}
          {draft && (
            <div className="ad-modal-backdrop" role="dialog" aria-modal="true" onClick={() => setDraft(null)}>
              <div className="ad-modal-dialog" onClick={e => e.stopPropagation()}>
                <div className="ad-modal-header">
                  <div className="ad-modal-header-text">
                    <span className="ad-modal-badge">{draft.id ? 'Edit campaign' : 'New campaign'}</span>
                    <h3>Step {step + 1} of 4: {STEPS[step]}</h3>
                  </div>
                  <button type="button" className="ad-modal-close-btn" onClick={() => setDraft(null)} aria-label="Close dialog">✕</button>
                </div>

                <form
                  className="ad-modal-form"
                  onSubmit={e => {
                    e.preventDefault();
                    if (step < 3) { setStep(s => s + 1); return; }
                    perform(async () => {
                      const body = {
                        name: draft.name,
                        module: draft.module,
                        categoryId: draft.categoryId,
                        items: draft.items,
                        packageId: draft.packageId,
                        requestedStartAt: new Date(draft.requestedStartAt).toISOString(),
                        ...(draft.id ? { version: draft.version } : {})
                      };
                      const b = await advertisingApi(false, `/campaigns${draft.id ? `/${draft.id}` : ''}`, { method: draft.id ? 'PATCH' : 'POST', body });
                      setSubmissionOffer(null); setDraft(null); void open(b.data);
                    });
                  }}
                >
                  <div className="ad-modal-body">
                    <div className="ad-wizard-stepper">
                      {STEPS.map((name, i) => (
                        <div key={name} className={`ad-stepper-step ${i === step ? 'active' : i < step ? 'done' : ''}`}>
                          <div className="ad-step-number">{i < step ? '✓' : i + 1}</div>
                          <span className="ad-step-label">{name}</span>
                        </div>
                      ))}
                    </div>

                    {step === 0 && (
                      <>
                        <div className="ad-form-grid">
                          <label className="ad-field">
                            <span className="ad-field-title">Campaign name</span>
                            <input required maxLength={200} placeholder="e.g. Diwali offers" value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} />
                          </label>
                          <label className="ad-field">
                            <span className="ad-field-title">Storefront</span>
                            <select value={draft.module} disabled={!!draft.id} onChange={e => { setDraft({ ...draft, module: e.target.value, items: [], pickedCategories: {}, categoryId: '', packageId: '' }); setProductPage(1); }}>
                              <option value="ECOMMERCE">Shop All</option>
                              <option value="QUICK">Quick Commerce</option>
                            </select>
                          </label>
                        </div>

                        <div className="ad-section-divider">
                          <h4>Choose products</h4>
                          <p className="ad-section-hint">Tick the products to advertise. Only approved products that are in stock can be picked.</p>
                          {productLimit > 0 && <p className="ad-section-hint" role="status">Products per ad: up to {productLimit}. Picked {draft.items.length}.</p>}
                          {overLimit && <p className="ad-notice" role="alert">Packages allow up to {productLimit} {productLimit === 1 ? 'product' : 'products'} per ad. Untick {draft.items.length - productLimit} to continue.</p>}
                        </div>

                        {productsError && (
                          <p role="alert" className="ad-error">
                            {productsError} <button type="button" onClick={() => setRefresh(n => n + 1)}>Retry</button>
                          </p>
                        )}

                        {productsLoading && (
                          <div className="ad-products-loading">
                            Loading your products…
                          </div>
                        )}

                        {!productsLoading && !products.length && !productsError && (
                          <div className="ad-no-products">
                            <p><strong>No products found in {STOREFRONT[draft.module]}.</strong></p>
                            <small>Only approved products that are in stock can be advertised. If your products are in {draft.module === 'QUICK' ? 'Shop All' : 'Quick Commerce'}, change the storefront above.</small>
                          </div>
                        )}

                        <div className="ad-product-selection-list">
                          {products.map(p => (
                            <div key={p.id} className={`ad-product-item ${draft.items.some(i => i.productId === p.id) ? 'selected' : ''}`}>
                              <div className="ad-product-row">
                                {p.image && <img src={p.image} alt="" className="ad-product-img" />}
                                <div className="ad-product-info">
                                  <strong>{p.name}</strong>{p.sku && <> · <span className="ad-sku">{p.sku}</span></>}
                                  {p.reason && <span className="ad-product-ineligible"> ({p.reason})</span>}
                                </div>
                              </div>
                              <div className="ad-variant-options">
                                {p.variants.map(v => (
                                  <label key={v.id || 'standard'} className="ad-variant-choice">
                                    <input
                                      type="checkbox"
                                      disabled={!p.eligible || v.stock < 1 || (productLimit > 0 && draft.items.length >= productLimit && !draft.items.some(i => i.productId === p.id))}
                                      checked={draft.items.some(i => i.productId === p.id && i.variantId === v.id)}
                                      onChange={e => setDraft({
                                        ...draft,
                                        items: e.target.checked
                                          ? [...draft.items.filter(i => i.productId !== p.id), { productId: p.id, ...(v.id ? { variantId: v.id } : {}) }]
                                          : draft.items.filter(i => i.productId !== p.id),
                                        pickedCategories: { ...draft.pickedCategories, [p.id]: p.adCategories || p.categories }
                                      })}
                                    />
                                    <span>{v.name} · ₹{v.price} · {v.stock} available</span>
                                  </label>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>

                        {productPages > 1 && <div className="ad-toolbar ad-product-nav">
                          <button type="button" disabled={productPage <= 1} onClick={() => setProductPage(p => p - 1)}>Previous products</button>
                          <span>Product page {productPage}</span>
                          <button type="button" disabled={productPage >= productPages} onClick={() => setProductPage(p => p + 1)}>More products</button>
                        </div>}
                      </>
                    )}

                    {step === 1 && (
                      <>
                        <p className="ad-section-hint">Your products show as “Sponsored” at the top of this category page.</p>
                        <label className="ad-field">
                          <span className="ad-field-title">Category</span>
                          <select required value={draft.categoryId} onChange={e => setDraft({ ...draft, categoryId: e.target.value, packageId: '' })}>
                            <option value="">{categories.length ? 'Choose a category' : 'No category fits all your products'}</option>
                            {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                          </select>
                        </label>
                        {pickedIds.length > 0 && !categories.length && <p className="ad-notice" role="alert">The products you picked are in different categories. A campaign shows products from one category, so go back and keep only products from the same category.</p>}
                      </>
                    )}

                    {step === 2 && (
                      <>
                        <div className="ad-form-grid">
                          <label className="ad-field">
                            <span className="ad-field-title">Start date</span>
                            <input required type="datetime-local" min={earliestStart()} value={draft.requestedStartAt} onChange={e => setDraft({ ...draft, requestedStartAt: e.target.value })} />
                          </label>
                          <label className="ad-field">
                            <span className="ad-field-title">Package</span>
                            <select required value={chosen ? draft.packageId : ''} onChange={e => setDraft({ ...draft, packageId: e.target.value })}>
                              <option value="">Choose a package</option>
                              {candidates.map(p => <option key={p.id} value={p.id}>{p.name} · {p.durationDays} days · up to {p.maxProducts} {p.maxProducts === 1 ? 'product' : 'products'} · {advertisingMoney(p.amountPaise)}</option>)}
                            </select>
                          </label>
                        </div>
                        {!inCategory.length && <p className="ad-notice">No package is available for this category yet. Please check again later.</p>}
                        {inCategory.length > 0 && !candidates.length && <p className="ad-notice" role="alert">You picked {draft.items.length} products, but packages for this category allow up to {Math.max(...inCategory.map(p => p.maxProducts))} per ad. Go back and untick some products.</p>}
                        {candidates.length > 0 && inCategory.length > candidates.length && <p className="ad-section-hint">Packages that allow fewer than {draft.items.length} products per ad are not shown.</p>}
                      </>
                    )}

                    {step === 3 && (
                      <>
                        <div className="ad-summary-box">
                          <div className="ad-summary-header">
                            <span className="ad-summary-badge">Summary</span>
                            <p><strong>{draft.name}</strong> · {draft.items.length} {draft.items.length === 1 ? 'product' : 'products'} · {categories.find(c => c.id === draft.categoryId)?.name}</p>
                          </div>
                          <div className="ad-summary-pkg-name">{chosen?.name}</div>
                          <div className="ad-summary-pkg-details">{chosen?.durationDays} days · {advertisingMoney(chosen?.amountPaise)}{chosen?.billingQuote?.taxPaise ? ` + ${advertisingMoney(chosen.billingQuote.taxPaise)} GST` : ''}</div>
                          <p>Starts: {draft.requestedStartAt ? new Date(draft.requestedStartAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—'}</p>
                          <p className="ad-summary-note">Save it, then submit it for review. You pay only after Bulkimart approves it.</p>
                        </div>
                      </>
                    )}
                  </div>

                  <div className="ad-modal-footer">
                    <button type="button" disabled={busy} onClick={() => setDraft(null)}>Cancel</button>
                    <div className="ad-modal-buttons">
                      {step > 0 && <button type="button" onClick={() => setStep(s => s - 1)}>Back</button>}
                      <button className="ad-primary" disabled={busy || (step === 0 && (!draft.items.length || overLimit)) || (step === 3 && !chosen)}>
                        {step === 3 ? 'Save campaign draft' : 'Continue'}
                      </button>
                    </div>
                  </div>
                </form>
              </div>
            </div>
          )}

          {packageForm && <AdvertisingPackageForm key={packageForm.id || 'new'} value={packageForm} busy={busy} onCancel={() => setPackageForm(null)}
            onSave={form => perform(async () => {
              await advertisingApi(true, `/packages${form.id ? `/${form.id}` : ''}`, { method: form.id ? 'PATCH' : 'POST', body: packagePayload(form) });
              setPackageForm(null);
            })} />}
        </>
      )}
    </section>
  );
}
