import ParcelPolicy from '../models/ParcelPolicy.js';
import { httpError } from '../utils/response.js';
import { MAX_CHECKOUT_PAISE } from '../utils/money.js';
export const failParcel = (message, status = 400) => { throw httpError(status, message); };
export const flagNames = ['catalogue', 'booking', 'online_payment', 'pay_driver', 'auto_assignment', 'admin_fallback', 'fulfilment', 'refunds'];
export const parcelFlags = () => Object.fromEntries(flagNames.map(k => [k, true]));
export const productionParcel = () => ['production','prod','deployment-production'].includes(String(process.env.NODE_ENV).trim().toLowerCase()) || ['production','prod','deployment-production'].includes(String(process.env.DEPLOYMENT_ENV).trim().toLowerCase());
export function requireParcel(kind) {
  if (!parcelFlags()[kind]) failParcel('Parcel capability is not enabled', 503);
  if (productionParcel() && kind !== 'catalogue') failParcel('Production parcel operations are release-blocked', 503);
}
export function requireParcelGateway(kind = 'online_payment') {
  requireParcel(kind);
  if (process.env.PAYMENT_GATEWAY !== 'razorpay' || process.env.RAZORPAY_MODE !== 'test' || !process.env.RAZORPAY_KEY_ID?.startsWith('rzp_test_')) failParcel('Parcel gateway execution requires isolated Razorpay test mode', 503);
}
export function parcelPermission(req, key) {
  if (req.userType !== 'admin' || (req.user.role !== 'superAdmin' && !req.user.permissions?.includes(key))) failParcel(`${key} permission required`, 403);
}
export const boundedText = (value, label, max = 500) => {
  if (typeof value !== 'string' || !value.trim() || value.length > max) failParcel(`${label} is required (maximum ${max} characters)`);
  return value.trim();
};
export const integer = (n, label, min = 0, max = MAX_CHECKOUT_PAISE) => {
  if (!Number.isSafeInteger(n) || n < min || n > max) failParcel(`Invalid ${label}`);
  return n;
};
const strings = (v, label) => {
  if (!Array.isArray(v) || !v.length || v.length > 100) failParcel(`Explicit ${label} list required`);
  return [...new Set(v.map(x => boundedText(x, label, 100)))];
};
export function validateParcelPolicy(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) failParcel('An explicit policy object is required');
  const c = {};
  c.approvalReference = boundedText(input.approvalReference, 'Policy note');
  c.terms = boundedText(input.terms, 'Customer cancellation, prohibited parcel and failure terms', 10000);
  c.effectiveAt = new Date(input.effectiveAt);
  if (!Number.isFinite(c.effectiveAt.getTime())) failParcel('Effective date required');
  c.categories = strings(input.categories, 'allowed categories');
  c.prohibitedItems = strings(input.prohibitedItems, 'prohibited items');
  if (!Array.isArray(input.areas) || !input.areas.length || input.areas.length > 100) failParcel('Explicit service areas required');
  c.areas = input.areas.map(a => { if (!a || typeof a !== 'object') failParcel('Invalid service area'); return { name: boundedText(a.name, 'Area name', 100), pincodes: strings(a.pincodes, 'pincodes').map(p => { if (!/^\d{6}$/.test(p)) failParcel('Invalid pincode'); return p; }), lat: coordinate(a.lat, 90), lng: coordinate(a.lng, 180), radiusKm: positive(a.radiusKm, 'area radius', 100) }; });
  for (const [k, min, max] of [['basePaise',0,MAX_CHECKOUT_PAISE],['perKmPaise',0,MAX_CHECKOUT_PAISE],['minimumPaise',1,MAX_CHECKOUT_PAISE],['maximumPaise',1,MAX_CHECKOUT_PAISE],['driverBasePaise',0,MAX_CHECKOUT_PAISE],['driverPerKmPaise',0,MAX_CHECKOUT_PAISE],['quoteSeconds',30,3600],['acceptanceSeconds',15,600],['maxAttempts',1,20],['maxActiveTasks',1,10],['locationMaxAgeSeconds',30,3600]]) c[k] = integer(input[k], k, min, max);
  for (const [k, max] of [['maxWeightKg',100],['maxDimensionCm',500],['assignmentRadiusKm',100],['maxRouteKm',500]]) c[k] = positive(input[k], k, max);
  // Supported initial policy combinations are intentionally explicit.
  if (input.taxTreatment !== 'inclusive' || input.surcharges !== 'none' || input.cancellationMode !== 'admin_review' || input.failureMode !== 'admin_review' || input.cashCollectionPoint !== 'delivery' || input.partialCash !== false || typeof input.payDriverEnabled !== 'boolean') failParcel('Unsupported policy: require inclusive approved taxes, no surcharges, admin review, exact cash at delivery');
  Object.assign(c, { taxTreatment: 'inclusive', surcharges: 'none', cancellationMode: 'admin_review', failureMode: 'admin_review', cashCollectionPoint: 'delivery', partialCash: false, payDriverEnabled: input.payDriverEnabled });
  c.taxRateBps = integer(input.taxRateBps, 'explicit inclusive tax rate in basis points', 0, 10000);
  c.payDriverCategories = strings(input.payDriverCategories, 'pay-driver categories');
  if (c.payDriverCategories.some(x => !c.categories.includes(x)) || c.minimumPaise > c.maximumPaise || c.driverBasePaise > c.maximumPaise) failParcel('Inconsistent fare or category policy');
  if (c.maxActiveTasks !== 1 || c.categories.some(x=>c.prohibitedItems.includes(x))) failParcel('Initial parcel policy requires exclusive single-task custody and disjoint allowed/prohibited categories');
  return c;
}
export function coordinate(n, max) { if (typeof n !== 'number' || !Number.isFinite(n) || Math.abs(n) > max) failParcel('Valid map coordinates required'); return n; }
function positive(n, label, max) { if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0 || n > max) failParcel(`Invalid ${label}`); return n; }
export async function currentParcelPolicy(session) {
  const q = ParcelPolicy.findById('parcel');
  const p = await (session ? q.session(session) : q);
  if (!p || new Date(p.config.effectiveAt) > new Date()) failParcel('An effective approved parcel policy is required', 409);
  return p;
}
export function validateParcelDetails(input, c, distance) {
  const address = (a = {}) => {
    if (!a || typeof a !== 'object' || Array.isArray(a)) failParcel('Complete address required');
    const v = { address: boundedText(a.address, 'Address'), name: boundedText(a.name, 'Contact name', 100), phone: boundedText(a.phone, 'Phone', 20), pincode: boundedText(a.pincode, 'Pincode', 6), lat: coordinate(a.lat,90), lng: coordinate(a.lng,180) };
    if (!/^\d{6}$/.test(v.pincode) || !/^\+?[1-9]\d{9,14}$/.test(v.phone)) failParcel('Valid phone and pincode required');
    if (!c.areas.some(x => x.pincodes.includes(v.pincode) && distance(x,v) <= x.radiusKm)) failParcel('Address is outside approved service areas');
    return v;
  };
  if (!c.categories.includes(input.category) || input.acceptRestrictions !== true) failParcel('Select an approved category and accept parcel restrictions');
  const dimensions = input.dimensions;
  if (!Array.isArray(dimensions) || dimensions.length !== 3) failParcel('Three dimensions required');
  return { pickup: address(input.pickup), dropoff: address(input.dropoff), category: input.category, description: boundedText(input.description,'Parcel description'), weightKg: positive(input.weightKg,'weight',c.maxWeightKg), dimensions: dimensions.map(n => positive(n,'dimension',c.maxDimensionCm)), instructions: typeof input.instructions === 'string' ? input.instructions.trim().slice(0,500) : '', acceptRestrictions: true };
}
export function parcelFare(distanceKm, p) {
  if (!Number.isFinite(distanceKm) || distanceKm <= 0 || distanceKm > p.config.maxRouteKm) failParcel('Route distance is unsupported', 409);
  const c = p.config, metres = Math.ceil(distanceKm * 1000);
  const distanceFee = Math.ceil(metres * c.perKmPaise / 1000);
  const totalPaise = Math.max(c.minimumPaise, c.basePaise + distanceFee);
  const driverPaise = c.driverBasePaise + Math.ceil(metres * c.driverPerKmPaise / 1000);
  const taxPaise = Math.round(totalPaise * c.taxRateBps / (10000 + c.taxRateBps));
  if (!Number.isSafeInteger(totalPaise) || totalPaise > c.maximumPaise || driverPaise > totalPaise-taxPaise) failParcel('Fare or earning exceeds approved limits',409);
  return { policyVersion: p.version, policy: structuredClone(c), distanceMetres: metres, basePaise: c.basePaise, distancePaise: distanceFee, totalPaise, taxPaise, driverPaise, platformPaise: totalPaise - taxPaise - driverPaise, currency: 'INR' };
}
export function parcelSettlementBlockers(b) {
  const reasons = ['parcel_payout_adapter_not_release_approved'];
  if (b.status !== 'delivered') reasons.push('delivery_not_verified');
  if (b.paymentMethod === 'online' && !b.finance.bankEvidence) reasons.push('gateway_bank_settlement_unreconciled');
  if (b.paymentMethod === 'pay_driver' && b.cash.status !== 'reconciled') reasons.push('cash_deposit_unreconciled');
  if (b.finance.dispute || b.cancellation || b.exception?.status === 'admin_review') reasons.push('operational_or_financial_review');
  if (b.finance.refundStatus && b.finance.refundStatus !== 'confirmed') reasons.push('refund_unresolved');
  return reasons;
}
// A financial review must never become a dispatch or proof bypass after an
// operational cancellation/exception is rejected or retried.
export const parcelOperationalHold = b => Boolean(b.finance?.dispute
  || b.finance?.gatewayDisputes?.length
  || (b.finance?.refundStatus && b.finance.refundStatus !== 'none')
  || b.finance?.refundedPaise > 0);
