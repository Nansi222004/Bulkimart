import { createHash, randomUUID } from 'node:crypto';
import Seller from '../models/Seller.js';
import User from '../models/User.js';
import { getShiprocketCapabilities, listPickupLocations, addPickupLocation } from './shiprocket.service.js';

const text = value => typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
const equal = (a, b) => text(String(a ?? '')).toLowerCase() === text(String(b ?? '')).toLowerCase();
const phone = value => String(value || '').replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '');
export function pickupDefinition(seller, user) {
  const store = seller.storeDetails || {};
  const payload = { name: text(store.name || seller.businessName), email: text(store.email || user?.email).toLowerCase(), phone: phone(store.phone || user?.phone),
    address: text(store.address), city: text(store.city), state: text(store.state), pin_code: text(store.pincode), country: 'India' };
  let error;
  if (payload.name.length < 2 || payload.name.length > 100) error = 'Provide a store/contact name of 2–100 characters.';
  else if (payload.address.length < 10 || payload.address.length > 80) error = 'Pickup street address must be 10–80 characters. Correct the store address.';
  else if (!payload.city || payload.city.length > 80 || !payload.state || payload.state.length > 80 || !/^[1-9]\d{5}$/.test(payload.pin_code)) error = 'Provide a valid pickup city, state and six-digit postal code.';
  else if (!/^[6-9]\d{9}$/.test(payload.phone)) error = 'Provide a valid ten-digit store contact phone.';
  else if (payload.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)) error = 'Add a valid pickup contact email in the store profile.';
  if (Object.values(payload).some(value => /[\x00-\x1f<>]/.test(value))) error = 'Remove unsupported characters from pickup contact/address fields.';
  const fingerprint = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  const locationName = `BM${String(seller._id)}${fingerprint.slice(0, 10)}`;
  return { payload: { ...payload, pickup_location: locationName }, fingerprint, locationName, error };
}
export const pickupMatches = (row, payload) => ['pickup_location', 'name', 'email', 'address', 'city', 'state', 'country', 'pin_code'].every(key => equal(row[key], payload[key])) && phone(row.phone) === payload.phone;
export const pickupUsable = row => row?.id != null && Number(row.status) === 2 && Number(row.phone_verified) === 1 && row.is_active !== false && row.is_active !== 0;
export function pickupReadyForShipping(seller, user) {
  if (!seller.pickupSync?.status) return true; // Legacy admin links still undergo provider verification.
  const definition = pickupDefinition(seller, user);
  return !definition.error && seller.pickupSync.status === 'registered' && Boolean(seller.pickupSync.providerId)
    && seller.pickupSync.fingerprint === definition.fingerprint && seller.pickupSync.locationName === seller.thirdPartyFulfillment?.shiprocketPickupLocation
    && (seller.pickupSync.verificationMode === 'provider' ? process.env.SHIPROCKET_MODE === 'live' : seller.pickupSync.verificationMode === process.env.SHIPROCKET_MODE);
}

