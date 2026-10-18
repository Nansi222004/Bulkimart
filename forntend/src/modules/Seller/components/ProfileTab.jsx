import React, { useEffect, useRef, useState } from 'react';
import { useSeller } from '../context/SellerContext';
import { apiUrl } from '../../../utils/api';
import { boundedFetch } from '../../../utils/portalRequests';
import PickupSyncCard from './PickupSyncCard';

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
  return <div className="seller-modal-overlay" role="dialog" aria-modal="true" aria-label="Edit seller profile">
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
  </div>;
};
export const ProfileTab = () => {
  const {sellerProfile:s,profileLoading,profileError,fetchSellerProfile,triggerToast} = useSeller();
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
      <section className="seller-profile-card"><div className="seller-profile-actions"><h2>Store Address & Location Pin</h2><button disabled={pinning||profileLoading} onClick={pin}>{pinning?'Pinning…':'Update Location'}</button></div><dl className="seller-profile-fields">{[['Address',store.address],['City / district',store.city],['State',store.state],['Pincode',store.pincode],['Location pin',Number.isFinite(store.lat)&&Number.isFinite(store.lng)?`${store.lat}, ${store.lng}`:null]].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{shown(value)}</dd></div>)}</dl></section>
    </div><aside><section className="seller-profile-card seller-profile-trust"><h2>Security & Trust</h2><dl>{[['Verification',statuses[s.status]],['Partner tier',s.partnerTier],['Region',[store.city,store.state].filter(Boolean).join(', ')],['Seller status',s.status]].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value || 'Unavailable'}</dd></div>)}</dl><p>Account identity and approval cannot be changed through store profile editing.</p></section><PickupSyncCard seller={s} refreshSeller={fetchSellerProfile}/></aside></div>
    {editing&&<SellerProfileEditor key={String(id)} seller={s} onClose={()=>setEditing(false)}/>}
  </div>;
};
export default ProfileTab;
