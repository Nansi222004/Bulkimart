import Payment from '../models/Payment.js';
import Package from '../models/PromotionPackage.js';
import { advertisingBillingEnabled, advertisingProduction, adCharge } from './advertisingBillingPolicy.service.js';
export const paidAdvertisingEnabled = () => advertisingBillingEnabled()&&process.env.ADVERTISING_PAID_DELIVERY_ENABLED==='true'
  &&process.env.RAZORPAY_MODE===(advertisingProduction()?'live':'test');
export async function paidAdvertisingEligible(c) {
  const a=c.advertising,now=new Date();
  if(!paidAdvertisingEnabled()||c.advertisingVersion!==2||c.status!=='DISABLED'||a.review!=='APPROVED'||a.approvedRevision!==a.revision||a.funding!=='FUNDED'
    ||!['SCHEDULED','ACTIVE'].includes(a.delivery)||!a.paid?.authorizedBy||a.paid.revision!==a.revision||!a.paid.startAt||!a.paid.endAt||a.paid.startAt>now||a.paid.endAt<=now)return false;
  if(!await Package.exists({_id:c.packageId,advertisingVersion:2,module:c.module,placement:'CATEGORY_SPONSORED',isActive:true,'advertising.archivedAt':null}))return false;
  let charge;try{charge=adCharge(a.terms);}catch{return false;}
  const p=await Payment.findOne({_id:a.paid.paymentId,'advertising.campaignId':c._id,'advertising.revision':a.revision,status:'paid'}).lean();
  return !!p&&p.advertising.expectedPaise===charge.totalPaise&&p.advertising.primaryCaptureId&&p.advertising.reconciliation==='MATCHED'
    &&p.advertising.gatewayMode===process.env.RAZORPAY_MODE&&!p.advertising.refunds.some(r=>r.status!=='FAILED')
    &&p.captures.some(r=>r.gatewayPaymentId===p.advertising.primaryCaptureId&&r.amountPaise===charge.totalPaise&&r.currency==='INR'&&r.disposition==='settled');
}
