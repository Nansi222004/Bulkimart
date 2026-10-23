import React,{useContext,useEffect,useRef,useState} from 'react';
import {CustomerSessionContext} from '../../utils/customerSession';
import { parcelRequest as request,parcelMoney as money,parcelLabel as label,parcelHeaders,parcelFormDetails } from './parcelApi';
import { apiUrl } from '../../utils/api';
import { boundedFetch } from '../../utils/portalRequests';
import { openRazorpayCheckout } from '../../utils/razorpayCheckout';
import './parcels.css';
import CustomerServiceHeading from '../services/CustomerServiceHeading';
import { parcelBookingEnabled, parcelBookingReady } from './parcelAvailability';
import ParcelLocationPicker from './ParcelLocationPicker';
export function ParcelCustomerEntry() {
  const session=useContext(CustomerSessionContext);
  return session?.verified?<ParcelDelivery/>:<section className="parcel-workspace customer-service-page"><CustomerServiceHeading parcel><p>Book a pickup and delivery for your parcel.</p></CustomerServiceHeading><section className="parcel-card customer-service-state"><h2>Sign in to send a parcel</h2><p>Sign in to book a parcel or view your private delivery history.</p><a className="customer-service-action" href="/account">Sign in to Bulkimart</a></section></section>;
}
export function ParcelDiscovery({driver=false}) {
  const [enabled,setEnabled]=useState(false);
  useEffect(()=>{const c=new AbortController();request('customer','/capabilities',{signal:c.signal}).then(b=>{if(!c.signal.aborted)setEnabled(b.data?.[driver?'fulfilment':'catalogue']===true && !b.data.productionBlocked);}).catch(()=>{});return()=>c.abort();},[driver]);
  return enabled?<a className="parcel-discovery" href={driver?'/delivery/parcels':'/parcel-delivery'}>{driver?'Parcel Deliveries':'Send a Parcel'}<span>{driver?'Offers and assigned parcel tasks':'Book a pickup and delivery for your own parcel'}</span></a>:null;
}
export function ParcelTimeline({events=[]}) {return <ol className="parcel-timeline">{events.map((e,i)=><li key={i}><strong>{label(e.status)}</strong><small>{new Date(e.at).toLocaleString()}</small></li>)}</ol>;}
export function ParcelAddress({prefix,title,addresses,onLocationChange}) {
  const [value,setValue]=useState({address:'',name:'',phone:'',pincode:'',lat:'',lng:''}),[savedId,setSavedId]=useState('');
  const update=next=>{setValue(next);onLocationChange?.();};
  return <fieldset><legend>{title}</legend>{addresses.length>0&&<label>Saved address<select value={savedId} onChange={e=>{
    setSavedId(e.target.value);const a=addresses.find(x=>x._id===e.target.value);
    update(a?{address:[a.line1,a.line2,a.city,a.state].filter(Boolean).join(', '),name:a.name||'',phone:a.phone||'',pincode:a.pincode||'',lat:a.lat??'',lng:a.lng??''}:{address:'',name:'',phone:'',pincode:'',lat:'',lng:''});
  }}><option value="">Enter a new address</option>{addresses.map(a=><option key={a._id} value={a._id}>{a.label||a.name}: {a.line1}</option>)}</select></label>}
    <ParcelLocationPicker key={savedId} value={value} onChange={update} initialQuery={value.address}/>
    {['address','name','phone','pincode'].map(k=><label key={k}>{({address:'Street address, city and state',name:'Contact name',phone:'Contact phone',pincode:'Pincode'})[k]}<input required name={prefix+'.'+k} value={value[k]} type={k==='phone'?'tel':'text'} inputMode={k==='pincode'?'numeric':undefined} pattern={k==='pincode'?'[0-9]{6}':undefined} maxLength={k==='address'?500:k==='name'?100:k==='pincode'?6:20} onChange={e=>update({...value,[k]:e.target.value})}/></label>)}
    <input type="hidden" name={prefix+'.lat'} value={value.lat}/><input type="hidden" name={prefix+'.lng'} value={value.lng}/>
    <small>Search the location or use your current location, then add the house number and contact details.</small>
  </fieldset>;
}
export default function ParcelDelivery() {
  const [path,setPath]=useState(window.location.pathname),[flags,setFlags]=useState({}),[policy,setPolicy]=useState(null),[addresses,setAddresses]=useState([]),[quote,setQuote]=useState(null),[booking,setBooking]=useState(null),[rows,setRows]=useState([]),[page,setPage]=useState(1),[meta,setMeta]=useState({}),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[revision,refresh]=useState(0);
  const quoteGeneration=useRef(0),lock=useRef(false),bookKey=useRef(crypto.randomUUID()),paymentKey=useRef(crypto.randomUUID());
  const invalidateQuote=()=>{quoteGeneration.current++;setQuote(null);};
  const routePath=path.replace(/\/$/,'');
  const track=/^\/parcel-delivery\/track\/([a-f\d]{24})$/i.exec(routePath)?.[1],history=routePath==='/parcel-delivery/history';
  const invalid=!track&&!history&&!['/parcel-delivery','/parcel-delivery/book'].includes(routePath);
  const readKey=routePath+':'+(history?page:1);
  const [readError,setReadError]=useState(''),[loadedKey,setLoadedKey]=useState('');
  const nav=p=>{window.history.pushState(null,'',p);setPath(p);};
  useEffect(()=>{const f=()=>setPath(window.location.pathname);window.addEventListener('popstate',f);window.addEventListener('app:locationchange',f);return()=>{window.removeEventListener('popstate',f);window.removeEventListener('app:locationchange',f);};},[]);
  useEffect(()=>{
    const c=new AbortController();setLoading(true);setReadError('');setError('');invalidateQuote();
    if(invalid){setLoading(false);return()=>c.abort();}
    async function load(){
      if(track||history){
        const b=await request('customer',track?'/bookings/'+track:'/bookings?page='+page,{signal:c.signal});
        if(c.signal.aborted)return;
        if(track){
          if(!b.data) {setBooking(null);}
          else if(!b.data.details?.pickup||!b.data.details?.dropoff||!b.data.cash||!b.data.refund||!Array.isArray(b.data.history)) throw new Error('Invalid tracking response');
          else setBooking(b.data);
        } else {
          if(!Array.isArray(b.data)||!b.meta)throw new Error('Invalid history response');
          setRows(b.data);setMeta(b.meta);
        }
      } else {
        const f=await request('customer','/capabilities',{signal:c.signal});
        if(c.signal.aborted)return;
        if(typeof f.data?.catalogue!=='boolean')throw new Error('Unable to check parcel availability. Please try again.');
        setFlags(f.data);setPolicy(null);
        // A disabled service is an availability state, not a failed catalogue request.
        const p=parcelBookingEnabled(f.data)?await request('customer','/catalogue',{signal:c.signal}):null;
        if(c.signal.aborted)return;
        setPolicy(p?.data&&Array.isArray(p.data.areas)&&Array.isArray(p.data.categories)&&Array.isArray(p.data.prohibitedItems)?p.data:null);
      }
      setLoadedKey(readKey);
    }
    load().catch(e=>{if(!c.signal.aborted)setReadError(e.message);}).finally(()=>{if(!c.signal.aborted)setLoading(false);});
    return()=>c.abort();
  },[readKey,invalid,revision]);
  useEffect(()=>{const c=new AbortController();boundedFetch(apiUrl('/api/users/addresses'),{headers:parcelHeaders('customer'),signal:c.signal}).then(r=>r.json()).then(b=>{if(!c.signal.aborted)setAddresses(Array.isArray(b.data)?b.data:[]);}).catch(()=>{});return()=>c.abort();},[]);
  const run=async fn=>{if(lock.current)return;lock.current=true;setBusy(true);setError('');setNotice('');try{await fn();}catch(e){setError(e.message);}finally{setBusy(false);lock.current=false;}};
  const action=(suffix,data)=>run(async()=>{await request('customer',`/bookings/${track}/${suffix}`,{method:'POST',body:JSON.stringify(data)});refresh(x=>x+1);});
  const retryRead=<button disabled={loading} onClick={()=>refresh(x=>x+1)}>Retry</button>;
  const shell=content=><section className="parcel-workspace customer-service-page"><CustomerServiceHeading parcel><p>Your parcel, collected and delivered by a Bulkimart delivery partner.</p></CustomerServiceHeading><nav><button onClick={()=>nav('/parcel-delivery/book')}>New booking</button><button onClick={()=>nav('/parcel-delivery/history')}>Delivery history</button></nav>{content}</section>;
  if(invalid)return shell(<section className="parcel-card"><h2>Invalid parcel link</h2><p>The tracking identifier or parcel page is invalid. Open a delivery from your history.</p></section>);
  if(loading)return shell(<p role="status">{track?'Loading parcel tracking…':history?'Loading parcel history…':'Loading parcel delivery…'}</p>);
  if(loadedKey!==readKey&&!readError)return shell(<p role="status">Loading parcel delivery…</p>);
  if(readError)return shell(<section className="parcel-card"><h2>{track?'Unable to load parcel tracking':history?'Unable to load parcel history':'Unable to load parcel delivery'}</h2><p role="alert" className="parcel-error">{readError}</p>{retryRead}{history&&loadedKey===readKey&&rows.length>0&&<><p>Previously loaded deliveries. Refresh failed; statuses may be outdated.</p>{rows.map(b=><button className="parcel-row" key={b._id} onClick={()=>nav('/parcel-delivery/track/'+b._id)}>{b.reference} · {label(b.status)} · {money(b.feePaise)}</button>)}</>}</section>);
  if(track&&(loadedKey!==readKey||!booking))return shell(<section className="parcel-card"><h2>Parcel tracking unavailable</h2><p>This booking is unavailable or could not be found for your account.</p>{retryRead}</section>);
  return <section className="parcel-workspace customer-service-page"><CustomerServiceHeading parcel><p>Your parcel, collected and delivered by a Bulkimart delivery partner.</p></CustomerServiceHeading><nav><button onClick={()=>nav('/parcel-delivery/book')}>New booking</button><button onClick={()=>nav('/parcel-delivery/history')}>Delivery history</button><button disabled={busy} onClick={()=>refresh(x=>x+1)}>Refresh status</button></nav>
    {error&&<p role="alert" className="parcel-error">{error}</p>}{notice&&<p role="status">{notice}</p>}{loading?<p role="status">Loading parcel delivery…</p>:!track&&!history&&!parcelBookingReady(flags,policy)?<section className="parcel-card customer-service-state"><h2>Parcel booking is currently unavailable</h2><p role="status">We’re not accepting new parcel deliveries right now. Please check back later.</p><p>You can still view and track your existing deliveries from Delivery history.</p><button onClick={()=>refresh(x=>x+1)}>Check availability</button><a className="customer-service-action" href="/grocery-home">Back to shopping</a></section>:track&&booking?<>
      <section className="parcel-card"><h2>{booking.reference}</h2><strong>{label(booking.status)}</strong><p>{money(booking.feePaise)} · {label(booking.paymentMethod)} · {label(booking.paymentStatus)}</p><p>Cash: {label(booking.cash.status)} · Refund: {label(booking.refund.status)}</p>{booking.pickupCode&&<p>Pickup code: <strong>{booking.pickupCode}</strong>. Share only at pickup.</p>}{booking.deliveryCode&&<p>Delivery code: <strong>{booking.deliveryCode}</strong>. Share with the recipient only when the parcel arrives.</p>}<p>{booking.details.pickup.address} → {booking.details.dropoff.address}</p></section>
      {booking.paymentMethod==='online'&&['payment_pending','payment_failed'].includes(booking.status)&&<section className="parcel-card"><p>Payment is confirmed only after server verification.</p><button disabled={busy} onClick={()=>run(async()=>{const c=await request('customer',`/bookings/${track}/payment`,{method:'POST',headers:{'Idempotency-Key':paymentKey.current},body:JSON.stringify({policyVersion:booking.policyVersion,acceptTerms:true})});const result=await openRazorpayCheckout(c.data,parcelHeaders('customer'));setNotice(result.ok?'Payment verified. Driver search will begin.':result.message);refresh(x=>x+1);})}>Pay {money(booking.feePaise)} online</button><button disabled={busy} onClick={()=>action('payment-status',{})}>Check payment status</button></section>}
      {!['cancelled','delivered','cancellation_review'].includes(booking.status)&&<form className="parcel-card" onSubmit={e=>{e.preventDefault();action('cancellation',{version:booking.version,reason:new FormData(e.currentTarget).get('reason')});}}><label>Cancellation reason<input name="reason" required maxLength={500}/></label><p>Cancellation and any refund are reviewed under the accepted terms.</p><button disabled={busy}>Request cancellation review</button></form>}<ParcelTimeline events={booking.history}/>
    </>:history?<section className="parcel-card"><h2>Your parcel deliveries</h2>{!rows.length&&<p>No parcel bookings yet.</p>}{rows.map(b=><button className="parcel-row" key={b._id} onClick={()=>nav(`/parcel-delivery/track/${b._id}`)}>{b.reference} · {label(b.status)} · {money(b.feePaise)}</button>)}<button disabled={page<=1} onClick={()=>setPage(x=>x-1)}>Previous</button><span> Page {page} </span><button disabled={page>=meta.pages} onClick={()=>setPage(x=>x+1)}>Next</button></section>:<>
      <section className="parcel-card"><h2>Pickup to doorstep</h2><p>Available in {policy.areas.map(a=>a.name).join(', ')}.</p><p>Maximum weight: {policy.maxWeightKg} kg. Maximum side: {policy.maxDimensionCm} cm.</p><p>Restricted items: {policy.prohibitedItems.join(', ')}.</p></section>
      <form className="parcel-card" onChange={invalidateQuote} onSubmit={e=>{e.preventDefault();const form=new FormData(e.currentTarget),generation=++quoteGeneration.current;run(async()=>{const input=parcelFormDetails(form);const b=await request('customer','/quotes',{method:'POST',body:JSON.stringify(input)});if(generation!==quoteGeneration.current)return;setQuote(b.data);bookKey.current=crypto.randomUUID();});}}>
        <div className="parcel-grid"><ParcelAddress prefix="pickup" title="Pickup" addresses={addresses} onLocationChange={invalidateQuote}/><ParcelAddress prefix="dropoff" title="Drop-off" addresses={addresses} onLocationChange={invalidateQuote}/></div>
        <label>Parcel category<select name="category" required>{policy.categories.map(c=><option key={c}>{c}</option>)}</select></label><label>Parcel description<textarea required name="description" maxLength={500}/></label><label>Weight (kg)<input type="number" step="0.01" min="0.01" max={policy.maxWeightKg} required name="weightKg"/></label><div className="parcel-grid">{['length','width','height'].map(k=><label key={k}>{label(k)} (cm)<input type="number" step="0.1" min="0.1" max={policy.maxDimensionCm} required name={k}/></label>)}</div><label>Pickup instructions<textarea name="instructions" maxLength={500}/></label><label><input type="checkbox" required name="restrictions"/>My parcel meets the listed restrictions and limits.</label><button disabled={busy||!policy.ready}>Calculate delivery fee</button>
      </form>
      {quote&&<form className="parcel-card" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);run(async()=>{const b=await request('customer','/bookings',{method:'POST',headers:{'Idempotency-Key':bookKey.current},body:JSON.stringify({quoteId:quote._id,policyVersion:quote.pricing.policyVersion,paymentMethod:f.get('paymentMethod'),acceptTerms:f.get('terms')==='on'})});nav(`/parcel-delivery/track/${b.data._id}`);});}}><h2>Delivery fee {money(quote.pricing.totalPaise)}</h2><dl><dt>Base fee</dt><dd>{money(quote.pricing.basePaise)}</dd><dt>Distance fee</dt><dd>{money(quote.pricing.distancePaise)}</dd>{quote.pricing.minimumAdjustmentPaise>0&&<><dt>Minimum fare adjustment</dt><dd>{money(quote.pricing.minimumAdjustmentPaise)}</dd></>}<dt>Included tax</dt><dd>{money(quote.pricing.taxPaise)}</dd></dl><p>{(quote.pricing.distanceMetres/1000).toFixed(2)} km · Valid until {new Date(quote.expiresAt).toLocaleTimeString()}</p><p>{quote.terms}</p><label>Payment method<select name="paymentMethod" required>{flags.online_payment&&<option value="online">Pay online with Razorpay</option>}{flags.pay_driver&&policy.payDriverEnabled&&policy.payDriverCategories.includes(quote.details.category)&&<option value="pay_driver">Pay driver at delivery — {money(quote.pricing.totalPaise)}</option>}</select></label><p>Pay-driver bookings require the exact fee at delivery. A driver’s collection remains pending reconciliation.</p><label><input type="checkbox" required name="terms"/>I accept these payment, cancellation and delivery terms.</label><button disabled={busy||new Date(quote.expiresAt)<=new Date()}>Confirm parcel booking</button></form>}
    </>}
  </section>;
}