export async function queueSellerPickupSync(sellerId, { retry = false } = {}) {
  const seller = await Seller.findById(sellerId).lean();
  if (!seller) return null;
  const user = await User.findById(seller.userId).select('email phone isActive roles').lean();
  const definition = pickupDefinition(seller, user);
  if (!user?.isActive || !user.roles?.includes('seller') || ['rejected', 'suspended'].includes(seller.status)) definition.error = 'An active eligible seller account is required for pickup registration.';
  const previous = seller.pickupSync || {};
  if (previous.fingerprint === definition.fingerprint && (!retry || ['syncing','pending'].includes(previous.status))) return previous;
  if (retry && previous.nextAttemptAt && new Date(previous.nextAttemptAt) > new Date() && previous.fingerprint === definition.fingerprint) return previous;
  const changed = previous.fingerprint !== definition.fingerprint;
  const priorIntent = (previous.history || []).find(entry => entry.fingerprint === definition.fingerprint && entry.createStartedAt)?.createStartedAt;
  const update = { $set: {
    'pickupSync.status': definition.error ? 'needs_attention' : 'pending',
    'pickupSync.fingerprint': definition.fingerprint, 'pickupSync.locationName': definition.locationName,
    'pickupSync.attempts': 0, 'pickupSync.nextAttemptAt': new Date(), 'pickupSync.lastError': definition.error || null,
    'pickupSync.leaseUntil': null, 'pickupSync.operationId': null,
    ...(changed ? { 'pickupSync.createStartedAt': priorIntent || null, 'pickupSync.providerId': null, 'pickupSync.registeredAt': null } : {}),
  } };
  const oldName = previous.locationName || seller.thirdPartyFulfillment?.shiprocketPickupLocation;
  if (changed && oldName) update.$push = { 'pickupSync.history': { locationName: oldName, providerId: previous.providerId, fingerprint: previous.fingerprint, createStartedAt: previous.createStartedAt, changedAt: new Date() } };
  // Do not enqueue an obsolete address if another profile save won this race.
  const saved = await Seller.findOneAndUpdate({ _id: seller._id, storeDetails: seller.storeDetails,
    ...(previous.fingerprint ? { 'pickupSync.fingerprint': previous.fingerprint } : { 'pickupSync.fingerprint': { $exists: false } }) }, update, { returnDocument: 'after' });
  return saved?.pickupSync || null;
}

export async function syncSellerPickup(sellerId) {
  const operationId = randomUUID();
  const now = new Date();
  const seller = await Seller.findOneAndUpdate({ _id: sellerId, 'pickupSync.attempts': { $lt: 5 },
    $or: [{ 'pickupSync.status': 'pending', 'pickupSync.nextAttemptAt': { $lte: now } }, { 'pickupSync.status': 'syncing', 'pickupSync.leaseUntil': { $lte: now } }] },
  { $set: { 'pickupSync.status': 'syncing', 'pickupSync.operationId': operationId, 'pickupSync.leaseUntil': new Date(Date.now() + 90000) }, $inc: { 'pickupSync.attempts': 1 } }, { returnDocument: 'after' });
  if (!seller) return;
  const owner = { _id: seller._id, 'pickupSync.status': 'syncing', 'pickupSync.operationId': operationId, 'pickupSync.fingerprint': seller.pickupSync.fingerprint };
  const user = await User.findById(seller.userId).select('email phone isActive roles').lean();
  const definition = pickupDefinition(seller, user);
  if (!user?.isActive || !user.roles?.includes('seller') || ['rejected', 'suspended'].includes(seller.status)) definition.error = 'An active eligible seller account is required for pickup registration.';
  let safeError = 'Shiprocket pickup synchronization is unavailable. Retry later.';
  let permanent = false;
  try {
    if (definition.fingerprint !== seller.pickupSync.fingerprint) { await queueSellerPickupSync(seller._id); return; }
    if (definition.error) { safeError = definition.error; permanent = true; throw new Error(); }
    if (!getShiprocketCapabilities().configured) { safeError = 'Shiprocket is not configured. Contact platform support.'; throw new Error(); }
    let rows = await listPickupLocations();
    let row = rows.find(entry => entry.pickup_location === definition.locationName);
    if (!row) {
      // Only consider references already associated with this seller by the
      // platform. Never adopt another account's matching-looking address.
      const ownedNames = [seller.thirdPartyFulfillment?.shiprocketPickupLocation, ...(seller.pickupSync.history || []).map(entry => entry.locationName)].filter(Boolean);
      row = rows.find(entry => ownedNames.includes(entry.pickup_location) && pickupMatches(entry, { ...definition.payload, pickup_location: entry.pickup_location }));
    }
    if (!row && !seller.pickupSync.createStartedAt) {
      // Persist intent before the remote request. Unknown outcomes reconcile
      // by deterministic name only; they never blindly repeat POST addpickup.
      const intent = await Seller.updateOne(owner, { $set: { 'pickupSync.createStartedAt': new Date() } });
      if (intent.matchedCount !== 1) return;
      safeError = 'Pickup creation acknowledgement is unconfirmed. Retry reconciles the saved provider reference without creating a duplicate.';
      await addPickupLocation(definition.payload);
      rows = await listPickupLocations(); row = rows.find(entry => entry.pickup_location === definition.locationName);
    }
    if (!row) { safeError = 'Pickup creation outcome is unconfirmed. Reconciliation will check the provider; do not create another location manually.'; throw new Error(); }
    if (!pickupMatches(row, { ...definition.payload, pickup_location: row.pickup_location })) { safeError = 'Provider pickup details do not match this store. Contact platform support.'; permanent = true; throw new Error(); }
    if (!pickupUsable(row)) { safeError = 'Pickup exists but Shiprocket has not confirmed it active with phone verification. Contact support to complete provider verification, then retry.'; permanent = true; throw new Error(); }
    await Seller.updateOne({ ...owner, storeDetails: seller.storeDetails.toObject?.() || seller.storeDetails }, { $set: {
      'pickupSync.status': 'registered', 'pickupSync.locationName': row.pickup_location, 'pickupSync.providerId': String(row.id), 'pickupSync.registeredAt': new Date(),
      'pickupSync.createStartedAt': seller.pickupSync.createStartedAt || new Date(),
      'pickupSync.lastError': null, 'pickupSync.leaseUntil': null, 'pickupSync.verificationMode': process.env.SHIPROCKET_MODE === 'live' ? 'provider' : process.env.SHIPROCKET_MODE,
      'thirdPartyFulfillment.shiprocketPickupLocation': row.pickup_location,
      // Approval remains a separate admin-controlled policy. Never set enabled.
    } });
  } catch {
    const attempts = seller.pickupSync.attempts;
    await Seller.updateOne(owner, { $set: { 'pickupSync.status': permanent ? 'needs_attention' : attempts >= 5 ? 'failed' : 'pending',
      'pickupSync.lastError': safeError, 'pickupSync.leaseUntil': null, 'pickupSync.nextAttemptAt': new Date(Date.now() + Math.min(3600000, 60000 * 2 ** (attempts - 1))) } });
  }
}

