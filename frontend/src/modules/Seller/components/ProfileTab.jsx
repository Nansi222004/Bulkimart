import ModalPortal from '../../../components/ModalPortal';
import React, { useEffect, useRef, useState } from 'react';
import { useSeller } from '../context/SellerContext';
import { apiUrl } from '../../../utils/api';
import { boundedFetch } from '../../../utils/portalRequests';
import PickupSyncCard from './PickupSyncCard';
import { useFeedback } from '../../../components/feedback/FeedbackProvider';

/** Readable text for a reverse-geocode result: building name (if any) + postal address. */
export const readableAddress = a => {
  if (!a) return null;
  const postal = a.formatted || [a.address, a.city, a.state, a.pincode].filter(Boolean).join(', ');
  if (a.placeName && postal && !postal.includes(a.placeName)) return `${a.placeName}, ${postal}`;
  return postal || a.placeName || null;
};

/** Turns the saved store pin into an address so sellers never see raw latitude/longitude. */
const usePinnedAddress = (lat, lng, lookup) => {
  const [state, setState] = useState({ text: null, loading: false });
  // The context recreates lookup on every render; only new coordinates should trigger a lookup.
  const lookupRef = useRef(lookup);
  lookupRef.current = lookup;
  useEffect(() => {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) { setState({ text: null, loading: false }); return undefined; }
    let alive = true;
    setState({ text: null, loading: true });
    lookupRef.current(lat, lng).then(result => { if (alive) setState({ text: result?.ok ? readableAddress(result.address) : null, loading: false }); })
      .catch(() => { if (alive) setState({ text: null, loading: false }); });
    return () => { alive = false; };
  }, [lat, lng]);
  return state;
};

const TrashIcon = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>;

/** Delete-account card. DELETE /api/sellers/account; the server blocks it (409) while orders, returns or payouts are open. */
const DeleteAccountCard = () => {
  const ui = useFeedback();
  const { logoutSeller, triggerToast } = useSeller();
  const remove = () => ui.perform({
    title: 'Delete seller account?',
    message: 'This permanently closes your store on Bulkimart and cannot be undone. Accounts with active orders, open returns or pending payouts cannot be deleted until those are settled.',
    destructive: true,
    confirmLabel: 'Delete account',
    cancelLabel: 'Keep account',
  }, async () => {
    const res = await boundedFetch(apiUrl('/api/sellers/account'), { method: 'DELETE', headers: { Authorization: `Bearer ${localStorage.getItem('sellerToken') || ''}` } });
    const body = await res.json().catch(() => ({}));
    // Shown inside the open dialog (e.g. the 409 "active orders" reason).
    if (!res.ok) return { ok: false, message: body.message || 'Could not delete seller account.' };
    triggerToast(body.message || 'Seller account deleted.');
    await logoutSeller();
    return true;
  });
  return <section className="seller-profile-card seller-danger-card" aria-labelledby="seller-delete-title">
    <div className="seller-danger-head"><span className="seller-danger-icon"><TrashIcon /></span><div><h2 id="seller-delete-title">Delete account</h2><p>Permanently close your seller account and remove your store from Bulkimart. Settle active orders, returns and payouts first.</p></div></div>
    <button type="button" className="seller-danger-btn" onClick={remove}><TrashIcon />Delete my seller account</button>
  </section>;
};

