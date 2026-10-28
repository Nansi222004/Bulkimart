import React,{useContext,useEffect,useRef,useState} from 'react';
import {CustomerSessionContext} from '../../utils/customerSession';
import { parcelRequest as request,parcelMoney as money,parcelHeaders } from './parcelApi';
import { apiUrl } from '../../utils/api';
import { boundedFetch } from '../../utils/portalRequests';
import { openRazorpayCheckout } from '../../utils/razorpayCheckout';
import './parcels.css';
import CustomerServiceHeading from '../services/CustomerServiceHeading';
import { parcelBookingEnabled, parcelBookingReady } from './parcelAvailability';
import ParcelLocationPicker from './ParcelLocationPicker';
import ParcelBookingFlow from './ParcelBookingFlow';
import ParcelMap from './ParcelMap';
import ParcelCustomerStatus,{parcelCustomerStatus} from './ParcelCustomerStatus';
import {socket} from '../../utils/socket';
export function ParcelCustomerEntry() {
  const session=useContext(CustomerSessionContext);
  return session?.verified?<ParcelDelivery/>:<section className="parcel-workspace customer-service-page"><CustomerServiceHeading parcel><p>Book a pickup and delivery for your parcel.</p></CustomerServiceHeading><section className="parcel-card customer-service-state"><h2>Sign in to send a parcel</h2><p>Sign in to book a parcel or view your private delivery history.</p><a className="customer-service-action" href="/account" onClick={()=>{try{sessionStorage.setItem('bulkimart:parcel-return',window.location.pathname);}catch{}}}>Sign in to Bulkimart</a></section></section>;
}
export function ParcelDiscovery({driver=false}) {
  const [enabled,setEnabled]=useState(false);
  useEffect(()=>{const c=new AbortController();request('customer','/capabilities',{signal:c.signal}).then(b=>{if(!c.signal.aborted)setEnabled(b.data?.[driver?'fulfilment':'catalogue']===true && !b.data.productionBlocked);}).catch(()=>{});return()=>c.abort();},[driver]);
  return enabled?<a className="parcel-discovery" href={driver?'/delivery/parcels':'/parcel-delivery'}>{driver?'Parcel Deliveries':'Send a Parcel'}<span>{driver?'Offers and assigned parcel tasks':'Book a pickup and delivery for your own parcel'}</span></a>:null;
}
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
  const session = useContext(CustomerSessionContext);
  const [justBooked, setJustBooked] = useState(false);
  const [checkoutActive,setCheckoutActive]=useState(false);
  const [path,setPath]=useState(window.location.pathname),[flags,setFlags]=useState({}),[policy,setPolicy]=useState(null),[addresses,setAddresses]=useState([]),[booking,setBooking]=useState(null),[rows,setRows]=useState([]),[page,setPage]=useState(1),[meta,setMeta]=useState({}),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[revision,refresh]=useState(0);
  const lock=useRef(false),paymentKey=useRef(crypto.randomUUID());
  const routePath=path.replace(/\/$/,'');
  const track=/^\/parcel-delivery\/track\/([a-f\d]{24})$/i.exec(routePath)?.[1],history=routePath==='/parcel-delivery/history';
  const invalid=!track&&!history&&!['/parcel-delivery','/parcel-delivery/book'].includes(routePath);
  const readKey=routePath+':'+(history?page:1);
  const [readError,setReadError]=useState(''),[loadedKey,setLoadedKey]=useState(''),[updatedAt,setUpdatedAt]=useState(null);
  const nav=p=>{window.history.pushState(null,'',p);setPath(p);};
  const trackingBusy=useRef(false);trackingBusy.current=busy||checkoutActive;
  // Tracking and history stay live: every parcel update, a 10s poll, and whenever the app returns to the foreground or reconnects.
  useEffect(()=>{
    if(!track&&!history)return;
    const update=()=>{if(!trackingBusy.current&&document.visibilityState!=='hidden')refresh(x=>x+1);};
    const notification=n=>{if(n?.event==='PARCEL_UPDATED'&&(history||String(n.metadata?.parcelDeliveryId)===track))update();};
    const visible=()=>{if(document.visibilityState==='visible')update();};
    socket.on('notification_new',notification);socket.on('connect',update);
    document.addEventListener?.('visibilitychange',visible);window.addEventListener('focus',update);window.addEventListener('online',update);
    const timer=setInterval(update,10000);
    return()=>{clearInterval(timer);socket.off('notification_new',notification);socket.off('connect',update);document.removeEventListener?.('visibilitychange',visible);window.removeEventListener('focus',update);window.removeEventListener('online',update);};
  },[track,history]);
  useEffect(()=>{const f=()=>setPath(window.location.pathname);window.addEventListener('popstate',f);window.addEventListener('app:locationchange',f);return()=>{window.removeEventListener('popstate',f);window.removeEventListener('app:locationchange',f);};},[]);
  useEffect(()=>{
    // A background refresh of an already-loaded tracking or history page keeps the content on screen.
    const c=new AbortController();setLoading(track||history?loadedKey!==readKey:true);setReadError('');setError('');
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
      setLoadedKey(readKey);if(track||history)setUpdatedAt(new Date());
    }
    load().catch(e=>{if(!c.signal.aborted)setReadError(e.message);}).finally(()=>{if(!c.signal.aborted)setLoading(false);});
    return()=>c.abort();
  },[readKey,invalid,revision]);
  useEffect(()=>{const c=new AbortController();boundedFetch(apiUrl('/api/users/addresses'),{headers:parcelHeaders('customer'),signal:c.signal}).then(r=>r.json()).then(b=>{if(!c.signal.aborted)setAddresses(Array.isArray(b.data)?b.data:[]);}).catch(()=>{});return()=>c.abort();},[]);
  const run=async fn=>{if(lock.current)return;lock.current=true;setBusy(true);setError('');setNotice('');try{await fn();}catch(e){setError(e.message);}finally{setBusy(false);lock.current=false;}};
  const payOnline=b=>run(async()=>{
    setCheckoutActive(true);
    try {
      const c=await request('customer',`/bookings/${b._id}/payment`,{method:'POST',headers:{'Idempotency-Key':paymentKey.current},body:JSON.stringify({policyVersion:b.policyVersion,acceptTerms:true})});
      const result=await openRazorpayCheckout(c.data,parcelHeaders('customer'));
      if(result.ok){setJustBooked(b._id);setBooking(previous=>previous?._id===b._id?{...previous,paymentStatus:'paid',status:result.bookingStatus||'searching_for_driver'}:previous);}
      setNotice(result.ok?'Payment successful. We’re arranging your pickup.':result.cancelled?'Payment was not completed. You can continue when you’re ready.':result.message);refresh(x=>x+1);
    } finally {setCheckoutActive(false);}
  });
  const action=(suffix,data)=>run(async()=>{await request('customer',`/bookings/${track}/${suffix}`,{method:'POST',body:JSON.stringify(data)});refresh(x=>x+1);});
  const retryRead=<button disabled={loading} onClick={()=>refresh(x=>x+1)}>Retry</button>;
  const shell=content=><section className="parcel-workspace customer-service-page"><CustomerServiceHeading parcel><p>Your parcel, collected and delivered by a Bulkimart delivery partner.</p></CustomerServiceHeading><nav className="parcel-nav" aria-label="Parcel navigation"><button type="button" className={`parcel-nav-btn ${!history?'active':''}`} onClick={()=>nav('/parcel-delivery/book')}>New booking</button><button type="button" className={`parcel-nav-btn ${history?'active':''}`} onClick={()=>nav('/parcel-delivery/history')}>Delivery history</button></nav>{content}</section>;
  if(checkoutActive)return <section className="parcel-workspace customer-service-page"><section className="parcel-card parcel-checkout-screen" role="status" aria-live="polite"><div className="parcel-payment-spinner" aria-hidden="true"/><h2>Complete your payment</h2><strong>{money(booking?.feePaise)}</strong><p>Opening secure Razorpay checkout…</p><small>Your booking will be confirmed after payment is verified. Keep this page open.</small></section></section>;
  if(invalid)return shell(<section className="parcel-card"><h2>Invalid parcel link</h2><p>The tracking identifier or parcel page is invalid. Open a delivery from your history.</p></section>);
  if(loading)return shell(<p role="status">{track?'Loading parcel tracking…':history?'Loading parcel history…':'Loading parcel delivery…'}</p>);
  if(loadedKey!==readKey&&!readError)return shell(<p role="status">Loading parcel delivery…</p>);
  if(readError)return shell(<section className="parcel-card"><h2>{track?'Unable to load parcel tracking':history?'Unable to load parcel history':'Unable to load parcel delivery'}</h2><p role="alert" className="parcel-error">{readError}</p>{retryRead}{history&&loadedKey===readKey&&rows.length>0&&<><p>Previously loaded deliveries. Refresh failed; statuses may be outdated.</p>{rows.map(b=><button type="button" className="parcel-row" key={b._id} onClick={()=>nav('/parcel-delivery/track/'+b._id)}><span className="parcel-row-text">{b.reference} · {parcelCustomerStatus(b.status)} · {money(b.feePaise)}</span><span className="parcel-row-arrow" aria-hidden="true">→</span></button>)}</>}</section>);
  if(track&&(loadedKey!==readKey||!booking))return shell(<section className="parcel-card"><h2>Parcel tracking unavailable</h2><p>This booking is unavailable or could not be found for your account.</p>{retryRead}</section>);
  return <section className="parcel-workspace customer-service-page">{(track||history||!parcelBookingReady(flags,policy))&&<CustomerServiceHeading parcel><p>Your parcel, collected and delivered by a Bulkimart delivery partner.</p></CustomerServiceHeading>}<nav className={track||history?'parcel-nav':'parcel-nav parcel-nav-booking'} aria-label="Parcel navigation">{(track||history)&&<button type="button" className="parcel-nav-btn" onClick={()=>nav('/parcel-delivery/book')}>New booking</button>}<button type="button" className={'parcel-nav-btn '+(history?'active':'')} onClick={()=>nav('/parcel-delivery/history')}>Delivery history</button>{(track||history)&&<button type="button" className="parcel-nav-refresh" disabled={busy} onClick={()=>refresh(x=>x+1)}>Refresh status</button>}</nav>
    {(track||history)&&updatedAt&&<p className="parcel-live-status" aria-live="off"><span aria-hidden="true"/>Live · updated {updatedAt.toLocaleTimeString('en-IN',{hour:'numeric',minute:'2-digit',second:'2-digit'})}</p>}
    {error&&<p role="alert" className="parcel-error">{error}</p>}{notice&&<p role="status">{notice}</p>}{loading?<p role="status">Loading parcel delivery…</p>:!track&&!history&&!parcelBookingReady(flags,policy)?<section className="parcel-card customer-service-state"><h2>Parcel booking is currently unavailable</h2><p role="status">We’re not accepting new parcel deliveries right now. Please check back later.</p><p>You can still view and track your existing deliveries from Delivery history.</p><button onClick={()=>refresh(x=>x+1)}>Check availability</button><a className="customer-service-action" href="/grocery-home">Back to shopping</a></section>:track&&booking?<>
      <ParcelCustomerStatus booking={booking} justBooked={justBooked===track}/><ParcelMap pickup={booking.details.pickup} dropoff={booking.details.dropoff} route={booking.route}/>
      {booking.paymentMethod==='online'&&['payment_pending','payment_failed'].includes(booking.status)&&<section className="parcel-card"><p>{busy?"Opening secure Razorpay checkout…":"Complete your payment securely with Razorpay."}</p><button disabled={busy} onClick={()=>payOnline(booking)}>{busy?"Payment in progress…":"Pay "+money(booking.feePaise)+" online"}</button><button disabled={busy} onClick={()=>action('payment-status',{})}>Check payment status</button></section>}
      {['picked_up','in_transit','arrived_at_dropoff'].includes(booking.status)&&!booking.canCancel&&<p className="parcel-card parcel-cancel-closed">Your parcel has been picked up, so this booking can no longer be cancelled.</p>}
      {booking.canCancel&&<details className="parcel-card"><summary>Cancel this booking</summary><form onSubmit={e=>{e.preventDefault();action('cancellation',{version:booking.version,reason:new FormData(e.currentTarget).get('reason')});}}><label>Cancellation reason<input name="reason" required maxLength={500}/></label><p>Cancellation and any refund are reviewed under the accepted terms.</p><button disabled={busy}>Request cancellation review</button></form></details>}
    </>:history?<section className="parcel-card"><h2>Your parcel deliveries</h2>{!rows.length?<div className="parcel-empty-state"><div className="parcel-empty-icon" aria-hidden="true"><svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg></div><p className="parcel-empty-title">No parcel bookings yet.</p><p className="parcel-empty-subtitle">When you book a parcel pickup or delivery, its status and tracking will appear here.</p><button type="button" className="parcel-btn-book-now" onClick={()=>nav('/parcel-delivery/book')}>Book a parcel →</button></div>:<>{rows.map(b=><button type="button" className="parcel-row" key={b._id} onClick={()=>nav(`/parcel-delivery/track/${b._id}`)}><span className="parcel-row-text">{b.reference} · {parcelCustomerStatus(b.status)} · {money(b.feePaise)}</span><span className="parcel-row-arrow" aria-hidden="true">→</span></button>)}{meta.pages>1&&<nav className="customer-service-pagination" aria-label="Pagination"><button type="button" disabled={page<=1} onClick={()=>setPage(x=>x-1)}>Previous</button><span> Page {page} </span><button type="button" disabled={page>=meta.pages} onClick={()=>setPage(x=>x+1)}>Next</button></nav>}</>}</section>:<>
      <ParcelBookingFlow policy={policy} flags={flags} addresses={addresses} profile={session?.profile} onBooked={b=>{setBooking(b);setJustBooked(b.paymentMethod==='online'?false:b._id);nav('/parcel-delivery/track/'+b._id);if(b.paymentMethod==='online')void payOnline(b);}}/>
    </>}
  </section>;
}
