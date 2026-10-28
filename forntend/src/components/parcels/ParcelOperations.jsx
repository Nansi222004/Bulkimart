import React,{useEffect,useRef,useState} from 'react';
import {parcelRequest as request,parcelMoney as money} from './parcelApi';
import './parcels.css';

import {socket} from '../../utils/socket';
import ParcelAdminPanel from './ParcelAdminPanel';
import {riderParcelStatus,riderNextStep,riderProblemOptions,shortParcelNumber,riderActionNotice,riderFriendlyError} from './parcelRiderText';
export default function ParcelOperations({admin=false}) {return admin?<ParcelAdminPanel/>:<ParcelDriverOperations/>;}
export function ParcelDriverOperations() {
  const mode='driver',query=new URLSearchParams(window.location.search),[id,setId]=useState(query.get('parcel')||''),[items,setItems]=useState([]),[detail,setDetail]=useState(null),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[revision,refresh]=useState(0),[page,setPage]=useState(1),[pages,setPages]=useState(1);
  const lock=useRef(false);
  const backgroundRead=useRef(false);
  useEffect(()=>{

    const update=()=>{if(!lock.current){backgroundRead.current=true;refresh(x=>x+1);}};
    const notification=n=>{if(n?.event==='PARCEL_UPDATED')update();};
    socket.on('notification_new',notification);
    socket.on('connect',update);
    const timer=setInterval(update,10000);
    return()=>{clearInterval(timer);socket.off('notification_new',notification);socket.off('connect',update);};
  },[]);

  useEffect(()=>{const c=new AbortController();const background=backgroundRead.current;backgroundRead.current=false;if(!background){setLoading(true);setDetail(null);}setError('');
    request(mode,id?`/bookings/${id}`:`/bookings?page=${page}`,{signal:c.signal}).then(b=>{if(c.signal.aborted)return;if(id)setDetail(b.data);else{setItems(b.data);setPages(b.meta.pages);}}).catch(e=>{if(c.signal.aborted)return;if(id&&e.status===404){setId('');setNotice('This parcel offer is no longer available.');}else setError(e.message);}).finally(()=>{if(!c.signal.aborted)setLoading(false);});return()=>c.abort();
  },[mode,id,revision,page]);
  const run=async fn=>{if(lock.current)return;lock.current=true;setBusy(true);setError('');setNotice('');try{await fn();refresh(x=>x+1);}catch(e){setError(riderFriendlyError(e));}finally{lock.current=false;setBusy(false);}};
  const act=(action,data={})=>run(async()=>{await request(mode,`/bookings/${id}/actions`,{method:'POST',body:JSON.stringify({action,version:detail.version,...data})});setNotice(riderActionNotice[action]||'Delivery updated.');});
  const offer=(action)=>run(async()=>{try{await request(mode,`/bookings/${id}/offer`,{method:'POST',body:JSON.stringify({action,token:detail.offer.token,version:detail.version})});if(action==='reject'){setId('');setDetail(null);}setNotice(action==='accept'?'Parcel assigned to you.':'Offer declined.');}catch(e){if(e.status===409||e.status===404){setId('');setDetail(null);setNotice('This offer is no longer available or you are no longer eligible.');return;}throw e;}});
  const isOffer=detail?.offer;
  const next=detail&&riderNextStep[detail.status];
  const pickup=detail?.status==='arrived_at_pickup',atAddress=pickup||detail?.status==='arrived_at_dropoff';
  const closed=detail&&['cancelled','delivered','cancellation_review','delivery_failed'].includes(detail.status);
  const cashHere=detail?.paymentMethod==='pay_driver'&&detail.cash?.status==='outstanding'&&detail.status===(detail.cashCollectionPoint==='pickup'?'arrived_at_pickup':'arrived_at_dropoff');
  const earning=detail?.finance?.earningPaise??detail?.earningPaise??detail?.pricing?.driverPaise;
  const routeCard=(title,point,isPickup)=><section className="parcel-rider-address"><span className="parcel-rider-label">{title}</span><h3>{point?.name||title}</h3><p>{point?.address}</p><div className="parcel-rider-contact">{point?.phone&&<a href={'tel:'+point.phone}>{isPickup?'Call sender':'Call recipient'}</a>}{point?.lat!=null&&point?.lng!=null&&<a target="_blank" rel="noreferrer" href={`https://www.google.com/maps/dir/?api=1&destination=${point.lat},${point.lng}`}>Open directions ↗</a>}</div></section>;
  return <main className="parcel-workspace parcel-rider-workspace">
    <header className="parcel-rider-header"><div><span className="parcel-rider-label">Your deliveries</span><h1>Parcel deliveries</h1><p>Accept a request or continue your pickup.</p></div><nav><button className="parcel-rider-secondary" onClick={()=>{setId('');setDetail(null);}}>All parcels</button><button className="parcel-rider-secondary" onClick={()=>refresh(x=>x+1)} disabled={busy}>Refresh</button></nav></header>
    {error&&<p className="parcel-error" role="alert">{error}</p>}{notice&&<p role="status" className="parcel-notice">{notice}</p>}
    {loading?<p role="status">Loading your parcels…</p>:detail?<>
      <section className="parcel-rider-card parcel-rider-overview"><div className="parcel-rider-title"><h2>{shortParcelNumber(detail)}</h2><span className="parcel-rider-badge">{isOffer?'New request':riderParcelStatus(detail.status)}</span></div><div className="parcel-rider-amounts">{earning!=null&&<div><span>You earn</span><strong>{money(earning)}</strong></div>}<div><span>Delivery fee</span><strong>{money(detail.feePaise)}</strong></div></div>
        <p className="parcel-rider-payment">{detail.paymentMethod==='online'?(detail.paymentStatus==='paid'?'Paid online · Do not collect cash':'Online payment needs checking'):['collected_unreconciled','reconciled'].includes(detail.cash?.status)?'Cash received · No more cash to collect':`Collect ${money(detail.feePaise)} at ${detail.cashCollectionPoint==='pickup'?'pickup from the sender':'delivery from the recipient'}`}</p>
        {isOffer&&<div className="parcel-rider-area-route"><div><span>Pickup area</span><strong>{detail.pickupArea}</strong></div><span aria-hidden="true">→</span><div><span>Delivery area</span><strong>{detail.dropoffArea}</strong></div>{detail.weightKg!=null&&<small>{detail.weightKg} kg parcel</small>}</div>}
      </section>
      {isOffer?<section className="parcel-rider-card parcel-rider-next"><h2>Can you take this parcel?</h2><p>Accept to see the pickup address and contact details.</p><small>Reply by {new Date(detail.offer.expiresAt).toLocaleTimeString('en-IN',{hour:'numeric',minute:'2-digit'})}</small><div className="parcel-rider-offer-actions"><button className="parcel-rider-primary" disabled={busy||new Date(detail.offer.expiresAt)<=new Date()} onClick={()=>offer('accept')}>Accept parcel</button><button className="parcel-rider-secondary" disabled={busy} onClick={()=>offer('reject')}>Decline</button></div></section>:<>
        {!closed&&<section className="parcel-rider-card parcel-rider-next"><span className="parcel-rider-label">Next step</span><h2>{atAddress?(pickup?'Confirm parcel pickup':'Complete the delivery'):riderParcelStatus(detail.status)}</h2>
          {next&&<><p>{next.help}</p><button className="parcel-rider-primary" disabled={busy} onClick={()=>act(next.action)}>{busy?'Updating…':next.label}</button></>}
          {cashHere&&<div className="parcel-rider-cash-step"><strong>Collect {money(detail.feePaise)} first</strong><p>Receive the exact delivery fee from {detail.cashCollectionPoint==='pickup'?'the sender':'the recipient'}, then record it below.</p><button className="parcel-rider-primary" disabled={busy} onClick={()=>act('collect_cash',{amountPaise:detail.feePaise})}>I received {money(detail.feePaise)} cash</button></div>}
          {atAddress&&<><p>{pickup?'Ask the sender for the 6-digit pickup code in their parcel tracking page.':'Ask the recipient for the 6-digit delivery code shared by the customer.'}</p><button className="parcel-rider-secondary" disabled={busy} onClick={()=>act(pickup?'pickup_code':'delivery_code')}>{pickup?'Send pickup code':'Send delivery code'}</button><form className="parcel-rider-code-form" onSubmit={e=>{e.preventDefault();act(pickup?'verify_pickup':'verify_delivery',{code:new FormData(e.currentTarget).get('code')});}}><label>{pickup?'Sender’s pickup code':'Recipient’s delivery code'}<input name="code" required pattern="[0-9]{6}" maxLength={6} inputMode="numeric" autoComplete="one-time-code" placeholder="Enter 6-digit code" disabled={busy}/></label><button className="parcel-rider-primary" disabled={busy||cashHere}>{busy?'Checking code…':pickup?'Confirm pickup':'Complete delivery'}</button>{cashHere&&<small>Record the cash payment before confirming.</small>}</form></>}
        </section>}
        {closed&&<section className="parcel-rider-card"><h2>{riderParcelStatus(detail.status)}</h2><p>{detail.status==='delivered'?'The parcel has been delivered. Thank you!':detail.status==='cancelled'?'This booking is closed. You do not need to continue this delivery.':'This delivery is paused while the team reviews it. Keep any collected parcel safe and wait for instructions.'}</p></section>}
        {detail.details?.pickup&&<section className="parcel-rider-card parcel-rider-note" aria-label="Parcel and pickup note"><span className="parcel-rider-label">Pickup note from the sender</span>
          <p className={detail.details.instructions?'parcel-rider-note-text':'parcel-rider-note-empty'}>{detail.details.instructions||'No pickup note was added.'}</p>
          <dl>{detail.details.category&&<><dt>Parcel</dt><dd>{detail.details.category.replaceAll('_',' ')}</dd></>}{detail.details.description&&<><dt>Contents</dt><dd>{detail.details.description}</dd></>}{detail.details.weightKg!=null&&<><dt>Weight</dt><dd>{detail.details.weightKg} kg{Array.isArray(detail.details.dimensions)&&detail.details.dimensions.length===3?` · ${detail.details.dimensions.join(' × ')} cm`:''}</dd></>}</dl>
        </section>}
        {detail.details?.pickup&&<div className="parcel-rider-route">{routeCard('Collect from',detail.details.pickup,true)}{routeCard('Deliver to',detail.details.dropoff,false)}</div>}
        {!closed&&<details className="parcel-rider-card parcel-rider-help"><summary>Need help with this delivery?</summary><p>Tell the team what is wrong. This pauses the delivery until they review it.</p><form onSubmit={e=>{e.preventDefault();act('exception',{reason:new FormData(e.currentTarget).get('reason')});}}><label>What’s the problem?<select name="reason" required disabled={busy}>{riderProblemOptions.map(([value,title])=><option value={value} key={value}>{title}</option>)}</select></label><button className="parcel-rider-secondary" disabled={busy}>Ask support for help</button></form></details>}
      </>}
      <details className="parcel-rider-card parcel-rider-reference"><summary>Booking and payment details</summary><p className="parcel-rider-full-number">{detail.reference}</p>{earning!=null&&<p>Your earning: {money(earning)}. {detail.finance?.held?'It will be reviewed after delivery before payment is released.':'Check Earnings for payment details.'}</p>}{detail.details?.weightKg!=null&&<p>Parcel weight: {detail.details.weightKg} kg</p>}</details>
    </>:<><section className="parcel-rider-list"><h2>Your requests and tasks</h2>{!items.length&&<div className="parcel-rider-card parcel-rider-empty"><h3>No parcel requests yet</h3><p>Stay on duty and keep your location updated. New requests will appear here.</p><a href="/delivery/dashboard">Back to duty dashboard</a></div>}{items.map(b=><button className="parcel-row parcel-rider-list-card" key={b._id} onClick={()=>setId(b._id)}><div><strong>{shortParcelNumber(b)}</strong><span className="parcel-rider-badge">{b.offer?'New request':riderParcelStatus(b.status)}</span></div><p>{b.offer?`${b.pickupArea} → ${b.dropoffArea}`:`${b.details?.pickup?.pincode||'Pickup'} → ${b.details?.dropoff?.pincode||'Delivery'}`}</p><span>{(b.earningPaise??b.finance?.earningPaise)!=null?'You earn '+money(b.earningPaise??b.finance?.earningPaise):'Delivery fee '+money(b.feePaise)}</span><small>Open parcel →</small><span className="parcel-rider-list-number">{b.reference}</span></button>)}</section>{pages>1&&<nav className="parcel-rider-pagination"><button disabled={page<=1} onClick={()=>setPage(x=>x-1)}>Previous</button><span>Page {page} of {pages}</span><button disabled={page>=pages} onClick={()=>setPage(x=>x+1)}>Next</button></nav>}</>}
  </main>;
}
