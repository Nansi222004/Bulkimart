import { api } from './apiClient';
import { UPLOAD_TIMEOUT_MS } from '../config/env';
import { getAppHash } from '../utils/otpAutofill';

/**
 * Every rider endpoint the app uses. Each one exists in backend/routes/delivery.routes.js
 * (mounted at /api/delivery) or backend/routes/auth.routes.js, and is the same call the web
 * portal makes (frontend/src/modules/Delivery/context/DeliveryContext.jsx).
 * Responses use the backend envelope { success, data, message, meta }.
 * Routes marked "approved" are behind requireApprovedPartner on the server.
 */
const id = (value) => encodeURIComponent(String(value));
const data = (body) => body?.data;

const multipart = {
  timeout: UPLOAD_TIMEOUT_MS,
  headers: { 'Content-Type': 'multipart/form-data' },
  transformRequest: (d) => d,
};

// ---------------------------------------------------------------- auth (public)
// POST /api/auth/delivery/send-otp { phone, intent: 'login'|'register', appHash? }
//   -> { success, message, otpLength, expiresIn, resendAfter, otp? (mock mode only) }
// appHash lets the server end the SMS with this app's SMS Retriever hash (OTP autofill).
export const sendLoginOtp = async (phone, intent) => {
  const appHash = await getAppHash();
  return api.post('/api/auth/delivery/send-otp', { phone, intent, ...(appHash ? { appHash } : {}) }, { skipAuth: true });
};
// POST /api/auth/delivery/verify-otp { phone, otp, intent } -> { success, token, user, sessionRole, deliveryState? }
export const verifyLoginOtp = (phone, otp, intent) => api.post('/api/auth/delivery/verify-otp', { phone, otp, intent }, { skipAuth: true, skipUnauthorizedHandler: true });
// GET /api/auth/me -> { userType, sessionRole, ... }
export const getIdentity = () => api.get('/api/auth/me');

// ---------------------------------------------------------------- profile & onboarding (any signed-in user)
// POST /api/delivery/start { name? } — idempotent, creates or returns the application.
export const startOnboarding = (name, token) => api.post('/api/delivery/start', name ? { name } : {},
  token ? { skipAuth: true, headers: { Authorization: `Bearer ${token}` } } : undefined).then(data);
// GET /api/delivery/me -> partner + { isLicenseExpired, finance, name, phone }
export const getMyProfile = () => api.get('/api/delivery/me').then(data);

const file = (f) => ({ uri: f.uri, name: f.name || 'document.jpg', type: f.type || 'image/jpeg' });

// PUT /api/delivery/vehicle multipart (approved riders): same fields as step 1. Refused while carrying a delivery.
export function changeVehicle({ vehicleType, vehicleNo, licenseNo, licenseExpiry, licenseFile }) {
  const fd = new FormData();
  fd.append('vehicleType', vehicleType);
  fd.append('vehicleNo', vehicleNo || '');
  if (vehicleType !== 'bicycle') {
    fd.append('licenseNo', licenseNo || '');
    if (licenseExpiry) fd.append('licenseExpiry', licenseExpiry);
    if (licenseFile) fd.append('license', file(licenseFile));
  }
  return api.put('/api/delivery/vehicle', fd, multipart);
}

