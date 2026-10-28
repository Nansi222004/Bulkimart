import { useFeedback } from '../feedback/FeedbackProvider';
import { getPortalToken } from '../../utils/portalSession';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { apiUrl } from '../../utils/api';
import { boundedFetch } from '../../utils/portalRequests';
import ServicePaymentPanel from './ServicePaymentPanel';
import './services.css';
import { createLatestRequest, serviceApplicationId } from './serviceRequests';
import { SERVICE_TEXT_CHARS, SERVICE_ANSWER_BYTES, SERVICE_FILE_COUNT, SERVICE_FILE_BYTES, serializedAnswerBytes } from '../../../../shared/serviceLimits.mjs';

const types = ['text', 'textarea', 'number', 'date', 'select', 'radio', 'checkbox', 'email', 'phone', 'file'];
const labels = { submitted: 'Submitted', under_review: 'Under Review', information_required: 'More Information Required', awaiting_payment: 'Awaiting payment', payment_verified: 'Payment verified', in_progress: 'In Progress', completed: 'Completed', rejected: 'Rejected' };
const transitions = { submitted: ['under_review', 'rejected'], under_review: ['information_required', 'awaiting_payment', 'in_progress', 'rejected'], information_required: ['rejected'], awaiting_payment: ['awaiting_payment', 'rejected'], payment_verified: ['in_progress'], in_progress: ['awaiting_payment', 'completed', 'rejected'], completed: [], rejected: [] };
const blank = () => ({ name: '', slug: '', description: '', instructions: '', pricing: { mode: 'free', amount: 0, currency: 'INR' }, fields: [] });
const price = p => !p ? 'Price unavailable' : p.mode === 'free' ? 'Free' : `${p.currency} ${Number(p.amount).toFixed(2)}`;
const key = () => crypto.randomUUID();

export function ServiceVisibility({ service }) {
  const audiences = service.audiences ?? ['vendor'];
  return <p>Audience: {audiences.includes('vendor') ? 'Approved sellers' : ''}{audiences.includes('vendor') && audiences.includes('customer') ? ' and ' : ''}{audiences.includes('customer') ? 'Customers' : ''}. Customer catalogue: {service.status !== 'published' ? 'Hidden until published.' : !audiences.includes('customer') ? 'Hidden — customer audience is not selected.' : 'Visible to customers.'}</p>;
}

export function DynamicFields({ fields = [], answers = {}, setAnswers, setFiles, errors = {}, disabled = false }) {
  return fields.map(f => {
    const id = `service-field-${f.id}`;
    const common = { id, disabled, required: f.required, 'aria-invalid': !!errors[f.id], 'aria-describedby': `${id}-help`, value: answers[f.id] ?? '', onChange: e => setAnswers(a => ({ ...a, [f.id]: f.type === 'number' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value })) };
    return <div className="sm-field" key={f.id}>
      <label htmlFor={id}>{f.label}{f.required ? ' *' : ''}</label>
      {f.type === 'textarea' ? <textarea {...common} minLength={f.minLength} maxLength={f.maxLength ?? SERVICE_TEXT_CHARS} />
        : f.type === 'select' ? <select {...common}><option value="">Choose…</option>{f.options.map(o => <option key={o}>{o}</option>)}</select>
        : f.type === 'radio' ? <fieldset><legend className="sm-sr">{f.label}</legend>{f.options.map(o => <label key={o}><input type="radio" name={id} disabled={disabled} required={f.required} checked={answers[f.id] === o} onChange={() => setAnswers(a => ({ ...a, [f.id]: o }))} /> {o}</label>)}</fieldset>
        : f.type === 'checkbox' ? <input id={id} type="checkbox" disabled={disabled} required={f.required} checked={answers[f.id] === true} onChange={e => setAnswers(a => ({ ...a, [f.id]: e.target.checked }))} />
        : f.type === 'file' ? <input id={id} type="file" disabled={disabled} required={f.required} accept={f.formats.map(x => x === 'jpg' ? '.jpg,.jpeg' : `.${x}`).join(',')} onChange={e => setFiles(a => ({ ...a, [f.id]: e.target.files[0] }))} />
        : <input {...common} type={f.type === 'phone' ? 'tel' : f.type} min={f.min} max={f.max} minLength={f.minLength} maxLength={f.maxLength ?? SERVICE_TEXT_CHARS} step={f.type === 'number' ? 'any' : undefined} />}
      <small id={`${id}-help`}>{f.help}{f.type === 'file' ? ` (${f.formats.join(', ')}; max ${(f.maxBytes / 1024 / 1024).toFixed(1)} MB)` : ''}</small>
      {errors[f.id] && <small role="alert" className="sm-error">{errors[f.id]}</small>}
    </div>;
  });
}

