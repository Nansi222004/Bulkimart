import React, { useEffect, useRef, useState } from 'react';
import { loadGoogleMaps } from '../../utils/googleMaps';
import { validParcelLocation } from './parcelApi';

export default function ParcelMap({ pickup, dropoff, route, editable, onPinChange, areaMode = false, radiusKm }) {
  const holder = useRef(null), instance = useRef(null), latest = useRef(onPinChange);
  latest.current = editable ? onPinChange : null;
  const [ready, setReady] = useState(0), [retry, setRetry] = useState(0), [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false, listener;
    setError('');
    loadGoogleMaps().then(maps => {
      if (cancelled || !holder.current) return;
      instance.current = new maps.Map(holder.current, { center: { lat: 22.5, lng: 79 }, zoom: 5, mapTypeControl: false, streetViewControl: false, fullscreenControl: false, gestureHandling: 'cooperative' });
      listener = instance.current.addListener('click', event => latest.current?.({ lat: event.latLng.lat(), lng: event.latLng.lng() }));
      setReady(n => n + 1);
    }).catch(() => { if (!cancelled) setError('Interactive map unavailable. You can still find an address using search.'); });
    return () => { cancelled = true; listener?.remove(); instance.current = null; };
  }, [retry]);
  useEffect(() => {
    if (!ready || !instance.current) return;
    const maps = window.google.maps, map = instance.current, items = [], listeners = [];
    const bounds = new maps.LatLngBounds();
    for (const [kind, point, label] of [['pickup', pickup, 'P'], ['dropoff', dropoff, 'D']]) {
      if (!validParcelLocation(point)) continue;
      const position = { lat: Number(point.lat), lng: Number(point.lng) };
      const marker = new maps.Marker({ map, position, label: areaMode ? 'C' : label, title: areaMode ? 'Service area centre' : kind === 'pickup' ? 'Pickup location' : 'Drop location', draggable: editable === kind });
      if (editable === kind) listeners.push(marker.addListener('dragend', e => latest.current?.({ lat: e.latLng.lat(), lng: e.latLng.lng() })));
      bounds.extend(position); items.push(marker);
    }
    let circle;
    if (areaMode && validParcelLocation(pickup) && Number(radiusKm) > 0 && Number(radiusKm) <= 100) {
      circle = new maps.Circle({ map, center: { lat: Number(pickup.lat), lng: Number(pickup.lng) }, radius: Number(radiusKm) * 1000, strokeColor: '#087c9f', strokeWeight: 2, fillColor: '#087c9f', fillOpacity: 0.12, clickable: false });
    }
    if (circle) map.fitBounds(circle.getBounds(), 32);
    else if (items.length > 1) map.fitBounds(bounds, 48);
    else if (items.length) { map.setCenter(bounds.getCenter()); map.setZoom(16); }
    let line;
    if (route?.polyline && maps.geometry?.encoding) {
      line = new maps.Polyline({ map, path: maps.geometry.encoding.decodePath(route.polyline), strokeColor: '#087c9f', strokeWeight: 5 });
    }
    return () => { listeners.forEach(l => l.remove()); items.forEach(m => m.setMap(null)); line?.setMap(null); circle?.setMap(null); };
  }, [ready, pickup?.lat, pickup?.lng, dropoff?.lat, dropoff?.lng, route?.polyline, editable, areaMode, radiusKm]);
  return <div className="parcel-map-wrap">
    <div className="parcel-map" ref={holder} role="region" aria-label={areaMode ? 'Adjust the service area centre and view its coverage circle' : editable ? 'Adjust the ' + editable + ' pin on the map' : 'Pickup and delivery route map'} />
    {error ? <div className="parcel-map-message" role="status">{error} <button type="button" onClick={() => setRetry(n => n + 1)}>Retry map</button></div> : !ready ? <p role="status">Loading map…</p> : editable ? <p className="parcel-map-hint">Tap the map or drag the {areaMode ? 'centre' : editable === 'pickup' ? 'pickup' : 'drop'} pin, then confirm the location.</p> : null}
  </div>;
}
