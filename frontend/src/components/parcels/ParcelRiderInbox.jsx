import React,{useEffect,useRef,useState} from 'react';
import {parcelRequest as request,parcelMoney as money} from './parcelApi';
import {socket} from '../../utils/socket';
import {riderParcelStatus} from './parcelRiderText';
import './parcels.css';
export default function ParcelRiderInbox({enabled}) {
  const [items,setItems]=useState([]),[error,setError]=useState(''),[busy,setBusy]=useState(''),[notice,setNotice]=useState('');
  const mounted=useRef(false),readAbort=useRef(null),generation=useRef(0),lock=useRef(false);
  const load=async()=>{
    readAbort.current?.abort();const controller=new AbortController();readAbort.current=controller;const current=++generation.current;
    try{const response=await request('driver','/bookings?limit=100',{signal:controller.signal});if(mounted.current&&current===generation.current){setItems((response.data||[]).filter(b=>b.offer||!['delivered','cancelled'].includes(b.status)));setError('');}}
    catch(e){if(mounted.current&&!controller.signal.aborted&&current===generation.current)setError(e.message);}
  };
  useEffect(()=>{
    if(!enabled){setItems([]);return;}
    mounted.current=true;void load();
    const update=n=>{if(n?.event==='PARCEL_UPDATED')void load();};
    const reconnect=()=>void load();socket.on('notification_new',update);socket.on('connect',reconnect);
    const timer=setInterval(()=>void load(),10000);
    return()=>{mounted.current=false;generation.current++;readAbort.current?.abort();clearInterval(timer);socket.off('notification_new',update);socket.off('connect',reconnect);};
  },[enabled]);
  const respond=async(b,action)=>{
    if(lock.current)return;lock.current=true;readAbort.current?.abort();generation.current++;setBusy(b._id);setError('');setNotice('');
    try{await request('driver',`/bookings/${b._id}/offer`,{method:'POST',body:JSON.stringify({action,token:b.offer.token,version:b.version})});if(mounted.current)setNotice(action==='accept'?'Parcel assigned to you. Open the task for pickup details.':'Parcel offer declined.');}
    catch(e){if(mounted.current){if(e.status===409||e.status===404){setItems(rows=>rows.filter(row=>row._id!==b._id));setNotice('This offer is no longer available or you are no longer eligible.');}else setError(e.message);}}
    finally{lock.current=false;if(mounted.current){setBusy('');await load();}}
  };
  if(!enabled)return null;
  return <section className="parcel-rider-inbox" aria-label="Parcel offers and tasks">
    <div className="parcel-inbox-heading"><h2>Parcel deliveries{items.length?` (${items.length})`:''}</h2><a href="/delivery/parcels">View all</a></div>
    {error&&<p role="alert">Could not refresh parcel offers. <button type="button" onClick={load}>Retry</button></p>}
    {notice&&<p role="status">{notice}</p>}
    {!items.length&&!error&&<p className="parcel-inbox-empty">No new parcel requests. Stay on duty with your location on.</p>}
    {items.map(b=><article className="parcel-inbox-offer" key={b._id}>
      <strong>{b.offer?'New parcel request':riderParcelStatus(b.status)}</strong>
      <p className="parcel-inbox-route">{b.offer?`${b.pickupArea} → ${b.dropoffArea}`:`${b.details?.pickup?.pincode||'Pickup'} → ${b.details?.dropoff?.pincode||'Drop-off'}`}</p>
      {(b.earningPaise??b.finance?.earningPaise)!=null&&<p className="parcel-inbox-earning">You earn <strong>{money(b.earningPaise??b.finance?.earningPaise)}</strong></p>}
      {b.offer?<><small>Accept by {new Date(b.offer.expiresAt).toLocaleTimeString()}</small><div className="parcel-inbox-actions"><button type="button" disabled={!!busy||new Date(b.offer.expiresAt)<=new Date()} onClick={()=>respond(b,'accept')}>{busy===b._id?'Updating…':'Accept parcel'}</button><button type="button" disabled={!!busy} onClick={()=>respond(b,'reject')}>Decline</button></div></>:null}
      <a href={'/delivery/parcels?parcel='+b._id}>{b.offer?'View offer':'Open pickup and delivery task'}</a>
    </article>)}
  </section>;
}
