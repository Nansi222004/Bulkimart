import crypto from 'node:crypto';
import Parcel from '../models/ParcelDelivery.js';
import Partner from '../models/DeliveryPartner.js';
import User from '../models/User.js';
import Order from '../models/Order.js';
import Delivery from '../models/Delivery.js';
import Return from '../models/Return.js';
import { riderPickupPosition } from './riderEligibility.service.js';
import { maxConcurrentDeliveries } from './riderCapacity.service.js';
import { distanceKm } from '../utils/geo.js';
import { financialTransaction } from './financeSafety.service.js';
import { requireParcel, parcelFlags, productionParcel, failParcel, parcelOperationalHold } from './parcelPolicy.service.js';
import { RETURN_PICKUP_STATUS } from '../constants/enums.js';
import { parcelEvent, parcelVersion, touchParcel, releaseParcelRider } from './parcelWorkflow.service.js';
import { notifyUser, notifyRider, notifyAllAdmins } from './notification.service.js';
export async function eligibleParcelRider(p,b,session,reserved = false) {
  const c = b.pricing.policy;
  if (!p || p.parcelReturnClaim?.token || p.status !== 'approved' || (!p.isAvailable && !reserved) || (p.parcelReservation?.bookingId && String(p.parcelReservation.bookingId) !== String(b._id))) return false;
  const u = await User.findById(p.userId).select('isActive roles').session(session);
  if (!u?.isActive || !u.roles?.includes('delivery')) return false;
  const origin = p.currentLocation, km = distanceKm(origin,b.details.pickup);
  // Require a fresh current fix for cash and parcel custody. A home pin is not live availability.
  const age = Date.now()-new Date(p.currentLocation?.updatedAt || 0).getTime();
  if (!Number.isFinite(age) || age > c.locationMaxAgeSeconds*1000 || age < -60000 || !origin || km === undefined || km > c.assignmentRadiusKm || (p.deliveryRadiusKm != null && km > p.deliveryRadiusKm)) return false;
  if (p.zones?.length && (!p.zones.includes(b.details.pickup.pincode) || !p.zones.includes(b.details.dropoff.pincode))) return false;
  const orders = await Order.countDocuments({deliveryPartnerId:p._id,status:{$nin:['delivered','cancelled','returned','refunded']}}).session(session);
  const returns = await Delivery.countDocuments({partnerId:p._id,direction:'return_pickup',status:{$nin:['rejected','delivered','failed']}}).session(session);
  const pendingReturn = await Return.exists({'pickup.partnerId':p._id,'pickup.status':{$in:[RETURN_PICKUP_STATUS.ASSIGNED,RETURN_PICKUP_STATUS.PICKED_UP]}}).session(session);
  const limit = Math.min(c.maxActiveTasks,maxConcurrentDeliveries() || c.maxActiveTasks);
  return orders+returns === 0 && !pendingReturn && limit >= 1;
}
export const dispatchReady = b => !b.cancellation && !parcelOperationalHold(b) && (b.paymentMethod === 'online' ? b.paymentStatus === 'paid' : b.paymentStatus === 'cash_due');
export async function notifyParcel(b) {
  // Financial commits precede best-effort notifications; no addresses or proof codes.
  const opts = { event:'PARCEL_UPDATED',dedupeKey:`PARCEL:${b._id}:${b.__v}:customer`,title:'Parcel delivery update',message:'Open Parcel Deliveries for the latest status.',metadata:{parcelDeliveryId:String(b._id)},route:`/parcel-delivery/track/${b._id}` };
  const jobs = [notifyUser(String(b.customerId),opts)];
  if (b.assignment.offer) jobs.push(notifyRider(String(b.assignment.offer.partnerId),{...opts,dedupeKey:`PARCEL:${b._id}:${b.assignment.offer.token}:offer`,route:'/delivery/parcels'}));
  if (b.status === 'needs_admin_assignment') jobs.push(notifyAllAdmins({...opts,route:'/admin/parcel-delivery'}));
  await Promise.allSettled(jobs);
}
export async function assignParcel(id,{partnerId,actor,version,reason} = {}) {
  requireParcel(partnerId?'admin_fallback':'auto_assignment');
  const b = await financialTransaction(async session => {
    const b = await Parcel.findById(id).session(session);
    if (!b) failParcel('Booking not found',404);
    if (partnerId) { parcelVersion(b,version); if (!reason || typeof reason !== 'string' || reason.length > 500) failParcel('Assignment reason required'); }
    if (!dispatchReady(b)) failParcel('Booking is not dispatch eligible',409);
    if (partnerId && b.status !== 'needs_admin_assignment') failParcel('Manual assignment requires the fallback queue',409);
    if (!['searching_for_driver','needs_admin_assignment'].includes(b.status)) return b;
    if (!partnerId && b.status === 'needs_admin_assignment') return b;
    const offer = b.assignment.offer;
    if (offer && new Date(offer.expiresAt) > new Date()) return b;
    if (offer) {
      const old = b.assignment.attempts.find(x=>x.token === offer.token); if (old) {old.outcome='timeout';old.resolvedAt=new Date();}
      await releaseParcelRider(b,session); delete b.assignment.offer;
    }
    let candidates = [];
    if (partnerId) candidates = [await Partner.findById(partnerId).session(session)];
    else if (b.assignment.attempts.length < b.pricing.policy.maxAttempts) {
      const lat = b.details.pickup.lat, lng = b.details.pickup.lng, delta = b.pricing.policy.assignmentRadiusKm/111;
      candidates = await Partner.find({status:'approved',isAvailable:true,'parcelReservation.bookingId':{$exists:false},'parcelReturnClaim.token':{$exists:false},
        'currentLocation.lat':{$gte:lat-delta,$lte:lat+delta},'currentLocation.lng':{$gte:lng-delta/Math.max(.1,Math.cos(lat*Math.PI/180)),$lte:lng+delta/Math.max(.1,Math.cos(lat*Math.PI/180))}}).limit(100).session(session);
      candidates = candidates.filter(p=>!b.assignment.attempts.some(a=>String(a.partnerId) === String(p._id))).sort((a,c)=>distanceKm(riderPickupPosition(a),b.details.pickup)-distanceKm(riderPickupPosition(c),b.details.pickup));
    }
    let selected;
    for (const p of candidates) {
      if (!await eligibleParcelRider(p,b,session)) continue;
      selected = await Partner.findOneAndUpdate({_id:p._id,status:'approved',isAvailable:true,'parcelReservation.bookingId':{$exists:false},'parcelReturnClaim.token':{$exists:false}},{$set:{isAvailable:false,parcelReservation:{bookingId:b._id,previousDuty:true}},$inc:{__v:1}},{session,returnDocument:'after'});
      if (selected) break;
    }
    if (!selected) {
      if (partnerId) failParcel('Driver unavailable, stale, outside coverage or at capacity',409);
      requireParcel('admin_fallback');
      b.assignment.reason = b.assignment.attempts.length >= b.pricing.policy.maxAttempts?'attempts_exhausted':'no_eligible_driver';
      parcelEvent(b,{type:'system'},'admin_fallback','needs_admin_assignment',b.assignment.reason);
    } else {
      const attempt = {number:b.assignment.attempts.length+1,partnerId:String(selected._id),token:crypto.randomUUID(),offeredAt:new Date(),expiresAt:new Date(Date.now()+b.pricing.policy.acceptanceSeconds*1000),outcome:'offered',by:actor?.id,reason};
      b.assignment.attempts.push(attempt); b.assignment.offer = {...attempt};
      parcelEvent(b,actor || {type:'system'},partnerId?'manual_offer':'automatic_offer','searching_for_driver',reason);
    }
    touchParcel(b); await b.save({session}); return b;
  });
  await notifyParcel(b); return b;
}
export async function respondParcelOffer(id,partnerId,input) {
  requireParcel('fulfilment');
  const b = await financialTransaction(async session => {
    const b = await Parcel.findById(id).session(session), offer = b?.assignment.offer;
    if (!b || !offer || String(offer.partnerId) !== String(partnerId)) failParcel('Offer not found',404);
    parcelVersion(b,input.version);
    if (b.status !== 'searching_for_driver' || offer.token !== input.token || new Date(offer.expiresAt) <= new Date() || !dispatchReady(b)) failParcel('Offer expired or no longer available',409);
    const p = await Partner.findById(partnerId).session(session);
    if (!p || String(p.parcelReservation?.bookingId) !== String(b._id)) failParcel('Reservation no longer held',409);
    // Serialize changes in eligibility/duty against this offer response.
    await Partner.updateOne({_id:p._id},{$inc:{__v:1}},{session});
    const attempt = b.assignment.attempts.find(x=>x.token === offer.token);
    if (!['accept','reject'].includes(input.action)) failParcel('Accept or reject required');
    if (input.action === 'accept') {
      if (!await eligibleParcelRider(p,b,session,true)) failParcel('Driver no longer eligible',409);
      b.partnerId = partnerId; attempt.outcome='accepted';
      parcelEvent(b,{id:partnerId,type:'driver'},'offer_accepted','driver_assigned');
    } else {
      attempt.outcome='rejected'; await releaseParcelRider(b,session);
      parcelEvent(b,{id:partnerId,type:'driver'},'offer_rejected');
    }
    attempt.resolvedAt=new Date(); delete b.assignment.offer;
    touchParcel(b); await b.save({session}); return b;
  });
  if (input.action === 'reject') return assignParcel(b._id);
  await notifyParcel(b); return b;
}
let sweeping = false;
export async function sweepParcelsOnce() {
  if (sweeping || productionParcel() || !parcelFlags().auto_assignment || !parcelFlags().admin_fallback) return {processed:0};
  sweeping = true;
  try {
    const rows = await Parcel.find({status:'searching_for_driver',$or:[{'assignment.offer':{$exists:false}},{'assignment.offer.expiresAt':{$lte:new Date()}}]}).select('_id').sort({createdAt:1}).limit(50);
    for (const row of rows) { try { await assignParcel(row._id); } catch { /* Durable state remains for next sweep. */ } }
    return {processed:rows.length};
  } finally { sweeping=false; }
}