// PUT /api/delivery/step/1 multipart: vehicleType, vehicleNo, licenseNo, licenseExpiry?, license(file)
export function submitVehicleStep({ vehicleType, vehicleNo, licenseNo, licenseExpiry, licenseFile }) {
  const fd = new FormData();
  fd.append('vehicleType', vehicleType);
  fd.append('vehicleNo', vehicleNo || '');
  fd.append('licenseNo', licenseNo || '');
  if (licenseExpiry) fd.append('licenseExpiry', licenseExpiry);
  if (licenseFile) fd.append('license', file(licenseFile));
  return api.put('/api/delivery/step/1', fd, multipart);
}
// PUT /api/delivery/step/2 multipart: aadhaarNumber, aadhaarFront(file), aadhaarBack(file)
export function submitAadhaarStep({ aadhaarNumber, frontFile, backFile }) {
  const fd = new FormData();
  fd.append('aadhaarNumber', aadhaarNumber || '');
  if (frontFile) fd.append('aadhaarFront', file(frontFile));
  if (backFile) fd.append('aadhaarBack', file(backFile));
  return api.put('/api/delivery/step/2', fd, multipart);
}
// PUT /api/delivery/step/3 multipart: zones, deliveryRadiusKm?, bank fields, passbook(file), flattened location
export function submitServiceAreaStep({ zones, deliveryRadius, location, bank, passbookFile }) {
  const fd = new FormData();
  fd.append('zones', zones || '');
  if (deliveryRadius !== undefined && deliveryRadius !== null && deliveryRadius !== '') fd.append('deliveryRadiusKm', String(deliveryRadius));
  fd.append('accountNo', bank?.accountNo || '');
  fd.append('ifsc', bank?.ifsc || '');
  fd.append('holderName', bank?.holderName || '');
  fd.append('bankName', bank?.bankName || '');
  if (bank?.upiId) fd.append('upiId', bank.upiId);
  if (passbookFile) fd.append('passbook', file(passbookFile));
  const loc = location || {};
  for (const key of ['lat', 'lng', 'accuracy', 'source', 'address', 'landmark', 'city', 'state', 'pincode']) {
    if (loc[key] !== undefined && loc[key] !== null && loc[key] !== '') fd.append(key, String(loc[key]));
  }
  return api.put('/api/delivery/step/3', fd, multipart);
}
// POST /api/delivery/submit -> { status }
export const submitApplication = () => api.post('/api/delivery/submit').then(data);
// PUT /api/delivery/location { lat, lng, accuracy, source, address, city, state, pincode } — base location
export const saveBaseLocation = (location) => api.put('/api/delivery/location', location);
// PUT /api/delivery/service-area { zones: string[], version } -> { zones, version }; 409 when the profile changed
export const saveServiceArea = (zones, version) => api.put('/api/delivery/service-area', { zones, version }).then(data);
// PUT /api/delivery/presence { lat, lng, source:'gps' } — live dispatch position while on duty
export const sendPresence = (point) => api.put('/api/delivery/presence', point);
// GET /api/geo/reverse?lat&lng&accuracy -> address fields (server holds the paid key)
export const reverseGeocode = (lat, lng, accuracy) => api.get('/api/geo/reverse', { params: { lat, lng, ...(accuracy ? { accuracy: Math.round(accuracy) } : {}) } }).then(data);
// DELETE /api/delivery/account
export const deleteAccount = () => api.delete('/api/delivery/account');

// ---------------------------------------------------------------- duty & forward orders (approved)
// PUT /api/delivery/availability { isAvailable, lat?, lng? } -> { isAvailable }
export const setAvailability = (isAvailable, coords) => api.put('/api/delivery/availability', { isAvailable, ...(coords || {}) });
// GET /api/delivery/orders/pending -> offer[] (orderId, merchant*, customer*, payout, distance, pickupDistance, codAmount, ...)
export const getPendingOffers = () => api.get('/api/delivery/orders/pending').then((b) => (Array.isArray(b?.data) ? b.data : []));
// GET /api/delivery/orders/active -> active delivery or null
export const getActiveDelivery = () => api.get('/api/delivery/orders/active').then((b) => b?.data || null);
export const acceptOffer = (orderId) => api.post(`/api/delivery/orders/${id(orderId)}/accept`);
export const declineOffer = (orderId) => api.post(`/api/delivery/orders/${id(orderId)}/decline`);
export const expireOffer = (orderId) => api.post(`/api/delivery/orders/${id(orderId)}/expire`);
// POST /cancel — before pickup only; the server refuses afterwards.
export const cancelDelivery = (orderId) => api.post(`/api/delivery/orders/${id(orderId)}/cancel`);
// PATCH /status { status: 'arrived_at_store' | 'picked_up' | 'arrived_at_customer' }
export const updateStage = (orderId, status) => api.patch(`/api/delivery/orders/${id(orderId)}/status`, { status });
// PUT /location { lat, lng, accuracy, source:'gps' } — live trip position for the customer's map
export const sendTripLocation = (orderId, point) => api.put(`/api/delivery/orders/${id(orderId)}/location`, point);
// POST /generate-otp -> { sent: true }. The code goes to the customer only.
export const requestDeliveryOtp = (orderId) => api.post(`/api/delivery/orders/${id(orderId)}/generate-otp`);
// POST /verify-otp { otp, codCollected? } -> { earnings, tip, earningStatus, codCollection }
export const verifyDeliveryOtp = (orderId, otp, codCollected) => api.post(`/api/delivery/orders/${id(orderId)}/verify-otp`,
  { otp, ...(codCollected !== undefined && codCollected !== null ? { codCollected } : {}) });

