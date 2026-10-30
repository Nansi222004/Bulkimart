import React, { useEffect, useRef, useState } from 'react';
import { parcelLocationLookup, validParcelLocation } from './parcelApi';
import { parcelPlaceSuggestions, resolveParcelPlace } from '../../utils/googleMaps';
import ParcelMap from './ParcelMap';

export default function ParcelLocationPicker({ value, onChange, mode = 'customer', label = 'Search address or landmark', initialQuery = '', confirmLocation = false, showMap = false, areaMode = false, radiusKm, idPrefix = 'parcel' }) {
  const [query, setQuery] = useState(initialQuery), [busy, setBusy] = useState(false);
  const [candidate, setCandidate] = useState(null), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const operation = useRef(0), controller = useRef(null), latest = useRef({ value, onChange });
  const [suggestions, setSuggestions] = useState([]), [autocompleteError, setAutocompleteError] = useState(''), [highlight, setHighlight] = useState(-1);
  const token = useRef(null), suggestionGeneration = useRef(0);
  const [typing, setTyping] = useState(false);
  const [suggestionBusy, setSuggestionBusy] = useState(false);
  latest.current = { value, onChange };
  useEffect(() => () => { operation.current++; controller.current?.abort(); }, []);
  useEffect(() => {
    if (!confirmLocation || !typing || query.trim().length < 3) return;
    const id = ++suggestionGeneration.current;
    const timer = setTimeout(() => {
      if (id !== suggestionGeneration.current) return;
      setSuggestionBusy(true);
      parcelPlaceSuggestions(query.trim(), token.current).then(result => {
        if (id !== suggestionGeneration.current) return;
        token.current = result.token; setSuggestions(result.suggestions); setAutocompleteError(result.suggestions.length ? '' : 'No suggestions found. Try a full street address and city, or choose a pin on the map.');
      }).catch(() => { if (id === suggestionGeneration.current) { setSuggestions([]); setAutocompleteError('Suggestions unavailable. Use Find address or choose a pin on the map.'); } }).finally(() => { if (id === suggestionGeneration.current) setSuggestionBusy(false); });
    }, 350);
    return () => { clearTimeout(timer); suggestionGeneration.current++; };
  }, [query, confirmLocation, typing]);
  const start = () => {
    controller.current?.abort(); controller.current = new AbortController();
    if (confirmLocation) latest.current.onChange({ ...latest.current.value, lat: '', lng: '' });
    const id = ++operation.current; suggestionGeneration.current++; setSuggestionBusy(false); setSuggestions([]); setBusy(true); setError(''); setNotice(''); setCandidate(null);
    return { id, signal: controller.current.signal };
  };
  const select = (point, address = {}) => {
    const current = latest.current;
    current.onChange({ ...current.value, ...address, lat: point.lat, lng: point.lng });
    setCandidate(null); setNotice('Location selected. Check the address and pincode before continuing.');
  };
  const prepare = async (point, id, signal, accuracy) => {
    let patch = { ...point };
    try {
      const address = await parcelLocationLookup(mode, 'reverse', { lat: point.lat, lng: point.lng, ...(accuracy ? { accuracy } : {}) }, signal);
      patch = { ...patch, address: point.address || address.formatted || [address.address, address.city, address.state].filter(Boolean).join(', '), pincode: point.pincode || address.pincode || '', approximate: point.approximate === true || accuracy > 50 };
    } catch {
      patch = { ...patch, approximate: true };
      if (id === operation.current) setNotice('Address lookup unavailable. Confirm this pin and enter the full address and pincode in the next step.');
    }
    if (id === operation.current) setCandidate(patch);
  };
  const chooseSuggestion = async item => {
    const { id } = start();
    try {
      const point = await resolveParcelPlace(item.prediction);
      if (!validParcelLocation(point)) throw new Error('No usable location found. Try address search.');
      if (id === operation.current) { setCandidate(point); token.current = null; }
    } catch (e) { if (id === operation.current) setError(e.message); }
    finally { if (id === operation.current) setBusy(false); }
  };
  const movePin = async point => {
    const { id, signal } = start();
    await prepare(point, id, signal);
    if (id === operation.current) setBusy(false);
  };
  const search = async () => {
    if (query.trim().length < 3) { setError('Enter a street, area or landmark with the city.'); return; }
    const { id, signal } = start();
    try {
      const point = await parcelLocationLookup(mode, 'forward', { q: query.trim() }, signal);
      if (id !== operation.current) return;
      if (!validParcelLocation(point)) throw new Error('No usable location was found. Try a more specific address.');
      if (confirmLocation) {
        const match = { ...point, address: point.matched || query, approximate: point.precision !== 'ROOFTOP' };
        if (/^\d{6}$/.test(point.pincode || '')) setCandidate(match);
        else await prepare(match, id, signal);
      } else setCandidate(point);
    } catch (e) { if (id === operation.current) setError(e.message); }
    finally { if (id === operation.current) setBusy(false); }
  };
  const locate = () => {
    const { id, signal } = start();
    if (window.isSecureContext === false) { setBusy(false); setError('Current location requires a secure connection. Search for the address instead.'); return; }
    if (!navigator.geolocation) { setBusy(false); setError('Current location is unavailable. Search for the address instead.'); return; }
    navigator.geolocation.getCurrentPosition(async position => {
      if (id !== operation.current) return;
      const point = { lat: position.coords.latitude, lng: position.coords.longitude };
      if (!validParcelLocation(point)) { setError('Your location could not be read. Search for the address instead.'); setBusy(false); return; }
      if (confirmLocation) {
        await prepare(point, id, signal, position.coords.accuracy);
        if (id === operation.current) setBusy(false);
        return;
      }
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
      setBusy(false); setError(failure.code === 1 ? 'Location permission was denied. Search for the address instead.' : failure.code === 3 ? 'Location request timed out. Try again or search for the address.' : 'Your location could not be found. Try again or search for the address.');
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
  };
  return <div className="parcel-location-picker" aria-busy={busy || suggestionBusy}>
    <label>{label}<input type="text" value={query} autoComplete="off" role={confirmLocation ? 'combobox' : undefined} aria-expanded={suggestions.length > 0} aria-controls={confirmLocation ? idPrefix + '-place-results' : undefined} aria-activedescendant={highlight >= 0 && suggestions[highlight] ? idPrefix + '-place-' + highlight : undefined} placeholder="Street, landmark or area, city" maxLength={500} onKeyDown={e => {
      if (e.key === 'ArrowDown' && suggestions.length) { e.preventDefault(); setHighlight(n => (n + 1) % suggestions.length); }
      if (e.key === 'ArrowUp' && suggestions.length) { e.preventDefault(); setHighlight(n => (n - 1 + suggestions.length) % suggestions.length); }
      if (e.key === 'Escape') { suggestionGeneration.current++; setSuggestionBusy(false); setSuggestions([]); setHighlight(-1); }
      if (e.key === 'Enter') { e.preventDefault(); if (suggestions[highlight]) chooseSuggestion(suggestions[highlight]); else search(); }
    }} onChange={e => {
      operation.current++; suggestionGeneration.current++; controller.current?.abort(); setSuggestions([]); setHighlight(-1); setSuggestionBusy(false); setBusy(false); setCandidate(null); setError(''); setNotice(''); setTyping(true); setQuery(e.target.value);
      onChange({ ...value, lat: '', lng: '' });
    }}/></label>
    {suggestions.length > 0 && <><ul id={idPrefix + '-place-results'} role="listbox" aria-label="Address suggestions" className="parcel-suggestions">{suggestions.map((item, index) => <li key={index} id={idPrefix + '-place-' + index} role="option" aria-selected={index === highlight}><button type="button" onClick={() => chooseSuggestion(item)}>{item.text}</button></li>)}</ul><small className="parcel-google-attribution" translate="no">Google Maps</small></>}
    {autocompleteError && <small role="status">{autocompleteError}</small>}
    {suggestionBusy && <p role="status">Searching addresses…</p>}
    <div className="parcel-location-actions"><button type="button" onClick={search} disabled={busy}>Find address</button><button type="button" onClick={locate} disabled={busy}>Use current location</button></div>
    {busy && <p role="status">Finding location…</p>}
    {showMap && <ParcelMap pickup={candidate || value} editable="pickup" onPinChange={movePin} areaMode={areaMode} radiusKm={radiusKm}/>}
    {candidate && <div className="parcel-location-result"><p>{candidate.address || candidate.matched || query || 'Selected map pin'}</p><small>Pincode: {candidate.pincode || 'Not resolved — enter it in address details'}</small><small>{candidate.approximate ? 'Approximate address. Check and correct the pin before confirming.' : 'Check that this is the correct place.'}</small><button type="button" disabled={busy} onClick={() => { suggestionGeneration.current++; setSuggestions([]); select(candidate, { address: candidate.address || candidate.matched || query || '', pincode: candidate.pincode || '', approximate: candidate.approximate === true }); }}>Use this location</button></div>}
    {error && <p role="alert" className="parcel-error">{error}</p>}
    {!busy && (notice || validParcelLocation(value)) && <p role="status" className="parcel-location-status">{notice || 'Location selected. You can search to change it.'}</p>}
  </div>;
}
