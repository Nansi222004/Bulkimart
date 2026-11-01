// Coordinate checks and map links. No distance or ETA is computed here:
// those figures come from the server (offer `distance`, `pickupDistance`) or are not shown.

const present = (v) => v !== null && v !== undefined && v !== '';

export function toCoord(point) {
  if (!point || !present(point.lat) || !present(point.lng)) return null;
  const lat = Number(point.lat), lng = Number(point.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  if (lat === 0 && lng === 0) return null; // 0,0 means the address was never located
  return { lat, lng };
}

/** Google Maps turn-by-turn intent for the installed Maps app. */
export const navigationIntentUrl = (coord) => `google.navigation:q=${coord.lat},${coord.lng}`;

/** Web fallback that opens in any browser or maps app. Uses coordinates when valid, otherwise the address text. */
export function directionsWebUrl({ coord, address }) {
  const destination = coord ? `${coord.lat},${coord.lng}` : address ? encodeURIComponent(address) : null;
  return destination ? `https://www.google.com/maps/dir/?api=1&destination=${destination}&travelmode=driving` : null;
}

/** Shop -> customer route preview used on an offer, as the web OrderPingModal does. */
export function routePreviewUrl(pickup, drop) {
  const a = toCoord(pickup), b = toCoord(drop);
  if (a && b) return `https://www.google.com/maps/dir/?api=1&origin=${a.lat},${a.lng}&destination=${b.lat},${b.lng}&travelmode=driving`;
  if (a) return `https://www.google.com/maps/search/?api=1&query=${a.lat},${a.lng}`;
  return null;
}

/** Normalises a phone number for the dialer; null when it is not a plausible number. */
export function dialablePhone(raw) {
  const phone = String(raw || '').replace(/[\s()-]/g, '');
  return /^\+?\d{7,15}$/.test(phone) ? phone : null;
}

/** Six decimals (~0.1 m), the same precision the web portal sends. */
export const roundCoord = (value) => Number(Number(value).toFixed(6));
