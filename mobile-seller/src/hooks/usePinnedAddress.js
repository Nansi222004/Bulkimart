import { useEffect, useState } from 'react';
import { reverseGeocode } from '../services/settings.api';

// Turns the saved store pin into a readable address ("Shop 4, MG Road, Indore, MP 452001")
// so sellers never see raw latitude/longitude. Falls back to null when lookup is unavailable.
export default function usePinnedAddress(lat, lng) {
  const [state, setState] = useState({ text: null, loading: false });
  useEffect(() => {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) { setState({ text: null, loading: false }); return undefined; }
    let alive = true;
    setState({ text: null, loading: true });
    reverseGeocode({ lat, lng })
      .then((a) => { if (alive) setState({ text: readableAddress(a), loading: false }); })
      .catch(() => { if (alive) setState({ text: null, loading: false }); });
    return () => { alive = false; };
  }, [lat, lng]);
  return state;
}

export function readableAddress(a) {
  if (!a) return null;
  const postal = a.formatted || [a.address, a.city, a.state, a.pincode].filter(Boolean).join(', ');
  // When a building/shop name was found, lead with it unless the postal line already contains it.
  if (a.placeName && postal && !postal.includes(a.placeName)) return `${a.placeName}, ${postal}`;
  return postal || a.placeName || null;
}
