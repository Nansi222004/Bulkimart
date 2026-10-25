import React, { useEffect, useRef, useState } from 'react';
import { Package, ArrowLeft, ArrowDownUp, MapPin, CheckCircle2 } from 'lucide-react';
import ParcelLocationPicker from './ParcelLocationPicker';
import ParcelMap from './ParcelMap';
import { parcelRequest, parcelMoney, validParcelLocation, saveParcelPickup } from './parcelApi';
import { initialParcelJourney, parcelDraftKey, readParcelDraft, savedParcelAddress, parcelJourneyInput, parcelAddressError, parcelDraftSnapshot } from './parcelJourney';

export function ParcelPriceSummary({ pricing }) {
  return <dl className="parcel-price-summary"><dt>Base fare</dt><dd>{parcelMoney(pricing.basePaise)}</dd><dt>Distance charge</dt><dd>{parcelMoney(pricing.distancePaise)}</dd>
    {pricing.minimumAdjustmentPaise > 0 && <><dt>Minimum fare adjustment</dt><dd>{parcelMoney(pricing.minimumAdjustmentPaise)}</dd></>}
    <dt>Tax (included)</dt><dd>{parcelMoney(pricing.taxPaise)}</dd><dt><strong>Total payable</strong></dt><dd><strong>{parcelMoney(pricing.totalPaise)}</strong></dd></dl>;
}
export function ParcelRouteSummary({ quote }) {
  return <p className="parcel-route-summary">{quote.route?.provider === 'mock' && <strong>Simulated test route · </strong>}{(quote.pricing.distanceMetres / 1000).toFixed(2)} km{quote.route?.durationSeconds > 0 ? ' · about ' + Math.ceil(quote.route.durationSeconds / 60) + ' min travel' : ' · travel time unavailable'}<small>Travel time is an estimate, not a confirmed pickup ETA.</small>{quote.route?.provider === 'google_routes' && <small className="parcel-google-attribution" translate="no">Google Maps</small>}</p>;
}
export default function ParcelBookingFlow({ policy, flags, addresses = [], profile, onBooked }) {
  const storageKey = parcelDraftKey(profile?._id);
  const [state, setState] = useState(() => readParcelDraft(storageKey, initialParcelJourney(profile, policy)));
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [now, setNow] = useState(Date.now());
  const generation = useRef(0), lock = useRef(false), mounted = useRef(true), controller = useRef(null), latest = useRef(state);
  latest.current = state;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; generation.current++; controller.current?.abort(); }; }, []);
  useEffect(() => {
    if (!storageKey) return;
    try { sessionStorage.setItem(storageKey, JSON.stringify({ version: 1, at: Date.now(), state: parcelDraftSnapshot(state) })); } catch { /* In-memory state and server idempotency still apply. */ }
  }, [state, storageKey]);
  useEffect(() => {
    if (!state.quote) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [state.quote?._id]);
  const change = patch => { generation.current++; controller.current?.abort(); setState(s => ({ ...s, ...patch, quote: null, terms: false })); setError(''); setNotice(''); };
  const updateAddress = (kind, value) => change({ [kind]: value, ...(validParcelLocation(value) ? { editing: null } : {}) });
  const run = async action => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(''); setNotice('');
    try { await action(); } catch (e) { if (mounted.current && e.name !== 'AbortError') setError(e.message); }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  };
  const requestQuote = async () => {
    const input = parcelJourneyInput(latest.current, policy), id = ++generation.current;
    controller.current?.abort(); controller.current = new AbortController();
    const body = await parcelRequest('customer', '/quotes', { method: 'POST', body: JSON.stringify(input), signal: controller.current.signal });
    if (!mounted.current || generation.current !== id) return null;
    const quote = body.data;
    if (!quote?._id || !Number.isSafeInteger(quote.pricing?.totalPaise) || quote.pricing.totalPaise <= 0 || !(new Date(quote.expiresAt).getTime() > Date.now())) throw new Error('A valid delivery quote could not be loaded. Please retry.');
    setNow(Date.now()); return quote;
  };
  const calculate = () => run(async () => {
    const quote = await requestQuote();
    if (quote) setState(s => ({ ...s, quote, step: 2, terms: false }));
  });
  const expired = state.quote && new Date(state.quote.expiresAt).getTime() <= now;
  const cashPoints = state.quote?.cashCollectionPoints || (policy.cashCollectionPoint === 'customer_choice' ? ['pickup', 'delivery'] : [policy.cashCollectionPoint === 'pickup' ? 'pickup' : 'delivery']);
  const cashPoint = state.pending?.payload.paymentMethod === 'pay_driver' ? state.pending.payload.cashCollectionPoint || 'delivery' : cashPoints.includes(state.cashCollectionPoint) ? state.cashCollectionPoint : cashPoints.includes('delivery') ? 'delivery' : cashPoints[0];
  const confirmBooking = () => run(async () => {
    let attempt = state.pending;
    if (!attempt) {
      if (!state.terms || !state.paymentMethod) throw new Error('Choose a payment method and accept the delivery terms.');
      let quote = state.quote;
      if (!quote) throw new Error('Calculate your delivery quote again.');
      if (new Date(quote.expiresAt).getTime() - Date.now() < 30000) {
        const fresh = await requestQuote();
        if (!fresh) return;
        setState(s => ({ ...s, quote: fresh, terms: false }));
        setNotice('Your quote has been refreshed. Review the current fare and accept the terms before booking.');
        return;
      }
      attempt = { key: crypto.randomUUID(), payload: { quoteId: quote._id, policyVersion: quote.pricing.policyVersion, paymentMethod: state.paymentMethod, ...(state.paymentMethod === 'pay_driver' ? { cashCollectionPoint: cashPoint } : {}), acceptTerms: true } };
      const snapshot = { ...latest.current, pending: attempt };
      // Persist before sending: a timeout/reload must retry the same quote and key.
      if (storageKey) {
        try { sessionStorage.setItem(storageKey, JSON.stringify({ version: 1, at: Date.now(), state: parcelDraftSnapshot(snapshot) })); } catch { /* Same mounted instance retains the attempt. */ }
      }
      setState(snapshot);
    }
    let body;
    try {
      body = await parcelRequest('customer', '/bookings', { method: 'POST', headers: { 'Idempotency-Key': attempt.key }, body: JSON.stringify(attempt.payload) });
    } catch (e) {
      if (e.status === 409 && /Quotation expired|Policy changed/i.test(e.message)) setState(s => ({ ...s, pending: null, quote: null, step: 1, terms: false }));
      if (e.status && e.status < 500 && e.status !== 409) setState(s => ({ ...s, pending: null }));
      throw new Error(e.message + ' If confirmation was interrupted, retry safely or check Delivery history.');
    }
    if (!body.data?._id || !body.data.reference) throw new Error('Booking confirmation was interrupted. Retry safely or check Delivery history.');
    if (storageKey) { try { sessionStorage.removeItem(storageKey); } catch { /* Storage is optional. */ } }
    if (mounted.current) onBooked(body.data);
  });
  const back = () => { if (state.pending) return; setError(''); setState(s => ({ ...s, step: Math.max(0, s.step - 1) })); };
  const saved = kind => addresses.length > 0 && <label>Saved {kind === 'pickup' ? 'pickup' : 'drop'} address<select defaultValue="" onChange={e => { const a = addresses.find(a => a._id === e.target.value); if (a) updateAddress(kind, savedParcelAddress(a)); }}><option value="">Choose a saved address</option>{addresses.map(a => <option key={a._id} value={a._id}>{a.label || a.name}: {a.line1}</option>)}</select></label>;
  const locationCard = kind => <article className={'parcel-location-card ' + kind}><div className="parcel-location-title"><MapPin size={20} aria-hidden="true"/><h2>{kind === 'pickup' ? 'Pickup' : 'Drop'}</h2><button type="button" className="parcel-text-button" disabled={busy} onClick={() => setState(s => ({ ...s, editing: kind }))}>{validParcelLocation(state[kind]) ? 'Edit' : 'Choose location'}</button></div><p>{state[kind].address || (kind === 'pickup' ? 'Where should we collect your parcel?' : 'Where is your parcel going?')}</p>{state[kind].pincode && <small>Pincode: {state[kind].pincode}</small>}{state[kind].approximate && <small>Approximate address — confirm the building details.</small>}{saved(kind)}</article>;
  const detailFields = kind => <fieldset className="parcel-detail-card"><legend>{kind === 'pickup' ? 'Pickup details' : 'Drop details'}</legend>{[
    ['building', 'House / flat / building (optional)'], ['address', 'Street, locality and city'], ['landmark', 'Landmark (optional)'], ['pincode', 'Pincode'], ['name', 'Contact name'], ['phone', 'Contact phone'],
  ].map(([key, title]) => <label key={key}>{title}<input name={kind + '.' + key} value={state[kind][key] || ''} required={!['building', 'landmark'].includes(key)} maxLength={key === 'address' ? 400 : key === 'pincode' ? 6 : key === 'phone' ? 16 : 100} type={key === 'phone' ? 'tel' : 'text'} inputMode={key === 'pincode' ? 'numeric' : undefined} pattern={key === 'phone' ? '\\+?[1-9][0-9]{9,14}' : key === 'pincode' ? '[0-9]{6}' : undefined} autoComplete={key === 'phone' ? 'tel' : key === 'name' ? 'name' : 'off'} onChange={e => change({ [kind]: { ...state[kind], [key]: e.target.value } })}/></label>)}<label>Address label<select value={state[kind].label} onChange={e => change({ [kind]: { ...state[kind], label: e.target.value } })}>{['Home', 'Work', 'Other'].map(l => <option key={l}>{l}</option>)}</select></label></fieldset>;
  const addressSummary = <div className="parcel-address-summary">{['pickup', 'dropoff'].map(kind => <div key={kind}><strong>{kind === 'pickup' ? 'Pickup' : 'Drop'}</strong><p>{[state[kind].building, state[kind].address, state[kind].landmark].filter(Boolean).join(', ')}</p><small>{state[kind].name} · {state[kind].phone}</small></div>)}</div>;
  return <div className="parcel-booking-flow">
    <header className="parcel-flow-header">{state.step > 0 ? <button type="button" aria-label="Back to previous step" disabled={busy || !!state.pending} onClick={back}><ArrowLeft size={20}/></button> : <a href="/" aria-label="Back to home"><ArrowLeft size={22}/></a>}<div><h2>Send a Parcel</h2><p>Doorstep pickup and delivery</p></div><Package size={36} aria-hidden="true"/></header>
    <ol className="parcel-progress" aria-label="Booking progress">{['Locations', 'Details', 'Delivery', 'Review'].map((title, i) => <li key={title} aria-current={state.step === i ? 'step' : undefined} className={state.step >= i ? 'reached' : ''}><span>{i + 1}</span>{title}</li>)}</ol>
    {state.step <= 1 && <p className="parcel-location-status">Set your parcel pickup and drop here. Changing the shopping delivery location does not change these addresses. Both pins and pincodes must be in an approved parcel service area.</p>}
    {error && <p role="alert" className="parcel-error">{error}</p>}{notice && <p role="status" className="parcel-notice">{notice}</p>}
    {state.step === 0 && <form onSubmit={e => { e.preventDefault(); if (validParcelLocation(state.pickup) && validParcelLocation(state.dropoff)) setState(s => ({ ...s, step: 1 })); }}>
      <div className="parcel-location-stack">{locationCard('pickup')}<button type="button" className="parcel-switch" aria-label="Switch pickup and drop locations" disabled={busy} onClick={() => change({ pickup: state.dropoff, dropoff: state.pickup, editing: null })}><ArrowDownUp size={20}/><span>Switch</span></button>{locationCard('dropoff')}</div>
      {state.editing && <section className="parcel-card"><h3>{state.editing === 'pickup' ? 'Choose pickup location' : 'Choose drop location'}</h3><p>Use your current location to find a nearby address, or search and confirm a pin.</p><ParcelLocationPicker key={state.editing} confirmLocation showMap label={state.editing === 'pickup' ? 'Search pickup address' : 'Search drop address'} value={state[state.editing]} initialQuery={state[state.editing].address} onChange={v => updateAddress(state.editing, v)}/></section>}
      <div className="parcel-sticky-action"><button className="parcel-primary" disabled={busy || !validParcelLocation(state.pickup) || !validParcelLocation(state.dropoff)}>Confirm locations</button><small>Delivery availability is checked with your parcel details.</small></div>
    </form>}
    {state.step === 1 && <form onSubmit={e => { e.preventDefault(); calculate(); }}>
      <div className="parcel-grid">{detailFields('pickup')}{detailFields('dropoff')}</div>
      <button type="button" disabled={busy} onClick={()=>run(async()=>{const message=parcelAddressError(state.pickup);if(message)throw new Error(message);await saveParcelPickup(state.pickup);setNotice('Pickup location saved to your addresses using your profile contact. Recipient contact details stay on this booking.');})}>Save pickup to my addresses</button>
      <section className="parcel-card"><h2>What are you sending?</h2><p>Up to {policy.maxWeightKg} kg · Each side up to {policy.maxDimensionCm} cm</p><label>Parcel category<select name="category" value={state.parcel.category} onChange={e => change({ parcel: { ...state.parcel, category: e.target.value } })}>{policy.categories.map(c => <option key={c}>{c}</option>)}</select></label>
        <label>Parcel description<textarea name="description" required maxLength={500} value={state.parcel.description} onChange={e => change({ parcel: { ...state.parcel, description: e.target.value } })}/></label>
        <div className="parcel-measurements">{[['weightKg', 'Weight (kg)', policy.maxWeightKg], ...['length', 'width', 'height'].map(k => [k, k[0].toUpperCase() + k.slice(1) + ' (cm)', policy.maxDimensionCm])].map(([key, title, max]) => <label key={key}>{title}<input required name={key} type="number" inputMode="decimal" step="0.01" min="0.01" max={max} value={state.parcel[key]} onChange={e => change({ parcel: { ...state.parcel, [key]: e.target.value } })}/></label>)}</div>
        <label>Pickup instructions (optional)<textarea name="instructions" maxLength={500} value={state.parcel.instructions} onChange={e => change({ parcel: { ...state.parcel, instructions: e.target.value } })}/></label>
        <p>Prohibited items: {policy.prohibitedItems.join(', ')}.</p><label className="parcel-check"><input type="checkbox" required checked={state.parcel.acceptRestrictions} onChange={e => change({ parcel: { ...state.parcel, acceptRestrictions: e.target.checked } })}/>My parcel meets these restrictions and limits.</label>
      </section><div className="parcel-sticky-action"><button className="parcel-primary" disabled={busy}>{busy ? 'Checking route and delivery fee…' : 'Confirm drop details'}</button></div>
    </form>}
    {state.step >= 2 && state.quote && <>
      {state.step === 2 && <ParcelMap pickup={state.pickup} dropoff={state.dropoff} route={state.quote.route}/>}<ParcelRouteSummary quote={state.quote}/>{addressSummary}
      {state.step === 2 ? <><section className="parcel-card"><h2>Delivery service</h2><button className="parcel-service-option selected" aria-pressed="true" type="button"><Package size={38} aria-hidden="true"/><span><strong>{state.quote.service?.name || 'Doorstep delivery'}</strong><small>Up to {state.quote.service?.maxWeightKg || policy.maxWeightKg} kg · {state.quote.service?.maxDimensionCm || policy.maxDimensionCm} cm per side</small><small>Partner and pickup time confirmed after booking.</small></span><strong>{parcelMoney(state.quote.pricing.totalPaise)}</strong><CheckCircle2 size={20} aria-hidden="true"/></button></section><div className="parcel-sticky-action"><button className="parcel-primary" disabled={busy || expired} onClick={() => setState(s => ({ ...s, step: 3 }))}>Review fare · {parcelMoney(state.quote.pricing.totalPaise)}</button></div></> :
        <><form id="parcel-booking-review" onSubmit={e => { e.preventDefault(); confirmBooking(); }}><section className="parcel-card"><h2>Review your booking</h2><p>{state.quote.service?.name || 'Doorstep delivery'} · {state.parcel.category} · {state.parcel.weightKg} kg · {state.parcel.length} × {state.parcel.width} × {state.parcel.height} cm</p><p>{state.parcel.description}</p><ParcelPriceSummary pricing={state.quote.pricing}/><p className="parcel-terms">{state.quote.terms}</p>
          <fieldset className="parcel-payment-options" disabled={busy || !!state.pending}><legend>Payment method</legend>{flags.online_payment && <label className="parcel-check"><input type="radio" name="paymentMethod" required value="online" checked={state.paymentMethod === 'online'} onChange={() => setState(s => ({ ...s, paymentMethod: 'online', terms: false }))}/><span>Pay online with Razorpay</span></label>}{flags.pay_driver && policy.payDriverEnabled && policy.payDriverCategories?.includes(state.parcel.category) && <label className="parcel-check"><input type="radio" name="paymentMethod" required value="pay_driver" checked={state.paymentMethod === 'pay_driver'} onChange={() => setState(s => ({ ...s, paymentMethod: 'pay_driver', terms: false }))}/><span>Cash to delivery partner</span></label>}</fieldset>
          {state.paymentMethod === 'pay_driver' && <><fieldset className="parcel-payment-options" disabled={busy || !!state.pending}><legend>Pay at</legend>{[['pickup','Pickup · sender pays'],['delivery','Drop · recipient pays']].map(([point,title]) => <label key={point} className="parcel-check"><input type="radio" name="cashCollectionPoint" value={point} disabled={!cashPoints.includes(point)} checked={cashPoint === point} onChange={() => setState(s => ({ ...s, cashCollectionPoint: point, terms: false }))}/><span>{title}{!cashPoints.includes(point) && <small>Unavailable under the current delivery policy</small>}</span></label>)}</fieldset><p>Keep {parcelMoney(state.quote.pricing.totalPaise)} ready at {cashPoint === 'pickup' ? 'pickup. The sender pays before handover' : 'drop-off. The recipient pays before delivery'}. Only the delivery fee is collected, not the parcel value.</p></>}
          <label className="parcel-check"><input type="checkbox" required disabled={busy || !!state.pending} checked={state.terms} onChange={e => setState(s => ({ ...s, terms: e.target.checked }))}/>I accept the delivery, payment and cancellation terms.</label>
        </section></form><div className="parcel-sticky-action"><button type="submit" form="parcel-booking-review" className="parcel-primary" disabled={busy || (!state.pending && (!state.terms || !state.paymentMethod))}>{busy ? 'Confirming your booking…' : state.pending ? 'Retry booking safely' : (state.paymentMethod === 'online' ? 'Book & Pay · ' : 'Book Parcel · ') + parcelMoney(state.quote.pricing.totalPaise)}</button><small>Booking is created only when you confirm here.</small></div></>}
      {!state.pending && <p className="parcel-quote-status" role="status">{expired ? 'Your quote has expired. ' : 'Fare valid until ' + new Date(state.quote.expiresAt).toLocaleTimeString() + '. '}<button type="button" disabled={busy} onClick={calculate}>{busy ? 'Refreshing…' : 'Refresh quote'}</button></p>}
      {state.pending && <p role="status">A confirmation attempt is in progress. Retry uses the same booking identity; check Delivery history if the connection was interrupted.</p>}
    </>}
  </div>;
}
