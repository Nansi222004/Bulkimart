import React, { useEffect, useState, useRef } from 'react';
import { gstApi, gstLabels, gstTransitions } from './gstApi';
import GstFeeEditor from './GstFeeEditor';
import GstPaymentPanel from './GstPaymentPanel';
import GstIntakeStatus from './GstIntakeStatus';
import ModalPortal from '../ModalPortal';
import { isTopModal } from '../../utils/modalLayer';
import './gstPayments.css';
export default function GstAssistance({ admin = false }) {
  const [row, setRow] = useState(null), [rows, setRows] = useState([]), [filter, setFilter] = useState('');
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [selectedRequest, setSelectedRequest] = useState(null), [detailLoading, setDetailLoading] = useState(false);
  const [message, setMessage] = useState(''), [note, setNote] = useState(''), [status, setStatus] = useState('');
  const [files, setFiles] = useState([]), [verifiedGstin, setVerifiedGstin] = useState(''), [reference, setReference] = useState(''), [attested, setAttested] = useState(false);
  const generation = useRef(0);
  function resetForm() { setStatus(''); setMessage(''); setNote(''); setFiles([]); setVerifiedGstin(''); setReference(''); setAttested(false); }
  const base = id => admin ? `/${id}` : '/me';
  async function openRequest(request) {
    const current = ++generation.current;
    setSelectedRequest(request); setRow(null); setError(''); setDetailLoading(true); resetForm();
    try {
      const detail = await gstApi(true, `/${request._id}`);
      if (current === generation.current) setRow(detail);
    } catch (e) { if (current === generation.current) setError(e.message); }
    finally { if (current === generation.current) setDetailLoading(false); }
  }
  function closeRequest() {
    if (busy) return;
    generation.current++;
    setSelectedRequest(null); setRow(null); setError(''); setDetailLoading(false); resetForm();
  }
  async function load() {
    const current = ++generation.current;
    setError(''); setLoading(true);
    try { const d = await gstApi(admin, admin ? `?page=${page}&status=${filter}` : '/me'); if (current !== generation.current) return;
      if (admin) { setRows(d.requests); setRow(null); setSelectedRequest(null); } else setRow(d); resetForm();
    } catch (e) { if (current !== generation.current) return; setError(e.message); }
    finally { if (current === generation.current) setLoading(false); }
  }
  useEffect(() => { let active = true; const current = ++generation.current;
    setLoading(true); setError('');
    if (admin) { setSelectedRequest(null); setRow(null); setDetailLoading(false); }
    async function initial() {
      try { const data = await gstApi(admin, admin ? `?page=${page}&status=${filter}` : '/me');
        if (active && current === generation.current) { if (admin) { setRows(data.requests); setRow(null); } else setRow(data); resetForm(); setError(''); }
      } catch (e) { if (active && current === generation.current) setError(e.message); }
      finally { if (active && current === generation.current) setLoading(false); }
    } void initial(); return () => { active = false; generation.current++; };
  }, [admin, filter, page]);
  async function action(actionName) {
    if (!row || busy) return;
    const current = generation.current;
    setBusy(true); setError('');
    const body = new FormData(); body.append('action', actionName); body.append('version', row.version);
    body.append('message', message); body.append('internalNote', note); body.append('status', status);
    if (actionName === 'assign') body.append('reviewerId', 'self');
    if (status === 'completed') { body.append('verifiedGstin', verifiedGstin); body.append('verificationReference', reference); body.append('independentlyVerified', String(attested)); }
    for (const file of files) body.append('documents', file);
    try {
      const updated = await gstApi(admin, `${base(row._id)}/actions`, { method: 'POST', body });
      if (current !== generation.current) return;
      setRow(updated);
      if (admin) setRows(items => items.map(item => item._id === updated._id ? updated : item).filter(item => !filter || item.status === filter));
      setFiles([]); setMessage(''); setNote('');
    }
    catch (e) { if (current === generation.current) setError(e.message); } finally { setBusy(false); }
  }
  async function download(file) {
    try { const blob = await gstApi(admin, `${base(row._id)}/files/${file.fileId}`, { download: true });
      const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = file.name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { setError(e.message); }
  }
  const detail = row && <div className="gst-request-detail"><h3>{gstLabels[row.status]}</h3><p>{row.details.businessName} · {row.details.contactName} {row.details.contactPhone} · Submitted {new Date(row.submittedAt).toLocaleDateString()}</p>
      <p>{row.details.state} {row.details.pincode}</p><p>{row.details.message}</p>
      <p>Assistance does not grant permission to sell or represent government approval. Vendor onboarding is reviewed separately.</p>
      <GstPaymentPanel key={`${row._id}:${row.billing?.version || 0}`} row={row} admin={admin} onUpdated={load}/>
      {row.requestedCorrections && <p><strong>Requested next steps:</strong> {row.requestedCorrections}</p>}
      {row.status === 'pending' && <p>Awaiting a reviewer. {['pending','paid','failed','refunded','partial_refund'].includes(row.billing?.status) ? 'Contact Bulkimart for cancellation or payment review.' : 'You can cancel this pending assistance request.'}</p>}
      {row.status === 'under_review' && <p>A reviewer is assessing your assistance request. Refresh for next steps.</p>}
      {['rejected', 'cancelled'].includes(row.status) && <p>Contact support if you need to submit another request.</p>}
      {row.verification && <p>GSTIN reviewed by admin: {row.verification.gstin}. This workflow does not automatically change your seller GST record.</p>}
      {!!row.files.length && <ul>{row.files.map(f => <li key={f.fileId}><button type="button" onClick={() => download(f)}>Download {f.name}</button></li>)}</ul>}
      {admin && <p>Reviewer: {row.reviewerId || 'Unassigned'} <button disabled={busy} onClick={() => action('assign')}>Assign to me</button></p>}
      {(admin || row.status === 'additional_information_required') && <>
        <label>{admin ? 'Vendor-visible next steps / reason' : 'Response to requested information'}<textarea maxLength={2000} value={message} onChange={e => setMessage(e.target.value)}/></label>
        {admin && <><label>Internal note (never sent to vendor)<textarea maxLength={2000} value={note} onChange={e => setNote(e.target.value)}/></label><button disabled={busy || !note.trim() || !!files.length} onClick={() => action('note')}>Add internal note</button>
          <label>Assistance status<select value={status} onChange={e => setStatus(e.target.value)}><option value="">Choose a transition</option>{(gstTransitions[row.status] || []).map(s => <option key={s} value={s}>{gstLabels[s]}</option>)}</select></label>
        </>}
        <label>{admin ? 'Private verification evidence (completion only)' : 'Only documents requested by your reviewer'}<input key={`${row._id}:${row.version}`} type="file" multiple accept="application/pdf,image/jpeg,image/png" onChange={e => { const selected = [...e.target.files]; if (selected.length > 3 || selected.some(f => f.size > 5 * 1024 * 1024)) { setError('Choose at most three PDF/JPEG/PNG files, 5 MB each.'); setFiles([]); e.target.value = ''; } else setFiles(selected); }}/></label>
        {admin && status === 'completed' && <><label>GSTIN independently checked on GST portal<input value={verifiedGstin} maxLength={15} onChange={e => setVerifiedGstin(e.target.value.toUpperCase())}/></label>
          <label>Reference for actual verification evidence<input value={reference} maxLength={500} onChange={e => setReference(e.target.value)}/></label>
          <label><input type="checkbox" checked={attested} onChange={e => setAttested(e.target.checked)}/> I independently checked the GSTIN on the official GST portal and attached the actual verification evidence.</label></>}
        <button disabled={busy || !message.trim() || (admin && !status)} onClick={() => action(admin ? 'transition' : 'respond')}>{admin ? 'Save assistance status' : 'Send additional information'}</button>
      </>}
      {!admin && row.status === 'pending' && <button disabled={busy || ['pending','paid','failed','refunded','partial_refund'].includes(row.billing?.status)} onClick={() => action('cancel')}>Cancel pending assistance request</button>}
      <h4>Status history</h4><ol>{row.events.map((event, i) => <li key={i}>{new Date(event.at).toLocaleString()} — {event.action}: {gstLabels[event.to]}{event.vendorMessage && <p>{event.vendorMessage}</p>}{admin && event.internalNote && <p>Internal: {event.internalNote}</p>}</li>)}</ol>
    </div>;
  if (!admin && !row && !error) return null;
  return <section className={`gst-registration-assistance${admin ? ' gst-admin-workspace' : ' gst-seller-workspace'}`} aria-label="GST registration assistance">
    <header className="gst-workspace-heading"><h2>GST Registration Assistance</h2>
      {admin && <p>Review seller requests, track service payments and manage registration assistance.</p>}
    </header>
    {admin && <><GstIntakeStatus/><GstFeeEditor/></>}
    {error && (!admin || !selectedRequest) && <p role="alert">{error}</p>}
    <div className="gst-toolbar"><button type="button" disabled={busy || loading} onClick={load}>Refresh assistance status</button>
    {admin && <label>Filter by status<select value={filter} disabled={busy || loading} onChange={e => { setFilter(e.target.value); setPage(1); }}><option value="">All</option>{Object.entries(gstLabels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>}
    </div>
    {loading && <p role="status" className="gst-empty-state">Loading GST assistance…</p>}
    {admin && <>
      {!loading && !error && rows.length === 0 && <div className="gst-empty-state"><h3>No GST assistance requests</h3><p>{filter || page > 1 ? 'No requests on this page. Change the filter or go to the previous page.' : 'Requests appear here when a seller submits registration with “Apply through Bulkimart” selected.'}</p></div>}
      <ul className="gst-request-list">{rows.map(r => <li key={r._id}><button type="button" aria-haspopup="dialog" aria-pressed={selectedRequest?._id === r._id} disabled={busy || loading} onClick={() => openRequest(r)}><strong>{r.details.businessName}</strong><span>{gstLabels[r.status]}</span><small>{r.details.contactName} · {r.billing ? `Payment: ${r.billing.status}` : 'No fee recorded'}</small></button></li>)}</ul>
      <nav className="gst-pagination" aria-label="GST request pages"><button disabled={busy || loading || page === 1} onClick={() => setPage(page - 1)}>Previous</button><span> Page {page} </span><button disabled={busy || loading || rows.length < 30} onClick={() => setPage(page + 1)}>Next</button></nav>
    </>}
    {!admin && detail}
    {admin && selectedRequest && <ModalPortal className="gst-details-overlay" onClick={e => { if (e.target === e.currentTarget) closeRequest(); }} onKeyDown={e => { if (e.key === 'Escape' && isTopModal(e.currentTarget)) { e.preventDefault(); e.stopPropagation(); closeRequest(); } }}>
      <section className="gst-registration-assistance gst-details-dialog" role="dialog" aria-modal="true" aria-labelledby="gst-request-dialog-title" aria-busy={detailLoading || busy}>
        <header className="gst-details-header">
          <div><h2 id="gst-request-dialog-title">GST assistance details</h2><p>{selectedRequest.details.businessName}</p></div>
          <button type="button" onClick={closeRequest} disabled={busy} aria-label="Close GST assistance details">✕</button>
        </header>
        <div className="gst-details-body">
          {detailLoading && <p role="status">Loading request details…</p>}
          {error && <p role="alert">{error}</p>}
          {!detailLoading && !row && error && <button type="button" onClick={() => openRequest(selectedRequest)}>Retry request</button>}
          {detail}
        </div>
      </section>
    </ModalPortal>}
  </section>;
}
