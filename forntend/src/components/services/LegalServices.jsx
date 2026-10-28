import React, { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { apiUrl } from '../../utils/api';
import { boundedFetch } from '../../utils/portalRequests';
import { DynamicFields } from './ServicesPanel';
import ServicePaymentPanel, { payServiceFee, feeText } from './ServicePaymentPanel';
import { SERVICE_FILE_BYTES, SERVICE_FILE_COUNT, SERVICE_ANSWER_BYTES, serializedAnswerBytes } from '../../../../shared/serviceLimits.mjs';
import './legalServices.css';
import CustomerServiceHeading from './CustomerServiceHeading';
import ServiceReference from './ServiceReference';
import { CustomerSessionContext } from '../../utils/customerSession';

export const money = n => `₹${((n || 0) / 100).toFixed(2)}`;
export const statusLabel = s => String(s || '').replaceAll('_', ' ');
export const legalRequestPath = id => `/legal-services/requests/${id}`;
const REQUEST_STATUS = { awaiting_payment: 'Payment pending', submitted: 'Submitted — waiting for review', payment_verified: 'Paid — waiting for review', under_review: 'Under review', information_required: 'More information needed', in_progress: 'In progress', completed: 'Completed', rejected: 'Rejected' };
export function useLegalApi(admin = false) {
  return useCallback(async (path, options = {}, blob = false) => {
    const token = localStorage.getItem(admin ? 'adminToken' : 'userToken');
    const r = await boundedFetch(apiUrl(path), { ...options, headers: { Authorization: `Bearer ${token || ''}`, ...(options.body && !(options.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}), ...options.headers } });
    if (blob && r.ok) return r.blob();
    const b = await r.json().catch(() => ({}));
    if (!r.ok || b.success === false) throw Object.assign(new Error(b.message || 'Unable to load Legal Services'), { fields: b.meta?.fields, status: r.status });
    return b;
  }, [admin]);
}
function usePath() {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => { const update = () => setPath(window.location.pathname); window.addEventListener('popstate', update); window.addEventListener('app:locationchange', update); return () => { window.removeEventListener('popstate', update); window.removeEventListener('app:locationchange', update); }; }, []);
  return [path, p => { window.history.pushState(null, '', p); setPath(p); }];
}
export function LegalDiscovery() {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => { const c = new AbortController(); boundedFetch(apiUrl('/api/customer-services/capabilities'), { signal: c.signal }).then(r => r.json()).then(b => { if (!c.signal.aborted) setEnabled(b.data?.catalogue === true); }).catch(() => {}); return () => c.abort(); }, []);
  return enabled ? <a className="legal-discovery" href="/legal-services" onClick={e => { e.preventDefault(); window.history.pushState(null, '', '/legal-services'); }}>Legal Services <span>Explore services and submit a private request. Final price confirmed after review.</span></a> : null;
}
export function RequestTimeline({ events = [] }) { return <ol className="legal-timeline">{events.map((e, i) => <li key={e._id || i}><strong>{statusLabel(e.action)}</strong> · {new Date(e.at).toLocaleString()}{e.message && <p>{e.message}</p>}</li>)}</ol>; }
export function PrivateFiles({ files = [], request, base, run }) {
  return <section><h3>Private documents</h3>{!files.length && <p>No documents available.</p>}{files.map(f => <button type="button" key={f.fileId} onClick={() => run(async () => {
    const b = await request(`${base}/files/${f.fileId}`, {}, true), url = URL.createObjectURL(b), a = document.createElement('a'); a.href = url; a.download = f.name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  })}>Download {f.name}</button>)}</section>;
}
function FollowUp({ request: a, submit, provider = false, busy }) {
  return <form className="legal-card" onSubmit={e => { e.preventDefault(); const data = new FormData(e.currentTarget); submit(data); }}><h3>{provider ? 'Assignment update' : 'Respond to information request'}</h3>
    <input type="hidden" name="version" value={a.version} />{provider && <label>Update<select name="action"><option value="acknowledged">Acknowledge assignment</option>{a.status === 'in_progress' && <option value="progress">Progress update</option>}<option value="provider_information_request">Request information through admin</option>{a.status === 'in_progress' && <option value="completion_submitted">Submit completion for admin verification</option>}</select></label>}
    <label>Message<textarea name="message" required maxLength={2000} /></label><label>Private documents (up to 10, 5 MiB each)<input name="files" type="file" disabled={provider && a.status !== 'in_progress'} multiple accept=".pdf,.png,.jpg,.jpeg" /></label><button disabled={busy}>Send update</button></form>;
}
export default function LegalServices() {
  const request = useLegalApi(), [path, changePath] = usePath();
  const session = useContext(CustomerSessionContext);
  const isLoggedIn = Boolean(session?.verified || (typeof localStorage !== 'undefined' && localStorage.getItem('userToken')));
  const [items, setItems] = useState([]), [detail, setDetail] = useState(null), [meta, setMeta] = useState({ total: 0 });
  const [search, setSearch] = useState(''), [page, setPage] = useState(1), [revision, refresh] = useState(0);
  const [answers, setAnswers] = useState({}), [files, setFiles] = useState({}), [errors, setErrors] = useState({}), [accepted, setAccepted] = useState(false);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [review, setReview] = useState(false);
  const lock = useRef(false), key = useRef(crypto.randomUUID());
  // A service definition and a submitted request have different shapes. Clear
  // the old view before changing routes, rather than rendering it as a request
  // for one frame while the next effect starts its fetch.
  const navigate = next => { setDetail(null); setItems([]); setLoading(true); changePath(next); };
  const parts = path.split('/').filter(Boolean), history = parts[1] === 'requests', id = parts[2] || (history ? null : parts[1]);
  useEffect(() => {
    const c = new AbortController(); setLoading(true); setError(''); setDetail(null); setAnswers({}); setFiles({}); setAccepted(false); setReview(false);
    const url = history ? `/api/customer-services/applications${id ? `/${id}` : `?page=${page}`}` : id ? `/api/customer-services/catalogue/${id}` : `/api/customer-services?q=${encodeURIComponent(search)}&page=${page}`;
    request(url, { signal: c.signal }).then(b => {
      if (c.signal.aborted) return;
      if (id) {
        if (!b.data || String(b.data._id).toLowerCase() !== id.toLowerCase() || (!history && !Array.isArray(b.data.fields))) throw new Error('Invalid Legal Services response. Please reload.');
        setDetail(b.data);
      } else {
        if (!Array.isArray(b.data) || !Number.isSafeInteger(b.meta?.total) || b.meta.total < 0 || b.data.some(s => !/^[a-f\d]{24}$/i.test(s?._id || ''))) throw new Error('Invalid Legal Services response. Please reload.');
        setItems(b.data); setMeta(b.meta);
      }
    }).catch(e => { if (!c.signal.aborted) setError(e.message); }).finally(() => { if (!c.signal.aborted) setLoading(false); });
    return () => c.abort();
  }, [request, history, id, search, page, revision]);
  const run = async fn => { if (lock.current) return; lock.current = true; setBusy(true); setError(''); setErrors({}); try { await fn(); } catch (e) { setError(e.message); setErrors(e.fields || {}); } finally { lock.current = false; setBusy(false); } };
  const submit = () => run(async () => {
    if (!localStorage.getItem('userToken')) throw new Error('Sign in from Account before submitting a private request.');
    if (serializedAnswerBytes(answers) > SERVICE_ANSWER_BYTES || Object.values(files).filter(Boolean).length > SERVICE_FILE_COUNT || Object.values(files).some(f => f?.size > SERVICE_FILE_BYTES)) throw new Error('Answers or private files exceed the allowed limits.');
    const data = new FormData(); data.set('answers', JSON.stringify(answers)); data.set('formVersion', detail.formVersion); data.set('serviceVersion', detail.version);
    Object.entries(files).forEach(([id, f]) => { if (f) data.append(id, f); });
    // Store a non-sensitive retry key only; never persist form answers/documents.
    const storageKey = `legal-submission:${detail._id}`, pendingKey = sessionStorage.getItem(storageKey) || key.current; sessionStorage.setItem(storageKey, pendingKey);
    const b = await request(`/api/customer-services/catalogue/${detail._id}/applications`, { method: 'POST', headers: { 'Idempotency-Key': pendingKey }, body: data });
    if (!/^[a-f\d]{24}$/i.test(b.data?._id || '')) throw new Error('The submission response is incomplete. Retry to recover the existing request.');
    sessionStorage.removeItem(storageKey); key.current = crypto.randomUUID();
    if (b.data.status === 'awaiting_payment' && b.data.billing) {
      // Fixed-price service: take the fee now. Closing checkout leaves a Pay button on the request.
      const outcome = await payServiceFee({ application: b.data, request: customerRequest, authorization: customerAuthorization }).catch(e => ({ message: e.message }));
      setNotice(outcome.verified ? 'Payment received. Your request has been submitted for review.' : `${outcome.message || 'Payment was not completed.'} Your request is saved — pay the fee below to submit it.`);
    } else setNotice('Request submitted. Our team will review it shortly.');
    navigate(legalRequestPath(b.data._id));
  });
  // Customer service payments use the shared fee checkout under /api/customer-services.
  const customerRequest = (suffix, options) => request(`/api/customer-services${suffix}`, options);
  const customerAuthorization = () => `Bearer ${localStorage.getItem('userToken') || ''}`;
  const fee = !history && detail?.startingPrice ? Math.round(Number(detail.startingPrice.amount) * 100) : 0;
  const base = detail?._id ? `/api/customer-services/applications/${detail._id}` : '';
  return <section className="legal-services customer-service-page" aria-label="Legal Services"><CustomerServiceHeading title={history ? 'My Legal Service Requests' : 'Legal Services'}><p>Explore legal services and submit a private request. Final pricing is confirmed after review.</p></CustomerServiceHeading><nav className="legal-nav" aria-label="Legal services navigation"><button type="button" className={`legal-nav-btn ${!history ? 'active' : ''}`} onClick={() => navigate('/legal-services')}>Browse services</button><button type="button" className={`legal-nav-btn ${history ? 'active' : ''}`} onClick={() => { if (!isLoggedIn) { if (typeof window !== 'undefined') window.location.href = '/account'; return; } navigate('/legal-services/requests'); }}>My requests</button>{!isLoggedIn && <a className="legal-nav-auth" href="/account">Sign in</a>}</nav>
    {notice && <p role="status">{notice}</p>}{error && <section className="customer-service-state" role="alert"><h2>Legal Services update</h2><p>{error}</p><button disabled={busy} onClick={() => refresh(n => n + 1)}>Reload latest</button></section>}
    {loading ? <section className="customer-service-state" role="status"><p>Loading Legal Services…</p></section> : detail ? history ? <>
      <h3>{detail.serviceName}</h3><p>Reference: <ServiceReference value={detail._id} /></p><p><strong>{REQUEST_STATUS[detail.status] || statusLabel(detail.status)}</strong></p><button type="button" disabled={busy} onClick={() => refresh(n => n + 1)}>Refresh request</button>
      {detail.informationRequest && <p>Information requested: {detail.informationRequest}</p>}{detail.rejectionReason && <p>{detail.rejectionReason}</p>}
      {detail.billing && <ServicePaymentPanel application={detail} request={customerRequest} authorization={customerAuthorization} onUpdated={async () => refresh(n => n + 1)} />}
      <dl>{detail.fields?.filter(f => f.type !== 'file').map(f => <React.Fragment key={f.id}><dt>{f.label}</dt><dd>{String(detail.answers?.[f.id] ?? '—')}</dd></React.Fragment>)}</dl>
      <PrivateFiles files={detail.files} request={request} base={base} run={run} />
      {detail.status === 'information_required' && <FollowUp request={detail} busy={busy} submit={data => run(async () => { validateFollowUp(data); await request(`${base}/respond`, { method: 'POST', body: data }); refresh(n => n + 1); })} />}
      <h3>Request history</h3><RequestTimeline events={detail.events} />
    </> : <><h3>{detail.name}</h3><p>{detail.description}</p><p>{detail.instructions}</p><p className="legal-price">{fee ? <>Service fee <strong>{feeText(fee)}</strong> · paid when you submit</> : 'Free service'}</p><p>Only submit information required for this service. Documents are private.</p>
      <form onSubmit={e => { e.preventDefault(); if (!isLoggedIn) { if (typeof window !== 'undefined') window.location.href = '/account'; return; } if (!review) setReview(true); else submit(); }}><DynamicFields fields={detail.fields} answers={answers} setAnswers={setAnswers} setFiles={setFiles} errors={errors} disabled={busy || review} />{review && <p>Review the information above, then submit your request.</p>}
        {review && fee > 0 && <div className="service-fee is-due"><div className="service-fee-row"><span>Service fee</span><strong>{feeText(fee)}</strong></div><label className="sm-agree"><input type="checkbox" checked={accepted} disabled={busy} onChange={e => setAccepted(e.target.checked)} />I agree to pay {feeText(fee)} now. If my request is rejected, the fee is refunded to my Bulkimart wallet.</label></div>}
        {review && <button type="button" onClick={() => setReview(false)}>Edit details</button>}<button disabled={busy || (review && fee > 0 && !accepted)}>{!review ? 'Review request' : busy ? (fee ? 'Opening payment…' : 'Submitting…') : fee ? `Pay ${feeText(fee)} & submit` : 'Submit request'}</button></form></>
      : !error && <>{!history && <div className="legal-search"><label htmlFor="legal-service-search">Search legal services</label><input id="legal-service-search" type="search" placeholder="Search by service name or keyword" aria-describedby="legal-service-search-hint" maxLength={100} value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} /><p id="legal-service-search-hint">Find the service you need by name or keyword.</p></div>}<div className="legal-grid">{items.map(a => <article className="legal-card" key={a._id}><h3>{a.name || a.serviceName}</h3>{history ? <><p><ServiceReference value={a._id} /></p><p>{statusLabel(a.status)} · {statusLabel(a.paymentStatus)}</p><p>{new Date(a.createdAt).toLocaleDateString()}</p></> : <p>{a.description}</p>}<button type="button" onClick={() => { if (history) { navigate(legalRequestPath(a._id)); } else { if (!isLoggedIn) { if (typeof window !== 'undefined') window.location.href = '/account'; return; } navigate(`/legal-services/${a._id}`); } }}>{history ? 'View request' : 'View service'}</button></article>)}</div>{!items.length && <section className="customer-service-state" role="status"><h2>{history ? 'No requests yet' : 'No eligible services available'}</h2><p>{history ? 'Your private legal service requests will appear here.' : search ? 'Try another search to find a legal service.' : 'Legal services are currently unavailable. Please check back for available services.'}</p></section>}{meta.total > 20 && <nav className="customer-service-pagination"><button disabled={page === 1} onClick={() => setPage(n => n - 1)}>Previous</button><span>Page {page}</span><button disabled={page * 20 >= meta.total} onClick={() => setPage(n => n + 1)}>Next</button></nav>}</>}
  </section>;
}
export function validateFollowUp(data) {
  const files = data.getAll('files').filter(f => f.size > 0);
  if (files.length > SERVICE_FILE_COUNT || files.some(f => f.size > SERVICE_FILE_BYTES)) throw new Error('Upload up to 10 private files, each no larger than 5 MiB.');
  if (!files.length) data.delete('files');
}
