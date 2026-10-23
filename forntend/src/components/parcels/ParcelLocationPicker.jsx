import React, { useEffect, useRef, useState } from 'react';
import { parcelLocationLookup, validParcelLocation } from './parcelApi';

export default function ParcelLocationPicker({ value, onChange, mode = 'customer', label = 'Search address or landmark', initialQuery = '' }) {
  const [query, setQuery] = useState(initialQuery), [busy, setBusy] = useState(false);
  const [candidate, setCandidate] = useState(null), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const operation = useRef(0), controller = useRef(null), latest = useRef({ value, onChange });
  latest.current = { value, onChange };
  useEffect(() => () => { operation.current++; controller.current?.abort(); }, []);
  const start = () => {
    controller.current?.abort(); controller.current = new AbortController();
    const id = ++operation.current; setBusy(true); setError(''); setNotice(''); setCandidate(null);
    return { id, signal: controller.current.signal };
  };
  const select = (point, address = {}) => {
    const current = latest.current;
    current.onChange({ ...current.value, ...address, lat: point.lat, lng: point.lng });
    setCandidate(null); setNotice('Location selected. Check the address and pincode before continuing.');
  };
  const search = async () => {
    if (query.trim().length < 3) { setError('Enter a street, area or landmark with the city.'); return; }
    const { id, signal } = start();
    try {
      const point = await parcelLocationLookup(mode, 'forward', { q: query.trim() }, signal);
      if (id !== operation.current) return;
      if (!validParcelLocation(point)) throw new Error('No usable location was found. Try a more specific address.');
      setCandidate(point);
    } catch (e) { if (id === operation.current) setError(e.message); }
    finally { if (id === operation.current) setBusy(false); }
  };
  const locate = () => {
    if (!navigator.geolocation) { setError('Current location is unavailable. Search for the address instead.'); return; }
    const { id, signal } = start();
    navigator.geolocation.getCurrentPosition(async position => {
      if (id !== operation.current) return;
      const point = { lat: position.coords.latitude, lng: position.coords.longitude };
      if (!validParcelLocation(point)) { setError('Your location could not be read. Search for the address instead.'); setBusy(false); return; }
      select(point);
      try {
        const address = await parcelLocationLookup(mode, 'reverse', { ...point, accuracy: position.coords.accuracy }, signal);
        if (id !== operation.current) return;
        const patch = {};
        if (address.formatted || address.address) patch.address = address.formatted || [address.address, address.city, address.state].filter(Boolean).join(', ');
        if (address.pincode) patch.pincode = address.pincode;
        select(point, patch);
      } catch {
        if (id === operation.current) setNotice('Current location selected. Please enter the street address and pincode below.');
      } finally { if (id === operation.current) setBusy(false); }
    }, failure => {
      if (id !== operation.current) return;
      setBusy(false); setError(failure.code === 1 ? 'Location permission was denied. Search for the address instead.' : 'Your location could not be found. Try again or search for the address.');
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
  };
  return <div className="parcel-location-picker" aria-busy={busy}>
    <label>{label}<input type="text" value={query} placeholder="Street, landmark or area, city" maxLength={500} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); search(); } }} onChange={e => {
      operation.current++; controller.current?.abort(); setBusy(false); setCandidate(null); setError(''); setNotice(''); setQuery(e.target.value);
      onChange({ ...value, lat: '', lng: '' });
    }}/></label>
    <div className="parcel-location-actions"><button type="button" onClick={search} disabled={busy}>Find address</button><button type="button" onClick={locate} disabled={busy}>Use current location</button></div>
    {busy && <p role="status">Finding location…</p>}
    {candidate && <div className="parcel-location-result"><p>{candidate.matched || query}</p><small>Check that this is the correct place.</small><button type="button" onClick={() => select(candidate, { address: candidate.matched || query })}>Use this location</button></div>}
    {error && <p role="alert" className="parcel-error">{error}</p>}
    {!busy && (notice || validParcelLocation(value)) && <p role="status" className="parcel-location-status">{notice || 'Location selected. You can search to change it.'}</p>}
  </div>;
}