let running = false;
export async function sweepSellerPickupSync() {
  if (running) return;
  running = true;
  try {
    await Seller.updateMany({ 'pickupSync.status': 'syncing', 'pickupSync.attempts': { $gte: 5 }, 'pickupSync.leaseUntil': { $lte: new Date() } }, { $set: { 'pickupSync.status': 'failed', 'pickupSync.lastError': 'Interrupted synchronization exhausted retries. Retry reconciliation from the profile.', 'pickupSync.leaseUntil': null } });
    const due = await Seller.find({ $or: [{ 'pickupSync.status': 'pending', 'pickupSync.nextAttemptAt': { $lte: new Date() } }, { 'pickupSync.status': 'syncing', 'pickupSync.leaseUntil': { $lte: new Date() } }] }).select('_id').limit(5).lean();
    for (const seller of due) await syncSellerPickup(seller._id);
  } finally { running = false; }
}

export function pickupStatus(seller, user) {
  const state = seller.pickupSync;
  if (user && state?.status === 'registered' && !pickupReadyForShipping(seller, user)) return { status: 'needs_attention', message: 'Pickup details changed or verification is stale. Retry synchronization.', shippingApproved: Boolean(seller.thirdPartyFulfillment?.enabled) };
  return { status: state?.status || 'needs_attention', message: state?.lastError || (!state?.status ? 'Pickup has not been synchronized. Register the saved store address.' : null),
    locationName: state?.status === 'registered' ? state.locationName : null, nextAttemptAt: state?.nextAttemptAt, registeredAt: state?.registeredAt,
    shippingApproved: Boolean(seller.thirdPartyFulfillment?.enabled), verificationMode: state?.verificationMode };
}
