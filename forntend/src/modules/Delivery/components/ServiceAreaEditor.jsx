import React, {useRef, useState} from 'react';

export default function ServiceAreaEditor({profile, onSave, onReload}) {
  const [editing,setEditing]=useState(false),[zones,setZones]=useState(''),[version,setVersion]=useState(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[conflict,setConflict]=useState(false);
  const lock=useRef(false);
  const open=()=>{setZones((profile?.zones||[]).join(', '));setVersion(profile?.__v);setEditing(true);setError('');setNotice('');setConflict(false);};
  const save=async event=>{
    event.preventDefault();if(lock.current||conflict)return;
    const entries=[...new Set(zones.split(',').map(value=>value.trim()).filter(Boolean))];
    if(!entries.length||entries.length>50||entries.some(value=>!/^\d{6}$/.test(value))){setError('Enter 1 to 50 valid 6-digit pincodes, separated by commas.');return;}
    lock.current=true;setBusy(true);setError('');setNotice('');
    try{
      const result=await onSave(entries,version);
      if(!result.ok){setError(result.message||'Could not save your service area.');setConflict(result.status===409);return;}
      setEditing(false);setNotice('Service area saved. These pincodes apply to new delivery offers.');
    }catch{setError('Could not save your service area. Please retry.');}
    finally{lock.current=false;setBusy(false);}
  };
  return <section className="rider-service-area-editor">
    {!editing?<button type="button" className="profile-support-btn outline" onClick={open}>Edit service area</button>:<form onSubmit={save}>
      <label htmlFor="rider-service-pincodes">Delivery pincodes</label>
      <textarea id="rider-service-pincodes" rows={3} required disabled={busy} value={zones} onChange={event=>setZones(event.target.value)} aria-describedby="rider-service-pincodes-help"/>
      <p id="rider-service-pincodes-help">Enter every pincode you can serve, separated by commas. Keep your existing pincodes if you still cover them. Example: 452001, 452006.</p>
      <p>Parcel offers require both pickup and drop pincodes, an available rider near pickup, and an approved parcel service area.</p>
      <div className="rider-service-area-actions"><button type="submit" disabled={busy||conflict}>{busy?'Saving…':'Save service area'}</button><button type="button" disabled={busy} onClick={()=>{setEditing(false);setError('');setConflict(false);}}>Cancel</button></div>
      {conflict&&<button type="button" className="profile-support-btn outline" disabled={busy} onClick={async()=>{if(lock.current)return;lock.current=true;setBusy(true);try{const result=await onReload();if(!result?.ok){setError(result?.message||'Could not refresh your profile. Please retry.');return;}setEditing(false);setConflict(false);setError('');setNotice('Profile refreshed. Open Edit service area to review the saved pincodes.');}catch{setError('Could not refresh your profile. Please retry.');}finally{lock.current=false;setBusy(false);}}}>Reload saved service area</button>}
    </form>}
    {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
  </section>;
}
