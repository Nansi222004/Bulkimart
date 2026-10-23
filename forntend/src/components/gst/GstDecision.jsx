import React, { useEffect, useState } from 'react';
import { apiUrl } from '../../utils/api';
export default function GstDecision({ value, onChange }) {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => { let active = true;
    fetch(apiUrl('/api/sellers/gst-assistance/capabilities'), { signal: AbortSignal.timeout(10000) }).then(r => r.json()).then(b => { if (active) setEnabled(b.data?.enabled === true); }).catch(() => {});
    return () => { active = false; };
  }, []);
  const update = changes => onChange({ ...value, ...changes });
  const noGstin = ['assistance', 'without_gstin', 'no_gstin'].includes(value.choice);
  return <fieldset className="onboarding-form-group" style={{ marginTop: 20 }}>
    <legend>GST registration</legend>
    <p>Do you have a GSTIN?</p>
    <label><input type="radio" name="has-gstin" checked={value.choice === 'has_gstin'} onChange={() => update({ choice: 'has_gstin', consent: false })}/> Yes</label>{' '}
    <label><input type="radio" name="has-gstin" checked={noGstin} onChange={() => update({ choice: 'no_gstin', gstin: '', consent: false })}/> No</label>
    {value.choice === 'has_gstin' && <label style={{ display: 'block' }}>GSTIN
      <input className="onboarding-input" value={value.gstin || ''} maxLength={15} autoComplete="off" onChange={e => update({ gstin: e.target.value.toUpperCase() })}/>
      <small>15-character format check only. This does not verify registration.</small>
    </label>}
    {noGstin && <><p>Would you like to apply for GST registration through Bulkimart?</p>
      <label><input type="radio" name="gst-assistance" checked={value.choice === 'assistance'} disabled={!enabled} onChange={() => update({ choice: 'assistance' })}/> Yes, Apply through Bulkimart</label><br/>
      <label><input type="radio" name="gst-assistance" checked={value.choice === 'without_gstin'} onChange={() => update({ choice: 'without_gstin', consent: false })}/> No, Continue without GST</label>
      {!enabled && <p>GST registration assistance is not currently accepting requests.</p>}
      <p>You may submit your vendor application for review. Selling remains subject to vendor approval and applicable GST requirements. If GST registration is required for your business, obtain it before selling.</p>
    </>}
    {value.choice === 'assistance' && <section aria-label="GST registration assistance form">
      <h4>GST registration assistance request</h4>
      <p>We will use the business details already supplied in this application. This is a request for assistance, not a government GST application or approval. No fee is collected here.</p>
      <label>Contact person name<input className="onboarding-input" maxLength={100} value={value.contactName || ''} onChange={e => update({ contactName: e.target.value })}/></label>
      <label>What help do you need? (optional)<textarea className="onboarding-textarea" maxLength={2000} value={value.message || ''} onChange={e => update({ message: e.target.value })}/></label>
      <p>Do not enter passwords, Aadhaar numbers or OTPs. A reviewer will request specific information or private documents if needed.</p>
      <label><input type="checkbox" checked={value.consent === true} onChange={e => update({ consent: e.target.checked })}/> I request GST registration assistance and consent to Bulkimart using my submitted business/contact details and any documents I later provide for this request. This does not authorize government filing or guarantee registration.</label>
    </section>}
  </fieldset>;
}
