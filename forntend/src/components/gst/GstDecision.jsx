import React, { useEffect, useState } from 'react';
import { apiUrl } from '../../utils/api';
import { boundedFetch } from '../../utils/portalRequests';
import './gstDecision.css';
export default function GstDecision({ value, onChange }) {
  const [detailsState, setDetailsState] = useState('loading'), [attempt, retry] = useState(0);
  const [fee, setFee] = useState(null);
  useEffect(() => {
    const controller = new AbortController(); setDetailsState('loading');
    boundedFetch(apiUrl('/api/sellers/gst-assistance/capabilities'), { signal: controller.signal }).then(async r => {
      const b = await r.json();
      if (!r.ok || b.success === false || !b.data) throw new Error('Invalid GST assistance details');
      if (!controller.signal.aborted) { setDetailsState('ready'); setFee(b.data.fee || null); }
    }).catch(() => { if (!controller.signal.aborted) setDetailsState('error'); });
    return () => controller.abort();
  }, [attempt]);
  const update = changes => onChange({ ...value, ...changes });
  const noGstin = ['assistance', 'without_gstin', 'no_gstin'].includes(value.choice);
  return <fieldset className="onboarding-form-group gst-decision">
    <legend>GST registration</legend>
    <p>Do you have a GSTIN?</p>
    <label><input type="radio" name="has-gstin" checked={value.choice === 'has_gstin'} onChange={() => update({ choice: 'has_gstin', consent: false })}/> Yes</label>{' '}
    <label><input type="radio" name="has-gstin" checked={noGstin} onChange={() => update({ choice: 'no_gstin', gstin: '', consent: false })}/> No</label>
    {value.choice === 'has_gstin' && <label style={{ display: 'block' }}>GSTIN
      <input className="onboarding-input" value={value.gstin || ''} maxLength={15} autoComplete="off" onChange={e => update({ gstin: e.target.value.toUpperCase() })}/>
      <small>15-character format check only. This does not verify registration.</small>
    </label>}
    {noGstin && <><p>Would you like to apply for GST registration through Bulkimart?</p>
      <label><input type="radio" name="gst-assistance" checked={value.choice === 'assistance'} onChange={() => update({ choice: 'assistance' })}/> Yes, Apply through Bulkimart</label>
      <label><input type="radio" name="gst-assistance" checked={value.choice === 'without_gstin'} onChange={() => update({ choice: 'without_gstin', consent: false })}/> No, Continue without GST</label>
      {detailsState === 'loading' && <p role="status">Loading GST assistance details…</p>}
      {detailsState === 'error' && <p role="alert">We couldn’t load GST assistance details. You can still request assistance. <button type="button" onClick={() => retry(n => n + 1)}>Retry details</button></p>}
      <p>You may submit your vendor application for review. Selling remains subject to vendor approval and applicable GST requirements. If GST registration is required for your business, obtain it before selling.</p>
    </>}
    {value.choice === 'assistance' && <section aria-label="GST registration assistance form">
      <h4>GST registration assistance request</h4>
      <p className="gst-decision-notice" role="status">Complete the details below, then continue to review and submit your seller application. Your GST assistance request will be submitted with it. You do not need to wait for the GST review to complete registration.</p>
      <p>{fee ? `Bulkimart service fee: ₹${(fee.amountPaise/100).toFixed(2)}. Pay after submitting your seller application, from the GST assistance section.` : 'The service fee is awaiting configuration by Bulkimart. You can complete your seller application now.'}</p>
      {fee && <p>{fee.terms}</p>}
      <p>We will use the business details already supplied in this application. This is a request for assistance, not a government GST application or approval. No fee is collected during registration.</p>
      <label>Contact person name<input className="onboarding-input" maxLength={100} value={value.contactName || ''} onChange={e => update({ contactName: e.target.value })}/></label>
      <label>What help do you need? (optional)<textarea className="onboarding-textarea" maxLength={2000} value={value.message || ''} onChange={e => update({ message: e.target.value })}/></label>
      <p>Do not enter passwords, Aadhaar numbers or OTPs. A reviewer will request specific information or private documents if needed.</p>
      <label><input type="checkbox" checked={value.consent === true} onChange={e => update({ consent: e.target.checked })}/> I request GST registration assistance and consent to Bulkimart using my submitted business/contact details and any documents I later provide for this request. This does not authorize government filing or guarantee registration.</label>
    </section>}
  </fieldset>;
}
