import React, { useState } from 'react';
import { apiUrl } from '../../../utils/api';
import { normalizeRiderDocument, vehicleNumberError, drivingLicenceError, VEHICLE_NUMBER_EXAMPLE, DRIVING_LICENCE_EXAMPLE } from '../../../../../backend/shared/riderDocuments.mjs';

export const RIDER_VEHICLES = [['bicycle', 'Bicycle'], ['bike', 'Bike'], ['auto', 'Auto'], ['car', 'Car']];

/**
 * An approved rider changes their vehicle (e.g. bike → auto). Parcel bookings are offered by
 * vehicle, so this decides which bookings the rider receives. The server refuses while a
 * delivery is in progress and tells admins to re-check the documents.
 */
export default function RiderVehicleEditor({ profile, onSaved }) {
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [form, setForm] = useState({ vehicleType: '', vehicleNo: '', licenseNo: '', licenseExpiry: '', licenseFile: null });
  if (profile?.status !== 'approved') return null;
  const start = () => { setForm({ vehicleType: profile.vehicleType || 'bike', vehicleNo: profile.vehicleNo || '', licenseNo: profile.drivingLicense?.no || '', licenseExpiry: '', licenseFile: null }); setError(''); setNotice(''); setOpen(true); };
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const needsLicence = form.vehicleType !== 'bicycle';
  const save = async e => {
    e.preventDefault();
    const problem = vehicleNumberError(form.vehicleNo, form.vehicleType) || (needsLicence && drivingLicenceError(form.licenseNo)) || (needsLicence && !form.licenseFile && !profile.drivingLicense?.url && 'Please upload a photo of your driving licence');
    if (problem) { setError(problem); return; }
    const fd = new FormData();
    fd.append('vehicleType', form.vehicleType);
    fd.append('vehicleNo', normalizeRiderDocument(form.vehicleNo));
    if (needsLicence) { fd.append('licenseNo', normalizeRiderDocument(form.licenseNo)); if (form.licenseExpiry) fd.append('licenseExpiry', form.licenseExpiry); if (form.licenseFile) fd.append('license', form.licenseFile); }
    setBusy(true); setError('');
    try {
      const res = await fetch(apiUrl('/api/delivery/vehicle'), { method: 'PUT', headers: { Authorization: 'Bearer ' + localStorage.getItem('deliveryToken') }, body: fd });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message || 'Your vehicle could not be updated.');
      setOpen(false); setNotice(body.message === 'No changes to save' ? 'Nothing changed.' : 'Vehicle updated. You will now get parcel requests for this vehicle.');
      await onSaved?.(body.data);
    } catch (err) { setError(err.message || 'Network error. Please try again.'); }
    finally { setBusy(false); }
  };
  return <div className="rider-vehicle-editor">
    {notice && <p role="status" className="rider-vehicle-notice">{notice}</p>}
    {!open ? <button type="button" className="rider-vehicle-secondary" onClick={start}>Change vehicle</button> : <form onSubmit={save} className="rider-vehicle-form">
      <h5>Change your vehicle</h5>
      <p>Parcel bookings are sent to riders by vehicle. You can change it when you are not carrying a delivery.</p>
      <label>Vehicle type<select value={form.vehicleType} onChange={e => set('vehicleType', e.target.value)}>{RIDER_VEHICLES.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></label>
      <label>Vehicle number<input required value={form.vehicleNo} placeholder={form.vehicleType === 'bicycle' ? 'Frame or registration number' : VEHICLE_NUMBER_EXAMPLE} maxLength={20} onChange={e => set('vehicleNo', e.target.value)}/></label>
      {needsLicence && <>
        <label>Driving licence number<input required value={form.licenseNo} placeholder={DRIVING_LICENCE_EXAMPLE} maxLength={20} onChange={e => set('licenseNo', e.target.value)}/></label>
        <label>Licence expiry (optional)<input type="date" value={form.licenseExpiry} onChange={e => set('licenseExpiry', e.target.value)}/></label>
        <label>Licence photo{profile.drivingLicense?.url ? ' (optional, keeps your current photo)' : ''}<input type="file" accept="image/*" onChange={e => set('licenseFile', e.target.files?.[0] || null)}/></label>
      </>}
      {error && <p role="alert" className="rider-vehicle-error">{error}</p>}
      <div className="rider-vehicle-actions"><button type="button" className="rider-vehicle-secondary" disabled={busy} onClick={() => setOpen(false)}>Cancel</button><button className="rider-vehicle-primary" disabled={busy}>{busy ? 'Saving…' : 'Save vehicle'}</button></div>
      <small>Our team is told about the change and may re-check your documents.</small>
    </form>}
  </div>;
}
