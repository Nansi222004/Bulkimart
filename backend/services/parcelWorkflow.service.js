import crypto from 'node:crypto';
import Parcel from '../models/ParcelDelivery.js';
import Quote from '../models/ParcelQuote.js';
import Policy from '../models/ParcelPolicy.js';
import Partner from '../models/DeliveryPartner.js';
import User from '../models/User.js';
import { financialTransaction } from './financeSafety.service.js';
import { postLedgerEntry } from './sellerLedger.service.js';
import { getRoute } from './maps.service.js';
import { distanceKm } from '../utils/geo.js';
import { currentParcelPolicy, validateParcelDetails, parcelFare, requireParcel, failParcel, boundedText, integer, parcelSettlementBlockers, parcelOperationalHold } from './parcelPolicy.service.js';
export const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const parcelKey = key => { if (typeof key !== 'string' || !/^[a-zA-Z0-9-]{16,100}$/.test(key)) failParcel('Valid idempotency key required'); return key; };
export function parcelEvent(b, actor, action, status = b.status, reason = '') {
  b.status = status; b.history.push({ status, action, actorId: actor.id, actorType: actor.type, at: new Date(), reason });
}
export function touchParcel(b) { for (const k of ['assignment','proof','finance','cash','cancellation','exception']) b.markModified(k); }
export function parcelVersion(b, version) { if (!Number.isSafeInteger(version) || b.__v !== version) failParcel('Booking changed; refresh before continuing',409); }
export async function ownedParcel(id, customerId, session) {
  const b = await Parcel.findOne({ _id:id, customerId }).session(session || null);
  if (!b) failParcel('Booking not found',404); return b;
}
export async function postParcel(b, key, account, direction, paise, session, bucket = 'held') {
  if (!['parcel_collections','parcel_cash_custody','parcel_driver_payable','parcel_revenue','tax_liability'].includes(account) || bucket!=='held') failParcel('Parcel accounting requires approved held parcel accounts',409);
  if (!paise) return;
  integer(paise,'posting',1);
  await postLedgerEntry({ idempotencyKey:`PARCEL:${b._id}:${key}`, parcelDeliveryId:b._id, partnerId: account === 'parcel_driver_payable' || account === 'parcel_cash_custody' ? b.partnerId : undefined, paymentId:b.paymentId,
    account, type: direction === 'debit' ? 'reversal' : 'adjustment', direction, bucket, amount:paise/100, reference:b.reference, description:`Parcel ${key}`, metadata:{ policyVersion:b.pricing.policyVersion, amountPaise:paise } },{ session });
}
export async function quoteParcel(customerId, input) {
  requireParcel('booking');
  const p = await currentParcelPolicy();
  const details = validateParcelDetails(input,p.config,distanceKm);
  let route;
  try { route = await getRoute(details.pickup,details.dropoff); } catch { failParcel('Verified route provider unavailable; booking quotation is disabled',503); }
  const pricing = parcelFare(route?.distanceKm,p);
  return Quote.create({ customerId, details, pricing, expiresAt:new Date(Date.now()+p.config.quoteSeconds*1000) });
}
export async function bookParcel(customerId, input, key) {
  requireParcel('booking'); parcelKey(key);
  if (!['online','pay_driver'].includes(input.paymentMethod) || input.acceptTerms !== true) failParcel('Choose payment method and accept terms');
  requireParcel(input.paymentMethod === 'online' ? 'online_payment':'pay_driver');
  // Dispatch prerequisites are checked before accepting a financial obligation.
  requireParcel('auto_assignment'); requireParcel('admin_fallback'); requireParcel('fulfilment');
  const id = digest([String(customerId),key]).slice(0,24), hash = digest([String(input.quoteId),input.paymentMethod,input.acceptTerms]);
  return financialTransaction(async session => {
    const prior = await Parcel.findById(id).session(session);
    if (prior) { if (prior.requestHash !== hash) failParcel('Idempotency key reused with changed booking',409); return prior; }
    const q = await Quote.findOne({ _id:input.quoteId, customerId }).session(session);
    if (!q) failParcel('Quotation not found',404);
    if (q.bookingId || q.expiresAt <= new Date()) failParcel('Quotation expired or already confirmed',409);
    const p = await currentParcelPolicy(session);
    if (p.version !== q.pricing.policyVersion || input.policyVersion !== p.version) failParcel('Policy changed; request a new quotation',409);
    // Serialize policy edits against confirmation without changing its business version.
    await Policy.updateOne({ _id:p._id, version:p.version },{ $inc:{ __v:1 } },{ session });
    if (input.paymentMethod === 'pay_driver' && (!p.config.payDriverEnabled || !p.config.payDriverCategories.includes(q.details.category))) failParcel('Pay-driver is not permitted for this parcel',409);
    const [b] = await Parcel.create([{ _id:id, reference:`PD-${id.toUpperCase()}`, customerId, quoteId:q._id, requestHash:hash, details:q.details, pricing:q.pricing, paymentMethod:input.paymentMethod, paymentStatus:input.paymentMethod === 'online'?'pending':'cash_due', cash:{status:input.paymentMethod==='online'?'not_applicable':'outstanding',amountPaise:0}, status:input.paymentMethod === 'online'?'payment_pending':'searching_for_driver', history:[] }],{ session });
    parcelEvent(b,{ id:customerId,type:'customer' },'terms_accepted');
    q.bookingId = b._id; await q.save({ session }); await b.save({ session }); return b;
  });
}
export function parcelDTO(b, mode = 'customer', partnerId) {
  const v = b.toObject ? b.toObject() : b;
  const summary = { _id:v._id, reference:v.reference, version:v.__v, status:v.status, paymentMethod:v.paymentMethod, paymentStatus:v.paymentStatus, policyVersion:v.pricing.policyVersion, feePaise:v.pricing.totalPaise, currency:'INR', createdAt:v.createdAt };
  if (mode === 'driver' && String(v.partnerId || '') !== String(partnerId)) return { ...summary, offer:v.assignment.offer?{token:v.assignment.offer.token,expiresAt:v.assignment.offer.expiresAt}:undefined, pickupArea:v.details.pickup.pincode, dropoffArea:v.details.dropoff.pincode, weightKg:v.details.weightKg, category:v.details.category, earningPaise:v.pricing.driverPaise };
  const h = v.history.map(e => ({ status:e.status, action:e.action, at:e.at, ...(mode === 'admin'?{ actorId:e.actorId,actorType:e.actorType,reason:e.reason }:{}) }));
  const terminal = ['delivered','cancelled'].includes(v.status);
  return { ...summary, details:mode === 'driver' && terminal ? { category:v.details.category } : v.details, terms:v.pricing.policy.terms, pricing:mode === 'admin'?v.pricing:undefined,
    assignment:mode === 'admin'?v.assignment:undefined, partnerId:v.partnerId, history:h, cash:{ status:v.cash.status, amountPaise:v.cash.amountPaise },
    finance:mode === 'admin'?{...v.finance,settlementBlockers:parcelSettlementBlockers(v)}: mode === 'driver'?{ earningPaise:v.pricing.driverPaise, held:v.finance.held, payoutStatus:'not_released' }:undefined,
    pickupCode:mode === 'customer' && v.status === 'arrived_at_pickup' && !parcelOperationalHold(v) && v.proof.pickup && new Date(v.proof.pickup.expiresAt)>new Date() && !v.proof.pickup.verifiedAt ? v.proof.pickup.code:undefined,
    deliveryCode:mode === 'customer' && v.status === 'arrived_at_dropoff' && !parcelOperationalHold(v) && v.proof.delivery && new Date(v.proof.delivery.expiresAt)>new Date() && !v.proof.delivery.verifiedAt ? v.proof.delivery.code:undefined,
    proof:mode === 'admin'?{ pickupVerifiedAt:v.proof.pickup?.verifiedAt,deliveryVerifiedAt:v.proof.delivery?.verifiedAt }:undefined,
    cancellation:mode === 'admin'?v.cancellation:v.cancellation?{ status:v.cancellation.status }:undefined,
    exception:mode === 'admin'?v.exception:v.exception?{ reason:v.exception.reason }:undefined,
    refund: { status:v.finance.refundStatus || 'none', refundedPaise:v.finance.refundedPaise || 0 } };
}
export async function releaseParcelRider(b,session) {
  const rider = b.partnerId || b.assignment.offer?.partnerId;
  if (!rider) return;
  const p = await Partner.findOne({ _id:rider,'parcelReservation.bookingId':b._id }).session(session);
  if (p) {
    const u = await User.findById(p.userId).select('isActive roles').session(session);
    p.isAvailable = Boolean(p.parcelReservation.previousDuty && p.status==='approved' && u?.isActive && u.roles?.includes('delivery'));
    p.parcelReservation = undefined; await p.save({ session });
  }
}
export async function parcelCustomerCancel(id, customerId, input) {
  requireParcel('booking');
  return financialTransaction(async session => {
    const b = await ownedParcel(id,customerId,session); parcelVersion(b,input.version);
    if (['delivered','cancelled','cancellation_review'].includes(b.status)) failParcel('Cancellation is unavailable',409);
    b.cancellation = { status:'requested', priorState:b.status, reason:boundedText(input.reason,'Cancellation reason'), requestedAt:new Date() };
    parcelEvent(b,{ id:customerId,type:'customer' },'cancellation_requested','cancellation_review');
    touchParcel(b); await b.save({ session }); return b;
  });
}
export async function parcelDriverAction(id,partnerId,input) {
  requireParcel('fulfilment');
  return financialTransaction(async session => {
    const b = await Parcel.findOne({ _id:id,partnerId }).session(session);
    if (!b) failParcel('Assigned booking not found',404);
    parcelVersion(b,input.version);
    if (parcelOperationalHold(b) || ['cancelled','delivered','cancellation_review'].includes(b.status)) failParcel('Task is held or closed',409);
    const p = await Partner.findOne({_id:partnerId,status:'approved','parcelReservation.bookingId':b._id}).session(session);
    const u = p && await User.findOne({_id:p.userId,isActive:true,roles:'delivery'}).session(session);
    if (!p || !u) failParcel('Active approved driver reservation required',409);
    await Partner.updateOne({_id:p._id},{$inc:{__v:1}},{session});
    const actor = { id:partnerId,type:'driver' }, action = input.action;
    const transitions = { driver_arriving:'driver_assigned',arrived_at_pickup:'driver_arriving',in_transit:'picked_up',arrived_at_dropoff:'in_transit' };
    if (transitions[action]) {
      if (b.status !== transitions[action]) failParcel('Invalid task transition',409);
      parcelEvent(b,actor,action,action);
    } else if (['pickup_code','delivery_code'].includes(action)) {
      const pickup = action === 'pickup_code', kind = pickup?'pickup':'delivery';
      if (b.status !== (pickup?'arrived_at_pickup':'arrived_at_dropoff')) failParcel('Arrive before requesting proof',409);
      if (b.proof[kind]?.attempts >= 5) failParcel('Proof attempts exhausted; admin review required',409);
      if (!b.proof[kind] || new Date(b.proof[kind].expiresAt) <= new Date()) b.proof[kind] = { code:crypto.randomInt(100000,1000000).toString(), attempts:b.proof[kind]?.attempts || 0, expiresAt:new Date(Date.now()+600000) };
      parcelEvent(b,actor,action);
    } else if (['verify_pickup','verify_delivery'].includes(action)) {
      const pickup = action === 'verify_pickup', kind = pickup?'pickup':'delivery', proof = b.proof[kind];
      if (b.status !== (pickup?'arrived_at_pickup':'arrived_at_dropoff') || !proof || new Date(proof.expiresAt) <= new Date() || proof.attempts >= 5) failParcel('Valid proof required',409);
      proof.attempts++;
      if (!/^\d{6}$/.test(input.code || '') || !crypto.timingSafeEqual(Buffer.from(proof.code),Buffer.from(String(input.code)))) {
        touchParcel(b); await b.save({ session }); return { invalidProof:true };
      }
      if (!pickup && b.paymentMethod === 'pay_driver' && b.cash.amountPaise !== b.pricing.totalPaise) failParcel('Exact fee collection or an exception is required before delivery',409);
      proof.verifiedAt = new Date(); delete proof.code;
      parcelEvent(b,actor,action,pickup?'picked_up':'delivered');
      if (!pickup) {
        await postParcel(b,'driver-earned','parcel_driver_payable','credit',b.pricing.driverPaise,session);
        await postParcel(b,'platform-earned','parcel_revenue','credit',b.pricing.platformPaise,session);
        await postParcel(b,'tax-earned','tax_liability','credit',b.pricing.taxPaise,session);
        b.finance.earningPosted = true; await releaseParcelRider(b,session);
      }
    } else if (action === 'collect_cash') {
      requireParcel('pay_driver');
      if (b.paymentMethod !== 'pay_driver' || b.status !== 'arrived_at_dropoff' || input.amountPaise !== b.pricing.totalPaise || b.paymentId) failParcel('Exact authorized cash fee at delivery required',409);
      if (!b.cash.collectedAt) {
        b.cash = { status:'collected_unreconciled',amountPaise:b.pricing.totalPaise,collectedAt:new Date(),collectorId:partnerId };
        b.paymentStatus = 'cash_collected';
        await postParcel(b,'cash-collected','parcel_cash_custody','credit',b.pricing.totalPaise,session);
        parcelEvent(b,actor,'cash_collected');
      }
    } else if (action === 'exception') {
      if (!['driver_assigned','driver_arriving','arrived_at_pickup','picked_up','in_transit','arrived_at_dropoff'].includes(b.status)) failParcel('Exception unavailable',409);
      const reasons = ['unreachable_recipient','invalid_address','prohibited_parcel','recipient_refusal','payment_refusal','operational_failure'];
      if (!reasons.includes(input.reason)) failParcel('Supported exception reason required');
      b.exception = { reason:input.reason, priorState:b.status, by:partnerId, at:new Date(), status:'admin_review' }; b.finance.held = true;
      parcelEvent(b,actor,'exception','delivery_failed',input.reason);
      // Retain the reservation until admin decides custody/return handling.
    } else failParcel('Unsupported driver action');
    touchParcel(b); await b.save({ session }); return b;
  });
}
