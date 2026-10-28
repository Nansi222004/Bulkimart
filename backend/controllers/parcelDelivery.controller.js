import mongoose from 'mongoose';
import Parcel, { PARCEL_REVIEW_STATES } from '../models/ParcelDelivery.js';
import Quote from '../models/ParcelQuote.js';
import Policy from '../models/ParcelPolicy.js';
import Partner from '../models/DeliveryPartner.js';
import User from '../models/User.js';
import { distanceKm } from '../utils/geo.js';
import Payment from '../models/Payment.js';
import Ledger from '../models/SellerLedgerEntry.js';
import { ok, created, paginated, getPagination } from '../utils/response.js';
import { financialTransaction } from '../services/financeSafety.service.js';
import { parcelFlags, productionParcel, requireParcel, parcelPermission, validateParcelPolicy, failParcel, boundedText, parcelOperationalHold, parcelCashCollectionPoints } from '../services/parcelPolicy.service.js';
import { quoteParcel, bookParcel, parcelDTO, parcelCustomerCancel, parcelDriverAction, parcelVersion, parcelEvent, releaseParcelRider, touchParcel, postParcel, ownedParcel } from '../services/parcelWorkflow.service.js';
import { assignParcel, respondParcelOffer, notifyParcel, parcelRiderIneligibility } from '../services/parcelAssignment.service.js';
import { parcelOfferFilter } from '../services/parcelOffers.js';
import { initiateParcelPayment, verifyParcelPayment, approveParcelRefund, executeParcelRefund, refundParcelToWallet, autoRefundParcelToWallet } from '../services/parcelPayment.service.js';
import { reconcileCreationAttempt } from '../services/paymentRecovery.service.js';
export const capabilities = (_req,res) => ok(res,{...parcelFlags(),productionBlocked:productionParcel()});
const canReadFinance = req => req.userType==='admin' && (req.user.role==='superAdmin' || req.user.permissions?.includes('manage_finance'));
async function driverSummaries(ids) {
  const partners=await Partner.find({_id:{$in:[...new Set(ids.filter(Boolean).map(String))]}}).select('userId zones vehicleType').lean();
  const users=await User.find({_id:{$in:partners.map(p=>p.userId)}}).select('name').lean();
  const names=new Map(users.map(u=>[String(u._id),u.name]));
  return partners.map(p=>({_id:p._id,name:names.get(String(p.userId))||'Delivery partner '+String(p._id).slice(-4).toUpperCase(),zones:p.zones,vehicleType:p.vehicleType}));
}
// The assigned rider as the customer sees them. Phone and vehicle number only while the delivery is under way.
const RIDER_CONTACT_STATES=['driver_assigned','driver_arriving','arrived_at_pickup','picked_up','in_transit','arrived_at_dropoff'];
async function customerPartnerView(b) {
  const active=RIDER_CONTACT_STATES.includes(b.status);
  if(!b.partnerId || (!active && b.status!=='delivered')) return undefined;
  const p=await Partner.findById(b.partnerId).select('userId vehicleType vehicleNo rating ratingCount').lean(); if(!p) return undefined;
  const u=await User.findById(p.userId).select('name phone avatar').lean();
  return { name:u?.name||'Your delivery partner', vehicleType:p.vehicleType, ...(p.ratingCount>0?{rating:p.rating}:{}), ...(u?.avatar?{avatar:u.avatar}:{}), ...(active?{phone:u?.phone,vehicleNo:p.vehicleNo}:{}) };
}
const dtoFor = (req,b) => {
  const dto=parcelDTO(b,req.parcelMode,req.parcelPartner?._id);
  if(req.parcelMode==='admin' && !canReadFinance(req)) {
    dto.finance={held:true};
    dto.history=dto.history.map(e=>/^(?:refund_|payment_|cash_|bank_|gateway_|allocate_cancelled_capture)/.test(e.action)?{status:e.status,action:e.action,at:e.at}:e);
  }
  return dto;
};
export async function catalogue(_req,res) {
  requireParcel('catalogue');
  const p=await Policy.findById('parcel');
  return ok(res,p?{version:p.version,terms:p.config.terms,categories:p.config.categories,prohibitedItems:p.config.prohibitedItems,maxWeightKg:p.config.maxWeightKg,maxDimensionCm:p.config.maxDimensionCm,payDriverEnabled:p.config.payDriverEnabled,payDriverCategories:p.config.payDriverCategories,cashCollectionPoint:p.config.cashCollectionPoint,cashCollectionPoints:parcelCashCollectionPoints(p.config),areas:p.config.areas.map(a=>({name:a.name,pincodes:a.pincodes})),ready:new Date(p.config.effectiveAt)<=new Date()}:null);
}
export async function quote(req,res) {
  const q=await quoteParcel(req.user._id,req.body);
  return created(res,{_id:q._id,expiresAt:q.expiresAt,details:q.details,cashCollectionPoints:parcelCashCollectionPoints(q.pricing.policy),route:{distanceMetres:q.pricing.distanceMetres,...q.$locals.route},service:{id:'parcel',name:'Doorstep delivery',maxWeightKg:q.pricing.policy.maxWeightKg,maxDimensionCm:q.pricing.policy.maxDimensionCm},pricing:{policyVersion:q.pricing.policyVersion,totalPaise:q.pricing.totalPaise,basePaise:q.pricing.basePaise,distancePaise:q.pricing.distancePaise,taxPaise:q.pricing.taxPaise,minimumAdjustmentPaise:q.pricing.totalPaise-q.pricing.basePaise-q.pricing.distancePaise,distanceMetres:q.pricing.distanceMetres,currency:'INR'},terms:q.pricing.policy.terms});
}
export async function book(req,res) {
  const b=await bookParcel(req.user._id,req.body,req.get('Idempotency-Key'));
  // A failed provider notification or dispatch never changes booking acceptance.
  if(b.status==='searching_for_driver') { try { await assignParcel(b._id); } catch { /* Durable sweep owns retries. */ } }
  return created(res,parcelDTO(await Parcel.findById(b._id)));
}
export async function list(req,res) {
  const {page,limit,skip}=getPagination(req.query);
  const filter=req.parcelMode==='customer'?{customerId:req.user._id}:req.parcelMode==='driver'?{$or:[{partnerId:req.parcelPartner._id},parcelOfferFilter(req.parcelPartner._id)]}:{};
  // `needs_review` is the admin queue: rider help requests and customer cancellation requests.
  if(req.parcelMode==='admin' && req.query.status==='needs_review') filter.status={$in:PARCEL_REVIEW_STATES};
  else if(req.query.status) filter.status=String(req.query.status);
  if(req.parcelMode==='admin' && req.query.reference) filter.reference=String(req.query.reference).slice(0,64);
  const rows=await Parcel.find(filter).sort({createdAt:-1}).skip(skip).limit(limit);
  const total=await Parcel.countDocuments(filter);
  return paginated(res,rows.map(b=>dtoFor(req,b)),{page,limit,total});
}
export async function detail(req,res) {
  const filter={_id:req.params.id};
  if(req.parcelMode==='customer') filter.customerId=req.user._id;
  if(req.parcelMode==='driver') filter.$or=[{partnerId:req.parcelPartner._id},parcelOfferFilter(req.parcelPartner._id)];
  const b=await Parcel.findOne(filter); if(!b) failParcel('Booking not found',404);
  const dto=dtoFor(req,b);
  if(req.parcelMode==='customer') dto.partner=await customerPartnerView(b);
  if(req.parcelMode==='admin') dto.drivers=await driverSummaries([b.partnerId,...(b.assignment.attempts||[]).map(a=>a.partnerId)]);
  if(req.parcelMode==='admin' && canReadFinance(req)) {
    dto.ledger=await Ledger.find({parcelDeliveryId:b._id}).sort({createdAt:1}).lean();
    const p=b.paymentId && await Payment.findById(b.paymentId).select('gatewayAttempts captures refundObligations status');
    dto.payment=p?.toObject();
  }
  return ok(res,dto);
}
export async function cancel(req,res) { const b=await parcelCustomerCancel(req.params.id,req.user._id,req.body); await notifyParcel(b); return ok(res,parcelDTO(b)); }
export async function pay(req,res) { return ok(res,await initiateParcelPayment(req.params.id,req.user._id,req.body,req.get('Idempotency-Key'))); }
export async function verify(req,res) { if(!mongoose.isValidObjectId(req.body.orderId)) failParcel('Invalid booking ID'); return ok(res,await verifyParcelPayment(req.body.orderId,req.user._id,req.body)); }
export async function paymentStatus(req,res) { return ok(res,await verifyParcelPayment(req.params.id,req.user._id,{},true)); }
export async function respond(req,res) { const b=await respondParcelOffer(req.params.id,req.parcelPartner._id,req.body); return ok(res,req.body.action==='reject'?{status:'rejected'}:parcelDTO(b,'driver',req.parcelPartner._id)); }
export async function driverAction(req,res) {
  const b=await parcelDriverAction(req.params.id,req.parcelPartner._id,req.body);
  if(b.invalidProof) failParcel('Invalid proof code',400);
  await notifyParcel(b); return ok(res,parcelDTO(b,'driver',req.parcelPartner._id));
}
export async function policies(_req,res) { return ok(res,await Policy.findById('parcel')); }
export async function savePolicy(req,res) {
  const config=validateParcelPolicy(req.body.config);
  const p=await financialTransaction(async session=>{
    let p=await Policy.findById('parcel').session(session);
    if(req.body.version !== (p?.version || 0)) failParcel('Policy changed; reload',409);
    if(!p) p=new Policy({_id:'parcel',version:0,config});
    p.version++; p.config=config; p.history.push({version:p.version,config,by:req.user._id,at:new Date()});
    await p.save({session}); return p;
  });
  return ok(res,p);
}
export async function candidates(req,res) {
  const b=await Parcel.findById(req.params.id); if(!b) failParcel('Booking not found',404);
  const rows=await Partner.find({status:'approved'});
  const summaries=await driverSummaries(rows.map(p=>p._id)),available=[],unavailableDrivers=[];
  for(const p of rows) {
    const reason=await parcelRiderIneligibility(p,b,null);
    const summary={...summaries.find(row=>String(row._id)===String(p._id)),pickupDistanceKm:distanceKm(p.currentLocation,b.details.pickup)};
    if(!reason)available.push(summary);
    else unavailableDrivers.push({...summary,reason,locationAgeSeconds:p.currentLocation?.updatedAt?Math.max(0,Math.round((Date.now()-new Date(p.currentLocation.updatedAt))/1000)):null,locationMaxAgeSeconds:b.pricing.policy.locationMaxAgeSeconds,assignmentRadiusKm:b.pricing.policy.assignmentRadiusKm});
  }
  return ok(res,available,'',{unavailableDrivers});
}
export async function assign(req,res) {
  if(!mongoose.isValidObjectId(req.body.partnerId)) failParcel('Valid partner ID required');
  return ok(res,dtoFor(req,await assignParcel(req.params.id,{partnerId:req.body.partnerId,actor:{id:req.user._id,type:'admin'},version:req.body.version,reason:boundedText(req.body.reason,'Assignment reason')})));
}
export async function adminAction(req,res) {
  requireParcel('fulfilment');
  const action=req.body.action;
  const financial=['reconcile_cash','bank_reconciled','approve_refund','cash_refund_evidence','allocate_cancelled_capture','refund_to_wallet'];
  if(financial.includes(action)) parcelPermission(req,'manage_finance');
  const b=await financialTransaction(async session=>{
    const b=await Parcel.findById(req.params.id).session(session); if(!b) failParcel('Booking not found',404);
    parcelVersion(b,req.body.version);
    const reason=boundedText(req.body.reason,'Review reason'), actor={id:req.user._id,type:'admin'};
    if(action==='approve_cancellation') {
      if(b.status!=='cancellation_review' || b.cancellation?.status!=='requested') failParcel('Cancellation review required',409);
      if((b.proof.pickup?.verifiedAt || ['picked_up','in_transit','arrived_at_dropoff'].includes(b.cancellation.priorState)) && !req.body.custodyEvidence) failParcel('Parcel return/custody evidence required',409);
      if(req.body.custodyEvidence) b.cancellation.custodyEvidence=boundedText(req.body.custodyEvidence,'Custody evidence');
      b.cancellation.status='approved'; b.finance.held=true; await releaseParcelRider(b,session); delete b.assignment.offer;
      for(const attempt of b.assignment.attempts) if(attempt.outcome==='offered'){attempt.outcome='cancelled';attempt.resolvedAt=new Date();}
      parcelEvent(b,actor,action,'cancelled',reason);
      // Money already held (online capture or deposited cash) goes straight back to the customer's wallet,
      // unless the admin chose to refund the original payment method (Razorpay refund or cash handed back).
      if(req.body.refundTo!==undefined && !['wallet','original'].includes(req.body.refundTo)) failParcel('Choose wallet or original payment method for the refund');
      b.cancellation.refundTo=req.body.refundTo||'wallet';
      await autoRefundParcelToWallet(b,{type:'system'},session);
    } else if(action==='reject_cancellation') {
      if(b.status!=='cancellation_review') failParcel('Cancellation review required',409);
      if(parcelOperationalHold(b)) failParcel('Financial review prevents resuming delivery',409);
      const state=b.cancellation.priorState; b.cancellation=undefined;
      parcelEvent(b,actor,action,state,reason);
    } else if(action==='reassign') {
      if(!['driver_assigned','driver_arriving','arrived_at_pickup'].includes(b.status)) failParcel('Reassignment is allowed only before pickup',409);
      await releaseParcelRider(b,session); const old=String(b.partnerId); b.partnerId=undefined; b.proof={};
      b.assignment.previousPartnerId=old; b.assignment.reason='admin_reassignment';
      parcelEvent(b,actor,action,'needs_admin_assignment',reason);
    } else if(action==='retry_exception') {
      if(b.status!=='delivery_failed' || b.exception?.status!=='admin_review' || !b.partnerId) failParcel('Assigned exception review required',409);
      if(parcelOperationalHold(b)) failParcel('Financial review prevents retrying delivery',409);
      b.exception.status='retry_approved';
      parcelEvent(b,actor,action,b.exception.priorState,reason);
    } else if(action==='resolve_exception') {
      if(b.status!=='delivery_failed' || b.exception?.status!=='admin_review') failParcel('Exception review required',409);
      b.exception.custodyEvidence=boundedText(req.body.custodyEvidence,'Return/custody evidence'); b.exception.status='resolved';
      await releaseParcelRider(b,session); parcelEvent(b,actor,action,'cancelled',reason);
    } else if(action==='reconcile_cash') {
      if(b.paymentMethod!=='pay_driver' || b.cash.status!=='collected_unreconciled' || req.body.amountPaise!==b.cash.amountPaise || b.finance.cashRefund) failParcel('Exact outstanding cash collection required',409);
      const evidence=boundedText(req.body.evidence,'Verified deposit evidence');
      b.cash.status='reconciled'; b.cash.reconciledAt=new Date(); b.cash.verifiedBy=req.user._id; b.cash.evidence=evidence;
      await postParcel(b,'cash-deposit','parcel_cash_custody','debit',b.cash.amountPaise,session);
      await postParcel(b,'cash-deposit-verified','parcel_collections','credit',b.cash.amountPaise,session);
      b.paymentStatus='cash_reconciled'; parcelEvent(b,actor,action,b.status,reason);
      // Cash for a booking the customer cancelled is refunded to their wallet once it is deposited.
      await autoRefundParcelToWallet(b,{type:'system'},session);
    } else if(action==='allocate_cancelled_capture') {
      if(b.status!=='cancelled' || b.paymentMethod!=='online' || b.finance.earningPosted || !b.finance.dispute || b.finance.gatewayDisputes?.length) failParcel('Reviewed cancelled online capture without gateway disputes required',409);
      const p=await Payment.findById(b.paymentId).session(session);
      if(p.captures.length!==1 || p.captures[0].disposition!=='reconciliation_required' || p.captures[0].amountPaise!==b.pricing.totalPaise || p.refundObligations.length) failParcel('Multiple or previously allocated captures require separate reconciliation',409);
      p.captures[0].disposition='settled';await p.save({session});
      delete b.finance.dispute;b.paymentStatus='paid';parcelEvent(b,actor,action,b.status,reason);
    } else if(action==='bank_reconciled') {
      if(b.paymentMethod!=='online' || b.paymentStatus!=='paid' || b.finance.bankEvidence || req.body.amountPaise!==b.pricing.totalPaise) failParcel('Unreconciled captured payment required',409);
      b.finance.bankEvidence={reference:boundedText(req.body.evidence,'Bank settlement evidence'),by:String(req.user._id),at:new Date(),amountPaise:req.body.amountPaise}; parcelEvent(b,actor,action,b.status,reason);
    } else if(action==='approve_refund') await approveParcelRefund(b,req.body,actor,session);
    else if(action==='refund_to_wallet') await refundParcelToWallet(b,{amountPaise:req.body.amountPaise,actor,reason},session);
    else if(action==='cash_refund_evidence') {
      if(b.paymentMethod!=='pay_driver' || b.status!=='cancelled' || b.finance.earningPosted || !b.cash.collectedAt || b.finance.cashRefund || b.finance.walletRefund || req.body.amountPaise!==b.cash.amountPaise) failParcel('Reviewed unallocated cash refund evidence required',409);
      b.finance.cashRefund={reference:boundedText(req.body.evidence,'Customer cash refund evidence'),by:String(req.user._id),at:new Date(),amountPaise:b.cash.amountPaise};
      await postParcel(b,'cash-refund-evidence',b.cash.status==='reconciled'?'parcel_collections':'parcel_cash_custody','debit',b.cash.amountPaise,session);
      b.finance.refundedPaise=b.cash.amountPaise; b.finance.refundStatus='confirmed'; b.cash.status='refunded_with_evidence'; parcelEvent(b,actor,action,b.status,reason);
    } else failParcel('Unsupported admin action');
    touchParcel(b); await b.save({session}); return b;
  });
  await notifyParcel(b); return ok(res,dtoFor(req,b));
}
export async function refund(req,res) {
  const b=await Parcel.findById(req.params.id); if(!b) failParcel('Booking not found',404);
  return ok(res,parcelDTO(await executeParcelRefund(b,req.body.key,req.user._id,req.body.reconcile===true,req.body.providerRefundId),'admin'));
}
export async function recover(req,res) {
  const b=await Parcel.findById(req.params.id); if(!b?.paymentId) failParcel('Payment not found',404);
  return ok(res,await reconcileCreationAttempt({paymentId:String(b.paymentId),key:req.body.key,actor:req.user._id,gatewayOrderId:req.body.gatewayOrderId}));
}
