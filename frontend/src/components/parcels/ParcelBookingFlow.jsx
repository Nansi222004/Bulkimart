import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowDownUp, ChevronRight, ChevronDown, Clock, Info, Pencil, LocateFixed, Heart, TriangleAlert, X } from 'lucide-react';
import { VEHICLE_ART_VIEWBOX, vehicleArt } from './vehicleArt';
import ParcelLocationPicker from './ParcelLocationPicker';
import ParcelMap from './ParcelMap';
import { parcelRequest, parcelMoney, validParcelLocation, saveParcelPickup } from './parcelApi';
import { initialParcelJourney, parcelDraftKey, readParcelDraft, writeParcelDraft, savedParcelAddress, bookedParcelAddress, parcelJourneyInput, parcelAddressError, parcelGoodsError, parcelVehicleMode, PARCEL_STEPS } from './parcelJourney';

// Flat colour illustrations (vehicleArt.js), shared shape-for-shape with the customer app. `size` is the
// picture's height; it is 1.5× as wide.
export function ParcelVehicleIcon({ icon, size = 34 }) {
  const Shape = { path: 'path', rect: 'rect', circle: 'circle', ellipse: 'ellipse' };
  return <span className={'parcel-vehicle-icon icon-' + (icon || 'parcel')} aria-hidden="true">
    <svg viewBox={VEHICLE_ART_VIEWBOX} width={Math.round(size * 1.5)} height={size} focusable="false">
      {vehicleArt(icon).map(({ t, ...attrs }, i) => React.createElement(Shape[t], { key: i, ...attrs }))}
    </svg>
  </span>;
}
/** Whole rupees when the fare has no paise (₹160), otherwise two decimals. */
export const parcelRupees = paise => Number.isFinite(paise) ? (paise % 100 ? parcelMoney(paise) : '₹' + paise / 100) : '';
export function ParcelPriceSummary({ pricing }) {
  return <dl className="parcel-price-summary"><dt>Base fare{pricing.includedKm > 0 ? ` (first ${pricing.includedKm} km)` : ''}</dt><dd>{parcelMoney(pricing.basePaise)}</dd><dt>Distance charge</dt><dd>{parcelMoney(pricing.distancePaise)}</dd>
    {pricing.weightSurchargePaise > 0 && <><dt>Weight surcharge</dt><dd>{parcelMoney(pricing.weightSurchargePaise)}</dd></>}
    {pricing.handlingFeePaise > 0 && <><dt>Handling fee</dt><dd>{parcelMoney(pricing.handlingFeePaise)}</dd></>}
    {pricing.minimumAdjustmentPaise > 0 && <><dt>Minimum fare adjustment</dt><dd>{parcelMoney(pricing.minimumAdjustmentPaise)}</dd></>}
    <dt>Tax (included)</dt><dd>{parcelMoney(pricing.taxPaise)}</dd><dt><strong>Total payable</strong></dt><dd><strong>{parcelMoney(pricing.totalPaise)}</strong></dd></dl>;
}
export function ParcelRouteSummary({ quote }) {
  return <p className="parcel-route-summary">{quote.route?.provider === 'mock' && <strong>Simulated test route · </strong>}{(quote.pricing.distanceMetres / 1000).toFixed(2)} km{quote.route?.durationSeconds > 0 ? ' · about ' + Math.ceil(quote.route.durationSeconds / 60) + ' min travel' : ' · travel time unavailable'}{quote.route?.provider === 'google_routes' && <small className="parcel-google-attribution" translate="no">Google Maps</small>}</p>;
}
/** Bottom sheet used for vehicle details, goods, payment and lists. */
export function ParcelSheet({ title, onClose, children, footer, label }) {
  useEffect(() => { const key = e => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key); }, [onClose]);
  return <div className="parcel-sheet-overlay" onClick={onClose}><section className="parcel-sheet" role="dialog" aria-modal="true" aria-label={label || title} onClick={e => e.stopPropagation()}>
    <button type="button" className="parcel-sheet-close" aria-label="Close" onClick={onClose}><X size={20}/></button>
    {title && <h2>{title}</h2>}
    <div className="parcel-sheet-body">{children}</div>
    {footer}
  </section></div>;
}
// The admin-published policy text, with the rules the app enforces spelled out.
export function ParcelTermsDialog({ terms, policy, onClose }) {
  useEffect(() => { const key = e => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key); }, [onClose]);
  const instant = (policy.customerCancel || 'instant_before_assignment') === 'instant_before_assignment';
  return <div className="parcel-terms-overlay" onClick={onClose}><section className="parcel-terms-dialog" role="dialog" aria-modal="true" aria-labelledby="parcel-terms-title" onClick={e => e.stopPropagation()}>
    <header><h2 id="parcel-terms-title">Delivery, payment and cancellation terms</h2><button type="button" aria-label="Close terms" onClick={onClose}>×</button></header>
    <div className="parcel-terms-body">
      {terms && <p className="parcel-terms-policy">{terms}</p>}
      <h3>Delivery</h3><ul>{parcelVehicleMode(policy) ? <li>Your goods must fit the vehicle you choose (its weight and load space are shown on the Select vehicle screen).</li> : <li>Parcels up to {policy.maxWeightKg} kg, each side up to {policy.maxDimensionCm} cm.</li>}{policy.prohibitedItems?.length > 0 && <li>Not allowed: {policy.prohibitedItems.join(', ')}.</li>}<li>The delivery partner confirms pickup and delivery with one-time codes shown in your tracking page.</li></ul>
      <h3>Payment</h3><ul><li>Pay online with Razorpay, or pay the delivery partner in cash where offered.</li><li>Only the delivery fee is charged — never the value of your parcel.</li></ul>
      <h3>Cancellation and refunds</h3><ul>{instant ? <><li>Until a delivery partner accepts, you can cancel at once. Any amount you paid goes back to your Bulkimart wallet straight away.</li><li>After a partner accepts and until pickup, cancellation requests are reviewed by our team.</li></> : <><li>You can request cancellation until the delivery partner picks up your parcel.</li><li>Cancellation requests are reviewed by our team.</li></>}<li>After pickup the booking can no longer be cancelled.</li><li>Approved refunds go to your Bulkimart wallet. Cash paid to the partner is refunded after it is deposited with us.</li></ul>
    </div>
    <button type="button" className="parcel-primary" onClick={onClose}>Close</button>
  </section></div>;
}
const BACK = { pickup: 'start', pickupDetails: 'pickup', dropoff: 'pickupDetails', dropoffDetails: 'dropoff', vehicle: 'dropoffDetails', review: 'vehicle' };
// The line under the goods title: the category (when a description is the title), weight and packages.
const goodsText = (parcel, vehicle, categories) => [parcel.description?.trim() && categories.includes(parcel.category) ? parcel.category : '', parcel.weightKg !== '' && parcel.weightKg != null ? `${Number(parcel.weightKg)} kg` : vehicle ? `up to ${vehicle.maxWeightKg} kg` : '', `${Number(parcel.packages) || 1} ${Number(parcel.packages) > 1 ? 'packages' : 'package'}`].filter(Boolean).join(' · ');

