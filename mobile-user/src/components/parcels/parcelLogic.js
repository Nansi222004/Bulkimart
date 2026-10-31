// Ports of components/parcels/parcelApi.js and parcelJourney.js (customer side). Rules and messages unchanged;
// sessionStorage becomes the app's in-memory session store.
import { authHeaders, boundedFetch } from '../../api/client';
import { session } from '../../lib/storage';

export const parcelMoney = n => `₹${((n || 0) / 100).toFixed(2)}`;
export const parcelHeaders = () => authHeaders(true);
const coordinatePresent = value => (typeof value === 'number' || (typeof value === 'string' && value.trim() !== '')) && Number.isFinite(Number(value));
export const validParcelLocation = value => coordinatePresent(value?.lat) && coordinatePresent(value?.lng) && Math.abs(Number(value.lat)) <= 90 && Math.abs(Number(value.lng)) <= 180;

export async function parcelLocationLookup(direction, values, signal) {
  const response = await boundedFetch(`/api/geo/${direction}?${new URLSearchParams(values)}`, { headers: parcelHeaders(), signal });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.data) throw new Error(body.message || 'Address lookup is unavailable. Try current location or a saved address.');
  return body.data;
}
export async function parcelRequest(path, options = {}) {
  const r = await boundedFetch(`/api/parcel-delivery${path}`, { ...options, headers: { ...parcelHeaders(), ...options.headers } });
  const body = await r.json().catch(() => ({}));
  if (!r.ok || body.success === false) { const error = new Error(body.message || 'Unable to load parcel delivery'); error.status = r.status; throw error; }
  return body;
}
export async function saveParcelPickup(address) {
  const response = await boundedFetch('/api/users/addresses', { method: 'POST', headers: parcelHeaders(), body: JSON.stringify({ label: address.label || 'Other', line1: [address.building, address.address, address.landmark].filter(Boolean).join(', '), pincode: address.pincode, lat: Number(address.lat), lng: Number(address.lng), locationSource: 'manual' }) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.success === false) throw new Error(body.message || 'Your pickup address could not be saved. Please retry.');
  return body;
}

export const blankParcelAddress = (profile = {}) => ({ address: '', building: '', landmark: '', name: profile.name || '', phone: profile.phone || '', pincode: '', lat: '', lng: '', label: 'Other' });
export const savedParcelAddress = address => ({ ...blankParcelAddress(), address: [address.line1, address.line2, address.city, address.state].filter(Boolean).join(', '), name: address.name || '', phone: address.phone || '', pincode: address.pincode || '', lat: address.lat ?? '', lng: address.lng ?? '', label: address.label || 'Other' });
export function parcelAddressError(address) {
  if (!validParcelLocation(address)) return 'Choose and confirm this location on the map or using address search.';
  if (!address.address?.trim()) return 'Enter the street address, locality and city.';
  if ([address.building, address.address, address.landmark].filter(Boolean).join(', ').length > 500) return 'Shorten the complete address to 500 characters.';
  if (!address.name?.trim()) return 'Enter the contact name.';
  if (!/^\+?[1-9]\d{9,14}$/.test(address.phone || '')) return 'Enter a valid contact phone number (10–15 digits).';
  if (!/^\d{6}$/.test(address.pincode || '')) return 'Enter a six-digit pincode.';
  return '';
}
export function parcelJourneyInput(state, policy) {
  for (const kind of ['pickup', 'dropoff']) {
    const message = parcelAddressError(state[kind]);
    if (message) throw new Error((kind === 'pickup' ? 'Pickup: ' : 'Drop: ') + message);
  }
  const { parcel } = state, weightKg = Number(parcel.weightKg), dimensions = ['length', 'width', 'height'].map(k => Number(parcel[k]));
  if (!policy.categories.includes(parcel.category) || !parcel.description.trim()) throw new Error('Choose a parcel category and describe what you are sending.');
  if (!Number.isFinite(weightKg) || weightKg <= 0 || weightKg > policy.maxWeightKg) throw new Error('Enter a weight within the supported parcel limit.');
  if (dimensions.some(n => !Number.isFinite(n) || n <= 0 || n > policy.maxDimensionCm)) throw new Error('Enter all three dimensions within the supported parcel limit.');
  if (!parcel.acceptRestrictions) throw new Error('Confirm that your parcel meets the restrictions.');
  const address = a => ({ address: [a.building?.trim(), a.address.trim(), a.landmark?.trim()].filter(Boolean).join(', '), name: a.name.trim(), phone: a.phone, pincode: a.pincode, lat: Number(a.lat), lng: Number(a.lng) });
  return { pickup: address(state.pickup), dropoff: address(state.dropoff), category: parcel.category, description: parcel.description.trim(), weightKg, dimensions, instructions: parcel.instructions || '', acceptRestrictions: true };
}
export function initialParcelJourney(profile, policy) {
  return { step: 0, editing: 'dropoff', pickup: blankParcelAddress(profile), dropoff: blankParcelAddress(), parcel: { category: policy.categories[0] || '', description: '', weightKg: '', length: '', width: '', height: '', instructions: '', acceptRestrictions: false }, quote: null, paymentMethod: '', cashCollectionPoint: '', terms: false, pending: null };
}
export const parcelDraftKey = id => (id ? 'bulkimart:parcel-draft:' + id : null);
export const parcelDraftSnapshot = state => ({ ...state, quote: state.pending && state.quote ? { ...state.quote, route: undefined } : null });
export function readParcelDraft(key, fallback) {
  if (!key) return fallback;
  try {
    const saved = JSON.parse(session.getItem(key) || 'null');
    if (!saved || saved.version !== 1 || !saved.state?.pickup || !saved.state?.dropoff || !saved.state?.parcel) return fallback;
    if (!saved.state.pending && Date.now() - saved.at > 3600000) return fallback;
    if (saved.state.pending && (!/^[a-zA-Z0-9-]{16,100}$/.test(saved.state.pending.key || '') || !saved.state.quote?.pricing || !saved.state.pending.payload?.quoteId)) return fallback;
    return { ...fallback, ...saved.state, step: saved.state.pending ? 3 : 0, quote: saved.state.pending ? saved.state.quote : null };
  } catch { return fallback; }
}
export const parcelCustomerStatus = status => ({
  payment_pending: 'Complete your payment', payment_failed: 'Payment needs attention',
  searching_for_driver: 'Finding your delivery partner', needs_admin_assignment: 'We’re arranging your pickup',
  driver_assigned: 'Your delivery partner is assigned', driver_arriving: 'Your partner is on the way',
  arrived_at_pickup: 'Your partner has arrived', picked_up: 'Your parcel has been collected', in_transit: 'Your parcel is on the way',
  arrived_at_dropoff: 'Your parcel has arrived', delivered: 'Parcel delivered', cancellation_review: 'Cancellation is being reviewed',
  cancelled: 'Booking cancelled', delivery_failed: 'Your delivery needs assistance',
}[status] || 'Parcel delivery update');
