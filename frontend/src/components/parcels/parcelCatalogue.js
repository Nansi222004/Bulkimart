// Parcel availability (GET /capabilities) and catalogue (GET /catalogue: vehicles, areas, categories),
// shared by the Services page's Parcel panel (services/ServicesHub.jsx) and the booking page (ParcelDelivery.jsx).
//
// - While booking is on, both requests run at the same time instead of one after the other.
// - One download serves every caller: the Parcel panel and the booking page opened from it share it.
// - The last good answer is kept in this browser, so the next visit shows vehicles and the Book button at
//   once (and still works offline) while a fresh copy loads. It is only for display: quotes and bookings
//   are always priced and checked by the server against its current policy.
import { parcelRequest } from './parcelApi';
import { parcelBookingEnabled } from './parcelAvailability';

const SAVED_KEY = 'bulkimart:parcel-catalogue';
const validPolicy = p => Boolean(p && Array.isArray(p.areas) && Array.isArray(p.categories) && Array.isArray(p.prohibitedItems));

/** The last answer saved in this browser: { flags, policy } (policy is null while booking is switched off), or null. */
export function savedParcelCatalogue() {
  try {
    const saved = JSON.parse(localStorage.getItem(SAVED_KEY));
    if (typeof saved?.flags?.catalogue !== 'boolean') return null;
    return { flags: saved.flags, policy: validPolicy(saved.policy) ? saved.policy : null };
  } catch { return null; }
}

let pending = null;
/** A fresh { flags, policy } from the server (shared while in flight); saved for the next visit. */
export function loadParcelCatalogue() {
  if (pending) return pending;
  pending = (async () => {
    // Booking was on last time (the usual case): ask for both at once. Otherwise the catalogue is only
    // requested once availability says booking is on, so a switched-off service is never asked for it.
    const wasOn = parcelBookingEnabled(savedParcelCatalogue()?.flags);
    const early = wasOn ? parcelRequest('customer', '/catalogue').catch(error => ({ error })) : null;
    const capabilities = await parcelRequest('customer', '/capabilities');
    const flags = capabilities.data;
    if (typeof flags?.catalogue !== 'boolean') throw new Error('Unable to check parcel availability. Please try again.');
    const enabled = parcelBookingEnabled(flags);
    const catalogue = enabled ? await (early || parcelRequest('customer', '/catalogue').catch(error => ({ error }))) : null;
    // The catalogue only matters while booking is on; a failure then is a failed load.
    if (enabled && catalogue.error) throw catalogue.error;
    const result = { flags, policy: enabled && validPolicy(catalogue?.data) ? catalogue.data : null };
    try { localStorage.setItem(SAVED_KEY, JSON.stringify(result)); } catch { /* storage is optional */ }
    return result;
  })().finally(() => { pending = null; });
  return pending;
}
