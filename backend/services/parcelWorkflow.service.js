import crypto from 'node:crypto';
import { httpError } from '../utils/response.js';
const parcelMoneyText = paise => '₹' + (paise / 100).toFixed(2);
import Parcel from '../models/ParcelDelivery.js';
import Quote from '../models/ParcelQuote.js';
import Policy from '../models/ParcelPolicy.js';
import Partner from '../models/DeliveryPartner.js';
import User from '../models/User.js';
import { financialTransaction } from './financeSafety.service.js';
import { postLedgerEntry } from './sellerLedger.service.js';
import { getRoute } from './maps.service.js';
import { distanceKm } from '../utils/geo.js';
import { currentParcelPolicy, validateParcelDetails, parcelFare, requireParcel, failParcel, boundedText, integer, parcelSettlementBlockers, parcelOperationalHold, parcelCashCollectionPoints, boostedParcelPricing, parcelVehicles, parcelVehicleFits, parcelVehicleSnapshot } from './parcelPolicy.service.js';
export const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
// Customers may cancel only until the rider has collected the parcel. After pickup,
// problems go through the rider's help request and the admin review queue instead.
export const parcelCustomerCanCancel = b => !['delivered','cancelled','cancellation_review','picked_up','in_transit','arrived_at_dropoff'].includes(b.status) && !b.proof?.pickup?.verifiedAt;
// Before any rider accepts, a customer cancellation takes effect at once (unless the policy
// frozen with the booking asks for admin review of every cancellation).
export const parcelInstantCancel = b => (b.pricing?.policy?.customerCancel || 'instant_before_assignment') === 'instant_before_assignment'
  && ['payment_pending','payment_failed','searching_for_driver','needs_admin_assignment'].includes(b.status) && !b.partnerId && !b.cancellation;
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
  const vehicles = parcelVehicles(p.config);
  let pricing;
  if (!vehicles.length) pricing = parcelFare(route?.distanceKm,p,details);
  else {
    // One quote prices every vehicle; the customer picks one when booking.
    const options = vehicles.map(v => {
      if (!parcelVehicleFits(details, v)) return { vehicleId:v.id, unavailable:'too_large' };
      try { const { policy:_policy, ...fare } = parcelFare(route?.distanceKm,p,details,v); return { vehicleId:v.id, pricing:fare }; }
      catch { return { vehicleId:v.id, unavailable:'outside_limits' }; }
    });
    const priced = options.filter(o => o.pricing);
    if (!priced.length) failParcel(options.some(o => o.unavailable === 'too_large') ? 'No vehicle can carry goods of this weight or size' : 'Route distance is unsupported',409);
    const cheapest = priced.reduce((a,b) => b.pricing.totalPaise < a.pricing.totalPaise ? b : a);
    pricing = { ...cheapest.pricing, policy:structuredClone(p.config), vehicleOptions:options };
  }
  if (route?.provider) pricing.routeProvider = route.provider;
  const quote = await Quote.create({ customerId, details, pricing, expiresAt:new Date(Date.now()+p.config.quoteSeconds*1000) });
  // Geometry is for the current Google Map only, never a persistent route cache.
  quote.$locals.route = { durationSeconds: Number.isFinite(route?.durationMin) && route.durationMin > 0 ? Math.ceil(route.durationMin * 60) : null, polyline: typeof route?.polyline === 'string' ? route.polyline : null, ...(route?.provider ? { provider: route.provider } : {}) };
  return quote;
}
export async function bookParcel(customerId, input, key) {
  requireParcel('booking'); parcelKey(key);
  if (!['online','pay_driver'].includes(input.paymentMethod) || input.acceptTerms !== true) failParcel('Choose payment method and accept terms');
  if (input.cashCollectionPoint !== undefined && (!['pickup','delivery'].includes(input.cashCollectionPoint) || input.paymentMethod !== 'pay_driver')) failParcel('Choose a valid cash collection point for cash payment');
  const collectionPoint = input.cashCollectionPoint ?? 'delivery';
  requireParcel(input.paymentMethod === 'online' ? 'online_payment':'pay_driver');
  // Dispatch prerequisites are checked before accepting a financial obligation.
  requireParcel('auto_assignment'); requireParcel('admin_fallback'); requireParcel('fulfilment');
  // Preserve legacy idempotency hashes for existing drop-off/online retries.
  const hashInputs = [String(input.quoteId),input.paymentMethod,input.acceptTerms];
  if (input.paymentMethod === 'pay_driver' && collectionPoint !== 'delivery') hashInputs.push(collectionPoint);
  if (input.vehicleId !== undefined) hashInputs.push('vehicle:'+String(input.vehicleId));
  const id = digest([String(customerId),key]).slice(0,24), hash = digest(hashInputs);
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
    // Vehicle quotes: the booking takes the chosen vehicle's frozen fare and records the vehicle,
    // so only riders with a matching vehicle receive the offer.
    let details = q.details, pricing = q.pricing;
    if (q.pricing.vehicleOptions) {
      const option = q.pricing.vehicleOptions.find(o => o.vehicleId === input.vehicleId);
      const vehicle = (q.pricing.policy.vehicles || []).find(v => v.id === input.vehicleId);
      if (!option || !vehicle) failParcel('Choose a vehicle from this quotation');
      if (!option.pricing) failParcel('This vehicle cannot carry your goods; choose another',409);
      const { vehicleOptions:_options, ...base } = q.pricing;
      pricing = { ...base, ...option.pricing, policy:q.pricing.policy, ...(q.pricing.routeProvider ? { routeProvider:q.pricing.routeProvider } : {}) };
      details = { ...q.details, weightKg:q.details.weightKg ?? vehicle.maxWeightKg, dimensions:q.details.dimensions || [...vehicle.dimensionsCm], vehicle:parcelVehicleSnapshot(vehicle) };
    } else if (input.vehicleId !== undefined) failParcel('This quotation has no vehicle choice');
    if (input.paymentMethod === 'pay_driver' && (!p.config.payDriverEnabled || !p.config.payDriverCategories.includes(q.details.category))) failParcel('Pay-driver is not permitted for this parcel',409);
    if (input.paymentMethod === 'pay_driver' && !parcelCashCollectionPoints(p.config).includes(collectionPoint)) failParcel('Cash collection point is not permitted by this policy',409);
    const [b] = await Parcel.create([{ _id:id, reference:`PD-${id.toUpperCase()}`, customerId, quoteId:q._id, requestHash:hash, details, pricing, paymentMethod:input.paymentMethod, paymentStatus:input.paymentMethod === 'online'?'pending':'cash_due', cash:{status:input.paymentMethod==='online'?'not_applicable':'outstanding',amountPaise:0,...(input.paymentMethod==='pay_driver'?{collectionPoint}:{})}, status:input.paymentMethod === 'online'?'payment_pending':'searching_for_driver', history:[] }],{ session });
    parcelEvent(b,{ id:customerId,type:'customer' },'terms_accepted');
    q.bookingId = b._id; await q.save({ session }); await b.save({ session }); return b;
  });
}
export function parcelDTO(b, mode = 'customer', partnerId) {
  const v = b.toObject ? b.toObject() : b;
  const summary = { _id:v._id, reference:v.reference, version:v.__v, status:v.status, paymentMethod:v.paymentMethod, paymentStatus:v.paymentStatus, policyVersion:v.pricing.policyVersion, feePaise:v.pricing.totalPaise, currency:'INR', createdAt:v.createdAt, ...(v.paymentMethod==='pay_driver'?{cashCollectionPoint:v.cash.collectionPoint || 'delivery'}:{}) };
  if (mode === 'driver' && String(v.partnerId || '') !== String(partnerId)) return { ...summary, offer:v.assignment.offer?{token:v.assignment.offer.token,expiresAt:v.assignment.offer.expiresAt}:undefined, pickupArea:v.details.pickup.pincode, dropoffArea:v.details.dropoff.pincode, weightKg:v.details.weightKg, category:v.details.category, earningPaise:v.pricing.driverPaise, ...(v.details.vehicle?{ vehicle:{ id:v.details.vehicle.id, name:v.details.vehicle.name } }:{}) };
  const h = v.history.map(e => ({ status:e.status, action:e.action, at:e.at, ...(mode === 'admin'?{ actorId:e.actorId,actorType:e.actorType,reason:e.reason }:{}) }));
  const terminal = ['delivered','cancelled'].includes(v.status);
  return { ...summary, details:mode === 'driver' && terminal ? { category:v.details.category } : v.details, terms:v.pricing.policy.terms, pricing:mode === 'admin'?v.pricing:undefined,
    route:mode === 'customer'?{ distanceMetres:v.pricing.distanceMetres, ...(v.pricing.routeProvider ? { provider:v.pricing.routeProvider } : {}) }:undefined,
    service:mode === 'customer'?(v.details.vehicle?{ id:v.details.vehicle.id, name:v.details.vehicle.name, ...(v.details.vehicle.icon?{ icon:v.details.vehicle.icon }:{}) }:{ id:'parcel', name:'Doorstep delivery' }):undefined,
    vehicle:mode !== 'customer' && v.details.vehicle?{ id:v.details.vehicle.id, name:v.details.vehicle.name }:undefined,
    canCancel:mode === 'customer'?parcelCustomerCanCancel(v):undefined,
    boost:mode === 'customer'?parcelBoostState(v):mode === 'admin'?{ boostedPaise:v.pricing.boostPaise||0, boosts:v.pricing.boosts||[] }:undefined,
    assignment:mode === 'admin'?v.assignment:undefined, partnerId:v.partnerId, history:h, cash:{ status:v.cash.status, amountPaise:v.cash.amountPaise },
    finance:mode === 'admin'?{...v.finance,settlementBlockers:parcelSettlementBlockers(v)}: mode === 'driver'?{ earningPaise:v.pricing.driverPaise, held:v.finance.held, payoutStatus:'not_released' }:undefined,
    pickupCode:mode === 'customer' && v.status === 'arrived_at_pickup' && !parcelOperationalHold(v) && v.proof.pickup && new Date(v.proof.pickup.expiresAt)>new Date() && !v.proof.pickup.verifiedAt ? v.proof.pickup.code:undefined,
    deliveryCode:mode === 'customer' && v.status === 'arrived_at_dropoff' && !parcelOperationalHold(v) && v.proof.delivery && new Date(v.proof.delivery.expiresAt)>new Date() && !v.proof.delivery.verifiedAt ? v.proof.delivery.code:undefined,
    proof:mode === 'admin'?{ pickupVerifiedAt:v.proof.pickup?.verifiedAt,deliveryVerifiedAt:v.proof.delivery?.verifiedAt }:undefined,
    cancellation:mode === 'admin'?v.cancellation:v.cancellation?{ status:v.cancellation.status }:undefined,
    exception:mode === 'admin'?v.exception:v.exception?{ reason:v.exception.reason }:undefined,
    refund: { status:v.finance.refundStatus || 'none', refundedPaise:v.finance.refundedPaise || 0, ...(v.finance.walletRefund?{ toWallet:true }:{}) } };
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
/**
 * Whether the customer can add a fare boost right now, and with which amounts.
 * Boosting is for bookings still waiting for a rider. Online-paid bookings are
 * excluded until a top-up payment flow exists (the captured amount must equal the fare).
 */
export function parcelBoostState(b) {
  const c = b.pricing?.policy || {};
  const used = b.pricing?.boostPaise || 0;
  const remaining = Math.max(0, (c.maxBoostPaise || 0) - used);
  const options = (c.boostOptionsPaise || []).filter(a => a <= remaining);
  const base = { boostedPaise: used, options, remainingPaise: remaining };
  // Cash bookings collect the boost in cash with the fare; online-paid bookings pay it
  // from the customer's Bulkimart wallet (the original Razorpay payment is never changed).
  const funding = b.paymentMethod === 'online' ? 'wallet' : 'cash';
  Object.assign(base, { funding });
  if (!c.boostEnabled) return { ...base, allowed: false, reason: 'not_offered' };
  if (b.paymentMethod === 'online' && b.paymentStatus !== 'paid') return { ...base, allowed: false, reason: 'payment_pending' };
  if (!['searching_for_driver', 'needs_admin_assignment'].includes(b.status) || b.partnerId || b.cancellation || parcelOperationalHold(b)) return { ...base, allowed: false, reason: 'not_waiting_for_rider' };
  if (!options.length) return { ...base, allowed: false, reason: 'limit_reached' };
  return { ...base, allowed: true };
}

/**
 * The customer adds a boost to a booking nobody has accepted yet. The fare and the
 * rider earning rise (cash is collected at the new total), the open offer round is
 * closed, and a fresh round goes out at once — including to riders who declined the
 * lower fare. Idempotent per request key.
 */
export async function boostParcel(id, customerId, input) {
  requireParcel('booking');
  const key = parcelKey(input.key);
  const amountPaise = input.amountPaise;
  const b = await financialTransaction(async session => {
    const b = await ownedParcel(id, customerId, session);
    if ((b.pricing.boosts || []).some(x => x.key === key)) return b; // replayed request
    parcelVersion(b, input.version);
    const state = parcelBoostState(b);
    if (!state.allowed) failParcel(state.reason === 'payment_pending' ? 'Complete the booking payment before adding to the fare' : state.reason === 'limit_reached' ? 'The maximum fare boost for this booking has been reached' : 'This booking can no longer be boosted', 409);
    if (!Number.isSafeInteger(amountPaise) || !state.options.includes(amountPaise)) failParcel('Choose one of the offered boost amounts');
    const next = boostedParcelPricing(b.pricing, amountPaise);
    if (state.funding === 'wallet') {
      // Debited in this same transaction, keyed to the request, so a retry never charges twice.
      const { default: UserModel } = await import('../models/User.js');
      const balancePaise = Math.round(((await UserModel.findById(customerId).select('wallet.balance').session(session).lean())?.wallet?.balance || 0) * 100);
      if (balancePaise < amountPaise) throw httpError(409, `Your Bulkimart wallet has ${parcelMoneyText(balancePaise)}. Add ${parcelMoneyText(amountPaise - balancePaise)} to pay this boost.`, { code: 'WALLET_BALANCE_SHORT', shortPaise: amountPaise - balancePaise, balancePaise });
      const { debitWallet } = await import('./wallet.service.js');
      const { WALLET_TRANSACTION_TYPE, WALLET_REFERENCE_TYPE } = await import('../models/WalletLedger.js');
      await debitWallet({ userId: customerId, amount: amountPaise / 100, type: WALLET_TRANSACTION_TYPE.ORDER_PAYMENT, referenceType: WALLET_REFERENCE_TYPE.PARCEL,
        referenceId: String(b._id), description: `Fare boost for parcel #${String(b.reference || b._id).slice(-6).toUpperCase()}`, idempotencyKey: `PARCEL_BOOST:${b._id}:${key}`, session });
      // Money now held for this booking, alongside the original online capture.
      await postParcel(b, `boost-${key}`, 'parcel_collections', 'credit', amountPaise, session);
    }
    b.pricing = { ...b.pricing, totalPaise: next.totalPaise, driverPaise: next.driverPaise, taxPaise: next.taxPaise, platformPaise: next.platformPaise, boostPaise: next.boostPaise,
      ...(state.funding === 'wallet' ? { walletBoostPaise: (b.pricing.walletBoostPaise || 0) + amountPaise } : {}),
      boosts: [...(b.pricing.boosts || []), { key, amountPaise, driverPaise: next.driverBoostPaise, funding: state.funding, at: new Date() }] };
    b.markModified('pricing');
    // Close the current offer round and start counting rounds afresh at the new fare;
    // earlier rounds (including declines) are kept for the record.
    for (const a of b.assignment.attempts) if (a.outcome === 'offered') { a.outcome = 'superseded'; a.resolvedAt = new Date(); }
    b.assignment.history = [...(b.assignment.history || []), ...b.assignment.attempts];
    // A boost is a fresh search: new offer rounds and a new search window (parcelAssignment.service).
    b.assignment.attempts = []; delete b.assignment.offer; delete b.assignment.searchStartedAt; b.assignment.reason = '';
    parcelEvent(b, { id: customerId, type: 'customer' }, 'fare_boosted', 'searching_for_driver', `+₹${(amountPaise / 100).toFixed(2)}`);
    touchParcel(b); await b.save({ session }); return b;
  });
  // Broadcast the higher earning straight away (also notifies customer and riders).
  const { assignParcel } = await import('./parcelAssignment.service.js');
  try { return await assignParcel(b._id); } catch { return Parcel.findById(b._id); }
}

export async function parcelCustomerCancel(id, customerId, input) {
  requireParcel('booking');
  return financialTransaction(async session => {
    const b = await ownedParcel(id,customerId,session); parcelVersion(b,input.version);
    if (!parcelCustomerCanCancel(b)) failParcel(b.proof?.pickup?.verifiedAt ? 'The parcel has been picked up and can no longer be cancelled' : 'Cancellation is unavailable',409);
    const reason = boundedText(input.reason,'Cancellation reason');
    if (parcelInstantCancel(b)) {
      // No rider has accepted: cancel now. Open offers are withdrawn and money already held
      // (online capture, wallet-paid boosts) goes back to the customer's Bulkimart wallet.
      const now = new Date();
      b.cancellation = { status:'approved', priorState:b.status, reason, requestedAt:now, decidedAt:now, instant:true, refundTo:'wallet' };
      for (const attempt of b.assignment.attempts || []) if (attempt.outcome === 'offered') { attempt.outcome = 'cancelled'; attempt.resolvedAt = now; }
      await releaseParcelRider(b,session); delete b.assignment.offer;
      b.finance.held = true;
      parcelEvent(b,{ id:customerId,type:'customer' },'cancelled_by_customer','cancelled',reason);
      const { autoRefundParcelToWallet, refundParcelBoostToWallet } = await import('./parcelPayment.service.js');
      await autoRefundParcelToWallet(b,{ type:'system' },session);
      await refundParcelBoostToWallet(b,{ type:'system' },session);
      touchParcel(b); await b.save({ session }); return b;
    }
    b.cancellation = { status:'requested', priorState:b.status, reason, requestedAt:new Date() };
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
      if (pickup && b.paymentMethod === 'pay_driver' && b.cash.collectionPoint === 'pickup' && b.cash.amountPaise !== b.pricing.totalPaise) failParcel('Collect the exact pickup fee before confirming pickup',409);
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
      const collectionPoint = b.cash.collectionPoint || 'delivery';
      if (b.paymentMethod !== 'pay_driver' || b.status !== (collectionPoint === 'pickup' ? 'arrived_at_pickup' : 'arrived_at_dropoff') || input.amountPaise !== b.pricing.totalPaise || b.paymentId) failParcel('Exact authorized cash fee at the selected collection point required',409);
      if (!b.cash.collectedAt) {
        b.cash = { collectionPoint, status:'collected_unreconciled',amountPaise:b.pricing.totalPaise,collectedAt:new Date(),collectorId:partnerId };
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