const shown = value => value || 'Not provided';
const statuses = { approved: 'Approved seller', pending: 'Pending review', under_review: 'Under review', rejected: 'Rejected', suspended: 'Suspended', incomplete: 'Registration incomplete' };
const profileFields = [['name','Store name',160],['phone','Alternate mobile number',16],['email','Store email',254],['description','Store description',2000],['address','Address',500],['city','City / district',100],['state','State',100],['pincode','Pincode',6]];
export function validateProfile(form) {
  const errors = {};
  if (!form.name.trim()) errors.name = 'Store name is required';
  if (form.phone && !/^(?:\+91)?[6-9]\d{9}$/.test(form.phone.trim())) errors.phone = 'Enter a valid 10-digit mobile number';
  if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) errors.email = 'Enter a valid email address';
  if (form.pincode && !/^[1-9]\d{5}$/.test(form.pincode.trim())) errors.pincode = 'Enter a valid 6-digit pincode';
  return errors;
}
export const SellerProfileEditor = ({ seller, onClose }) => {
  const { updateSellerProfile, profileSaving } = useSeller();
  const [form, setForm] = useState(() => Object.fromEntries(profileFields.map(([key]) => [key,seller.storeDetails?.[key] || ''])));
  const [errors,setErrors] = useState({}), [error,setError] = useState('');
  const lock=useRef(false), alive=useRef(true);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  const save=async event=>{
    event.preventDefault();if(lock.current)return;
    const validation=validateProfile(form);setErrors(validation);if(Object.keys(validation).length)return;
    lock.current=true;setError('');
    try {const result=await updateSellerProfile(form);if(!alive.current)return;if(result?.ok)onClose();else if(!result?.stale)setError(result?.message || 'Could not save profile');}
    finally {lock.current=false;}
  };
  return <ModalPortal className="seller-modal-overlay" role="dialog" aria-modal="true" aria-label="Edit seller profile">
    <form className="seller-modal-sheet seller-profile-editor" onSubmit={save} noValidate>
      <h2>Edit Profile</h2><p>Update your store contact and business details. Account identity, verification and approval are managed separately.</p>
      <label>Seller ID<input value={seller._id || seller.id || ''} readOnly /></label>
      <div className="seller-profile-fields">{profileFields.map(([key,label,max])=><label key={key}>{label}{key==='name'?' *':''}
        <input name={key} value={form[key]} maxLength={max} type={key==='email'?'email':'text'} disabled={profileSaving} aria-invalid={!!errors[key]} aria-describedby={errors[key]?`profile-${key}-error`:undefined} onChange={e=>setForm(current=>({...current,[key]:e.target.value}))}/>
        {errors[key]&&<span role="alert" id={`profile-${key}-error`}>{errors[key]}</span>}
      </label>)}</div>
      {error&&<p role="alert">{error}</p>}
      <div className="seller-profile-actions"><button type="button" disabled={profileSaving} onClick={onClose}>Cancel</button><button type="submit" disabled={profileSaving}>{profileSaving?'Saving…':'Save Profile'}</button></div>
    </form>
  </ModalPortal>;
};
export const ProfileTab = () => {
  const {sellerProfile:s,profileLoading,profileError,fetchSellerProfile,triggerToast,lookupStoreAddress} = useSeller();
  const pinned = usePinnedAddress(s?.storeDetails?.lat, s?.storeDetails?.lng, lookupStoreAddress);
  const [editing,setEditing]=useState(false), [pinning,setPinning]=useState(false);
  const alive=useRef(true);
  useEffect(()=>{alive.current=true;fetchSellerProfile({fresh:true});return()=>{alive.current=false;};},[fetchSellerProfile]);
  const token=localStorage.getItem('sellerToken');
  const current=()=>alive.current&&token===localStorage.getItem('sellerToken');
  const pin=()=>{
    if(pinning)return;
    if(!navigator.geolocation){triggerToast('Location is unavailable in this browser.');return;}
    setPinning(true);
    navigator.geolocation.getCurrentPosition(async position=>{
      if(!current())return;
      try {
        const response=await boundedFetch(apiUrl('/api/sellers/profile'),{method:'PUT',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({lat:position.coords.latitude,lng:position.coords.longitude})});
        const body=await response.json();if(!response.ok)throw new Error(body.message || 'Could not update location');
        if(current()){await fetchSellerProfile({fresh:true});triggerToast('Store location pinned.');}
      }catch(error){if(current())triggerToast(error.message, {type:'error'});}
      finally{if(current())setPinning(false);}
    },()=>{if(current()){setPinning(false);triggerToast('Allow location access to pin your store.');}},{enableHighAccuracy:true,timeout:15000,maximumAge:0});
  };
  if(!s)return <section className="seller-profile-card" role={profileError?'alert':'status'}><p>{profileLoading?'Loading seller profile…':profileError || 'No store details found. Complete your seller registration.'}</p>{!profileLoading&&<button onClick={()=>fetchSellerProfile({fresh:true})}>Retry profile</button>}</section>;
  const store=s.storeDetails || {}, account=typeof s.userId==='object'?s.userId:{};
  const id=s._id || s.id;
  return <div className="seller-profile-page">
    <header className="seller-profile-hero"><div className="seller-profile-avatar-large">{(store.name || s.businessName || 'S').slice(0,1).toUpperCase()}</div><div><small>SELLER · {statuses[s.status] || 'Status unavailable'}</small><h1>{shown(s.businessName || account.name)}</h1><p>{shown(store.name)}</p><small>Seller ID: {id || 'Unavailable'}</small></div><button onClick={()=>setEditing(true)} disabled={profileLoading}>Edit Profile</button></header>
    <div className="seller-profile-grid"><div>
      <section className="seller-profile-card"><h2>Business Profile</h2><dl className="seller-profile-fields">
        {[['Seller identity',account.name || s.businessName],['Store name',store.name],['Contact number',account.phone],['Alternate phone',store.phone],['Account email',account.email],['Store email',store.email],['Business email',s.email],['Store description',store.description]].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{shown(value)}</dd></div>)}
      </dl></section>
      <section className="seller-profile-card"><div className="seller-profile-actions"><h2>Store Address & Location Pin</h2><button disabled={pinning||profileLoading} onClick={pin}>{pinning?'Pinning…':'Update Location'}</button></div><dl className="seller-profile-fields">{[['Address',store.address],['City / district',store.city],['State',store.state],['Pincode',store.pincode],['Pinned location',Number.isFinite(store.lat)&&Number.isFinite(store.lng)?(pinned.loading?'Finding address…':pinned.text || [store.address,store.city,store.state,store.pincode].filter(Boolean).join(', ') || 'Pinned on the map'):'Not pinned yet']].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{shown(value)}</dd></div>)}</dl></section>
    </div><aside><section className="seller-profile-card seller-profile-trust"><h2>Security & Trust</h2><dl>{[['Verification',statuses[s.status]],['Partner tier',s.partnerTier],['Region',[store.city,store.state].filter(Boolean).join(', ')],['Seller status',s.status]].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value || 'Unavailable'}</dd></div>)}</dl><p>Account identity and approval cannot be changed through store profile editing.</p></section><PickupSyncCard seller={s} refreshSeller={fetchSellerProfile}/></aside></div>
    <DeleteAccountCard />
    {editing&&<SellerProfileEditor key={String(id)} seller={s} onClose={()=>setEditing(false)}/>}
  </div>;
};
export default ProfileTab;
