import React, { useEffect, useRef, useState } from 'react';
import { advertisingApi, advertisingMoney, campaignLabel, packagePayload } from './advertisingApi';
import './advertising.css';
import AdvertisingBillingPanel from './AdvertisingBillingPanel';
import AdvertisingFinancePanel from './AdvertisingFinancePanel';
import AdvertisingMetrics from './AdvertisingMetrics';
import AdvertisingBillingPolicyEditor from './AdvertisingBillingPolicyEditor';
const reviews = ['DRAFT', 'PENDING_REVIEW', 'CHANGES_REQUESTED', 'APPROVED', 'REJECTED'];
const freshPackage = () => ({ name: '', description: '', module: 'ECOMMERCE', price: '', durationDays: '', maxProducts: '', categories: '',
  isActive: false, archived: false, reason: '', policies: {}, windowHours: '', conversionEvent: '', model: '' });
const freshCampaign = () => ({ name: '', module: 'ECOMMERCE', categoryId: '', packageId: '', requestedStartAt: '', items: [] });
export default function AdvertisingWorkspace({ admin = false }) {
  const [cap, setCap] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [capabilityRetry, setCapabilityRetry] = useState(0);
  const [financeOpen,setFinanceOpen]=useState(false);
  const [tab, setTab] = useState('campaigns'), [rows, setRows] = useState([]), [meta, setMeta] = useState({ page: 1, pages: 1, total: 0 });
  const [page, setPage] = useState(1), [review, setReview] = useState(''), [refresh, setRefresh] = useState(0), [detail, setDetail] = useState(null);
  const [reason, setReason] = useState(''), [packageForm, setPackageForm] = useState(null), [draft, setDraft] = useState(null), [step, setStep] = useState(0);
  const [submissionOffer, setSubmissionOffer] = useState(null);
  const [pilotStart, setPilotStart] = useState(''), [pilotEnd, setPilotEnd] = useState('');
  const [products, setProducts] = useState([]), [productPage, setProductPage] = useState(1), [productPages, setProductPages] = useState(1), [packages, setPackages] = useState([]);
  const generation = useRef(0), detailGeneration = useRef(0);
  const token = localStorage.getItem(admin ? 'adminToken' : 'sellerToken');
  const canReview = !admin || cap?.permissions?.includes('advertising_review');
  const canConfigure = admin && cap?.permissions?.includes('advertising_configure');
  const canFinanceRead=admin&&cap?.permissions?.some(p=>['advertising_finance','advertising_reconcile','advertising_refund'].includes(p));
  useEffect(() => { let alive = true; setError(''); setCap(null); setDetail(null); setRows([]); setDraft(null); setPackageForm(null); setSubmissionOffer(null);
    advertisingApi(admin, '/capabilities').then(b => { if (alive) { setCap(b.data); if (admin && !b.data.permissions.includes('advertising_review')) setTab('packages'); } }).catch(e => alive && setError(e.message));
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
    if (!draft) return; let alive = true; setProducts([]);
    advertisingApi(false, `/products?module=${draft.module}&limit=20&page=${productPage}`).then(b => { if (alive) { setProducts(b.data); setProductPages(b.meta.pages); } }).catch(e => alive && setError(e.message));
    advertisingApi(false, '/packages?limit=100').then(b => alive && setPackages(b.data)).catch(e => alive && setError(e.message));
    return () => { alive = false; };
  }, [draft?.module, productPage, !!draft, token, refresh]);
  async function perform(work) { setBusy(true); setError(''); try { await work(); setRefresh(n => n + 1); } catch (e) { setError(e.message); } finally { setBusy(false); } }
  async function open(row) { const seq = ++detailGeneration.current; setSubmissionOffer(null); setError(''); try { const b = await advertisingApi(admin, `/campaigns/${row.id}`); if (seq === detailGeneration.current) { setDetail(b.data); setReason(''); } } catch(e) { setError(e.message); } }
  const change = (action) => perform(async () => {
    const path = admin ? `/campaigns/${detail.id}/${action}` : `/campaigns/${detail.id}/${action === 'submit' ? 'submit' : 'actions'}`;
    const b = await advertisingApi(admin, path, { method: 'POST', body: { version: detail.version, ...(admin ? { reason } : action === 'submit' ? { packageVersion: submissionOffer?.version } : { action }) } }); setDetail(b.data); setSubmissionOffer(null);
  });
  const savePilot = enabled => perform(async () => {
    const body = { version: detail.version, reason, enabled,
      ...(enabled ? { startAt: new Date(pilotStart).toISOString(), endAt: new Date(pilotEnd).toISOString() } : {}) };
    const b = await advertisingApi(true, `/campaigns/${detail.id}/pilot`, { method: 'POST', body });
    setDetail(b.data);
  });
  const candidates = packages.filter(p => p.module === draft?.module && p.isActive && !p.archivedAt && (!p.categories.length || p.categories.includes(draft?.categoryId)));
  const chosen = candidates.find(p => p.id === draft?.packageId);
  const categories = [...new Map(products.flatMap(p => p.categories).map(c => [c.id, c])).values()];
  return <section className="advertising-workspace" aria-label={admin ? 'Admin advertising' : 'Seller advertising'}>
    <h2>Advertising</h2><p>Manage sponsored category campaigns separately from sales and payouts.</p>
    <p className="ad-notice">Billing and paid delivery require enabled capabilities, an approved policy snapshot and explicit campaign financial authorization. Pilot service is separate. No revenue is recognized automatically.</p>
    {error && <p role="alert" className="ad-error">{error} <button onClick={() => cap ? setRefresh(n => n + 1) : setCapabilityRetry(n => n + 1)}>Retry</button></p>}
    {!cap && !error && <p role="status">Loading advertising capabilities…</p>}
    {cap && !cap.managementEnabled && <p role="status">Advertising management is currently disabled. No campaigns can be purchased or served.</p>}
    {canFinanceRead&&<button onClick={()=>setFinanceOpen(v=>!v)}>Advertising finance and reconciliation</button>}
    {financeOpen&&canFinanceRead&&<AdvertisingFinancePanel permissions={cap.permissions} capabilities={cap}/>}
    {cap?.managementEnabled && <>
      {admin && !canReview && !canConfigure && <p>Your permissions do not include campaign review or package configuration. Use the finance workspace for authorized operations.</p>}
      <div className="ad-toolbar">{canReview && <button onClick={() => { setTab('campaigns'); setPage(1); }}>Campaigns</button>}{canConfigure && <button onClick={() => { setTab('packages'); setPage(1); }}>Packages and policies</button>}
        {!admin && <button className="ad-primary" onClick={() => { setDraft(freshCampaign()); setStep(0); setDetail(null); }}>Create campaign</button>}
        {tab === 'packages' && canConfigure && <button className="ad-primary" onClick={() => setPackageForm(freshPackage())}>Create package</button>}
        {tab === 'campaigns' && <label>Review status<select value={review} onChange={e => { setReview(e.target.value); setPage(1); }}><option value="">All review states</option>{reviews.map(s => <option key={s}>{s}</option>)}</select></label>}
      </div>
      <p>Attributed sales and ROAS: pending attribution implementation. Campaign details show backend impression and click counts separately for paid service and pilots.</p>
      {busy && <p role="status">Updating advertising…</p>}
      {!busy && !rows.length && <p>No {tab} found for this selection.</p>}
      <div className="ad-grid">{rows.map(row => <article className="ad-card" key={row.id}><h3>{row.name}</h3>
        {tab === 'campaigns' ? <><p>{campaignLabel(row)}</p><p>{row.module} · Sponsored category</p><p>{advertisingMoney(row.terms?.amountPaise)}</p><button onClick={() => open(row)}>View campaign</button></>
          : <><p>{row.module} · {row.durationDays} days · {advertisingMoney(row.amountPaise)}</p><p>{row.archivedAt ? 'Archived' : row.isActive ? 'Available for submission' : 'Inactive'} · Version {row.version}</p><p>{row.description}</p>{!row.archivedAt && <button onClick={() => setPackageForm({ ...freshPackage(), ...row, price: String(row.amountPaise / 100), categories: row.categories.join(', '), policies: row.policies || {}, windowHours: row.policies?.attribution?.windowHours || '', conversionEvent: row.policies?.attribution?.conversionEvent || '', model: row.policies?.attribution?.model || '', reason: '' })}>Edit package</button>}</>}
      </article>)}</div>
      <nav className="ad-toolbar" aria-label="Advertising pages"><button disabled={busy || page <= 1} onClick={() => setPage(p => p - 1)}>Previous</button><span>Page {meta.page} of {meta.pages} · {meta.total} results</span><button disabled={busy || page >= meta.pages} onClick={() => setPage(p => p + 1)}>Next</button></nav>
      {detail && <article className="ad-card"><h3>{detail.name}</h3><button onClick={() => { detailGeneration.current++; setDetail(null); }}>Close details</button><p>{campaignLabel(detail)} · Revision {detail.revision}</p><p>Funding: {detail.funding} · Delivery: {detail.delivery}</p><p>Requested start: {detail.requestedStartAt ? new Date(detail.requestedStartAt).toLocaleString() : 'Not selected'}. Service dates begin only after verified payment.</p>
        {(!admin||canFinanceRead)&&<AdvertisingBillingPanel key={`${detail.id}:${detail.version}`} id={detail.id} admin={admin} permissions={cap.permissions||[]} capabilities={cap} onChanged={()=>{setRefresh(n=>n+1);void open(detail);}}/>}
        {canReview&&<AdvertisingMetrics key={`metrics:${detail.id}`} id={detail.id} admin={admin}/>}
        {detail.pilot && <p>Separate non-billable pilot: {detail.pilot.enabled ? 'Authorized' : 'Stopped'} · {new Date(detail.pilot.startAt).toLocaleString()} – {new Date(detail.pilot.endAt).toLocaleString()}. This is not paid or funded service.</p>}
        {admin && canReview && cap.pilotEnabled && detail.review === 'APPROVED' && detail.delivery === 'NOT_SCHEDULED' && detail.funding === 'UNPAID' && <div className="ad-notice">
          <h4>Non-billable category pilot</h4><p>Explicit test authorization only; funding and paid service remain unchanged. Enter a decision reason below.</p>
          <label>Pilot start<input type="datetime-local" value={pilotStart} onChange={e => setPilotStart(e.target.value)} /></label>
          <label>Pilot end<input type="datetime-local" value={pilotEnd} onChange={e => setPilotEnd(e.target.value)} /></label>
          <button disabled={busy || !reason.trim() || !pilotStart || !pilotEnd} onClick={() => savePilot(true)}>Authorize non-billable pilot</button>
        </div>}
        {admin && canReview && detail.pilot?.enabled && <button disabled={busy || !reason.trim()} onClick={() => savePilot(false)}>Stop non-billable pilot</button>}
        {detail.terms && <p>Accepted package version {detail.terms.packageVersion}: {advertisingMoney(detail.terms.amountPaise)} / {detail.terms.durationDays} days. {detail.terms.policies?.billing?'Operational policy is recorded; financial authorization is separate.':'Tax/invoice treatment pending approval.'}</p>}
        <ul>{detail.history.map((h,i) => <li key={i}>{new Date(h.at).toLocaleString()} · {h.action} · {h.reason}</li>)}</ul>
        {!admin && ['DRAFT','CHANGES_REQUESTED'].includes(detail.review) && detail.delivery === 'NOT_SCHEDULED' && <div className="ad-toolbar"><button disabled={busy} onClick={() => { setDraft({ ...detail, items: detail.items.map(i => ({ productId: i.productId, ...(i.variantId ? {variantId:i.variantId} : {}) })), requestedStartAt: detail.requestedStartAt ? new Date(new Date(detail.requestedStartAt).getTime() - new Date(detail.requestedStartAt).getTimezoneOffset()*60000).toISOString().slice(0,16) : '' }); setStep(0); }}>Edit revision</button><button disabled={busy} onClick={() => perform(async () => setSubmissionOffer((await advertisingApi(false, `/packages/${detail.packageId}`)).data))}>Review submission terms</button></div>}
        {submissionOffer && <div className="ad-notice"><p>Confirm {submissionOffer.name}, version {submissionOffer.version}: {advertisingMoney(submissionOffer.amountPaise)} for {submissionOffer.durationDays} days.</p><p>{submissionOffer.description}</p>{Object.entries(submissionOffer.policies || {}).filter(([,v]) => typeof v === 'string').map(([k,v]) => <p key={k}>{k}: {v}</p>)}
          {submissionOffer.billingQuote?<>
            <p>Sponsored category · {submissionOffer.module}. Base {advertisingMoney(submissionOffer.billingQuote.basePaise)} · Tax {advertisingMoney(submissionOffer.billingQuote.taxPaise)} · Total {advertisingMoney(submissionOffer.billingQuote.totalPaise)}.</p>
            <p>Policy {submissionOffer.billingQuote.policy.approvalReference} · Issuer {submissionOffer.billingQuote.policy.issuer} · {submissionOffer.billingQuote.policy.taxTreatment} · Rate {submissionOffer.billingQuote.policy.taxRateBps/100}%. Invoice: {submissionOffer.billingQuote.policy.invoiceMode}. Credit note: {submissionOffer.billingQuote.policy.creditNoteMode}.</p>
            <p>Service starts at verified payment or your requested start, whichever is later. Interruptions stop for review; no automatic extension. Revenue requires finance review after completion.</p>
            <p>Maximum refund limits: cancellation {submissionOffer.billingQuote.policy.refunds.cancellationBps/100}%, suspension {submissionOffer.billingQuote.policy.refunds.suspensionBps/100}%, unavailable service {submissionOffer.billingQuote.policy.refunds.unavailableBps/100}%, unused service {submissionOffer.billingQuote.policy.refunds.unusedBps/100}%. Authorized review is required.</p>
          </>:<p>Financial policies remain pending approval.</p>}
          <p>Submission confirms this package version and its displayed terms. It does not collect payment.</p><button disabled={busy} onClick={() => change('submit')}>Confirm terms and submit</button></div>}
        {!admin && detail.funding === 'UNPAID' && detail.delivery === 'NOT_SCHEDULED' && <button disabled={busy} onClick={() => change('cancel')}>Cancel unpaid campaign</button>}
        {admin && canReview && <><label>Decision reason<textarea value={reason} maxLength={2000} onChange={e => setReason(e.target.value)}/></label><div className="ad-toolbar">{(detail.review === 'PENDING_REVIEW' ? ['approve','request-changes','reject','suspend','cancel'] : ['suspend','cancel']).map(action => <button key={action} disabled={busy || !reason.trim() || ['ADMIN_SUSPENDED','CANCELLED','COMPLETED'].includes(detail.delivery)} onClick={() => change(action)}>{action.replaceAll('-', ' ')}</button>)}</div></>}
      </article>}
      {draft && <form className="ad-card" onSubmit={e => { e.preventDefault(); if (step < 3) { setStep(s => s + 1); return; } perform(async () => {
        const body = { name: draft.name, module: draft.module, categoryId: draft.categoryId, items: draft.items, packageId: draft.packageId, requestedStartAt: new Date(draft.requestedStartAt).toISOString(), ...(draft.id ? {version:draft.version} : {}) };
        const b = await advertisingApi(false, `/campaigns${draft.id ? `/${draft.id}` : ''}`, { method: draft.id ? 'PATCH' : 'POST', body }); setDetail(b.data); setSubmissionOffer(null); setDraft(null);
      }); }}><h3>Campaign creation · Step {step + 1} of 4</h3><p>{['Products','Placement','Schedule and package','Preview and confirmation'][step]}</p>
        {step === 0 && <><label>Campaign name<input required maxLength={200} value={draft.name} onChange={e => setDraft({...draft,name:e.target.value})}/></label><label>Module<select value={draft.module} disabled={!!draft.id} onChange={e => { setDraft({...draft,module:e.target.value,items:[],categoryId:'',packageId:''}); setProductPage(1); }}><option value="ECOMMERCE">Shop All</option><option value="QUICK">Quick</option></select></label>
          {products.map(p => <div key={p.id}><strong>{p.name}</strong> · {p.sku} {p.reason && <span>{p.reason}</span>}{p.variants.map(v => <label key={v.id || 'standard'}><input type="checkbox" disabled={!p.eligible || v.stock < 1} checked={draft.items.some(i => i.productId === p.id && i.variantId === v.id)} onChange={e => setDraft({...draft,items:e.target.checked ? [...draft.items.filter(i => i.productId !== p.id),{productId:p.id,...(v.id ? {variantId:v.id} : {})}] : draft.items.filter(i => i.productId !== p.id)})}/>{v.name} · ₹{v.price} · {v.stock} available</label>)}</div>)}
          <div className="ad-toolbar"><button type="button" disabled={productPage <= 1} onClick={() => setProductPage(p => p-1)}>Previous products</button><span>Product page {productPage}</span><button type="button" disabled={productPage >= productPages} onClick={() => setProductPage(p => p+1)}>More products</button></div></>}
        {step === 1 && <><p>Sponsored category is the enabled placement for this release.</p><label>Category<select required value={draft.categoryId} onChange={e => setDraft({...draft,categoryId:e.target.value,packageId:''})}><option value="">Select category</option>{categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label></>}
        {step === 2 && <><label>Requested start<input required type="datetime-local" value={draft.requestedStartAt} onChange={e => setDraft({...draft,requestedStartAt:e.target.value})}/></label><label>Package<select required value={draft.packageId} onChange={e => setDraft({...draft,packageId:e.target.value})}><option value="">Select configured package</option>{candidates.map(p => <option key={p.id} value={p.id}>{p.name} · {p.durationDays} days · {advertisingMoney(p.amountPaise)}</option>)}</select></label>{!candidates.length && <p>No configured package is available for this module/category.</p>}</>}
        {step === 3 && <><p><strong>Sponsored</strong> · {draft.name} · {draft.items.length} selected products</p><p>{chosen?.name} · {chosen?.durationDays} days · {advertisingMoney(chosen?.amountPaise)}</p><p>Requested start: {draft.requestedStartAt}. Save the draft, then submit it for review. No payment will be collected.</p><p>Tax, invoice, pause and refund policies remain subject to approval.</p></>}
        <div className="ad-toolbar"><button type="button" disabled={busy} onClick={() => setDraft(null)}>Cancel editing</button>{step > 0 && <button type="button" onClick={() => setStep(s => s-1)}>Back</button>}<button className="ad-primary" disabled={busy || (step === 0 && !draft.items.length) || (step === 3 && !chosen)}>{step === 3 ? 'Save campaign draft' : 'Continue'}</button></div>
      </form>}
      {packageForm && <form className="ad-card" onSubmit={e => {e.preventDefault(); perform(async () => { await advertisingApi(true, `/packages${packageForm.id ? `/${packageForm.id}` : ''}`, {method:packageForm.id?'PATCH':'POST',body:packagePayload(packageForm)}); setPackageForm(null); });}}><h3>{packageForm.id ? 'Edit' : 'Create'} advertising package</h3>
        {['name','description','price','durationDays','maxProducts','categories','reason'].map(k => <label key={k}>{({price:'Price (INR)',durationDays:'Duration (days)',maxProducts:'Product limit',categories:'Eligible category IDs (comma separated; blank means all)'})[k] || k}<input required={!['description','categories'].includes(k)} type={['price','durationDays','maxProducts'].includes(k)?'number':'text'} min={k==='price'?'0.01':'1'} step={k==='price'?'0.01':'1'} value={packageForm[k]} onChange={e => setPackageForm({...packageForm,[k]:e.target.value})}/></label>)}
        <label>Module<select value={packageForm.module} onChange={e => setPackageForm({...packageForm,module:e.target.value})}><option value="ECOMMERCE">Shop All</option><option value="QUICK">Quick</option></select></label><p>Placement: Sponsored category. Search and banners are not enabled.</p>
        {['sellerPause','cancellation','rejection','suspension','unusedService','refunds'].map(k => <label key={k}>{k} policy draft<textarea maxLength={2000} value={packageForm.policies[k] || ''} onChange={e => setPackageForm({...packageForm,policies:{...packageForm.policies,[k]:e.target.value}})}/></label>)}
        <AdvertisingBillingPolicyEditor value={packageForm.policies.billing} onChange={billing=>{const policies={...packageForm.policies};if(billing===undefined)delete policies.billing;else policies.billing=billing;setPackageForm({...packageForm,policies});}}/>
        {['treatment','invoiceIssuer','calculation','creditNotes'].map(k => <label key={k}>Tax policy draft: {k}<textarea maxLength={2000} value={packageForm.policies.tax?.[k] || ''} onChange={e => setPackageForm({...packageForm,policies:{...packageForm.policies,tax:{...packageForm.policies.tax,[k]:e.target.value}}})}/></label>)}
        <label>Attribution window (hours; blank means unconfigured)<input type="number" min="1" value={packageForm.windowHours} onChange={e => setPackageForm({...packageForm,windowHours:e.target.value})}/></label>
        <label>Qualifying conversion<select required={!!packageForm.windowHours} value={packageForm.conversionEvent} onChange={e => setPackageForm({...packageForm,conversionEvent:e.target.value})}><option value="">Unconfigured</option><option value="PAID">Paid</option><option value="DELIVERED">Delivered</option></select></label>
        <label>Attribution model<select required={!!packageForm.windowHours} value={packageForm.model} onChange={e => setPackageForm({...packageForm,model:e.target.value})}><option value="">Unconfigured</option><option value="FIRST_CLICK">First click</option><option value="LAST_CLICK">Last click</option></select></label>
        <label><input type="checkbox" checked={packageForm.isActive} disabled={packageForm.archived} onChange={e => setPackageForm({...packageForm,isActive:e.target.checked})}/>Available for campaign submission</label><label><input type="checkbox" checked={packageForm.archived} onChange={e => setPackageForm({...packageForm,archived:e.target.checked,isActive:e.target.checked?false:packageForm.isActive})}/>Archive permanently</label>
        <p>These are policy drafts. Saving them does not authorize payment, refunds or financial recognition.</p><button type="button" disabled={busy} onClick={() => setPackageForm(null)}>Cancel</button><button className="ad-primary" disabled={busy}>Save package version</button>
      </form>}
    </>}
  </section>;
}
