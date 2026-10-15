import React, { useEffect, useRef, useState } from 'react';
import { apiUrl } from '../../../utils/api';
const pickupDraft = seller => ({ name: seller.storeDetails?.name || seller.businessName || '', ...Object.fromEntries(['email','phone','address','city','state','pincode'].map(key => [key, seller.storeDetails?.[key] || ''])) });

export default function PickupSyncCard({ seller, refreshSeller }) {
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => pickupDraft(seller));
  const alive = useRef(false), generation = useRef(0), inFlight = useRef(false);
  const request = async (path, options = {}) => {
    const token = localStorage.getItem('sellerToken');
    const response = await fetch(apiUrl(path), { ...options, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } });
    const body = await response.json();
    if (token !== localStorage.getItem('sellerToken')) throw new Error('Seller session changed. Sign in again.');
    if (!response.ok) throw new Error(body.message || 'Could not update pickup registration. Retry after checking your connection.');
    return body;
  };
  const load = async () => {
    const current = ++generation.current;
    try { const body = await request('/api/sellers/pickup-sync'); if (alive.current && current === generation.current) { setStatus(body.data); setError(''); } }
    catch (failure) { if (alive.current && current === generation.current) setError(failure.message); }
  };
  useEffect(() => { alive.current = true; load(); return () => { alive.current = false; generation.current++; }; }, [seller._id]);
  const run = async save => {
    if (inFlight.current) return;
    inFlight.current = true; generation.current++; setBusy(true); setError('');
    try {
      if (save) { await request('/api/sellers/profile', { method: 'PUT', body: JSON.stringify(draft) }); if (alive.current) setEditing(false); }
      else await request('/api/sellers/pickup-sync/retry', { method: 'POST', body: '{}' });
      if (alive.current) { await load(); await refreshSeller?.(); }
    } catch (failure) { if (alive.current) setError(failure.message); }
    finally { inFlight.current = false; if (alive.current) setBusy(false); }
  };
  const state = status?.status;
  const pending = ['pending','syncing'].includes(state);
  return <section className="seller-pickup-sync" aria-label="Shiprocket pickup registration">
    <h3>Shiprocket pickup registration</h3>
    <p role="status">{!status ? error ? 'Registration status unavailable' : 'Checking registration…' : state === 'registered' ? 'Registered' : pending ? 'Pending — automatic synchronization scheduled' : 'Needs attention'}</p>
    {status?.message && <p>{status.message}</p>}
    {status?.locationName && <p>Pickup reference: {status.locationName}</p>}
    {status?.registeredAt && <p>Last confirmed: {new Date(status.registeredAt).toLocaleString()}</p>}
    {state === 'registered' && !status.shippingApproved && <p>Pickup is registered. Shiprocket shipping still requires platform approval.</p>}
    {pending && <p>Refresh status to check progress. Manual Bulkimart delivery remains available.</p>}
    {status?.nextAttemptAt && state !== 'registered' && <p>Next retry window: {new Date(status.nextAttemptAt).toLocaleString()}</p>}
    {error && <p role="alert">{error}</p>}
    <div className="seller-pickup-actions">
      <button type="button" disabled={busy} onClick={load}>Refresh pickup status</button>
      {state !== 'registered' && <button type="button" disabled={busy || pending} onClick={() => run(false)}>Retry pickup synchronization</button>}
      {state === 'registered' && <button type="button" disabled={busy} onClick={() => run(false)}>Recheck pickup registration</button>}
      <button type="button" disabled={busy} onClick={() => { if (!editing) setDraft(pickupDraft(seller)); setEditing(value => !value); }}>Correct pickup address/contact</button>
    </div>
    {editing && <form onSubmit={event => { event.preventDefault(); run(true); }}>
      {Object.keys(draft).map(key => <label key={key}>{({ name: 'Pickup contact/store name', email: 'Pickup contact email', phone: 'Pickup contact phone', address: 'Store pickup street address', city: 'City', state: 'State', pincode: 'Postal code' })[key]}
        <input required type={key === 'email' ? 'email' : key === 'phone' ? 'tel' : 'text'} value={draft[key]} maxLength={key === 'address' ? 80 : key === 'email' ? 254 : 100}
          minLength={key === 'address' ? 10 : undefined} pattern={key === 'pincode' ? '[1-9][0-9]{5}' : undefined}
          onChange={event => setDraft(previous => ({ ...previous, [key]: event.target.value }))} /></label>)}
      <button disabled={busy} type="submit">{busy ? 'Saving…' : 'Save pickup details and synchronize'}</button>
    </form>}
  </section>;
}
