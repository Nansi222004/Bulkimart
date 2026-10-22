import React, { useCallback, useEffect, useRef, useState } from 'react';
import { apiUrl } from '../../utils/api';
import { boundedFetch } from '../../utils/portalRequests';
import { openRazorpayCheckout } from '../../utils/razorpayCheckout';
import { DynamicFields } from './ServicesPanel';
import { SERVICE_FILE_BYTES, SERVICE_FILE_COUNT, SERVICE_ANSWER_BYTES, serializedAnswerBytes } from '../../../../shared/serviceLimits.mjs';
import './legalServices.css';

export const money = n => `₹${((n || 0) / 100).toFixed(2)}`;
export const statusLabel = s => String(s || '').replaceAll('_', ' ');
export const legalRequestPath = id => `/legal-services/requests/${id}`;
export function useLegalApi(admin = false) {
  return useCallback(async (path, options = {}, blob = false) => {
    const token = localStorage.getItem(admin ? 'adminToken' : 'userToken');
    const r = await boundedFetch(apiUrl(path), { ...options, headers: { Authorization: `Bearer ${token || ''}`, ...(options.body && !(options.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}), ...options.headers } });
    if (blob && r.ok) return r.blob();
    const b = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(b.message || 'Unable to load Legal Services'), { fields: b.meta?.fields, status: r.status });
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
export function QuoteBreakdown({ quotation: q }) {
  return q ? <section className="legal-card"><h3>Confirmed quotation · version {q.version}</h3><p>{q.scope}</p><dl><dt>Service amount</dt><dd>{money(q.servicePaise)}</dd><dt>Applicable service tax</dt><dd>{money(q.serviceTaxPaise)}</dd><dt>Total payable (INR)</dt><dd><strong>{money(q.totalPaise)}</strong></dd></dl>{q.expiresAt && <p>Valid until {new Date(q.expiresAt).toLocaleString()}</p>}<h4>Payment, cancellation and refund terms</h4><p>{q.terms || q.policy?.terms}</p></section> : null;
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
  const request = useLegalApi(), [path, navigate] = usePath();
  const [items, setItems] = useState([]), [detail, setDetail] = useState(null), [meta, setMeta] = useState({ total: 0 });
  const [search, setSearch] = useState(''), [page, setPage] = useState(1), [revision, refresh] = useState(0);
  const [answers, setAnswers] = useState({}), [files, setFiles] = useState({}), [errors, setErrors] = useState({}), [accepted, setAccepted] = useState(false);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [review, setReview] = useState(false);
  const lock = useRef(false), key = useRef(crypto.randomUUID());
  const parts = path.split('/').filter(Boolean), history = parts[1] === 'requests', id = parts[2] || (history ? null : parts[1]);
  useEffect(() => {
    const c = new AbortController(); setLoading(true); setError(''); setDetail(null); setAnswers({}); setFiles({}); setAccepted(false); setReview(false);
    const url = history ? `/api/customer-services/applications${id ? `/${id}` : `?page=${page}`}` : id ? `/api/customer-services/catalogue/${id}` : `/api/customer-services?q=${encodeURIComponent(search)}&page=${page}`;
    request(url, { signal: c.signal }).then(b => { if (!c.signal.aborted) { if (id) setDetail(b.data); else { setItems(b.data); setMeta(b.meta); } } }).catch(e => { if (!c.signal.aborted) setError(e.message); }).finally(() => { if (!c.signal.aborted) setLoading(false); });
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
    sessionStorage.removeItem(storageKey); key.current = crypto.randomUUID(); setNotice('Request submitted. Awaiting admin review. No payment has been collected.'); navigate(legalRequestPath(b.data._id));
  });
  const base = detail?._id ? `/api/customer-services/applications/${detail._id}` : '';
  const pay = () => run(async () => {
    const paymentKey = `legal-payment:${detail._id}`, attemptKey = sessionStorage.getItem(paymentKey) || crypto.randomUUID(); sessionStorage.setItem(paymentKey, attemptKey);
    const b = await request(`${base}/payment`, { method: 'POST', headers: { 'Idempotency-Key': attemptKey }, body: JSON.stringify({ quotationVersion: detail.quotation.version, acceptTerms: accepted }) });
    const outcome = await openRazorpayCheckout(b.data, { Authorization: `Bearer ${localStorage.getItem('userToken')}`, 'Content-Type': 'application/json' });
    setNotice(outcome.verified ? 'Payment verified by the server. Admin will authorize work.' : outcome.message || 'Payment pending verification. Refresh payment status before retrying.');
    if (outcome.verified) sessionStorage.removeItem(paymentKey);
    refresh(n => n + 1);
  });
  return <section className="legal-services" aria-label="Legal Services"><header><h2>{history ? 'My Legal Service Requests' : 'Legal Services'}</h2><nav><button onClick={() => navigate('/legal-services')}>Browse services</button><button onClick={() => navigate('/legal-services/requests')}>My requests</button><a href="/account">Account / sign in</a></nav></header>
    {notice && <p role="status">{notice}</p>}{error && <p role="alert">{error} <button disabled={busy} onClick={() => refresh(n => n + 1)}>Reload latest</button></p>}
    {loading ? <p role="status">Loading Legal Services…</p> : detail ? history ? <>
      <h3>{detail.serviceName}</h3><p>Reference: {detail._id}</p><p><strong>{statusLabel(detail.status)}</strong> · Payment: {statusLabel(detail.paymentStatus)}</p>
      {detail.informationRequest && <p>Information requested: {detail.informationRequest}</p>}{detail.rejectionReason && <p>{detail.rejectionReason}</p>}
      <QuoteBreakdown quotation={detail.quotation} />{detail.receipt && <p>Payment receipt: {detail.receipt.transactionReference} · {money(detail.receipt.capturedPaise)}</p>}
      {detail.canPay && <section className="legal-card"><label><input type="checkbox" checked={accepted} onChange={e => setAccepted(e.target.checked)} />I accept this quotation and the displayed payment, cancellation and refund terms.</label><button disabled={!accepted || busy} onClick={pay}>Pay confirmed amount</button></section>}
      {detail.paymentStatus !== 'not_requested' && <button disabled={busy} onClick={() => run(async () => { const b = await request(`${base}/payment-status`, { method: 'POST', body: '{}' }); if (b.data.status === 'failed') sessionStorage.removeItem(`legal-payment:${detail._id}`); setNotice(`Payment status: ${statusLabel(b.data.status)}`); refresh(n => n + 1); })}>Check payment status</button>}
      {detail.financialHold && <p role="status">This request is on financial hold pending admin review.</p>}
      <dl>{detail.fields?.filter(f => f.type !== 'file').map(f => <React.Fragment key={f.id}><dt>{f.label}</dt><dd>{String(detail.answers[f.id] ?? '—')}</dd></React.Fragment>)}</dl>
      <PrivateFiles files={detail.files} request={request} base={base} run={run} />
      {detail.status === 'information_required' && <FollowUp request={detail} busy={busy} submit={data => run(async () => { validateFollowUp(data); await request(`${base}/respond`, { method: 'POST', body: data }); refresh(n => n + 1); })} />}
      {!['cancelled', 'refunded', 'rejected'].includes(detail.status) && !detail.cancellation && <form onSubmit={e => { e.preventDefault(); const message = new FormData(e.currentTarget).get('reason'); run(async () => { await request(`${base}/cancellation`, { method: 'POST', body: JSON.stringify({ version: detail.version, message }) }); refresh(n => n + 1); }); }}><label>Cancellation or refund review request<textarea name="reason" required maxLength={2000} /></label><button disabled={busy}>Request admin review</button><p>Submitting this request does not confirm cancellation or a refund.</p></form>}
      {detail.cancellation && <p>Cancellation/refund review requested.</p>}{detail.refunds?.map(r => <p key={r.key}>Refund {money(r.amountPaise)}: {statusLabel(r.status)}</p>)}<h3>Request history</h3><RequestTimeline events={detail.events} />
    </> : <><h3>{detail.name}</h3><p>{detail.description}</p><p>{detail.instructions}</p>{detail.startingPrice && <p>Starting price: {detail.startingPrice.currency} {Number(detail.startingPrice.amount).toFixed(2)}. Final quotation follows admin review.</p>}<p>Only submit information required for this service. Documents are private. No payment is collected on submission.</p>
      <form onSubmit={e => { e.preventDefault(); if (!review) setReview(true); else submit(); }}><DynamicFields fields={detail.fields} answers={answers} setAnswers={setAnswers} setFiles={setFiles} errors={errors} disabled={busy || review} />{review && <p>Review the information above, then submit your request for admin review.</p>}{review && <button type="button" onClick={() => setReview(false)}>Edit details</button>}<button disabled={busy}>{review ? 'Submit Service Request' : 'Review request'}</button></form></>
      : <>{!history && <label>Search legal services<input type="search" maxLength={100} value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} /></label>}<div className="legal-grid">{items.map(a => <article className="legal-card" key={a._id}><h3>{a.name || a.serviceName}</h3>{history ? <><p>{statusLabel(a.status)} · {statusLabel(a.paymentStatus)}</p><p>{new Date(a.createdAt).toLocaleDateString()}</p></> : <p>{a.description}</p>}<button onClick={() => navigate(history ? legalRequestPath(a._id) : `/legal-services/${a._id}`)}>{history ? 'View request' : 'View service'}</button></article>)}</div>{!items.length && <p>No {history ? 'requests' : 'eligible services'} available.</p>}<nav><button disabled={page === 1} onClick={() => setPage(n => n - 1)}>Previous</button><span>Page {page}</span><button disabled={page * 20 >= meta.total} onClick={() => setPage(n => n + 1)}>Next</button></nav></>}
  </section>;
}
export function validateFollowUp(data) {
  const files = data.getAll('files').filter(f => f.size > 0);
  if (files.length > SERVICE_FILE_COUNT || files.some(f => f.size > SERVICE_FILE_BYTES)) throw new Error('Upload up to 10 private files, each no larger than 5 MiB.');
  if (!files.length) data.delete('files');
}
export function ProviderWorkspace() {
  const request = useLegalApi(), [items, setItems] = useState([]), [a, setA] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), lock = useRef(false);
  const run = async fn => { if (lock.current) return; lock.current = true; setBusy(true); setError(''); try { await fn(); } catch (e) { setError(e.message); } finally { lock.current = false; setBusy(false); } };
  const load = () => run(async () => setItems((await request('/api/legal-provider')).data));
  useEffect(() => { load(); }, [request]);
  const base = `/api/legal-provider/${a?._id}`;
  return <main className="legal-services"><h1>Legal provider workspace</h1><a href="/account">Sign in / account</a><button disabled={busy} onClick={load}>Refresh assignments</button>{error && <p role="alert">{error}</p>}{busy && <p role="status">Loading…</p>}
    {!a ? items.map(a => <article key={a._id} className="legal-card"><h2>{a.serviceName}</h2><p>{statusLabel(a.status)}</p><button onClick={() => run(async () => setA((await request(`/api/legal-provider/${a._id}`)).data))}>Open assignment</button></article>) : <>
      <button onClick={() => setA(null)}>Back to assignments</button><h2>{a.serviceName}</h2><p>{statusLabel(a.status)}</p><p>{a.quotation?.scope}</p>
      <dl>{a.fields?.map(f => <React.Fragment key={f.id}><dt>{f.label}</dt><dd>{String(a.answers[f.id] ?? '—')}</dd></React.Fragment>)}</dl>
      <PrivateFiles files={a.files} request={request} base={base} run={run} />
      {['under_review', 'awaiting_payment', 'payment_verified', 'in_progress'].includes(a.status) && !a.financialHold && <FollowUp request={a} provider busy={busy} submit={data => run(async () => { validateFollowUp(data); setA((await request(`${base}/progress`, { method: 'POST', body: data })).data); })} />}
      <p>Settlement status: {statusLabel(a.settlementStatus)}. Completion requires admin verification.</p><RequestTimeline events={a.events} /></>}
    {!busy && !items.length && <p>No assigned requests.</p>}</main>;
}
