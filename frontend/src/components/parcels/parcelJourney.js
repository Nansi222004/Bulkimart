import { validParcelLocation } from './parcelApi';

// Booking screens, in order (as in the parcel flow: pickup → drop → vehicle → review).
export const PARCEL_STEPS = ['start', 'pickup', 'pickupDetails', 'dropoff', 'dropoffDetails', 'vehicle', 'review'];
export const blankParcelAddress = (profile = {}) => ({ address: '', building: '', landmark: '', name: profile.name || '', phone: profile.phone || '', pincode: '', lat: '', lng: '', label: 'Other' });
export const savedParcelAddress = address => ({ ...blankParcelAddress(), address: [address.line1, address.line2, address.city, address.state].filter(Boolean).join(', '), name: address.name || '', phone: address.phone || '', pincode: address.pincode || '', lat: address.lat ?? '', lng: address.lng ?? '', label: address.label || 'Other' });
/** A pickup or drop from an earlier booking (Book Again). */
export const bookedParcelAddress = a => ({ ...blankParcelAddress(), address: a?.address || '', name: a?.name || '', phone: a?.phone || '', pincode: a?.pincode || '', lat: a?.lat ?? '', lng: a?.lng ?? '' });
export function parcelAddressError(address) {
  if (!validParcelLocation(address)) return 'Choose and confirm this location on the map or using address search.';
  if (!address.address?.trim()) return 'Enter the street address, locality and city.';
  if ([address.building, address.address, address.landmark].filter(Boolean).join(', ').length > 500) return 'Shorten the complete address to 500 characters.';
  if (!address.name?.trim()) return 'Enter the contact name.';
  if (!/^\+?[1-9]\d{9,14}$/.test(address.phone || '')) return 'Enter a valid contact phone number (10–15 digits).';
  if (!/^\d{6}$/.test(address.pincode || '')) return 'Enter a six-digit pincode.';
  return '';
}
export const parcelVehicleMode = policy => Array.isArray(policy?.vehicles) && policy.vehicles.length > 0;
/** Goods as the customer described them; with vehicles, weight is optional ("up to the vehicle's capacity"). */
export function parcelGoodsError(parcel, policy) {
  if (!policy.categories.includes(parcel.category)) return 'Choose what you are sending.';
  const blank = v => v === '' || v === null || v === undefined;
  if (parcelVehicleMode(policy)) {
    const max = Math.max(...policy.vehicles.map(v => v.maxWeightKg));
    if (!blank(parcel.weightKg) && !(Number(parcel.weightKg) > 0 && Number(parcel.weightKg) <= max)) return `Enter a weight up to ${max} kg, or leave it empty.`;
    if (!blank(parcel.packages) && !(Number.isInteger(Number(parcel.packages)) && Number(parcel.packages) >= 1 && Number(parcel.packages) <= 99)) return 'Enter between 1 and 99 packages.';
    return '';
  }
  if (!parcel.description?.trim()) return 'Describe what you are sending.';
  const weightKg = Number(parcel.weightKg), dimensions = ['length', 'width', 'height'].map(k => Number(parcel[k]));
  if (!Number.isFinite(weightKg) || weightKg <= 0 || weightKg > policy.maxWeightKg) return 'Enter a weight within the supported parcel limit.';
  if (dimensions.some(n => !Number.isFinite(n) || n <= 0 || n > policy.maxDimensionCm)) return 'Enter all three dimensions within the supported parcel limit.';
  return '';
}
export function parcelJourneyInput(state, policy) {
  for (const kind of ['pickup', 'dropoff']) {
    const message = parcelAddressError(state[kind]);
    if (message) throw new Error((kind === 'pickup' ? 'Pickup: ' : 'Drop: ') + message);
  }
  const { parcel } = state;
  const goods = parcelGoodsError(parcel, policy);
  if (goods) throw new Error(goods);
  if (!parcel.acceptRestrictions && !parcelVehicleMode(policy)) throw new Error('Confirm that your parcel meets the restrictions.');
  const address = a => ({ address: [a.building?.trim(), a.address.trim(), a.landmark?.trim()].filter(Boolean).join(', '), name: a.name.trim(), phone: a.phone, pincode: a.pincode, lat: Number(a.lat), lng: Number(a.lng) });
  const base = { pickup: address(state.pickup), dropoff: address(state.dropoff), category: parcel.category, instructions: parcel.instructions || '', acceptRestrictions: true };
  if (parcelVehicleMode(policy)) {
    return { ...base, ...(parcel.description?.trim() ? { description: parcel.description.trim() } : {}), ...(parcel.weightKg !== '' && parcel.weightKg != null ? { weightKg: Number(parcel.weightKg) } : {}), packages: Number(parcel.packages) || 1 };
  }
  return { ...base, description: parcel.description.trim(), weightKg: Number(parcel.weightKg), dimensions: ['length', 'width', 'height'].map(k => Number(parcel[k])) };
}
export function initialParcelJourney(profile, policy) {
  return { step: 'start', pickup: blankParcelAddress(profile), dropoff: blankParcelAddress(), saveAs: { pickup: '', dropoff: '' }, parcel: { category: policy.categories[0] || '', description: '', weightKg: '', packages: 1, length: '', width: '', height: '', instructions: '', acceptRestrictions: parcelVehicleMode(policy) }, quote: null, vehicleId: '', paymentMethod: '', cashCollectionPoint: '', pending: null };
}
export const parcelDraftKey = id => id ? 'bulkimart:parcel-draft:' + id : null;
export const parcelDraftSnapshot = state => ({ ...state, quote: state.pending && state.quote ? { ...state.quote, route: undefined } : null });
const DRAFT_VERSION = 2;
export const writeParcelDraft = (storage, key, state) => { if (!key) return; try { storage.setItem(key, JSON.stringify({ version: DRAFT_VERSION, at: Date.now(), state: parcelDraftSnapshot(state) })); } catch { /* In-memory state and server idempotency still apply. */ } };
export function readParcelDraft(key, fallback, storage = globalThis.sessionStorage) {
  if (!key) return fallback;
  try {
    const saved = JSON.parse(storage.getItem(key) || 'null');
    if (!saved || saved.version !== DRAFT_VERSION || !saved.state?.pickup || !saved.state?.dropoff) return fallback;
    if (!saved.state.pending && Date.now() - saved.at > 3600000) return fallback;
    if (saved.state.pending && (!/^[a-zA-Z0-9-]{16,100}$/.test(saved.state.pending.key || '') || !saved.state.quote?.pricing || !saved.state.pending.payload?.quoteId)) return fallback;
    // A pending attempt reopens its review; otherwise resume where the customer was, re-pricing from the vehicle step.
    const step = saved.state.pending ? 'review' : PARCEL_STEPS.includes(saved.state.step) ? (saved.state.step === 'review' ? 'vehicle' : saved.state.step) : 'start';
    return { ...fallback, ...saved.state, parcel: { ...fallback.parcel, ...saved.state.parcel }, saveAs: { pickup: '', dropoff: '' }, step, quote: saved.state.pending ? saved.state.quote : null };
  } catch { return fallback; }
}
/** Book Again: a fresh draft with an earlier booking's pickup and drop, opened at vehicle selection. */
export function bookAgainDraft(storage, profileId, booking) {
  const state = { step: 'vehicle', pickup: bookedParcelAddress(booking.details?.pickup), dropoff: bookedParcelAddress(booking.details?.dropoff), vehicleId: booking.service?.id && booking.service.id !== 'parcel' ? booking.service.id : '', pending: null };
  writeParcelDraft(storage, parcelDraftKey(profileId), state);
  return state;
}