// GET /orders/history?type&page -> paginated { data: items[], meta: { page, limit, total, pages? } }
export const getHistory = ({ type, page = 1 } = {}) => api.get('/api/delivery/orders/history', { params: { page, ...(type && type !== 'ALL' ? { type } : {}) } });
// GET /earnings/summary -> { daily, weekly, parcels }
export const getEarningsSummary = () => api.get('/api/delivery/earnings/summary').then(data);

// ---------------------------------------------------------------- payouts & COD (approved)
// POST /payouts { amount, idempotencyKey } (also sent as Idempotency-Key header)
export const requestPayout = (amount, idempotencyKey) => api.post('/api/delivery/payouts', { amount, idempotencyKey }, { headers: { 'Idempotency-Key': idempotencyKey } });
export const getPayouts = (page = 1) => api.get('/api/delivery/payouts', { params: { page } });
// Finance workflow (financeWorkflow.controller.js), rider-scoped by the server.
export const getCodOrders = (page = 1) => api.get('/api/delivery/finances/cod', { params: { page } });
export const getLedger = (page = 1) => api.get('/api/delivery/finances/ledger', { params: { page } });
export const getDeliveryFinance = (page = 1) => api.get('/api/delivery/finances/deliveries', { params: { page } });
// POST /orders/:id/cod/collect | remit { amount, method:'cash', reference, reason }
export const reportCod = (orderId, kind, { amount, reference, reason }) =>
  api.post(`/api/delivery/orders/${id(orderId)}/cod/${kind === 'remit' ? 'remit' : 'collect'}`, { amount, method: 'cash', reference, reason });

// ---------------------------------------------------------------- Quick Commerce return pickups (approved)
// GET /return-pickups -> { pending[], active[], history[] }
export const getReturnPickups = () => api.get('/api/delivery/return-pickups').then((b) => ({ pending: [], active: [], history: [], ...(b?.data || {}) }));
export const acceptReturnPickup = (returnId) => api.post(`/api/delivery/return-pickups/${id(returnId)}/accept`);
export const declineReturnPickup = (returnId, reason) => api.post(`/api/delivery/return-pickups/${id(returnId)}/decline`, reason ? { reason } : {});
export const expireReturnPickup = (returnId) => api.post(`/api/delivery/return-pickups/${id(returnId)}/expire`);
export const sendReturnLocation = (returnId, point) => api.put(`/api/delivery/return-pickups/${id(returnId)}/location`, point);
export const requestReturnOtp = (returnId) => api.post(`/api/delivery/return-pickups/${id(returnId)}/generate-otp`);
export const verifyReturnOtp = (returnId, otp) => api.post(`/api/delivery/return-pickups/${id(returnId)}/verify-otp`, { otp });

// ---------------------------------------------------------------- parcels (/api/delivery/parcels, approved driver)
export const getParcels = (page = 1, limit = 20) => api.get('/api/delivery/parcels/bookings', { params: { page, limit } });
// Open parcel offers for this rider (bookings still searching; the server lists only live offers sent to them).
export const getParcelOffers = () => api.get('/api/delivery/parcels/bookings', { params: { status: 'searching_for_driver', limit: 10 } })
  .then((body) => (body?.data || []).filter((b) => b.offer && new Date(b.offer.expiresAt) > new Date()));
export const getParcel = (bookingId) => api.get(`/api/delivery/parcels/bookings/${id(bookingId)}`).then(data);
// POST /offer { action:'accept'|'reject', token, version }
export const respondParcelOffer = (booking, action) => api.post(`/api/delivery/parcels/bookings/${id(booking._id)}/offer`, { action, token: booking.offer?.token, version: booking.version });
// POST /actions { action, version, ...extra }
export const parcelAction = (booking, action, extra = {}) => api.post(`/api/delivery/parcels/bookings/${id(booking._id)}/actions`, { action, version: booking.version, ...extra });

// ---------------------------------------------------------------- misc
// GET /api/helpline (public) -> { sosEmergencyNumber?, ... }
export const getHelpline = () => api.get('/api/helpline', { skipAuth: true }).then(data);