export function ServiceEditor({ initial, onSave, busy }) {
  const [form, setForm] = useState(initial);
  const [preview, setPreview] = useState(false);
  const update = (k, v) => setForm(p => ({ ...p, [k]: v }));
  const updateField = (index, k, v) => update('fields', form.fields.map((f, i) => i !== index ? f : k === 'type' ? { id: f.id, label: f.label, help: f.help, required: f.required, type: v } : { ...f, [k]: v }));
  const move = (i, delta) => { const fields = [...form.fields]; [fields[i], fields[i + delta]] = [fields[i + delta], fields[i]]; update('fields', fields); };
  return <form onSubmit={e => { e.preventDefault(); onSave(form); }} className="sm-card">
    <h3>{form._id ? 'Edit service' : 'Create service'}</h3>
    <div className="sm-grid">{[['name', 'Name'], ['slug', 'Identifier']].map(([k, label]) => <label key={k}>{label}<input required maxLength={k === 'slug' ? 100 : 150} value={form[k]} onChange={e => update(k, e.target.value)} /></label>)}</div>
    <label>Description<textarea required maxLength={10000} value={form.description} onChange={e => update('description', e.target.value)} /></label>
    <label>Instructions<textarea maxLength={10000} value={form.instructions} onChange={e => update('instructions', e.target.value)} /></label>
    <fieldset><legend>Service audience</legend>{['vendor', 'customer'].map(a => <label key={a}><input type="checkbox" checked={(form.audiences || ['vendor']).includes(a)} onChange={e => update('audiences', e.target.checked ? [...(form.audiences || ['vendor']), a] : (form.audiences || ['vendor']).filter(v => v !== a))} />{a === 'customer' ? 'Customer Legal Services (explicit eligibility)' : 'Vendor applications'}</label>)}</fieldset>
    <p>To show this service to customers, select Customer Legal Services, save the service, and publish it. Uncheck the customer audience or unpublish to hide it. Existing services without an audience are for approved sellers only.</p>
    <label>Legal category (optional)<input maxLength={100} value={form.legalCategory || ''} onChange={e => update('legalCategory', e.target.value)} /></label>
    <div className="sm-grid"><label>Pricing<select value={form.pricing.mode} onChange={e => update('pricing', { ...form.pricing, mode: e.target.value, amount: e.target.value === 'free' ? 0 : form.pricing.amount })}><option value="free">Free</option><option value="fixed">Fixed price</option></select></label>
      <label>Price<input type="number" min={form.pricing.mode === 'fixed' ? 0.01 : 0} max={10000000} step="0.01" disabled={form.pricing.mode === 'free'} required value={form.pricing.amount} onChange={e => update('pricing', { ...form.pricing, amount: Number(e.target.value) })} /></label>
      <label>Currency<input required pattern="[A-Z]{3}" maxLength={3} value={form.pricing.currency} onChange={e => update('pricing', { ...form.pricing, currency: e.target.value.toUpperCase() })} /></label></div>
    <h4>Application fields and required documents</h4>
    <p>Add a file field for each requested document. PDF, PNG and JPEG are supported.</p>
    {form.fields.map((f, i) => <fieldset key={i} className="sm-card"><legend>Field {i + 1}</legend><div className="sm-grid">
      <label>Stable ID<input required pattern="[a-zA-Z][a-zA-Z0-9_]{0,49}" value={f.id} onChange={e => updateField(i, 'id', e.target.value)} /></label>
      <label>Label<input required maxLength={150} value={f.label} onChange={e => updateField(i, 'label', e.target.value)} /></label>
      <label>Type<select value={f.type} onChange={e => updateField(i, 'type', e.target.value)}>{types.map(t => <option key={t}>{t}</option>)}</select></label>
      <label>Help text<input maxLength={500} value={f.help || ''} onChange={e => updateField(i, 'help', e.target.value)} /></label>
      <label><input type="checkbox" checked={f.required} onChange={e => updateField(i, 'required', e.target.checked)} /> Required</label>
      {['select', 'radio'].includes(f.type) && <label>Options (one per line)<textarea required value={(f.options || []).join('\n')} onChange={e => updateField(i, 'options', e.target.value.split('\n'))} /></label>}
      {f.type === 'number' && ['min', 'max'].map(k => <label key={k}>{k}<input type="number" step="any" value={f[k] ?? ''} onChange={e => updateField(i, k, e.target.value === '' ? undefined : Number(e.target.value))} /></label>)}
      {['text', 'textarea', 'email', 'phone'].includes(f.type) && ['minLength', 'maxLength'].map(k => <label key={k}>{k === 'minLength' ? 'Minimum length' : 'Maximum length'}<input type="number" min="0" max="10000" value={f[k] ?? ''} onChange={e => updateField(i, k, e.target.value === '' ? undefined : Number(e.target.value))} /></label>)}
      {f.type === 'file' && <><label>Allowed formats<select multiple value={f.formats || ['pdf', 'png', 'jpg']} onChange={e => updateField(i, 'formats', Array.from(e.target.selectedOptions, o => o.value))}>{['pdf', 'png', 'jpg'].map(x => <option key={x}>{x}</option>)}</select></label><label>Maximum bytes<input type="number" min="1" max={5242880} value={f.maxBytes ?? 5242880} onChange={e => updateField(i, 'maxBytes', Number(e.target.value))} /></label></>}
    </div><div className="sm-actions"><button type="button" disabled={i === 0} onClick={() => move(i, -1)}>Move up</button><button type="button" disabled={i === form.fields.length - 1} onClick={() => move(i, 1)}>Move down</button><button type="button" onClick={() => update('fields', form.fields.filter((_, n) => n !== i))}>Remove field</button></div></fieldset>)}
    <div className="sm-actions"><button type="button" disabled={form.fields.length >= 50} onClick={() => update('fields', [...form.fields, { id: `field_${form.fields.length + 1}`, label: '', type: 'text', required: false }])}>Add field</button><button type="button" onClick={() => setPreview(p => !p)}>Preview form</button><button disabled={busy} type="submit">{busy ? 'Saving…' : 'Save service'}</button></div>
    {preview && <section className="sm-card"><h4>{form.name} — {price(form.pricing)}</h4><p>{form.description}</p><p>{form.instructions}</p><DynamicFields disabled fields={form.fields.map(f => ({ ...f, formats: f.formats || ['pdf', 'png', 'jpg'], maxBytes: f.maxBytes || 5242880, options: f.options || [] }))} answers={{}} /></section>}
  </form>;
}

