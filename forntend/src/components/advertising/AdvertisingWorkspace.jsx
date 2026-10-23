import React, { useEffect, useRef, useState } from 'react';
import { advertisingApi, advertisingMoney, campaignLabel, packagePayload } from './advertisingApi';
import './advertising.css';
import AdvertisingBillingPanel from './AdvertisingBillingPanel';
import AdvertisingFinancePanel from './AdvertisingFinancePanel';
import AdvertisingMetrics from './AdvertisingMetrics';
import AdvertisingBillingPolicyEditor from './AdvertisingBillingPolicyEditor';

const reviews = ['DRAFT', 'PENDING_REVIEW', 'CHANGES_REQUESTED', 'APPROVED', 'REJECTED'];
const freshPackage = () => ({
  name: '', description: '', module: 'ECOMMERCE', price: '', durationDays: '', maxProducts: '', categories: '',
  isActive: false, archived: false, reason: '', policies: {}, windowHours: '', conversionEvent: '', model: ''
});
const freshCampaign = () => ({ name: '', module: 'ECOMMERCE', categoryId: '', packageId: '', requestedStartAt: '', items: [] });

export default function AdvertisingWorkspace({ admin = false }) {
  const [cap, setCap] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [capabilityRetry, setCapabilityRetry] = useState(0);
  const [financeOpen, setFinanceOpen] = useState(false);
  const [tab, setTab] = useState('campaigns'), [rows, setRows] = useState([]), [meta, setMeta] = useState({ page: 1, pages: 1, total: 0 });
  const [page, setPage] = useState(1), [review, setReview] = useState(''), [refresh, setRefresh] = useState(0), [detail, setDetail] = useState(null);
  const [reason, setReason] = useState(''), [packageForm, setPackageForm] = useState(null), [draft, setDraft] = useState(null), [step, setStep] = useState(0);
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
    advertisingApi(admin, `/${tab}?page=${page}&limit=20${tab === 'campaigns' && review ? `&review=${review}` : ''}`)
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
    const seq = ++detailGeneration.current; setSubmissionOffer(null); setError('');
    try {
      const b = await advertisingApi(admin, `/campaigns/${row.id}`);
      if (seq === detailGeneration.current) { setDetail(b.data); setReason(''); }
    } catch (e) { setError(e.message); }
  }

  const change = (action) => perform(async () => {
    const path = admin ? `/campaigns/${detail.id}/${action}` : `/campaigns/${detail.id}/${action === 'submit' ? 'submit' : 'actions'}`;
    const b = await advertisingApi(admin, path, {
      method: 'POST',
      body: { version: detail.version, ...(admin ? { reason } : action === 'submit' ? { packageVersion: submissionOffer?.version } : { action }) }
    });
    setDetail(b.data); setSubmissionOffer(null);
  });

  const savePilot = enabled => perform(async () => {
    const body = {
      version: detail.version, reason, enabled,
      ...(enabled ? { startAt: new Date(pilotStart).toISOString(), endAt: new Date(pilotEnd).toISOString() } : {})
    };
    const b = await advertisingApi(true, `/campaigns/${detail.id}/pilot`, { method: 'POST', body });
    setDetail(b.data);
  });

  const candidates = packages.filter(p => p.module === draft?.module && p.isActive && !p.archivedAt && (!p.categories.length || p.categories.includes(draft?.categoryId)));
  const chosen = candidates.find(p => p.id === draft?.packageId);
  const categories = [...new Map(products.flatMap(p => p.categories).map(c => [c.id, c])).values()];

  return (
    <section className="advertising-workspace" aria-label={admin ? 'Admin advertising' : 'Seller advertising'}>
      <header className="ad-header">
        <div className="ad-header-main">
          <div className="ad-header-badge">
            <span className="ad-badge-dot" aria-hidden="true"></span>
            {admin ? 'Administration & Governance' : 'Seller Growth Suite'}
          </div>
          <h2>Advertising</h2>
          <p className="ad-subtitle">Manage sponsored category campaigns separately from sales and payouts.</p>
        </div>
        {!admin && (
          <div className="ad-header-stats">
            <div className="ad-stat-pill">
              <span className="ad-stat-label">Active Channel</span>
              <span className="ad-stat-val">Category Spotlight</span>
            </div>
            <div className="ad-stat-pill">
              <span className="ad-stat-label">Placement</span>
              <span className="ad-stat-val">Shop All & Quick</span>
            </div>
          </div>
        )}
      </header>

      <div className="ad-policy-banner">
        <div className="ad-policy-icon" aria-hidden="true">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <path d="M12 16v-4"/>
            <path d="M12 8h.01"/>
          </svg>
        </div>
        <div className="ad-policy-text">
          <strong className="ad-policy-title">Compliance & Financial Snapshot</strong>
          <p className="ad-notice">Billing and paid delivery require enabled capabilities, an approved policy snapshot and explicit campaign financial authorization. Pilot service is separate. No revenue is recognized automatically.</p>
        </div>
      </div>

      {error && <p role="alert" className="ad-error">{error} <button onClick={() => cap ? setRefresh(n => n + 1) : setCapabilityRetry(n => n + 1)}>Retry</button></p>}
      {!cap && !error && <p role="status">Loading advertising capabilities…</p>}
      {cap && !cap.managementEnabled && <p role="status">Advertising management is currently disabled. No campaigns can be purchased or served.</p>}
      {canFinanceRead && <button onClick={() => setFinanceOpen(v => !v)}>Advertising finance and reconciliation</button>}
      {financeOpen && canFinanceRead && <AdvertisingFinancePanel permissions={cap.permissions} capabilities={cap} />}

      {cap?.managementEnabled && (
        <>
          {admin && !canReview && !canConfigure && <p>Your permissions do not include campaign review or package configuration. Use the finance workspace for authorized operations.</p>}

          <div className="ad-toolbar">
            <div className="ad-tabs-group">
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
            </div>

            <div className="ad-toolbar-actions">
              {tab === 'campaigns' && (
                <label className="ad-filter-label">
                  <span className="ad-filter-text">Review status</span>
                  <select value={review} onChange={e => { setReview(e.target.value); setPage(1); }}>
                    <option value="">All review states</option>
                    {reviews.map(s => <option key={s}>{s}</option>)}
                  </select>
                </label>
              )}
              {!admin && (
                <button className="ad-primary" onClick={() => { setDraft(freshCampaign()); setStep(0); setDetail(null); }}>
                  Create campaign
                </button>
              )}
              {tab === 'packages' && canConfigure && (
                <button className="ad-primary" onClick={() => setPackageForm(freshPackage())}>
                  Create package
                </button>
              )}
            </div>
          </div>

          <div className="ad-roas-bar">
            <span className="ad-roas-icon" aria-hidden="true">📊</span>
            <p className="ad-roas-text">Attributed sales and ROAS: pending attribution implementation. Campaign details show backend impression and click counts separately for paid service and pilots.</p>
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
              <h3 className="ad-empty-title">No {tab} found for this selection.</h3>
              <p className="ad-empty-desc">
                {tab === 'campaigns'
                  ? (review
                      ? 'No campaigns match the selected review filter. Select "All review states" or click "Create campaign" above.'
                      : 'Promote your catalog at the top of category searches. Reach verified wholesale buyers and boost your storefront order volume.')
                  : 'No advertising packages configured yet.'}
              </p>
              {!admin && tab === 'campaigns' && !review && (
                <div className="ad-perks-grid">
                  <div className="ad-perk-card">
                    <div className="ad-perk-icon">🎯</div>
                    <h4>Category Spotlight</h4>
                    <p>Get featured at the top of high-intent wholesale buyer categories.</p>
                  </div>
                  <div className="ad-perk-card">
                    <div className="ad-perk-icon">📈</div>
                    <h4>Verified Analytics</h4>
                    <p>Track real qualified impressions and valid clicks from your dashboard.</p>
                  </div>
                  <div className="ad-perk-card">
                    <div className="ad-perk-icon">🛡️</div>
                    <h4>Predictable Budget</h4>
                    <p>Fixed package durations with transparent rates and no surprise fees.</p>
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="ad-grid">
            {rows.map(row => (
              <article className="ad-card ad-campaign-card" key={row.id}>
                <div className="ad-card-header">
                  <span className={`ad-status-pill ad-status-${(tab === 'campaigns' ? (row.review || 'draft') : (row.isActive ? 'approved' : 'draft')).toLowerCase()}`}>
                    {tab === 'campaigns' ? campaignLabel(row) : (row.archivedAt ? 'Archived' : row.isActive ? 'Available for submission' : 'Inactive')}
                  </span>
                  <span className="ad-module-pill">{row.module}</span>
                </div>
                <h3 className="ad-card-title">{row.name}</h3>
                {tab === 'campaigns' ? (
                  <>
                    <div className="ad-card-meta">
                      <span className="ad-placement-tag">{row.module} · Sponsored category</span>
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
                      <button onClick={() => setPackageForm({ ...freshPackage(), ...row, price: String(row.amountPaise / 100), categories: row.categories.join(', '), policies: row.policies || {}, windowHours: row.policies?.attribution?.windowHours || '', conversionEvent: row.policies?.attribution?.conversionEvent || '', model: row.policies?.attribution?.model || '', reason: '' })}>
                        Edit package
                      </button>
                    )}
                  </>
                )}
              </article>
            ))}
          </div>

          <nav className="ad-toolbar ad-pagination" aria-label="Advertising pages">
            <button className="ad-page-btn" disabled={busy || page <= 1} onClick={() => setPage(p => p - 1)}>Previous</button>
            <span className="ad-page-counter">Page {meta.page} of {meta.pages} · {meta.total} results</span>
            <button className="ad-page-btn" disabled={busy || page >= meta.pages} onClick={() => setPage(p => p + 1)}>Next</button>
          </nav>

          {/* Campaign Details Modal */}
          {detail && (
            <div className="ad-modal-backdrop" role="dialog" aria-modal="true" onClick={() => { detailGeneration.current++; setDetail(null); }}>
              <div className="ad-modal-dialog" onClick={e => e.stopPropagation()}>
                <div className="ad-modal-header">
                  <div className="ad-modal-header-text">
                    <span className={`ad-status-pill ad-status-${(detail.review || 'draft').toLowerCase()}`}>
                      {campaignLabel(detail)}
                    </span>
                    <h3>{detail.name}</h3>
                    <p className="ad-detail-sub">Revision {detail.revision} · Funding: {detail.funding} · Delivery: {detail.delivery}</p>
                  </div>
                  <button className="ad-close-btn ad-modal-close-btn" onClick={() => { detailGeneration.current++; setDetail(null); }}>Close details</button>
                </div>

                <div className="ad-modal-body">
                  <div className="ad-detail-meta-strip">
                    <div className="ad-meta-item">
                      <span className="ad-meta-label">Schedule & Service</span>
                      <p>Requested start: {detail.requestedStartAt ? new Date(detail.requestedStartAt).toLocaleString() : 'Not selected'}. Service dates begin only after verified payment.</p>
                    </div>
                    {detail.terms && (
                      <div className="ad-meta-item">
                        <span className="ad-meta-label">Agreed Package</span>
                        <p>Accepted package version {detail.terms.packageVersion}: {advertisingMoney(detail.terms.amountPaise)} / {detail.terms.durationDays} days. {detail.terms.policies?.billing ? 'Operational policy is recorded; financial authorization is separate.' : 'Tax/invoice treatment pending approval.'}</p>
                      </div>
                    )}
                  </div>

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

                  {detail.pilot && (
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
                    <h4>Campaign History</h4>
                    <ul className="ad-history-list">
                      {detail.history.map((h, i) => (
                        <li key={i}>{new Date(h.at).toLocaleString()} · {h.action} · {h.reason}</li>
                      ))}
                    </ul>
                  </div>

                  {!admin && ['DRAFT', 'CHANGES_REQUESTED'].includes(detail.review) && detail.delivery === 'NOT_SCHEDULED' && (
                    <div className="ad-toolbar">
                      <button
                        disabled={busy}
                        onClick={() => {
                          setDraft({
                            ...detail,
                            items: detail.items.map(i => ({ productId: i.productId, ...(i.variantId ? { variantId: i.variantId } : {}) })),
                            requestedStartAt: detail.requestedStartAt ? new Date(new Date(detail.requestedStartAt).getTime() - new Date(detail.requestedStartAt).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : ''
                          });
                          setStep(0);
                        }}
                      >
                        Edit revision
                      </button>
                      <button
                        disabled={busy}
                        onClick={() => perform(async () => setSubmissionOffer((await advertisingApi(false, `/packages/${detail.packageId}`)).data))}
                      >
                        Review submission terms
                      </button>
                    </div>
                  )}

                  {submissionOffer && (
                    <div className="ad-notice">
                      <p>Confirm {submissionOffer.name}, version {submissionOffer.version}: {advertisingMoney(submissionOffer.amountPaise)} for {submissionOffer.durationDays} days.</p>
                      <p>{submissionOffer.description}</p>
                      {Object.entries(submissionOffer.policies || {}).filter(([, v]) => typeof v === 'string').map(([k, v]) => (
                        <p key={k}>{k}: {v}</p>
                      ))}
                      {submissionOffer.billingQuote ? (
                        <>
                          <p>Sponsored category · {submissionOffer.module}. Base {advertisingMoney(submissionOffer.billingQuote.basePaise)} · Tax {advertisingMoney(submissionOffer.billingQuote.taxPaise)} · Total {advertisingMoney(submissionOffer.billingQuote.totalPaise)}.</p>
                          <p>Policy {submissionOffer.billingQuote.policy.approvalReference} · Issuer {submissionOffer.billingQuote.policy.issuer} · {submissionOffer.billingQuote.policy.taxTreatment} · Rate {submissionOffer.billingQuote.policy.taxRateBps / 100}%. Invoice: {submissionOffer.billingQuote.policy.invoiceMode}. Credit note: {submissionOffer.billingQuote.policy.creditNoteMode}.</p>
                          <p>Service starts at verified payment or your requested start, whichever is later. Interruptions stop for review; no automatic extension. Revenue requires finance review after completion.</p>
                          <p>Maximum refund limits: cancellation {submissionOffer.billingQuote.policy.refunds.cancellationBps / 100}%, suspension {submissionOffer.billingQuote.policy.refunds.suspensionBps / 100}%, unavailable service {submissionOffer.billingQuote.policy.refunds.unavailableBps / 100}%, unused service {submissionOffer.billingQuote.policy.refunds.unusedBps / 100}%. Authorized review is required.</p>
                        </>
                      ) : (
                        <p>Financial policies remain pending approval.</p>
                      )}
                      <p>Submission confirms this package version and its displayed terms. It does not collect payment.</p>
                      <button disabled={busy} onClick={() => change('submit')}>Confirm terms and submit</button>
                    </div>
                  )}

                  {!admin && detail.funding === 'UNPAID' && detail.delivery === 'NOT_SCHEDULED' && (
                    <button disabled={busy} onClick={() => change('cancel')}>Cancel unpaid campaign</button>
                  )}

                  {admin && canReview && (
                    <>
                      <label>Decision reason<textarea value={reason} maxLength={2000} onChange={e => setReason(e.target.value)} /></label>
                      <div className="ad-toolbar">
                        {(detail.review === 'PENDING_REVIEW' ? ['approve', 'request-changes', 'reject', 'suspend', 'cancel'] : ['suspend', 'cancel']).map(action => (
                          <button
                            key={action}
                            disabled={busy || !reason.trim() || ['ADMIN_SUSPENDED', 'CANCELLED', 'COMPLETED'].includes(detail.delivery)}
                            onClick={() => change(action)}
                          >
                            {action.replaceAll('-', ' ')}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Campaign Creation Wizard Modal */}
          {draft && (
            <div className="ad-modal-backdrop" role="dialog" aria-modal="true" onClick={() => setDraft(null)}>
              <div className="ad-modal-dialog" onClick={e => e.stopPropagation()}>
                <div className="ad-modal-header">
                  <div className="ad-modal-header-text">
                    <span className="ad-modal-badge">Campaign creation · Step {step + 1} of 4</span>
                    <h3>Campaign creation · Step {step + 1} of 4</h3>
                    <p className="ad-step-title">{['Products', 'Placement', 'Schedule and package', 'Preview and confirmation'][step]}</p>
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
                      setDetail(b.data); setSubmissionOffer(null); setDraft(null);
                    });
                  }}
                >
                  <div className="ad-modal-body">
                    <div className="ad-wizard-stepper">
                      {['Products', 'Placement', 'Schedule & Package', 'Preview & Confirmation'].map((name, i) => (
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
                            <input required maxLength={200} placeholder="e.g., Summer Wholesale Clearance" value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} />
                          </label>
                          <label className="ad-field">
                            <span className="ad-field-title">Module</span>
                            <select value={draft.module} disabled={!!draft.id} onChange={e => { setDraft({ ...draft, module: e.target.value, items: [], categoryId: '', packageId: '' }); setProductPage(1); }}>
                              <option value="ECOMMERCE">Shop All</option>
                              <option value="QUICK">Quick</option>
                            </select>
                          </label>
                        </div>

                        <div className="ad-section-divider">
                          <h4>Select Products from Your Catalog</h4>
                          <p className="ad-section-hint">Only products with positive stock are eligible for category placement.</p>
                        </div>

                        {productsError && (
                          <p role="alert" className="ad-error">
                            {productsError} <button type="button" onClick={() => setRefresh(n => n + 1)}>Retry</button>
                          </p>
                        )}

                        {productsLoading && (
                          <div className="ad-products-loading">
                            Loading your catalog products…
                          </div>
                        )}

                        {!productsLoading && !products.length && !productsError && (
                          <div className="ad-no-products">
                            <p><strong>No products found for {draft.module === 'QUICK' ? 'Quick Commerce' : 'Shop All'}.</strong></p>
                            <small>Only approved, non-digital products with active stock in this module are eligible. If your products are registered under Quick, change the Module dropdown above to "Quick".</small>
                          </div>
                        )}

                        <div className="ad-product-selection-list">
                          {products.map(p => (
                            <div key={p.id} className={`ad-product-item ${draft.items.some(i => i.productId === p.id) ? 'selected' : ''}`}>
                              <div className="ad-product-row">
                                {p.image && <img src={p.image} alt="" className="ad-product-img" />}
                                <div className="ad-product-info">
                                  <strong>{p.name}</strong> · <span className="ad-sku">{p.sku}</span>
                                  {p.reason && <span className="ad-product-ineligible"> ({p.reason})</span>}
                                </div>
                              </div>
                              <div className="ad-variant-options">
                                {p.variants.map(v => (
                                  <label key={v.id || 'standard'} className="ad-variant-choice">
                                    <input
                                      type="checkbox"
                                      disabled={!p.eligible || v.stock < 1}
                                      checked={draft.items.some(i => i.productId === p.id && i.variantId === v.id)}
                                      onChange={e => setDraft({
                                        ...draft,
                                        items: e.target.checked
                                          ? [...draft.items.filter(i => i.productId !== p.id), { productId: p.id, ...(v.id ? { variantId: v.id } : {}) }]
                                          : draft.items.filter(i => i.productId !== p.id)
                                      })}
                                    />
                                    <span>{v.name} · ₹{v.price} · {v.stock} available</span>
                                  </label>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>

                        <div className="ad-toolbar ad-product-nav">
                          <button type="button" disabled={productPage <= 1} onClick={() => setProductPage(p => p - 1)}>Previous products</button>
                          <span>Product page {productPage}</span>
                          <button type="button" disabled={productPage >= productPages} onClick={() => setProductPage(p => p + 1)}>More products</button>
                        </div>
                      </>
                    )}

                    {step === 1 && (
                      <>
                        <div className="ad-placement-box">
                          <div className="ad-placement-icon">📌</div>
                          <div>
                            <strong>Sponsored Category Placement</strong>
                            <p>Sponsored category is the enabled placement for this release.</p>
                          </div>
                        </div>
                        <label className="ad-field">
                          <span className="ad-field-title">Category</span>
                          <select required value={draft.categoryId} onChange={e => setDraft({ ...draft, categoryId: e.target.value, packageId: '' })}>
                            <option value="">Select category</option>
                            {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                          </select>
                        </label>
                      </>
                    )}

                    {step === 2 && (
                      <>
                        <div className="ad-form-grid">
                          <label className="ad-field">
                            <span className="ad-field-title">Requested start</span>
                            <input required type="datetime-local" value={draft.requestedStartAt} onChange={e => setDraft({ ...draft, requestedStartAt: e.target.value })} />
                          </label>
                          <label className="ad-field">
                            <span className="ad-field-title">Package</span>
                            <select required value={draft.packageId} onChange={e => setDraft({ ...draft, packageId: e.target.value })}>
                              <option value="">Select configured package</option>
                              {candidates.map(p => <option key={p.id} value={p.id}>{p.name} · {p.durationDays} days · {advertisingMoney(p.amountPaise)}</option>)}
                            </select>
                          </label>
                        </div>
                        {!candidates.length && <p className="ad-notice">No configured package is available for this module/category.</p>}
                      </>
                    )}

                    {step === 3 && (
                      <>
                        <div className="ad-summary-box">
                          <div className="ad-summary-header">
                            <span className="ad-summary-badge">Summary</span>
                            <p><strong>Sponsored</strong> · {draft.name} · {draft.items.length} selected products</p>
                          </div>
                          <div className="ad-summary-pkg-name">{chosen?.name}</div>
                          <div className="ad-summary-pkg-details">{chosen?.durationDays} days · {advertisingMoney(chosen?.amountPaise)}</div>
                          <p>Requested start: {draft.requestedStartAt}. Save the draft, then submit it for review. No payment will be collected.</p>
                          <p className="ad-summary-note">Tax, invoice, pause and refund policies remain subject to approval.</p>
                        </div>
                      </>
                    )}
                  </div>

                  <div className="ad-modal-footer">
                    <button type="button" disabled={busy} onClick={() => setDraft(null)}>Cancel editing</button>
                    <div className="ad-modal-buttons">
                      {step > 0 && <button type="button" onClick={() => setStep(s => s - 1)}>Back</button>}
                      <button className="ad-primary" disabled={busy || (step === 0 && !draft.items.length) || (step === 3 && !chosen)}>
                        {step === 3 ? 'Save campaign draft' : 'Continue'}
                      </button>
                    </div>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* Package Configuration Modal */}
          {packageForm && (
            <div className="ad-modal-backdrop" role="dialog" aria-modal="true" onClick={() => setPackageForm(null)}>
              <div className="ad-modal-dialog" onClick={e => e.stopPropagation()}>
                <div className="ad-modal-header">
                  <div className="ad-modal-header-text">
                    <span className="ad-modal-badge">Package Configuration</span>
                    <h3>{packageForm.id ? 'Edit' : 'Create'} advertising package</h3>
                    <p className="ad-modal-subtitle">Configure pricing, duration, product limits, and administrative policy drafts.</p>
                  </div>
                  <button type="button" className="ad-modal-close-btn" onClick={() => setPackageForm(null)} aria-label="Close dialog">✕</button>
                </div>

                <form
                  className="ad-modal-form"
                  onSubmit={e => {
                    e.preventDefault();
                    perform(async () => {
                      await advertisingApi(true, `/packages${packageForm.id ? `/${packageForm.id}` : ''}`, { method: packageForm.id ? 'PATCH' : 'POST', body: packagePayload(packageForm) });
                      setPackageForm(null);
                    });
                  }}
                >
                  <div className="ad-modal-body">
                    {/* Section 1: Overview & Placement */}
                    <div className="ad-form-section">
                      <div className="ad-form-section-header">
                        <span className="ad-section-icon">📦</span>
                        <h4>Package Overview & Placement</h4>
                      </div>
                      <div className="ad-form-grid">
                        <label className="ad-field">
                          <span className="ad-field-title">Name</span>
                          <input
                            required
                            type="text"
                            placeholder="e.g. 7-Day Category Spotlight"
                            value={packageForm.name}
                            onChange={e => setPackageForm({ ...packageForm, name: e.target.value })}
                          />
                        </label>

                        <label className="ad-field">
                          <span className="ad-field-title">Module</span>
                          <select value={packageForm.module} onChange={e => setPackageForm({ ...packageForm, module: e.target.value })}>
                            <option value="ECOMMERCE">Shop All</option>
                            <option value="QUICK">Quick</option>
                          </select>
                        </label>
                      </div>

                      <label className="ad-field">
                        <span className="ad-field-title">Description</span>
                        <input
                          type="text"
                          placeholder="Brief summary of package benefits"
                          value={packageForm.description}
                          onChange={e => setPackageForm({ ...packageForm, description: e.target.value })}
                        />
                      </label>

                      <div className="ad-placement-box">
                        <div className="ad-placement-icon">📌</div>
                        <div>
                          <strong>Placement: Sponsored category</strong>
                          <p>Search and banners are not enabled.</p>
                        </div>
                      </div>

                      <label className="ad-field">
                        <span className="ad-field-title">Eligible category IDs (comma separated; blank means all)</span>
                        <input
                          type="text"
                          placeholder="Leave blank to include all categories, or e.g. cat-1, cat-2"
                          value={packageForm.categories}
                          onChange={e => setPackageForm({ ...packageForm, categories: e.target.value })}
                        />
                      </label>
                    </div>

                    {/* Section 2: Pricing, Duration & Limits */}
                    <div className="ad-form-section">
                      <div className="ad-form-section-header">
                        <span className="ad-section-icon">💰</span>
                        <h4>Pricing, Duration & Product Limits</h4>
                      </div>
                      <div className="ad-form-grid-3">
                        <label className="ad-field">
                          <span className="ad-field-title">Price (INR)</span>
                          <input
                            required
                            type="number"
                            min="0.01"
                            step="0.01"
                            placeholder="0.00"
                            value={packageForm.price}
                            onChange={e => setPackageForm({ ...packageForm, price: e.target.value })}
                          />
                        </label>

                        <label className="ad-field">
                          <span className="ad-field-title">Duration (days)</span>
                          <input
                            required
                            type="number"
                            min="1"
                            step="1"
                            placeholder="e.g. 7"
                            value={packageForm.durationDays}
                            onChange={e => setPackageForm({ ...packageForm, durationDays: e.target.value })}
                          />
                        </label>

                        <label className="ad-field">
                          <span className="ad-field-title">Product limit</span>
                          <input
                            required
                            type="number"
                            min="1"
                            step="1"
                            placeholder="e.g. 5"
                            value={packageForm.maxProducts}
                            onChange={e => setPackageForm({ ...packageForm, maxProducts: e.target.value })}
                          />
                        </label>
                      </div>

                      <label className="ad-field">
                        <span className="ad-field-title">reason</span>
                        <input
                          required
                          type="text"
                          placeholder="Audit or modification reason"
                          value={packageForm.reason}
                          onChange={e => setPackageForm({ ...packageForm, reason: e.target.value })}
                        />
                      </label>
                    </div>

                    {/* Section 3: Attribution */}
                    <div className="ad-form-section">
                      <div className="ad-form-section-header">
                        <span className="ad-section-icon">📊</span>
                        <h4>Attribution Settings</h4>
                      </div>
                      <div className="ad-form-grid-3">
                        <label className="ad-field">
                          <span className="ad-field-title">Attribution window (hours; blank means unconfigured)</span>
                          <input
                            type="number"
                            min="1"
                            placeholder="Blank = unconfigured"
                            value={packageForm.windowHours}
                            onChange={e => setPackageForm({ ...packageForm, windowHours: e.target.value })}
                          />
                        </label>

                        <label className="ad-field">
                          <span className="ad-field-title">Qualifying conversion</span>
                          <select
                            required={!!packageForm.windowHours}
                            value={packageForm.conversionEvent}
                            onChange={e => setPackageForm({ ...packageForm, conversionEvent: e.target.value })}
                          >
                            <option value="">Unconfigured</option>
                            <option value="PAID">Paid</option>
                            <option value="DELIVERED">Delivered</option>
                          </select>
                        </label>

                        <label className="ad-field">
                          <span className="ad-field-title">Attribution model</span>
                          <select
                            required={!!packageForm.windowHours}
                            value={packageForm.model}
                            onChange={e => setPackageForm({ ...packageForm, model: e.target.value })}
                          >
                            <option value="">Unconfigured</option>
                            <option value="FIRST_CLICK">First click</option>
                            <option value="LAST_CLICK">Last click</option>
                          </select>
                        </label>
                      </div>
                    </div>

                    {/* Section 4: Operational Policies */}
                    <div className="ad-form-section">
                      <div className="ad-form-section-header">
                        <span className="ad-section-icon">⚖️</span>
                        <h4>Operational Policy Drafts</h4>
                      </div>
                      <div className="ad-form-grid">
                        {['sellerPause', 'cancellation', 'rejection', 'suspension', 'unusedService', 'refunds'].map(k => (
                          <label key={k} className="ad-field">
                            <span className="ad-field-title">{k} policy draft</span>
                            <textarea
                              maxLength={2000}
                              placeholder={`Enter policy draft terms for ${k}`}
                              value={packageForm.policies[k] || ''}
                              onChange={e => setPackageForm({ ...packageForm, policies: { ...packageForm.policies, [k]: e.target.value } })}
                            />
                          </label>
                        ))}
                      </div>
                    </div>

                    {/* Section 5: Billing & Tax Policies */}
                    <div className="ad-form-section">
                      <div className="ad-form-section-header">
                        <span className="ad-section-icon">💳</span>
                        <h4>Structured Billing & Tax Policy Drafts</h4>
                      </div>
                      <div className="ad-billing-policy-wrap">
                        <AdvertisingBillingPolicyEditor
                          value={packageForm.policies.billing}
                          onChange={billing => {
                            const policies = { ...packageForm.policies };
                            if (billing === undefined) delete policies.billing; else policies.billing = billing;
                            setPackageForm({ ...packageForm, policies });
                          }}
                        />
                      </div>
                      <div className="ad-form-grid">
                        {['treatment', 'invoiceIssuer', 'calculation', 'creditNotes'].map(k => (
                          <label key={k} className="ad-field">
                            <span className="ad-field-title">Tax policy draft: {k}</span>
                            <textarea
                              maxLength={2000}
                              placeholder={`Enter tax policy draft for ${k}`}
                              value={packageForm.policies.tax?.[k] || ''}
                              onChange={e => setPackageForm({ ...packageForm, policies: { ...packageForm.policies, tax: { ...packageForm.policies.tax, [k]: e.target.value } } })}
                            />
                          </label>
                        ))}
                      </div>
                    </div>

                    {/* Section 6: Status & Archival */}
                    <div className="ad-form-section">
                      <div className="ad-form-section-header">
                        <span className="ad-section-icon">🔒</span>
                        <h4>Package Status & Availability</h4>
                      </div>
                      <div className="ad-toggle-cards">
                        <label className="ad-toggle-card">
                          <input
                            type="checkbox"
                            checked={packageForm.isActive}
                            disabled={packageForm.archived}
                            onChange={e => setPackageForm({ ...packageForm, isActive: e.target.checked })}
                          />
                          <span className="ad-toggle-text">
                            <strong>Available for campaign submission</strong>
                            <small>When enabled, active sellers can select this package when creating advertising campaigns.</small>
                          </span>
                        </label>

                        <label className="ad-toggle-card">
                          <input
                            type="checkbox"
                            checked={packageForm.archived}
                            onChange={e => setPackageForm({ ...packageForm, archived: e.target.checked, isActive: e.target.checked ? false : packageForm.isActive })}
                          />
                          <span className="ad-toggle-text">
                            <strong>Archive permanently</strong>
                            <small>Archived packages can no longer be used for new campaign submissions.</small>
                          </span>
                        </label>
                      </div>
                    </div>
                  </div>

                  <div className="ad-modal-footer">
                    <p className="ad-modal-disclaimer">
                      These are policy drafts. Saving them does not authorize payment, refunds or financial recognition.
                    </p>
                    <div className="ad-modal-buttons">
                      <button type="button" disabled={busy} onClick={() => setPackageForm(null)}>Cancel</button>
                      <button className="ad-primary" disabled={busy}>Save package version</button>
                    </div>
                  </div>
                </form>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
