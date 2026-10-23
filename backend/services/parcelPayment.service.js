import crypto from 'node:crypto';
import Parcel from '../models/ParcelDelivery.js';
import Payment from '../models/Payment.js';
import { financialTransaction } from './financeSafety.service.js';
import { createRazorpayOrder, getRazorpayPaymentStatus, verifyRazorpayPaymentSignature } from './razorpay.service.js';
import { reconcileCreationAttempt, processRefundObligation, reconcileRefundEvent } from './paymentRecovery.service.js';
import { requireParcelGateway, failParcel, integer, boundedText } from './parcelPolicy.service.js';
import { ownedParcel, parcelKey, parcelEvent, postParcel, touchParcel } from './parcelWorkflow.service.js';
import { notifyParcel } from './parcelAssignment.service.js';
export async function initiateParcelPayment(id,customerId,input,key) {
  requireParcelGateway(); parcelKey(key);
  const prepared = await financialTransaction(async session => {
    const b = await ownedParcel(id,customerId,session);
    if (b.paymentMethod !== 'online' || !['payment_pending','payment_failed'].includes(b.status) || b.cancellation || b.finance.dispute || b.pricing.policyVersion !== input.policyVersion || input.acceptTerms !== true) failParcel('Booking is not payable under this quote',409);
    let p = b.paymentId && await Payment.findById(b.paymentId).session(session);
    if (!p) {
      [p] = await Payment.create([{ _id:b._id,userId:customerId,parcelDeliveryId:b._id,quotationVersion:b.pricing.policyVersion,amount:b.pricing.totalPaise/100,method:'online',gateway:{provider:'razorpay'} }],{session});
      b.paymentId = p._id;
    }
    const active = p.gatewayAttempts.find(t=>['initializing','creation_unknown','issued'].includes(t.status)) || p.gatewayAttempts.find(t=>t.attemptId===key);
    if (active) {
      if (active.status !== 'issued') failParcel('Payment initialization requires reconciliation before retry',409);
      return {p,b,attempt:active.toObject(),fresh:false};
    }
    if (p.gatewayAttempts.length >= 10 || p.captures.length) failParcel('Payment requires finance review',409);
    p.gatewayAttempts.push({attemptId:key,provider:'razorpay',merchantOrderId:`PD-${crypto.randomUUID()}`,amountPaise:b.pricing.totalPaise,currency:'INR',status:'initializing',createdAt:new Date()});
    parcelEvent(b,{id:customerId,type:'customer'},'payment_initiated','payment_pending');
    await p.save({session}); await b.save({session}); return {p,b,attempt:p.gatewayAttempts.at(-1).toObject(),fresh:true};
  });
  let orderId = prepared.attempt.gatewayOrderId;
  if (prepared.fresh) {
    try {
      const g = await createRazorpayOrder({merchantOrderId:prepared.attempt.merchantOrderId,amountPaise:prepared.attempt.amountPaise,notes:{parcelDeliveryId:String(id),quotationVersion:String(prepared.b.pricing.policyVersion)}});
      await reconcileCreationAttempt({paymentId:String(prepared.p._id),key,actor:customerId,gatewayOrderId:g.orderId}); orderId=g.orderId;
    } catch {
      await Payment.updateOne({_id:prepared.p._id,gatewayAttempts:{$elemMatch:{attemptId:key,status:'initializing'}}},{$set:{'gatewayAttempts.$.status':'creation_unknown'}});
      failParcel('Payment order outcome uncertain; admin reconciliation is required',503);
    }
  }
  return {orderId:String(id),razorpayOrderId:orderId,keyId:process.env.RAZORPAY_KEY_ID,amountPaise:prepared.b.pricing.totalPaise,currency:'INR',name:'Bulkimart',description:'Parcel delivery',verificationPath:'/api/parcel-delivery/payments/verify'};
}
export async function captureParcel(paymentId,live) {
  requireParcelGateway();
  const b = await financialTransaction(async session => {
    const p = await Payment.findById(paymentId).session(session), b = p?.parcelDeliveryId && await Parcel.findById(p.parcelDeliveryId).session(session);
    if (!b || b.paymentMethod !== 'online' || String(b.paymentId) !== String(p._id)) failParcel('Parcel payment reference mismatch',409);
    const a = p.gatewayAttempts.find(t=>t.gatewayOrderId===live.orderId);
    if (!a || a.amountPaise !== b.pricing.totalPaise || p.quotationVersion !== b.pricing.policyVersion || live.currency !== 'INR' || live.amountPaise !== a.amountPaise || !live.paymentId) failParcel('Payment association, amount or currency mismatch',409);
    if (live.state === 'COMPLETED') {
      if (p.captures.some(c=>c.gatewayPaymentId===live.paymentId)) return b;
      const extra = p.captures.length > 0, late = !['payment_pending','payment_failed'].includes(b.status) || !!b.cancellation;
      p.captures.push({gatewayOrderId:live.orderId,gatewayPaymentId:live.paymentId,amountPaise:live.amountPaise,currency:'INR',disposition:extra || late?'reconciliation_required':'settled',receivedAt:new Date()});
      a.status='captured'; p.status='paid'; p.paidAt ||= new Date();
      await postParcel(b,`capture-${live.paymentId}`,'parcel_collections','credit',live.amountPaise,session);
      if (extra || late) { b.finance.dispute = 'Late or additional capture requires reconciliation'; b.finance.held=true; parcelEvent(b,{type:'system'},'late_capture_held'); }
      else { b.paymentStatus='paid'; parcelEvent(b,{type:'system'},'payment_verified','searching_for_driver'); }
    } else if (live.state === 'FAILED' && !p.captures.length && b.status === 'payment_pending') {
      a.status='failed'; p.status='failed'; b.paymentStatus='failed'; parcelEvent(b,{type:'system'},'payment_failed','payment_failed');
    } else return b;
    touchParcel(b); await p.save({session}); await b.save({session}); return b;
  });
  await notifyParcel(b); return b;
}
export async function verifyParcelPayment(id,customerId,input,poll=false) {
  requireParcelGateway();
  const b = await ownedParcel(id,customerId), p = b.paymentId && await Payment.findById(b.paymentId);
  if (!p) failParcel('Payment not initiated',409);
  const orderId = poll?p.gatewayAttempts.at(-1)?.gatewayOrderId:input.razorpay_order_id;
  if (!orderId || !p.gatewayAttempts.some(a=>a.gatewayOrderId===orderId)) failParcel('Payment order mismatch',409);
  if (!poll && !verifyRazorpayPaymentSignature({orderId,paymentId:input.razorpay_payment_id,signature:input.razorpay_signature})) failParcel('Invalid payment signature',401);
  const live = await getRazorpayPaymentStatus({orderId,...(!poll?{paymentId:input.razorpay_payment_id}:{})});
  if (live.orderId !== orderId || (!poll && live.paymentId !== input.razorpay_payment_id)) failParcel('Gateway association mismatch',409);
  if (live.paymentId) await captureParcel(p._id,live);
  const fresh = await Parcel.findById(id); return {status:fresh.paymentStatus,bookingStatus:fresh.status};
}
export async function approveParcelRefund(b,input,actor,session) {
  requireParcelGateway('refunds');
  if (b.paymentMethod !== 'online' || b.status !== 'cancelled' || b.finance.earningPosted || b.finance.dispute || b.finance.gatewayDisputes?.length) failParcel('Refund requires a cancelled booking and a reviewed unallocated online capture',409);
  const p = await Payment.findById(b.paymentId).session(session), capture = p?.captures.find(c=>c.disposition==='settled');
  if (!capture) failParcel('Verified captured payment required',409);
  const amount = integer(input.amountPaise,'refund amount',1), allocated = p.refundObligations.reduce((n,r)=>n+r.amountPaise,0);
  if (allocated+amount > capture.amountPaise) failParcel('Cumulative refund exceeds captured amount',409);
  const reason = boundedText(input.reason,'Refund approval reason'), key = `PARCEL:${crypto.randomUUID()}`;
  p.refundObligations.push({key,gatewayOrderId:capture.gatewayOrderId,gatewayPaymentId:capture.gatewayPaymentId,amountPaise:amount,currency:'INR',reason,status:'pending',createdAt:new Date()});
  b.finance.refundStatus='approved'; b.finance.held=true;
  parcelEvent(b,actor,'refund_approved',b.status,reason); await p.save({session});
}
export async function syncParcelRefunds(paymentId) {
  return financialTransaction(async session => {
    const p = await Payment.findById(paymentId).session(session), b = await Parcel.findById(p.parcelDeliveryId).session(session);
    const sum = p.refundObligations.filter(r=>r.status==='processed').reduce((n,r)=>n+r.amountPaise,0);
    if (sum > b.pricing.totalPaise || b.finance.earningPosted) failParcel('Refund allocation requires manual review',409);
    if (sum > b.finance.refundedPaise) { await postParcel(b,`refund-${sum}`,'parcel_collections','debit',sum-b.finance.refundedPaise,session); b.finance.refundedPaise=sum; parcelEvent(b,{type:'system'},'refund_verified'); }
    b.finance.refundStatus = p.refundObligations.some(r=>r.status!=='processed')?'pending_review':'confirmed';
    touchParcel(b); await b.save({session}); return b;
  });
}
export async function executeParcelRefund(b,key,actor,reconcile=false,providerRefundId) {
  requireParcelGateway('refunds');
  const p = await Payment.findOne({_id:b.paymentId,parcelDeliveryId:b._id,'refundObligations.key':key});
  if (!p) failParcel('Parcel refund not found',404);
  await processRefundObligation({paymentId:String(p._id),key,actor,reconcile,providerRefundId}); return syncParcelRefunds(p._id);
}
// Invoke only behind the shared raw-body signature verification.
export async function handleParcelWebhook(body,evt) {
  if (typeof body.event === 'string' && body.event.startsWith('payment.dispute.')) {
    const d = body.payload?.dispute?.entity, p = d?.payment_id && await Payment.findOne({parcelDeliveryId:{$exists:true},'captures.gatewayPaymentId':d.payment_id});
    if (p?.parcelDeliveryId) {
      requireParcelGateway();
      await financialTransaction(async session=>{
        const b=await Parcel.findById(p.parcelDeliveryId).session(session);
        const key=`${body.event}:${boundedText(d.id,'Dispute reference',100)}`;
        b.finance.gatewayDisputes ||= [];
        if(b.finance.gatewayDisputes.includes(key)) return;
        b.finance.gatewayDisputes.push(key);b.finance.dispute='Gateway dispute requires admin review';b.finance.held=true;
        touchParcel(b);parcelEvent(b,{type:'system'},'gateway_dispute');await b.save({session});
      });
      return true;
    }
  }
  const receipt = evt.refundReceipt || evt.refundNotes?.obligationReceipt;
  const rp = evt.refundId && await Payment.findOne({parcelDeliveryId:{$exists:true},$or:[{'refundObligations.providerRefundId':evt.refundId},...(receipt?[{'refundObligations.receipt':receipt}]:[])]});
  if (rp?.parcelDeliveryId) { requireParcelGateway('refunds'); await reconcileRefundEvent(evt); await syncParcelRefunds(rp._id); return true; }
  let p = evt.gatewayOrderId && await Payment.findOne({parcelDeliveryId:{$exists:true},'gatewayAttempts.gatewayOrderId':evt.gatewayOrderId});
  if (!p?.parcelDeliveryId) return false;
  requireParcelGateway();
  if (['payment_completed','payment_failed'].includes(evt.kind)) {
    const live = await getRazorpayPaymentStatus({orderId:evt.gatewayOrderId,paymentId:evt.paymentId});
    if (live.orderId !== evt.gatewayOrderId || live.paymentId !== evt.paymentId || live.amountPaise !== evt.amountPaise || live.currency !== evt.currency) failParcel('Webhook gateway evidence mismatch',409);
    await captureParcel(p._id,live);
  }
  return true;
}