export function ApplicationDetail({ application: a, admin, request, run, busy, onChange, onDirty }) {
  const [message, setMessage] = useState('');
  const [files, setFiles] = useState([]);
  const [target, setTarget] = useState('');
  const upload = useRef();
  useEffect(() => { onDirty?.(Boolean(message || files.length || target)); }, [message, files, target, onDirty]);
  const ui = useFeedback();
  const available = (transitions[a.status] || []).filter(status => status !== 'awaiting_payment' || a.snapshot.pricing?.mode === 'fixed')
    .filter(status => !['awaiting_payment', 'rejected'].includes(status) || (!a.billing?.paymentId && a.billing?.status !== 'paid'))
    .filter(status => !['in_progress', 'completed'].includes(status) || a.snapshot.pricing?.mode !== 'fixed' || (a.billing?.status === 'paid' && !a.billing.reviewRequired));
  const act = status => ui.perform({title:'Update application?', message:`Set application ${a._id} (${a.snapshot.name}) to ${labels[status] || status}?`,confirmLabel:'Update application',destructive:status==='rejected'}, () => run(async () => {
    const data = new FormData(); data.set('version', a.__v); data.set('message', message); if (admin) data.set('status', status);
    if (files.length > SERVICE_FILE_COUNT || files.some(f => f.size > SERVICE_FILE_BYTES)) throw new Error('Upload at most 10 files, with each file no larger than 5 MiB.');
    if (!admin || status === 'completed') files.forEach(f => data.append('files', f));
    const result = await request(`/applications/${a._id}/${admin ? 'transition' : 'respond'}`, { method: 'POST', body: data });
    onChange(result.data); setMessage(''); setFiles([]); setTarget(''); if (upload.current) upload.current.value = '';
  }));
  return <section className="sm-card"><h3>{a.snapshot.name}</h3><p>Application ID: <code>{a._id}</code></p><p><strong>{labels[a.status] || String(a.status || '').replaceAll('_', ' ')}</strong> · {price(a.snapshot.pricing)}</p><p>Submitted {new Date(a.createdAt).toLocaleString()}</p>{admin && <p>Vendor ID: {String(a.vendor?._id || a.vendor || '—')}</p>}
    <dl>{(a.snapshot.fields || []).filter(f => f.type !== 'file').map(f => <React.Fragment key={f.id}><dt>{f.label}</dt><dd>{typeof a.answers?.[f.id] === 'boolean' ? (a.answers[f.id] ? 'Yes' : 'No') : String(a.answers?.[f.id] ?? '—')}</dd></React.Fragment>)}</dl>
    <ServicePaymentPanel application={a} admin={admin} request={request} onUpdated={async () => onChange((await request(`/applications/${a._id}`)).data)} />
    {a.informationRequest && <p><strong>Information request:</strong> {a.informationRequest}</p>}{a.rejectionReason && <p><strong>Rejection reason:</strong> {a.rejectionReason}</p>}
    <h4>Documents and deliverables</h4>{!a.files?.length && <p>No files attached.</p>}{(a.files || []).map(f => <div key={f.fileId}><button disabled={busy} onClick={() => run(async () => { const blob = await request(`/applications/${a._id}/files/${f.fileId}`, {}, true); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = f.name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); })}>Download {f.name}</button> <small>{f.kind} · {(f.sizeBytes / 1024).toFixed(1)} KB</small></div>)}
    <h4>History</h4><ol>{(a.events || []).map(e => <li key={e._id}>{new Date(e.at).toLocaleString()} · {e.actorType} · {labels[e.action] || String(e.action || '').replaceAll('_', ' ')}{e.message && <p>{e.message}</p>}</li>)}</ol>
    {((admin && available.length > 0) || (!admin && a.status === 'information_required')) && <form onSubmit={e => { e.preventDefault(); act(admin ? target : 'under_review'); }}><fieldset disabled={busy}>
      {admin && <label>Action<select required value={target} onChange={e => setTarget(e.target.value)}><option value="">Choose action…</option>{available.map(s => <option key={s} value={s}>{s === 'awaiting_payment' ? 'Request payment' : labels[s]}</option>)}</select></label>}
      <label>{admin ? target === 'awaiting_payment' ? 'Payment terms shown to the applicant (include cancellation and refund terms)' : 'Message / required reason for rejection or information request' : 'Response to information request'}<textarea maxLength={2000} required={admin ? ['rejected', 'information_required', 'awaiting_payment'].includes(target) : !files.length} value={message} onChange={e => setMessage(e.target.value)} /></label>
      {(!admin || target === 'completed') && <label>{admin ? 'Final deliverables' : 'Additional documents'} (up to 10 files, 5 MB each)<input ref={upload} type="file" multiple accept=".pdf,.png,.jpg,.jpeg" onChange={e => setFiles(Array.from(e.target.files))} /></label>}
      <button disabled={busy || (admin && !target)}>{busy ? 'Saving…' : admin ? 'Apply action' : 'Send response and return to review'}</button>
    </fieldset></form>}
  </section>;
}