export default function ParcelBookingFlow({ policy, flags, addresses = [], profile, onBooked, onOpenHistory, onOpenTrip }) {
  const storageKey = parcelDraftKey(profile?._id);
  const [state, setState] = useState(() => readParcelDraft(storageKey, initialParcelJourney(profile, policy)));
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [now, setNow] = useState(Date.now());
  const [sheet, setSheet] = useState(null), [termsOpen, setTermsOpen] = useState(false), [mapOpen, setMapOpen] = useState(false), [showAddresses, setShowAddresses] = useState(false), [goodsDraft, setGoodsDraft] = useState(null);
  const generation = useRef(0), lock = useRef(false), mounted = useRef(true), controller = useRef(null), latest = useRef(state);
  latest.current = state;
  const vehicleMode = parcelVehicleMode(policy);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; generation.current++; controller.current?.abort(); }; }, []);
  useEffect(() => { if (storageKey) writeParcelDraft(sessionStorage, storageKey, state); }, [state, storageKey]);
  useEffect(() => {
    if (!state.quote) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [state.quote?._id]);
  // Each screen starts at the top, as on a phone.
  useEffect(() => { globalThis.scrollTo?.(0, 0); setMapOpen(false); setShowAddresses(false); }, [state.step]);
  // Home shows the customer's last few trips (with Book Again), like the parcel app's home.
  const [recent, setRecent] = useState([]);
  useEffect(() => {
    if (state.step !== 'start' || !onOpenHistory) return undefined;
    const c = new AbortController();
    parcelRequest('customer', '/bookings?page=1', { signal: c.signal }).then(b => { if (!c.signal.aborted && Array.isArray(b.data)) setRecent(b.data.slice(0, 3)); }).catch(() => {});
    return () => c.abort();
  }, [state.step, Boolean(onOpenHistory)]); // eslint-disable-line react-hooks/exhaustive-deps
  const go = step => { setError(''); setNotice(''); setState(s => ({ ...s, step })); };
  const change = patch => { generation.current++; controller.current?.abort(); setState(s => ({ ...s, ...patch, quote: null })); setError(''); setNotice(''); };
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
  const chooseVehicle = (quote, current) => {
    if (!quote.vehicleOptions) return '';
    const usable = quote.vehicleOptions.filter(o => o.available);
    return (usable.find(o => o.vehicle.id === current) || usable[0])?.vehicle.id || '';
  };
  const loadQuote = () => run(async () => {
    const quote = await requestQuote();
    if (!quote) return;
    setState(s => {
      const vehicleId = chooseVehicle(quote, s.vehicleId);
      const lost = s.step === 'review' && quote.vehicleOptions && vehicleId !== s.vehicleId;
      if (lost) setNotice('The vehicle you chose cannot carry these goods. Choose another vehicle.');
      return { ...s, quote, vehicleId, step: lost ? 'vehicle' : s.step };
    });
  });
  // Prices load as soon as the customer reaches vehicle selection (and again after any change).
  const goodsReady = !parcelGoodsError(state.parcel, policy) && (vehicleMode || state.parcel.acceptRestrictions);
  const wantsQuote = ['vehicle', 'review'].includes(state.step) && !state.quote && !state.pending && goodsReady && !error;
  useEffect(() => { if (wantsQuote && !busy && !lock.current) loadQuote(); }, [wantsQuote, busy]); // eslint-disable-line react-hooks/exhaustive-deps
  const quote = state.quote;
  const option = quote?.vehicleOptions?.find(o => o.vehicle.id === state.vehicleId);
  const fare = option?.pricing || (quote && !quote.vehicleOptions ? quote.pricing : null);
  const vehicle = option?.vehicle || policy.vehicles?.find(v => v.id === state.vehicleId);
  const vehicleName = option?.vehicle.name || (vehicleMode ? vehicle?.name || 'vehicle' : quote?.service?.name || 'Doorstep delivery');
  const expired = quote && new Date(quote.expiresAt).getTime() <= now;
  const cashPoints = quote?.cashCollectionPoints || policy.cashCollectionPoints || (policy.cashCollectionPoint === 'customer_choice' ? ['pickup', 'delivery'] : [policy.cashCollectionPoint === 'pickup' ? 'pickup' : 'delivery']);
  const cashAllowed = Boolean(flags.pay_driver && policy.payDriverEnabled && policy.payDriverCategories?.includes(state.parcel.category));
  const methods = [...(cashAllowed ? ['pay_driver'] : []), ...(flags.online_payment ? ['online'] : [])];
  const paymentMethod = state.pending?.payload.paymentMethod || (methods.includes(state.paymentMethod) ? state.paymentMethod : methods[0] || '');
  const cashPoint = state.pending?.payload.paymentMethod === 'pay_driver' ? state.pending.payload.cashCollectionPoint || 'delivery' : cashPoints.includes(state.cashCollectionPoint) ? state.cashCollectionPoint : cashPoints.includes('delivery') ? 'delivery' : cashPoints[0];
  const paymentLabel = paymentMethod === 'online' ? 'Pay online' : paymentMethod === 'pay_driver' ? `Cash at ${cashPoint === 'pickup' ? 'pickup' : 'drop'}` : 'Not available';
  const confirmBooking = () => run(async () => {
    let attempt = state.pending;
    if (!attempt) {
      if (!paymentMethod) throw new Error('No payment method is available for this parcel.');
      if (!quote || !fare) throw new Error('Choose a vehicle to see your fare.');
      if (new Date(quote.expiresAt).getTime() - Date.now() < 30000) {
        const fresh = await requestQuote();
        if (!fresh) return;
        setState(s => ({ ...s, quote: fresh, vehicleId: chooseVehicle(fresh, s.vehicleId) }));
        setNotice('Your fare has been refreshed. Check it, then tap Book again.');
        return;
      }
      attempt = { key: crypto.randomUUID(), payload: { quoteId: quote._id, policyVersion: fare.policyVersion ?? quote.pricing.policyVersion, paymentMethod, ...(paymentMethod === 'pay_driver' ? { cashCollectionPoint: cashPoint } : {}), ...(quote.vehicleOptions ? { vehicleId: state.vehicleId } : {}), acceptTerms: true } };
      const snapshot = { ...latest.current, pending: attempt };
      // Persist before sending: a timeout/reload must retry the same quote and key.
      if (storageKey) writeParcelDraft(sessionStorage, storageKey, snapshot);
      setState(snapshot);
    }
    let body;
    try {
      body = await parcelRequest('customer', '/bookings', { method: 'POST', headers: { 'Idempotency-Key': attempt.key }, body: JSON.stringify(attempt.payload) });
    } catch (e) {
      if (e.status === 409 && /Quotation expired|Policy changed/i.test(e.message)) setState(s => ({ ...s, pending: null, quote: null, step: 'vehicle' }));
      if (e.status && e.status < 500 && e.status !== 409) setState(s => ({ ...s, pending: null }));
      throw new Error(e.message + ' If confirmation was interrupted, retry safely or check Delivery history.');
    }
    if (!body.data?._id || !body.data.reference) throw new Error('Booking confirmation was interrupted. Retry safely or check Delivery history.');
    if (storageKey) { try { sessionStorage.removeItem(storageKey); } catch { /* Storage is optional. */ } }
    if (mounted.current) onBooked(body.data);
  });
  const back = () => { if (state.pending || busy) return; go(BACK[state.step] || 'start'); };
  const chooseLocation = (kind, value) => change({ [kind]: value, ...(validParcelLocation(value) ? { step: kind + 'Details' } : {}) });
  const confirmDetails = kind => run(async () => {
    const message = parcelAddressError(state[kind]);
    if (message) throw new Error(message);
    const label = state.saveAs?.[kind];
    if (label) {
      try { await saveParcelPickup({ ...state[kind], label }); setNotice('Address saved to your addresses.'); }
      catch { setNotice('This address could not be saved, but your booking can continue.'); }
    }
    setState(s => ({ ...s, step: kind === 'pickup' ? (validParcelLocation(s.dropoff) && s.dropoff.address ? 'dropoffDetails' : 'dropoff') : 'vehicle' }));
  });
  const stop = (kind, extra) => <div className={'parcel-stop ' + kind}><span className="parcel-stop-dot" aria-hidden="true"/><div><strong>{[state[kind].name, state[kind].phone].filter(Boolean).join(' · ') || (kind === 'pickup' ? 'Pickup' : 'Drop')}</strong><small>{[state[kind].building, state[kind].address].filter(Boolean).join(', ')}</small></div>{extra}</div>;
  const header = (title, sub) => <header className="parcel-flow-header">{state.step === 'start' ? <a href="/" aria-label="Back to home"><ArrowLeft size={22}/></a> : <button type="button" aria-label="Back to previous step" disabled={busy || !!state.pending} onClick={back}><ArrowLeft size={22}/></button>}<div><h2>{title}</h2>{sub && <p>{sub}</p>}</div></header>;
  const messages = <>{error && <p role="alert" className="parcel-error">{error}{['vehicle', 'review'].includes(state.step) && !state.quote && <button type="button" className="parcel-text-button" onClick={() => setError('')}>Try again</button>}</p>}{notice && <p role="status" className="parcel-notice">{notice}</p>}</>;

  // ---- Home (as in the parcel app): pickup bar, vehicles, recent trips and good-to-know cards
  if (state.step === 'start') {
    const tiles = vehicleMode ? policy.vehicles : [{ id: '', name: 'Doorstep delivery', icon: '', maxWeightKg: policy.maxWeightKg, description: 'Documents and small parcels' }];
    const next = validParcelLocation(state.pickup) ? (validParcelLocation(state.dropoff) ? 'vehicle' : 'dropoff') : 'pickup';
    const again = b => setState(s => ({ ...s, pickup: bookedParcelAddress(b.details.pickup), dropoff: bookedParcelAddress(b.details.dropoff), vehicleId: b.service?.id && b.service.id !== 'parcel' ? b.service.id : '', quote: null, pending: null, step: 'vehicle' }));
    const instant = (policy.customerCancel || 'instant_before_assignment') === 'instant_before_assignment';
    return <div className="parcel-booking-flow parcel-home">{messages}
      <button type="button" className="parcel-pickup-bar" onClick={() => go('pickup')}><span className="parcel-stop-dot pickup" aria-hidden="true"/><span><small>Pick up from</small><strong>{state.pickup.address || 'Set your pickup location'}</strong></span><ChevronRight size={20} aria-hidden="true"/></button>
      <h3 className="parcel-home-title">Choose a vehicle</h3>
      <div className="parcel-vehicle-tiles">{tiles.map(v => <button type="button" key={v.id || 'parcel'} className={'parcel-vehicle-tile tone-' + (v.icon || 'parcel')} onClick={() => setState(s => ({ ...s, vehicleId: v.id, step: next }))}>
        <span className="parcel-tile-art"><ParcelVehicleIcon icon={v.icon} size={58}/></span><strong>{v.name}</strong><small>Up to {v.maxWeightKg} kg</small><ChevronRight size={18} aria-hidden="true"/></button>)}</div>
      {recent.length > 0 && <section className="parcel-home-section"><div className="parcel-home-head"><h3 className="parcel-home-title">Your recent trips</h3>{onOpenHistory && <button type="button" className="parcel-text-button" onClick={onOpenHistory}>View all <ChevronRight size={14} aria-hidden="true"/></button>}</div>
        {recent.map(b => <article key={b._id} className="parcel-order-card">
          <button type="button" className="parcel-order-head" onClick={() => onOpenTrip?.(b._id)}><ParcelVehicleIcon icon={b.service?.icon} size={28}/><span><strong>{b.service?.name || 'Parcel delivery'}</strong><small>{b.createdAt ? new Date(b.createdAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit' }) : ''}</small></span><strong className="parcel-order-fare">{parcelRupees(b.feePaise)} ›</strong></button>
          <div className="parcel-trip-stops">{[['pickup', b.details?.pickup], ['dropoff', b.details?.dropoff]].map(([kind, a]) => a && <div key={kind} className={'parcel-stop ' + kind}><span className="parcel-stop-dot" aria-hidden="true"/><div><strong>{[a.name, a.phone].filter(Boolean).join(' · ')}</strong><small>{a.address}</small></div></div>)}</div>
          {['delivered', 'cancelled'].includes(b.status) && b.details?.pickup && b.details?.dropoff ? <div className="parcel-order-foot"><span className={'parcel-status-chip ' + (b.status === 'delivered' ? 'done' : 'cancelled')}>{b.status === 'delivered' ? 'Completed' : 'Cancelled'}</span><button type="button" className="parcel-primary parcel-book-again" onClick={() => again(b)}>Book Again</button></div>
            : <div className="parcel-order-foot"><span className="parcel-status-chip">In progress</span><button type="button" className="parcel-text-button" onClick={() => onOpenTrip?.(b._id)}>Track <ChevronRight size={14} aria-hidden="true"/></button></div>}
        </article>)}</section>}
      <section className="parcel-home-section"><h3 className="parcel-home-title">Good to know</h3><div className="parcel-info-cards">
        <div className="parcel-info-card"><strong>{instant ? 'Free cancellation' : 'Easy cancellation'}</strong><small>{instant ? 'Cancel at once until a partner accepts. Paid fares go back to your wallet.' : 'Request cancellation any time before pickup.'}</small></div>
        <div className="parcel-info-card"><strong>Cash or online</strong><small>Pay the partner in cash or online with Razorpay.</small></div>
        <div className="parcel-info-card"><strong>Safe handover</strong><small>Pickup and delivery are confirmed with one-time codes.</small></div>
      </div></section>
      {policy.areas?.length > 0 && <p className="parcel-start-note">We pick up and deliver within: {policy.areas.map(a => a.name).join(', ')}.</p>}
      {onOpenHistory && <button type="button" className="parcel-outline-button parcel-home-history" onClick={onOpenHistory}>Delivery history</button>}
    </div>;
  }
  // ---- Pickup / drop search
  if (state.step === 'pickup' || state.step === 'dropoff') {
    const kind = state.step;
    return <div className="parcel-booking-flow parcel-search-screen">{header(kind === 'pickup' ? 'Pickup location' : 'Drop location')}
      {kind === 'dropoff' && <div className="parcel-trip-card compact">{stop('pickup', <button type="button" className="parcel-icon-button" aria-label="Edit pickup" onClick={() => go('pickupDetails')}><ChevronRight size={18}/></button>)}</div>}
      {messages}
      <div className={'parcel-search-box ' + kind}><span className={'parcel-stop-dot ' + kind} aria-hidden="true"/>
        <ParcelLocationPicker key={kind + (mapOpen ? ':map' : '')} idPrefix={'parcel-' + kind} confirmLocation showMap={mapOpen} label={kind === 'pickup' ? 'Where is your pickup?' : 'Where is your drop?'} value={state[kind]} initialQuery="" onChange={v => chooseLocation(kind, v)}/></div>
      <div className="parcel-search-links"><button type="button" className="parcel-link-button" aria-pressed={mapOpen} onClick={() => setMapOpen(o => !o)}><LocateFixed size={18} aria-hidden="true"/>{mapOpen ? 'Hide map' : 'Select on map'}</button><a className="parcel-link-button" href="#parcel-saved-addresses"><Heart size={18} aria-hidden="true"/>Saved addresses</a></div>
      <ul className="parcel-address-list" id="parcel-saved-addresses" aria-label="Saved addresses">
        {addresses.length === 0 ? <li className="parcel-address-empty">No saved addresses yet. You can save one on the next screen.</li> : addresses.map(a => <li key={a._id}><button type="button" onClick={() => chooseLocation(kind, { ...savedParcelAddress(a), ...(kind === 'pickup' && !a.name && !a.phone ? { name: state.pickup.name, phone: state.pickup.phone } : {}) })}><Clock size={18} aria-hidden="true"/><span><strong>{a.label || 'Saved'}{a.name ? ' · ' + a.name : ''}</strong><small>{[a.line1, a.line2, a.city, a.pincode].filter(Boolean).join(', ')}</small></span></button></li>)}
      </ul>
    </div>;
  }
  // ---- Pickup / drop details on the map
  if (state.step === 'pickupDetails' || state.step === 'dropoffDetails') {
    const kind = state.step === 'pickupDetails' ? 'pickup' : 'dropoff', a = state[kind], pickup = kind === 'pickup';
    const mine = profile?.phone && a.phone === profile.phone && a.name === (profile.name || a.name);
    const edit = (key, value) => change({ [kind]: { ...a, [key]: value } });
    return <form className="parcel-booking-flow parcel-details-screen" onSubmit={e => { e.preventDefault(); confirmDetails(kind); }}>
      {header(pickup ? 'Pickup details' : 'Drop details')}
      <div className="parcel-map-hero"><span className={'parcel-pin-tip ' + kind}>{pickup ? 'Your goods will be picked from here' : 'Your goods will be dropped here'}</span>
        <ParcelMap pickup={pickup ? a : undefined} dropoff={pickup ? undefined : a} editable={kind} onPinChange={p => change({ [kind]: { ...a, lat: p.lat, lng: p.lng, approximate: true } })}/></div>
      <section className="parcel-card parcel-details-card">
        <div className="parcel-details-address"><span className={'parcel-stop-dot ' + kind} aria-hidden="true"/><div><strong>{a.address.split(',')[0] || 'Selected location'}</strong><small>{a.address}</small>{a.approximate && <small>Pin moved — check the address and pincode.</small>}</div><button type="button" className="parcel-outline-button" onClick={() => go(kind)}>Change</button></div>
        {messages}
        <label>House / Apartment / Shop (optional)<input name={kind + '.building'} maxLength={100} value={a.building || ''} onChange={e => edit('building', e.target.value)}/></label>
        {!/^\d{6}$/.test(a.pincode || '') && <label>Pincode<input name={kind + '.pincode'} required inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={a.pincode || ''} onChange={e => edit('pincode', e.target.value.replace(/\D/g, ''))}/></label>}
        <label>{pickup ? 'Sender’s name' : 'Receiver’s name'}<input name={kind + '.name'} required maxLength={100} autoComplete="name" value={a.name || ''} onChange={e => edit('name', e.target.value)}/></label>
        <label>{pickup ? 'Sender’s mobile number' : 'Receiver’s mobile number'}<input name={kind + '.phone'} required type="tel" maxLength={16} pattern="\+?[1-9][0-9]{9,14}" autoComplete="tel" value={a.phone || ''} onChange={e => edit('phone', e.target.value)}/></label>
        {profile?.phone && <label className="parcel-check"><input type="checkbox" checked={Boolean(mine)} onChange={e => change({ [kind]: { ...a, ...(e.target.checked ? { name: profile.name || a.name, phone: profile.phone } : { name: '', phone: '' }) } })}/>Use my mobile number: {profile.phone}</label>}
        <fieldset className="parcel-save-as"><legend>Save as (optional)</legend>{['Home', 'Work', 'Other'].map(label => <button type="button" key={label} aria-pressed={state.saveAs?.[kind] === label} className={state.saveAs?.[kind] === label ? 'selected' : ''} onClick={() => setState(s => ({ ...s, saveAs: { ...s.saveAs, [kind]: s.saveAs?.[kind] === label ? '' : label } }))}>{label}</button>)}</fieldset>
      </section>
      <div className="parcel-sticky-action"><button className="parcel-primary" disabled={busy}>{busy ? 'Saving…' : 'Confirm and Proceed'}</button></div>
    </form>;
  }
  // ---- Select vehicle
  const tripCard = <div className="parcel-trip-card">
    <div className="parcel-trip-stops">{stop('pickup')}{stop('dropoff')}</div>
    <button type="button" className="parcel-icon-button parcel-swap" aria-label="Switch pickup and drop" disabled={busy || !!state.pending} onClick={() => change({ pickup: state.dropoff, dropoff: state.pickup })}><ArrowDownUp size={18}/></button>
    <div className="parcel-trip-actions"><button type="button" className="parcel-link-button" disabled={busy || !!state.pending} onClick={() => go('pickupDetails')}><Pencil size={16} aria-hidden="true"/>Edit Locations</button></div>
  </div>;
  if (state.step === 'vehicle') {
    const options = quote?.vehicleOptions || (quote ? [{ vehicle: { id: '', name: quote.service?.name || 'Doorstep delivery', icon: '', maxWeightKg: quote.service?.maxWeightKg || policy.maxWeightKg, description: 'Partner and pickup time confirmed after booking.' }, available: true, pricing: quote.pricing, etaMinutes: null }] : []);
    const info = sheet?.type === 'vehicle' ? options.find(o => o.vehicle.id === sheet.id)?.vehicle : null;
    return <div className="parcel-booking-flow parcel-vehicle-screen">{header('Select Vehicle')}{tripCard}{messages}
      {!vehicleMode && <section className="parcel-card"><h3>What are you sending?</h3><p>Up to {policy.maxWeightKg} kg · Each side up to {policy.maxDimensionCm} cm</p>{goodsFields(state.parcel, p => change({ parcel: p }), policy, null)}
        <p>Prohibited items: {policy.prohibitedItems.join(', ')}.</p><label className="parcel-check"><input type="checkbox" checked={state.parcel.acceptRestrictions} onChange={e => change({ parcel: { ...state.parcel, acceptRestrictions: e.target.checked } })}/>My parcel meets these restrictions and limits.</label></section>}
      {busy && !quote && <p role="status" className="parcel-loading-line">Finding prices for your route…</p>}
      {quote && <ParcelRouteSummary quote={quote}/>}
      <ul className="parcel-vehicle-list" aria-label="Vehicles">{options.map(o => { const selected = (o.vehicle.id || '') === (state.vehicleId || options[0]?.vehicle.id || ''); return <li key={o.vehicle.id || 'parcel'} className={'parcel-vehicle-option' + (selected ? ' selected' : '') + (o.available ? '' : ' unavailable')}>
        <button type="button" aria-pressed={selected} disabled={!o.available || busy} onClick={() => setState(s => ({ ...s, vehicleId: o.vehicle.id }))}>
          <ParcelVehicleIcon icon={o.vehicle.icon} size={selected ? 52 : 36}/>
          <span className="parcel-vehicle-text"><strong>{o.vehicle.name}</strong><small>{o.vehicle.maxWeightKg} kg{o.etaMinutes ? ` · ${o.etaMinutes} mins` : ''}</small>{selected && o.vehicle.dimensionsCm && <small>Load space {o.vehicle.dimensionsCm.join(' × ')} cm</small>}{!o.available && <small>{o.reason === 'too_large' ? 'Can’t carry these goods' : 'Not available on this route'}</small>}</span>
          <strong className="parcel-vehicle-price">{o.pricing ? parcelRupees(o.pricing.totalPaise) : '—'}</strong>
        </button>
        {o.vehicle.dimensionsCm && <button type="button" className="parcel-icon-button parcel-vehicle-info" aria-label={'About ' + o.vehicle.name} onClick={() => setSheet({ type: 'vehicle', id: o.vehicle.id })}><Info size={16}/></button>}
      </li>; })}</ul>
      {quote && !expired && <p className="parcel-quote-status">Fare valid until {new Date(quote.expiresAt).toLocaleTimeString()}.</p>}
      {expired && <p className="parcel-quote-status" role="status">These prices have expired. <button type="button" className="parcel-text-button" disabled={busy} onClick={() => change({})}>Refresh prices</button></p>}
      <div className="parcel-sticky-action"><button type="button" className="parcel-primary" disabled={busy || !fare || expired} onClick={() => go('review')}>{fare ? `Proceed with ${vehicleName}` : busy ? 'Loading prices…' : 'Choose a vehicle'}</button></div>
      {info && <ParcelSheet label={info.name} onClose={() => setSheet(null)} footer={<button type="button" className="parcel-primary" onClick={() => setSheet(null)}>Done</button>}>
        <div className="parcel-vehicle-hero"><ParcelVehicleIcon icon={info.icon} size={96}/></div><h2>{info.name}</h2><p className="parcel-vehicle-spec">{info.maxWeightKg} kg · {info.dimensionsCm.join(' cm × ')} cm</p>{info.description && <p className="parcel-vehicle-desc">{info.description}</p>}
      </ParcelSheet>}
    </div>;
  }
  // ---- Review booking
  const instant = (policy.customerCancel || 'instant_before_assignment') === 'instant_before_assignment';
  const eta = option?.etaMinutes || (quote?.route?.durationSeconds ? Math.ceil(quote.route.durationSeconds / 60) : null);
  return <div className="parcel-booking-flow parcel-review-screen">{header('Review Booking')}{messages}
    {!quote ? <p role="status" className="parcel-loading-line">{busy ? 'Updating your fare…' : 'Your fare needs refreshing.'}</p> : <form id="parcel-booking-review" onSubmit={e => { e.preventDefault(); confirmBooking(); }}>
      <section className="parcel-card parcel-review-vehicle"><ParcelVehicleIcon icon={option?.vehicle.icon} size={44}/><div><strong>{vehicleName}</strong><button type="button" className="parcel-text-button" aria-expanded={showAddresses} onClick={() => setShowAddresses(v => !v)}>View Address Details <ChevronRight size={14} aria-hidden="true"/></button></div>{eta && <span className="parcel-eta-box"><strong>{eta}</strong><small>mins</small></span>}
        {showAddresses && <div className="parcel-trip-stops">{stop('pickup')}{stop('dropoff')}</div>}</section>
      <ParcelRouteSummary quote={quote}/>
      <section className="parcel-card parcel-goods-card"><h3>Goods Description</h3><div className="parcel-goods-row"><span><strong>{state.parcel.description?.trim() || state.parcel.category}</strong><small>{goodsText(state.parcel, vehicle, policy.categories)}</small></span><button type="button" className="parcel-text-button" disabled={busy || !!state.pending} onClick={() => { setGoodsDraft({ ...state.parcel }); setSheet({ type: 'goods' }); }}>Change <ChevronRight size={14} aria-hidden="true"/></button></div>
        {policy.prohibitedItems?.length > 0 && <div className="parcel-restricted"><TriangleAlert size={18} aria-hidden="true"/><span>Do not send restricted items</span><button type="button" className="parcel-text-button" onClick={() => setSheet({ type: 'restricted' })}>View List <ChevronRight size={14} aria-hidden="true"/></button></div>}</section>
      {fare && <section className="parcel-card parcel-fare-card"><h3>Fare Summary</h3><dl><dt>Trip fare (incl. tax)</dt><dd>{parcelMoney(fare.totalPaise)}</dd>{fare.taxPaise > 0 && <><dt>Tax included</dt><dd>{parcelMoney(fare.taxPaise)}</dd></>}<dt className="parcel-fare-total">Amount payable</dt><dd className="parcel-fare-total">{parcelMoney(fare.totalPaise)}</dd></dl></section>}
      <section className="parcel-card parcel-read-before"><h3>Read before Booking</h3><ul>
        <li>The fare is fixed for this route and vehicle. It changes only if you choose to add to it while we find a partner.</li>
        <li>Only the delivery fee is charged, never the value of your goods.</li>
        {vehicle && <li>Your goods must fit the {vehicleName}: up to {vehicle.maxWeightKg} kg{vehicle.dimensionsCm ? `, ${vehicle.dimensionsCm.join(' × ')} cm` : ''}.</li>}
        <li>{instant ? 'You can cancel free of charge until a delivery partner accepts.' : 'Cancellation requests are reviewed by our team.'}</li>
        <li>Pickup and delivery are confirmed with one-time codes shown on your tracking page.</li>
      </ul><button type="button" className="parcel-terms-link" onClick={() => setTermsOpen(true)}>Delivery, payment and cancellation terms</button></section>
      {!state.pending && expired && <p className="parcel-quote-status" role="status">Your fare has expired. <button type="button" className="parcel-text-button" disabled={busy} onClick={() => change({})}>Refresh fare</button></p>}
      {state.pending && <p role="status" className="parcel-notice">A confirmation attempt is in progress. Retry uses the same booking identity; check Delivery history if the connection was interrupted.</p>}
    </form>}
    {quote && <div className="parcel-sticky-action parcel-book-bar">
      <div className="parcel-book-row"><button type="button" className="parcel-pay-choice" disabled={busy || !!state.pending || methods.length === 0} onClick={() => setSheet({ type: 'payment' })}><span className="parcel-pay-icon" aria-hidden="true">₹</span><span><small>Choose payment method</small><strong>{paymentLabel} <ChevronDown size={14} aria-hidden="true"/></strong></span></button>
        {fare && <span className="parcel-book-total"><strong>{parcelRupees(fare.totalPaise)}</strong><button type="button" className="parcel-text-button" onClick={() => setSheet({ type: 'breakup' })}>View Breakup</button></span>}</div>
      <button type="submit" form="parcel-booking-review" className="parcel-primary" disabled={busy || !fare || (!state.pending && (expired || !paymentMethod))}>{busy ? 'Confirming your booking…' : state.pending ? 'Retry booking safely' : `Book ${vehicleName}`}</button>
      <small>By booking you accept the delivery, payment and cancellation terms.</small></div>}
    {sheet?.type === 'payment' && <ParcelSheet title="Select Payment Method" onClose={() => setSheet(null)} footer={<button type="button" className="parcel-primary" onClick={() => setSheet(null)}>{fare ? `Pay ${parcelRupees(fare.totalPaise)} ${paymentMethod === 'online' ? 'online' : 'using cash'}` : 'Confirm'}</button>}>
      <fieldset className="parcel-payment-options"><legend className="parcel-visually-hidden">Payment method</legend>
        {methods.includes('online') && <label className={'parcel-pay-option' + (paymentMethod === 'online' ? ' selected' : '')}><input type="radio" name="paymentMethod" value="online" checked={paymentMethod === 'online'} onChange={() => setState(s => ({ ...s, paymentMethod: 'online' }))}/><span><strong>Pay online</strong><small>UPI, cards and net banking with Razorpay</small></span></label>}
        {methods.includes('pay_driver') && <label className={'parcel-pay-option' + (paymentMethod === 'pay_driver' ? ' selected' : '')}><input type="radio" name="paymentMethod" value="pay_driver" checked={paymentMethod === 'pay_driver'} onChange={() => setState(s => ({ ...s, paymentMethod: 'pay_driver' }))}/><span><strong>Cash</strong><small>Pay the delivery partner in cash</small></span></label>}
      </fieldset>
      {paymentMethod === 'pay_driver' && <fieldset className="parcel-payment-options"><legend>Pay at</legend>{[['pickup', 'Pickup · sender pays'], ['delivery', 'Drop · receiver pays']].map(([point, title]) => <label key={point} className="parcel-check"><input type="radio" name="cashCollectionPoint" value={point} disabled={!cashPoints.includes(point)} checked={cashPoint === point} onChange={() => setState(s => ({ ...s, cashCollectionPoint: point }))}/><span>{title}{!cashPoints.includes(point) && <small>Not available under the current delivery policy</small>}</span></label>)}</fieldset>}
    </ParcelSheet>}
    {sheet?.type === 'breakup' && fare && <ParcelSheet title="Fare breakup" onClose={() => setSheet(null)}><ParcelPriceSummary pricing={fare}/></ParcelSheet>}
    {sheet?.type === 'restricted' && <ParcelSheet title="Items we do not deliver" onClose={() => setSheet(null)}><ul className="parcel-restricted-list">{policy.prohibitedItems.map(item => <li key={item}>{item}</li>)}</ul></ParcelSheet>}
    {sheet?.type === 'goods' && goodsDraft && <ParcelSheet title="Goods description" onClose={() => setSheet(null)} footer={<button type="button" className="parcel-primary" onClick={() => {
      const message = parcelGoodsError(goodsDraft, policy);
      if (message) { setError(message); return; }
      setSheet(null); change({ parcel: goodsDraft });
    }}>Save</button>}>{error && <p role="alert" className="parcel-error">{error}</p>}{goodsFields(goodsDraft, setGoodsDraft, policy, vehicle)}</ParcelSheet>}
    {termsOpen && <ParcelTermsDialog terms={quote?.terms || policy.terms} policy={policy} onClose={() => setTermsOpen(false)}/>}
  </div>;
}
/** Goods inputs: category, description, weight and packages (plus all three sides without vehicles). */
function goodsFields(parcel, onChange, policy, vehicle) {
  const vehicleMode = parcelVehicleMode(policy);
  const set = (key, value) => onChange({ ...parcel, [key]: value });
  return <div className="parcel-goods-fields">
    <label>What are you sending?<select name="category" value={parcel.category} onChange={e => set('category', e.target.value)}>{policy.categories.map(c => <option key={c}>{c}</option>)}</select></label>
    <label>Description{vehicleMode ? ' (optional)' : ''}<input name="description" required={!vehicleMode} maxLength={500} value={parcel.description} onChange={e => set('description', e.target.value)} placeholder="e.g. 2 cartons of T-shirts"/></label>
    <div className="parcel-measurements">
      <label>Weight (kg){vehicleMode ? ' (optional)' : ''}<input name="weightKg" required={!vehicleMode} type="number" inputMode="decimal" step="0.01" min="0.01" max={vehicleMode ? Math.max(...policy.vehicles.map(v => v.maxWeightKg)) : policy.maxWeightKg} value={parcel.weightKg} placeholder={vehicle ? `Up to ${vehicle.maxWeightKg}` : ''} onChange={e => set('weightKg', e.target.value)}/></label>
      {vehicleMode ? <label>Packages<input name="packages" type="number" inputMode="numeric" min="1" max="99" step="1" value={parcel.packages} onChange={e => set('packages', e.target.value)}/></label>
        : ['length', 'width', 'height'].map(k => <label key={k}>{k[0].toUpperCase() + k.slice(1)} (cm)<input required name={k} type="number" inputMode="decimal" step="0.01" min="0.01" max={policy.maxDimensionCm} value={parcel[k]} onChange={e => set(k, e.target.value)}/></label>)}
    </div>
    {vehicle && Number(parcel.weightKg) > vehicle.maxWeightKg && <p className="parcel-notice">This is more than a {vehicle.name} carries ({vehicle.maxWeightKg} kg). You’ll be asked to choose a bigger vehicle.</p>}
    <label>Pickup instructions (optional)<input name="instructions" maxLength={500} value={parcel.instructions} onChange={e => set('instructions', e.target.value)}/></label>
  </div>;
}
export { PARCEL_STEPS };