export default function ServicesPanel({ admin = false }) {
  const ui = useFeedback();
  const [tab, setTab] = useState('services');
  const [items, setItems] = useState([]), [meta, setMeta] = useState({ total: 0 }), [page, setPage] = useState(1);
  const [filter, setFilter] = useState(''), [from, setFrom] = useState(''), [to, setTo] = useState('');
  const [selected, setSelected] = useState(null), [editor, setEditor] = useState(null), [application, setApplication] = useState(null);
  const [answers, setAnswers] = useState({}), [files, setFiles] = useState({}), [errors, setErrors] = useState({});
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false), [conflict, setConflict] = useState(false), [detailRevision, setDetailRevision] = useState(0);
  const lock = useRef(false), submissionKey = useRef(key());
  const listRequests = useRef(createLatestRequest()), detailRequests = useRef(createLatestRequest());
  const mounted = useRef(true), detailDirty = useRef(false), currentApplication = useRef(null);
  currentApplication.current = application;
  const onDirty = useCallback(value => { detailDirty.current = value; }, []);
  const allowDiscard = () => !detailDirty.current || ui.ask('Discard your unsaved application message and selected files and reload or leave this application?');
  const request = useCallback(async (suffix = '', options = {}, blob = false) => {
    const token = (admin ? localStorage.getItem('adminToken') : getPortalToken('seller'));
    const response = await boundedFetch(apiUrl(`/api/${admin ? 'admin/' : ''}services${suffix}`), { ...options, headers: { Authorization: `Bearer ${token || ''}`, ...(options.body && !(options.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}), ...options.headers } });
    if (blob && response.ok) return response.blob();
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(body.message || 'Request failed'), { status: response.status, fields: body.meta?.fields });
    return body;
  }, [admin]);
  const load = useCallback(async () => {
    const task = listRequests.current.start();
    setLoading(true); setError('');
    try { const result = await request(`${tab === 'applications' ? '/applications' : ''}?page=${page}&limit=20${tab === 'applications' ? `&status=${filter}&from=${from}&to=${to}` : ''}`, { signal: task.signal }); if (mounted.current && task.isCurrent()) { setItems(result.data); setMeta(result.meta); } }
    catch (e) { if (mounted.current && task.isCurrent()) { setError(e.message); setItems([]); } } finally { if (mounted.current && task.isCurrent()) setLoading(false); }
  }, [request, tab, page, filter, from, to]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; listRequests.current.cancel(); detailRequests.current.cancel(); }; }, []);
  useEffect(() => { load(); return () => listRequests.current.cancel(); }, [load]);
  const openApplication = useCallback(async (id, confirmDiscard = true) => {
    if (confirmDiscard && detailDirty.current && !await ui.ask('Discard your unsaved application message and selected files and load the latest record?')) {
      if (admin && currentApplication.current) window.history.replaceState(null, '', `/admin/services?application=${currentApplication.current._id}`);
      return;
    }
    const task = detailRequests.current.start();
    setDetailLoading(true); setError('');
    try {
      if (!serviceApplicationId(id)) throw new Error('Service application reference is invalid. Select an application from the list.');
      const result = await request(`/applications/${id}`, { signal: task.signal });
      if (!mounted.current || !task.isCurrent()) return;
      setApplication(result.data); setSelected(null); setEditor(null); setTab('applications');
      setDetailRevision(v => v + 1); detailDirty.current = false; setConflict(false);
      if (admin) window.history.replaceState(null, '', `/admin/services?application=${id}`);
    } catch (e) {
      if (mounted.current && task.isCurrent()) {
        if ([403, 404].includes(e.status) || !serviceApplicationId(id)) setApplication(null);
        setError([403, 404].includes(e.status) ? 'This service application is unavailable or you do not have access.' : e.message);
      }
    } finally { if (mounted.current && task.isCurrent()) setDetailLoading(false); }
  }, [request, admin]);
  useEffect(() => {
    if (!admin || typeof window === 'undefined') return;
    const navigate = async () => {
      const id = new URLSearchParams(window.location.search).get('application');
      if (id !== null) void openApplication(id);
      else if (currentApplication.current) {
        if (detailDirty.current && !await ui.ask('Discard unsaved application changes and return to the service list?')) {
          window.history.replaceState(null, '', `/admin/services?application=${currentApplication.current._id}`); return;
        }
        detailRequests.current.cancel(); setApplication(null); setDetailLoading(false); detailDirty.current = false; setItems([]); setTab('services');
      } else { detailRequests.current.cancel(); setDetailLoading(false); }
    };
    navigate(); window.addEventListener('service-application-open', navigate); window.addEventListener('popstate', navigate);
    return () => { window.removeEventListener('service-application-open', navigate); window.removeEventListener('popstate', navigate); };
  }, [admin, openApplication]);
  const refresh = async () => {
    const allowed = allowDiscard();
    if (allowed !== true && !await allowed) return;
    await Promise.all([load(), application ? openApplication(application._id, false) : Promise.resolve()]);
  };
  const applyApplication = value => { detailRequests.current.cancel(); setDetailLoading(false); setApplication(value); setDetailRevision(v => v + 1); detailDirty.current = false; setConflict(false); };
  const run = async fn => {
    if (lock.current) return; lock.current = true; setBusy(true); setError(''); setErrors({}); setNotice('');
    try { await fn(); } catch (e) { if (mounted.current) { setError(e.message); setErrors(e.fields || {}); if (e.status === 409) setConflict(true); } return {ok:false,message:e.message}; } finally { lock.current = false; if (mounted.current) setBusy(false); }
  };
  const switchTab = async t => { const allowed=allowDiscard(); if(allowed!==true && !await allowed)return; listRequests.current.cancel(); detailRequests.current.cancel(); setDetailLoading(false); detailDirty.current = false; setConflict(false); setItems([]); setLoading(true); setTab(t); setPage(1); setSelected(null); setEditor(null); setApplication(null); setError(''); setNotice(''); if (admin) window.history.replaceState(null, '', '/admin/services'); if (tab === t && page === 1) void load(); };
  const submit = () => run(async () => {
    if (serializedAnswerBytes(answers) > SERVICE_ANSWER_BYTES) throw new Error('Application answers exceed the 256 KiB total limit. Please shorten your answers.');
    if (Object.values(files).filter(Boolean).length > SERVICE_FILE_COUNT) throw new Error('Upload at most 10 documents.');
    for (const f of selected.fields.filter(f => f.type !== 'file')) if (typeof answers[f.id] === 'string' && answers[f.id].length > Math.min(f.maxLength ?? SERVICE_TEXT_CHARS, SERVICE_TEXT_CHARS)) throw Object.assign(new Error('Please shorten your answer.'), { fields: { [f.id]: 'Text length is invalid' } });
    for (const [id, file] of Object.entries(files)) { const field = selected.fields.find(f => f.id === id); if (file && file.size > field.maxBytes) throw Object.assign(new Error('Document is too large'), { fields: { [id]: 'File exceeds the configured size limit' } }); }
    const data = new FormData(); data.set('answers', JSON.stringify(answers)); data.set('formVersion', selected.formVersion); data.set('serviceVersion', selected.__v);
    Object.entries(files).forEach(([id, file]) => { if (file) data.append(id, file); });
    const result = await request(`/${selected._id}/applications`, { method: 'POST', headers: { 'Idempotency-Key': submissionKey.current }, body: data });
    if (!result.data?._id || !result.data.snapshot || !Array.isArray(result.data.snapshot.fields)) throw new Error('The application response is incomplete. Retry with the same submission key to recover your request.');
    setSelected(null); setItems([]); setTab('applications'); setApplication(result.data); submissionKey.current = key(); setNotice(`Application ${result.data._id} submitted successfully.`);
  });
  return <section className="sm-panel" aria-label="Service management"><div className="sm-actions"><h2>{admin ? 'Service Management' : 'Vendor Services'}</h2><button disabled={busy} aria-pressed={tab === 'services'} onClick={() => switchTab('services')}>{admin ? 'Manage services' : 'Service catalogue'}</button><button disabled={busy} aria-pressed={tab === 'applications'} onClick={() => switchTab('applications')}>{admin ? 'Applications' : 'My applications'}</button><button disabled={busy || loading || detailLoading} onClick={refresh}>Refresh</button></div>
    {error && <div className="sm-error" role="alert">{error} <button disabled={busy} onClick={refresh}>{application ? 'Reload latest application' : 'Retry list'}</button></div>}{conflict && <p role="alert">The record changed. Reload the latest application and review it before retrying your action.</p>}{notice && <p role="status">{notice}</p>}{detailLoading && <p role="status">Loading application…</p>}
    {application ? <><button disabled={busy} onClick={() => switchTab('applications')}>Back to applications</button><ApplicationDetail key={`${application._id}:${detailRevision}`} application={application} admin={admin} request={request} run={run} busy={busy || detailLoading} onChange={applyApplication} onDirty={onDirty} /></>
      : editor ? <><button disabled={busy} onClick={() => setEditor(null)}>Back to services</button><ServiceEditor key={editor._id || 'new'} initial={editor} busy={busy} onSave={form => run(async () => { await request(form._id ? `/${form._id}` : '', { method: form._id ? 'PUT' : 'POST', body: JSON.stringify({ ...form, version: form.__v }) }); setEditor(null); setNotice('Service saved.'); await load(); })} /></>
      : selected ? <><button disabled={busy} onClick={() => setSelected(null)}>Back to catalogue</button><form className="sm-card" onSubmit={e => { e.preventDefault(); submit(); }}><h3>{selected.name} — {price(selected.pricing)}</h3><p>{selected.description}</p><p>{selected.instructions}</p><p>Each application is independent. The displayed price will be recorded with this application.</p><DynamicFields fields={selected.fields} answers={answers} setAnswers={setAnswers} setFiles={setFiles} errors={errors} disabled={busy} /><button disabled={busy}>{busy ? 'Submitting…' : 'Submit application'}</button></form></>
      : <>{tab === 'applications' && <div className="sm-grid"><label>Status<select value={filter} onChange={e => { setFilter(e.target.value); setPage(1); }}><option value="">All statuses</option>{Object.entries(labels).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label><label>From<input type="date" value={from} onChange={e => { setFrom(e.target.value); setPage(1); }} /></label><label>To<input type="date" value={to} onChange={e => { setTo(e.target.value); setPage(1); }} /></label></div>}
        {admin && tab === 'services' && <button onClick={() => setEditor(blank())}>Create service</button>}
        {loading ? <p role="status">Loading…</p> : <><div className="sm-grid">{items.map(item => <article className="sm-card" key={item._id}><h3>{tab === 'services' ? item.name : item.snapshot.name}</h3><p>{tab === 'services' ? price(item.pricing) : labels[item.status]}</p>{tab === 'applications' ? <><p><code>{item._id}</code></p><p>{new Date(item.createdAt).toLocaleDateString()}</p><button disabled={busy || detailLoading} onClick={() => openApplication(item._id)}>View application</button></>
          : <><p>{item.description}</p>{admin ? <><p>{item.status} · Form version {item.formVersion}</p><ServiceVisibility service={item}/><div className="sm-actions"><button disabled={busy} onClick={() => setEditor(item)}>Edit / preview</button><button disabled={busy} onClick={async () => { return ui.perform(`${item.status === 'published' ? 'Unpublish' : 'Publish'} ${item.name}?`, async () => {return await run(async () => { await request(`/${item._id}/publication`, { method: 'POST', body: JSON.stringify({ status: item.status === 'published' ? 'unpublished' : 'published', version: item.__v }) }); await load(); });}); }}>{item.status === 'published' ? 'Unpublish' : 'Publish'}</button></div></> : <button disabled={busy} onClick={() => { setSelected(item); setAnswers({}); setFiles({}); setErrors({}); submissionKey.current = key(); }}>View requirements and apply</button>}</>}
        </article>)}</div>{!items.length && <p>No {tab === 'services' ? 'services available' : 'applications found'}.</p>}<div className="sm-actions"><button disabled={page <= 1 || busy} onClick={() => setPage(p => p - 1)}>Previous</button><span>Page {page} · {meta.total} total</span><button disabled={page * 20 >= meta.total || busy} onClick={() => setPage(p => p + 1)}>Next</button></div></>}
      </>}
  </section>;
}
