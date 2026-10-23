import crypto from 'node:crypto';
import Payment from '../models/Payment.js';
import Promotion from '../models/SellerPromotion.js';
import Package from '../models/PromotionPackage.js';
import Ledger from '../models/SellerLedgerEntry.js';
import Receipt from '../models/AdWebhookReceipt.js';
import { financialTransaction } from './financeSafety.service.js';
import { postLedgerEntry } from './sellerLedger.service.js';
import { advertisingCampaign, advertisingVersion, campaignDTO, advertisingPagination } from './advertising.service.js';
import { validateAdvertisingSelection, advertisingChannel } from './advertisingEligibility.service.js';
import { adCharge, advertisingProduction, requireAdvertisingGateway, requireAdvertisingRefundGateway } from './advertisingBillingPolicy.service.js';
import { paidAdvertisingEnabled } from './advertisingPaidEligibility.service.js';
import { createRazorpayOrder, getRazorpayPaymentStatus, verifyRazorpayPaymentSignature, getRazorpayClient, validateRazorpayConfig, createRazorpayRefund } from './razorpay.service.js';
import { httpError } from '../utils/response.js';

const fail = (message,status=409) => { throw httpError(status,message); };
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const reason = input => { if (typeof input.reason!=='string' || !input.reason.trim() || input.reason.length>2000) fail('A bounded financial decision reason is required',400); return input.reason.trim(); };
const audit = (c,action,actor,comment,actorType=actor?'admin':'system') => {
  if(c.advertising.history.length>=500)fail('Campaign audit history is full');
  c.advertising.history.push({action,actorId:actor,actorType,reason:comment,at:new Date(),revision:c.advertising.revision,review:c.advertising.review,delivery:c.advertising.delivery});
};
async function saveCampaign(c,session) { c.__v+=1; await c.save({session}); }
function paymentGateway(p) {
  try {validateRazorpayConfig();}catch{fail('Razorpay credentials are unavailable',503);}
  if(p.advertising.gatewayMode!==process.env.RAZORPAY_MODE)fail('Payment belongs to a different Razorpay mode',503);
  if(process.env.RAZORPAY_MODE!==(advertisingProduction()?'live':'test'))fail('Gateway mode does not match this deployment environment',503);
}
const view = p => p ? {id:p._id,reference:p.advertising.reference,status:p.status,creation:p.advertising.creation,
  checkoutExpired:p.advertising.checkoutExpiresAt<=new Date(),checkoutExpiresAt:p.advertising.checkoutExpiresAt,
  amountPaise:p.advertising.expectedPaise,basePaise:p.advertising.basePaise,taxPaise:p.advertising.taxPaise,currency:'INR',
  receiptPaise:p.advertising.receiptPaise,refundedPaise:p.advertising.refundedPaise,recognizedPaise:p.advertising.recognizedPaise,
  reconciliation:p.advertising.reconciliation,invoiceReference:p.advertising.invoiceReference,
  gatewayFeePaise:p.advertising.gatewayFeePaise,gatewayFeeTaxPaise:p.advertising.gatewayFeeTaxPaise,
  refunds:p.advertising.refunds.map(r=>({key:r.key,amountPaise:r.amountPaise,status:r.status,reason:r.reason,creditNoteReference:r.creditNoteReference,createdAt:r.createdAt})),
} : null;
async function paymentForCampaign(id,sellerId,session=null) {
  const c=await advertisingCampaign(id,sellerId,session);
  const p=await Payment.findOne({_id:c._id,'advertising.campaignId':c._id}).session(session);
  return {c,p};
}
async function post(p,key,account,direction,paise,type,session,actor) {
  if(!paise)return;
  await postLedgerEntry({idempotencyKey:`ADS:${p._id}:${key}:${account}`,advertisingCampaignId:p.advertising.campaignId,
    advertiserSellerId:p.advertising.sellerId,advertisingRevision:p.advertising.revision,paymentId:p._id,
    account,direction,bucket:'held',amount:paise/100,currency:'INR',type,description:'Advertising transaction',postedBy:actor,
  },{session});
}
async function holdForReconciliation(id,code) {
  await financialTransaction(async session=>{
    const {c,p}=await paymentForCampaign(id,undefined,session);
    if(p.advertising.reconciliation===code)return;
    p.advertising.reconciliation=code;c.advertising.funding='RECONCILIATION_REQUIRED';
    if(['ACTIVE','SCHEDULED','NOT_SCHEDULED'].includes(c.advertising.delivery))c.advertising.delivery='UNAVAILABLE';
    audit(c,'reconciliation-hold',undefined,code);await saveCampaign(c,session);await p.save({session});
  });
}
async function accountingDiscrepancies(p){
  const entries=await Ledger.find({paymentId:p._id,advertisingCampaignId:p.advertising.campaignId}).lean(),balances={};
  for(const e of entries)balances[e.account]=(balances[e.account]||0)+(e.direction==='credit'?1:-1)*Math.round(e.amount*100);
  const a=p.advertising,primaryRefund=a.refunds.filter(r=>r.paymentId===a.primaryCaptureId&&r.status==='PROCESSED').reduce((sum,r)=>sum+r.amountPaise,0);
  const expectedCash=a.receiptPaise-a.refundedPaise,expectedTax=a.primaryCaptureId?a.taxPaise-Math.round(primaryRefund*a.taxPaise/a.expectedPaise):0;
  const expected={advertising_cash:expectedCash,advertising_tax:expectedTax,advertising_revenue:a.recognizedPaise,advertising_liability:expectedCash-expectedTax-a.recognizedPaise};
  return Object.entries(expected).filter(([account,amount])=>(balances[account]||0)!==amount).map(([account])=>`${account==='advertising_cash'?'CASH':account.replace('advertising_','').toUpperCase()}_LEDGER_MISMATCH`);
}
async function eligibleToPay(c,session) {
  const a=c.advertising;
  if(!paidAdvertisingEnabled())fail('Paid category delivery must be explicitly enabled before funding');
  if(a.review!=='APPROVED'||a.approvedRevision!==a.revision||!a.paid?.authorizedBy||a.paid.revision!==a.revision||a.pilot?.enabled||!['NOT_SCHEDULED'].includes(a.delivery))fail('Approved, financially authorized revision without pilot/paid delivery is required');
  if(!await Package.exists({_id:c.packageId,advertisingVersion:2,isActive:true,'advertising.archivedAt':null}).session(session))fail('Advertising package is unavailable');
  const selection=await validateAdvertisingSelection(c,session);
  if(selection.products.some(p=>p.type!==advertisingChannel(c.module)))fail('Paid category delivery requires products in the primary purchase channel');
  const charge=adCharge(a.terms);
  if(Object.values(charge.policy.refunds).some(value=>value>0)){
    try{requireAdvertisingRefundGateway();}catch{fail('Configured refund obligations require an enabled refund gateway before funding');}
  }
  return charge;
}
export async function authorizeAdvertisingBilling(id,actor,input) {
  return financialTransaction(async session=>{
    const c=await advertisingCampaign(id,undefined,session),a=c.advertising;
    if(c.__v!==advertisingVersion(input.version))fail('Campaign changed; refresh');
    reason(input);
    if(a.review!=='APPROVED'||a.approvedRevision!==a.revision||a.funding!=='UNPAID'||a.delivery!=='NOT_SCHEDULED'||a.pilot?.enabled)fail('Only an approved unpaid non-pilot campaign can be financially authorized');
    const {policy}=adCharge(a.terms);
    if(policy.invoiceMode==='EXTERNAL_REFERENCE' && (typeof input.invoiceReference!=='string'||!input.invoiceReference.trim()||input.invoiceReference.length>200))fail('Approved external invoice reference required',400);
    await validateAdvertisingSelection(c,session);
    a.paid={revision:a.revision,authorizedBy:actor,authorizedAt:new Date(),invoiceReference:input.invoiceReference || undefined};
    audit(c,'billing-authorize',actor,reason(input));await saveCampaign(c,session);return campaignDTO(c);
  });
}
export async function initiateAdvertisingPayment(id,sellerId,userId,input) {
  requireAdvertisingGateway();
  if(!await Payment.collection.indexExists(['advertising_gateway_order_unique','advertising_capture_unique']))fail('Advertising unique gateway indexes must be provisioned and verified before checkout',503);
  if(Object.keys(input).some(k=>!['version','idempotencyKey'].includes(k)))fail('Unsupported advertising payment fields',400);
  const ttl=Number(process.env.ADVERTISING_CHECKOUT_TTL_SECONDS);
  if(!Number.isSafeInteger(ttl)||ttl<60||ttl>86400)fail('Configure ADVERTISING_CHECKOUT_TTL_SECONDS between 60 and 86400',503);
  if(typeof input.idempotencyKey!=='string'||!/^[a-zA-Z0-9-]{16,100}$/.test(input.idempotencyKey))fail('A stable payment idempotency key is required',400);
  const prepared=await financialTransaction(async session=>{
    const {c,p:existing}=await paymentForCampaign(id,sellerId,session);
    if(existing) {
      if(existing.advertising.checkoutExpiresAt<=new Date())fail('Advertising checkout expired; cancel or reconcile this campaign');
      if(existing.advertising.creation!=='ISSUED')fail('Gateway order creation is uncertain; administrator reconciliation is required');
      if(!['pending','failed'].includes(existing.status))fail('This campaign is already paid or refunded');
      await eligibleToPay(c,session);return {p:existing,fresh:false};
    }
    if(c.__v!==advertisingVersion(input.version))fail('Campaign changed; refresh');
    const charge=await eligibleToPay(c,session);
    if(c.advertising.funding!=='UNPAID')fail('Campaign funding already started');
    // The campaign ID is also the advertising Payment ID: the built-in _id
    // uniqueness enforces one financial record per campaign without a second collection.
    if(await Payment.exists({_id:c._id}).session(session))fail('Payment identity conflict; reconcile before proceeding');
    const [p]=await Payment.create([{_id:c._id,userId,amount:charge.totalPaise/100,method:'online',gateway:{provider:'razorpay'},
      advertising:{campaignId:c._id,sellerId,revision:c.advertising.revision,reference:`AD-${crypto.randomUUID()}`,
        expectedPaise:charge.totalPaise,basePaise:charge.basePaise,taxPaise:charge.taxPaise,currency:'INR',creation:'INITIALIZING',
        gatewayMode:process.env.RAZORPAY_MODE,checkoutExpiresAt:new Date(Date.now()+ttl*1000),idempotencyKey:input.idempotencyKey,invoiceReference:c.advertising.paid.invoiceReference,refunds:[]},
    }],{session});
    c.advertising.funding='PAYMENT_PENDING';c.advertising.paid.paymentId=p._id;
    audit(c,'payment-prepared',undefined,'Advertising checkout prepared');await saveCampaign(c,session);
    return {p,fresh:true};
  });
  let p=prepared.p;
  if(prepared.fresh) {
    try {
      const order=await createRazorpayOrder({merchantOrderId:p.advertising.reference,amountPaise:p.advertising.expectedPaise,
        notes:{purpose:'ADVERTISING_V2',advertisingPaymentId:String(p._id)}});
      if(order.amountPaise!==p.advertising.expectedPaise||order.currency!=='INR')fail('Gateway returned an amount/currency mismatch',502);
      p=await Payment.findOneAndUpdate({_id:p._id,'advertising.creation':'INITIALIZING'},{$set:{'advertising.creation':'ISSUED','gateway.orderId':order.orderId,
        'gateway.merchantOrderId':p.advertising.reference,'gateway.initiatedAt':new Date()}},{returnDocument:'after'});
      if(!p)p=await Payment.findOne({_id:prepared.p._id,'advertising.creation':'ISSUED','gateway.orderId':order.orderId});
      if(!p)fail('Order association requires reconciliation');
    }catch(error){await Payment.updateOne({_id:prepared.p._id,'advertising.creation':'INITIALIZING'},{$set:{'advertising.creation':'UNKNOWN','advertising.reconciliation':'ORDER_CREATION_UNKNOWN'}});throw httpError(503,'Advertising order creation was not confirmed; reconcile before retrying');}
  }
  return {payment:view(p),checkout:{orderId:String(p._id),keyId:process.env.RAZORPAY_KEY_ID,razorpayOrderId:p.gateway.orderId,
    amountPaise:p.advertising.expectedPaise,currency:'INR',name:'Bulkimart Advertising',description:'Sponsored category package',verificationPath:'/api/sellers/advertising/payment-verification'}};
}
export async function settleAdvertisingCapture(paymentId,live,receiptId) {
  try {return await financialTransaction(async session=>{
    if(receiptId&&await Receipt.exists({_id:receiptId}).session(session))return {duplicate:true};
    const p=await Payment.findOne({_id:paymentId,'advertising.campaignId':{$exists:true}}).session(session);
    if(!p)fail('Advertising payment not found',404);
    const a=p.advertising;
    if(live.orderId!==p.gateway.orderId||live.amountPaise!==a.expectedPaise||live.currency!=='INR'||!live.paymentId)fail('Advertising payment amount, currency or association mismatch',400);
    const c=await advertisingCampaign(String(a.campaignId),undefined,session);
    if(live.state==='COMPLETED'&&!p.captures.some(r=>r.gatewayPaymentId===live.paymentId)) {
      const extra=!!a.primaryCaptureId;
      p.captures.push({gatewayOrderId:live.orderId,gatewayPaymentId:live.paymentId,amountPaise:live.amountPaise,currency:'INR',disposition:extra?'refund_required':'settled',receivedAt:new Date()});
      a.receiptPaise+=live.amountPaise;
      await post(p,`CAPTURE:${live.paymentId}`,'advertising_cash','credit',live.amountPaise,'advertising_receipt',session);
      await post(p,`CAPTURE:${live.paymentId}`,'advertising_liability','credit',extra?live.amountPaise:a.basePaise,'advertising_receipt',session);
      if(!extra)await post(p,`CAPTURE:${live.paymentId}`,'advertising_tax','credit',a.taxPaise,'advertising_tax',session);
      if(extra){a.reconciliation='EXTRA_CAPTURE_REFUND_REQUIRED';c.advertising.funding='RECONCILIATION_REQUIRED';}
      else {
        a.primaryCaptureId=live.paymentId;p.status='paid';p.paidAt=new Date();
        let eligible=false;
        try{await eligibleToPay(c,session);eligible=c.advertising.revision===a.revision&&a.checkoutExpiresAt>new Date()&&!live.refundedPaise&&!['CANCELLED','ADMIN_SUSPENDED'].includes(c.advertising.delivery);}catch(error){if(![400,409].includes(error.status))throw error;}
        if(eligible){
          const startAt=new Date(Math.max(Date.now(),new Date(c.advertising.requestedStartAt).getTime()));
          if(!Number.isFinite(startAt.getTime()))fail('Invalid approved schedule');
          c.advertising.paid.startAt=startAt;c.advertising.paid.endAt=new Date(startAt.getTime()+c.advertising.terms.durationDays*86400000);
          c.advertising.funding='FUNDED';c.advertising.delivery=startAt>new Date()?'SCHEDULED':'ACTIVE';a.reconciliation='MATCHED';
        } else {a.reconciliation='CAPTURE_REQUIRES_REVIEW';c.advertising.funding='REFUND_PENDING';}
      }
      audit(c,'capture-verified',undefined,'Authoritative advertising capture; no automatic revenue recognition');await saveCampaign(c,session);
    } else if(live.state==='FAILED'&&!a.primaryCaptureId){p.status='failed';c.advertising.funding='PAYMENT_FAILED';await saveCampaign(c,session);}
    await p.save({session});
    if(receiptId)await Receipt.create([{_id:receiptId,paymentId:p._id,kind:live.state,processedAt:new Date()}],{session});
    return view(p);
  });}catch(error){if(error.code===11000&&receiptId&&await Receipt.exists({_id:receiptId}))return {duplicate:true};throw error;}
}
export async function verifyAdvertisingPayment(id,sellerId,input) {
  const {p}=await paymentForCampaign(id,sellerId);if(!p)fail('Advertising payment not found',404);paymentGateway(p);
  if(input.razorpay_order_id!==p.gateway.orderId||!verifyRazorpayPaymentSignature({orderId:p.gateway.orderId,paymentId:input.razorpay_payment_id,signature:input.razorpay_signature}))fail('Advertising payment signature failed',401);
  const live=await getRazorpayPaymentStatus({orderId:p.gateway.orderId,paymentId:input.razorpay_payment_id});
  const payment=await settleAdvertisingCapture(p._id,live);
  return {status:payment.status,payment};
}
export async function advertisingBillingStatus(id,sellerId) {
  // Check ownership before lifecycle mutation, including after feature shutdown.
  await advertisingCampaign(id,sellerId);await refreshAdvertisingLifecycle(id);
  const {c,p}=await paymentForCampaign(id,sellerId);let quote;
  try{quote=adCharge(c.advertising.terms);}catch(error){if(![400,409].includes(error.status))throw error;}
  const journal=!sellerId&&p?await Ledger.find({paymentId:p._id,advertisingCampaignId:c._id}).select('entryNo account type direction amount createdAt').sort({createdAt:1}).limit(501).lean():undefined;
  const gateway=!sellerId&&p?{orderId:p.gateway.orderId,captures:p.captures.map(r=>({id:r.gatewayPaymentId,amountPaise:r.amountPaise,disposition:r.disposition}))}:undefined;
  return {campaign:campaignDTO(c),payment:view(p),quote,paidAuthorization:!!c.advertising.paid?.authorizedBy,
    ...(gateway?{gateway}:{}),
    ...(journal?{journal:journal.slice(0,500).map(e=>({id:e._id,entryNo:e.entryNo,account:e.account,type:e.type,direction:e.direction,amountPaise:Math.round(e.amount*100),at:e.createdAt})),journalTruncated:journal.length>500}:{})};
}
export async function cancelAdvertisingCampaign(id,sellerId,actor,input) {
  return financialTransaction(async session=>{
    const {c,p}=await paymentForCampaign(id,sellerId,session);
    if(c.__v!==advertisingVersion(input.version))fail('Campaign changed; refresh');
    reason(input);if(['COMPLETED','CANCELLED','ADMIN_SUSPENDED'].includes(c.advertising.delivery))fail('Campaign cannot be cancelled');
    c.advertising.delivery='CANCELLED';if(c.advertising.pilot)c.advertising.pilot.enabled=false;
    if(p?.advertising.primaryCaptureId)c.advertising.funding='REFUND_PENDING';
    audit(c,'cancel',actor,reason(input),sellerId?'seller':'admin');await saveCampaign(c,session);return campaignDTO(c);
  });
}
export async function reconcileAdvertisingPayment(id,actor,input={}) {
  const {p}=await paymentForCampaign(id);if(!p)fail('Advertising payment not found',404);paymentGateway(p);
  if(!p.gateway.orderId){
    if(typeof input.gatewayOrderId!=='string'||!/^order_[A-Za-z0-9]+$/.test(input.gatewayOrderId))fail('Provide the gateway order reference for uncertain creation',400);
    const order=await getRazorpayClient().orders.fetch(input.gatewayOrderId);
    if(order.amount!==p.advertising.expectedPaise||order.currency!=='INR'||order.receipt!==p.advertising.reference||order.notes?.advertisingPaymentId!==String(p._id))fail('Recovered gateway order does not match this advertising payment');
    await Payment.updateOne({_id:p._id,'gateway.orderId':null},{$set:{'gateway.orderId':order.id,'advertising.creation':'ISSUED','advertising.reconciliation':'ORDER_RECOVERED'}});
    p.gateway.orderId=order.id;
  }
  const result=await getRazorpayClient().orders.fetchPayments(p.gateway.orderId);
  // Never settle a partial, truncated capture list as a completed reconciliation.
  if(!Array.isArray(result.items)||result.items.length>=100)fail('Gateway payment list needs manual pagination review');
  for(const payment of result.items) {
    if(['captured','refunded','failed'].includes(payment.status))await settleAdvertisingCapture(p._id,{orderId:payment.order_id,paymentId:payment.id,amountPaise:payment.amount,refundedPaise:payment.amount_refunded,currency:payment.currency,state:payment.status==='failed'?'FAILED':'COMPLETED'});
    if(['captured','refunded'].includes(payment.status)){
      const listed=await getRazorpayClient().payments.fetchMultipleRefund(payment.id,{count:100});
      if(!Array.isArray(listed.items)||listed.items.length>=100){await holdForReconciliation(id,'REFUND_LIST_INCOMPLETE');fail('Provider refund history needs pagination review');}
      for(const refund of listed.items)await reconcileAdvertisingRefund(id,actor,{providerRefundId:refund.id});
      const fresh=await Payment.findById(p._id);
      const refunded=fresh.advertising.refunds.filter(r=>r.paymentId===payment.id&&r.status==='PROCESSED').reduce((sum,r)=>sum+r.amountPaise,0);
      if(payment.amount_refunded!==undefined&&payment.amount_refunded!==refunded){await holdForReconciliation(id,'PROVIDER_REFUND_TOTAL_MISMATCH');fail('Provider refund total differs; service remains blocked');}
    }
  }
  const captures=result.items.filter(row=>['captured','refunded'].includes(row.status)),fees={};
  if(captures.length&&captures.every(row=>Number.isSafeInteger(row.fee)&&row.fee>=0&&Number.isSafeInteger(row.tax)&&row.tax>=0)){
    fees['advertising.gatewayFeePaise']=captures.reduce((sum,row)=>sum+row.fee,0);
    fees['advertising.gatewayFeeTaxPaise']=captures.reduce((sum,row)=>sum+row.tax,0);
  }
  await Payment.updateOne({_id:p._id},{$set:{'advertising.reconciledAt':new Date(),...fees}});
  const discrepancies=await accountingDiscrepancies(await Payment.findById(p._id));
  if(discrepancies.length){await holdForReconciliation(id,discrepancies[0]);fail('Advertising accounting discrepancy requires review');}
  if(actor)await financialTransaction(async session=>{
    const c=await advertisingCampaign(id,undefined,session);audit(c,'payment-reconciled',actor,'Authoritative gateway payment/refund and accounting checks completed');await saveCampaign(c,session);
  });
  await refreshAdvertisingLifecycle(String(p.advertising.campaignId));
  return advertisingBillingStatus(id);
}
export async function handleAdvertisingWebhook(body,event,eventId) {
  const receiptId=hash(`razorpay:${eventId || `${event.eventId||event.kind}:${event.gatewayOrderId||event.refundPaymentId||event.refundId||'unknown'}`}`);
  let p=await Payment.findOne({'advertising.campaignId':{$exists:true},...(event.gatewayOrderId?{'gateway.orderId':event.gatewayOrderId}:{'captures.gatewayPaymentId':event.refundPaymentId || '__missing__'})});
  if(!p){
    const id=body.payload?.payment?.entity?.notes?.advertisingPaymentId || body.payload?.order?.entity?.notes?.advertisingPaymentId;
    if(typeof id==='string'&&/^[a-f\d]{24}$/i.test(id))p=await Payment.findOne({_id:id,'advertising.campaignId':{$exists:true}});
    if(p&&!p.gateway.orderId)await reconcileAdvertisingPayment(String(p.advertising.campaignId),undefined,{gatewayOrderId:event.gatewayOrderId});
    if(p)p=await Payment.findById(p._id);
  }
  if(!p){
    const entity=body.payload?.payment?.entity||body.payload?.order?.entity;
    if(entity?.notes?.purpose==='ADVERTISING_V2'){
      await recordWebhookIncident(receiptId,null,event,'ORPHANED_GATEWAY_EVENT');
      fail('Advertising webhook has no associated payment; manual review required');
    }
    return false;
  }
  if(await Receipt.exists({_id:receiptId}))return true;
  paymentGateway(p);
  try {
  if(['refund_completed','refund_failed'].includes(event.kind)) {
    await reconcileAdvertisingRefund(String(p.advertising.campaignId),undefined,{providerRefundId:event.refundId});
    await Receipt.create({_id:receiptId,paymentId:p._id,kind:event.kind,processedAt:new Date()}).catch(error=>{if(error.code!==11000)throw error;});return true;
  }
  if(['payment_completed','payment_failed'].includes(event.kind)) {
    const live=await getRazorpayPaymentStatus({orderId:p.gateway.orderId,paymentId:event.paymentId});
    if(['COMPLETED','FAILED'].includes(live.state))await settleAdvertisingCapture(p._id,live,receiptId);
    return true;
  }
  return true;
  } catch(error){await recordWebhookIncident(receiptId,p._id,event,'VERIFICATION_OR_RECONCILIATION_FAILED');throw error;}
}
async function recordWebhookIncident(receiptId,paymentId,event,code){
  await Receipt.create({_id:hash(`incident:${receiptId}`),stage:'INCIDENT',paymentId:paymentId||undefined,
    kind:event.kind,code,gatewayOrderId:event.gatewayOrderId,processedAt:new Date()}).catch(error=>{if(error.code!==11000)throw error;});
}
export async function refreshAdvertisingLifecycle(id) {
  return financialTransaction(async session=>{
    const c=await advertisingCampaign(id,undefined,session),a=c.advertising;
    if(a.funding!=='FUNDED'||!a.paid?.endAt||!['SCHEDULED','ACTIVE'].includes(a.delivery))return;
    let next=a.paid.endAt<=new Date()?'COMPLETED':a.paid.startAt<=new Date()?'ACTIVE':'SCHEDULED';
    // Interruptions require a recorded review; elapsed time alone is not proof
    // of delivered service, and never creates an automatic extension or refund.
    try {
      if(!paidAdvertisingEnabled())fail('Paid category delivery is disabled');
      await validateAdvertisingSelection(c,session);
      if(!await Package.exists({_id:c.packageId,advertisingVersion:2,isActive:true,'advertising.archivedAt':null}).session(session))fail('Package is unavailable');
    } catch(error) {
      if(![400,409].includes(error.status))throw error;
      next='UNAVAILABLE';a.funding='REFUND_PENDING';
    }
    if(a.delivery!==next){a.delivery=next;audit(c,'service-clock',undefined,'Paid service schedule evaluated');await saveCampaign(c,session);}
  });
}
let sweepRunning=false;
export async function sweepAdvertisingLifecycle() {
  if(sweepRunning)return;sweepRunning=true;
  try {
  // Oldest checked first: long-running campaigns cannot starve later rows.
  const rows=await Promotion.find({advertisingVersion:2,'advertising.funding':'FUNDED','advertising.delivery':{$in:['SCHEDULED','ACTIVE']}}).sort({'advertising.paid.lastEligibilityCheckAt':1}).select('_id').limit(100).lean();
  for(const row of rows){await refreshAdvertisingLifecycle(String(row._id));await Promotion.updateOne({_id:row._id},{$set:{'advertising.paid.lastEligibilityCheckAt':new Date()}},{timestamps:false});}
  }finally{sweepRunning=false;}
}
export async function requestAdvertisingRefund(id,actor,input) {
  requireAdvertisingRefundGateway();reason(input);
  if(typeof input.key!=='string'||!/^[A-Za-z0-9-]{16,100}$/.test(input.key)||!Number.isSafeInteger(input.amountPaise)||input.amountPaise<1)fail('Valid refund key and integer amount required',400);
  const claim=await financialTransaction(async session=>{
    const {c,p}=await paymentForCampaign(id,undefined,session);if(!p?.advertising.primaryCaptureId)fail('Captured advertising funds are required');paymentGateway(p);
    const a=p.advertising,prior=a.refunds.find(r=>r.key===input.key);
    if(prior){if(prior.amountPaise!==input.amountPaise||prior.reason!==input.reason||prior.paymentId!==(input.captureId||a.primaryCaptureId)||(prior.creditNoteReference||'')!==(input.creditNoteReference||''))fail('Refund key reused with different terms');return {p,fresh:false};}
    if(a.refundBusy||a.refunds.some(r=>['DISPATCHING','UNKNOWN','PENDING'].includes(r.status)))fail('An unresolved refund must be reconciled first');
    if(a.refunds.length>=100)fail('Refund history limit reached');
    const charge=adCharge(c.advertising.terms),capture=p.captures.find(r=>r.gatewayPaymentId===(input.captureId||a.primaryCaptureId));if(!capture)fail('Unknown advertising capture');
    const refunded=a.refunds.filter(r=>r.paymentId===capture.gatewayPaymentId&&r.status==='PROCESSED').reduce((sum,r)=>sum+r.amountPaise,0);
    const kind=c.advertising.delivery==='CANCELLED'?'cancellationBps':c.advertising.delivery==='ADMIN_SUSPENDED'?'suspensionBps':c.advertising.delivery==='UNAVAILABLE'?'unavailableBps':'unusedBps';
    if(capture.disposition!=='refund_required'&& !['CANCELLED','ADMIN_SUSPENDED','UNAVAILABLE','COMPLETED'].includes(c.advertising.delivery))fail('Stop or complete service before refund review');
    const maximum=capture.disposition==='refund_required'?capture.amountPaise:Math.floor(capture.amountPaise*charge.policy.refunds[kind]/10000);
    if(refunded+input.amountPaise>maximum)fail('Refund exceeds the accepted policy limit');
    if(charge.policy.creditNoteMode==='EXTERNAL_REFERENCE'&&(typeof input.creditNoteReference!=='string'||!input.creditNoteReference.trim()||input.creditNoteReference.length>200))fail('Approved credit-note reference required',400);
    const r={key:input.key,receipt:`ADRF-${hash(`${p._id}:${input.key}`).slice(0,24)}`,amountPaise:input.amountPaise,paymentId:capture.gatewayPaymentId,
      reason:input.reason,actorId:actor,status:'DISPATCHING',creditNoteReference:input.creditNoteReference,createdAt:new Date()};
    a.refunds.push(r);a.refundBusy=true;c.advertising.funding='REFUND_PENDING';
    audit(c,'refund-requested',actor,reason(input));await saveCampaign(c,session);await p.save({session});return {p,fresh:true,refund:r};
  });
  if(!claim.fresh)return view(claim.p);
  try {
    const result=await createRazorpayRefund({paymentId:claim.refund.paymentId,amountPaise:claim.refund.amountPaise,receipt:claim.refund.receipt,notes:{purpose:'ADVERTISING_V2',advertisingPaymentId:String(claim.p._id)}});
    await Payment.updateOne({_id:claim.p._id,'advertising.refunds':{$elemMatch:{key:input.key,status:{$in:['DISPATCHING','UNKNOWN']}}}},{$set:{'advertising.refunds.$.providerRefundId':result.refundId,'advertising.refunds.$.status':'PENDING','advertising.refundBusy':false}});
    return reconcileAdvertisingRefund(id,actor,{providerRefundId:result.refundId});
  }catch(error){await Payment.updateOne({_id:claim.p._id,'advertising.refunds':{$elemMatch:{key:input.key,status:{$in:['DISPATCHING','PENDING','UNKNOWN']}}}},{$set:{'advertising.refunds.$.status':'UNKNOWN','advertising.refundBusy':false,'advertising.reconciliation':'REFUND_RESULT_UNKNOWN'}});throw httpError(503,'Refund result is uncertain; reconcile before retrying');}
}
export async function reconcileAdvertisingRefund(id,actor,input) {
  const {p}=await paymentForCampaign(id);if(!p)fail('Advertising payment not found',404);paymentGateway(p);
  let live;
  if(input.providerRefundId)live=await getRazorpayClient().refunds.fetch(input.providerRefundId);
  else {
    const pending=p.advertising.refunds.find(r=>['DISPATCHING','UNKNOWN','PENDING'].includes(r.status)&&(!input.key||r.key===input.key));if(!pending)fail('No pending refund');
    const result=await getRazorpayClient().payments.fetchMultipleRefund(pending.paymentId,{count:100});
    const matches=result.items?.filter(r=>r.receipt===pending.receipt)||[];if(matches.length!==1)fail('Refund not uniquely found; keep reconciliation open');live=matches[0];
  }
  const expected=p.advertising.refunds.find(r=>r.receipt===live?.receipt||r.providerRefundId===live?.id);
  if(!expected||expected.paymentId!==live.payment_id||expected.amountPaise!==live.amount||live.currency!=='INR'||expected.receipt!==live.receipt||(expected.providerRefundId&&expected.providerRefundId!==live.id)){
    await holdForReconciliation(id,'UNAUTHORIZED_OR_MISMATCHED_REFUND');
    fail('Gateway refund does not match an authorized advertising refund; service is held for review');
  }
  return financialTransaction(async session=>{
    const {c,p:fresh}=await paymentForCampaign(id,undefined,session),a=fresh.advertising;
    const r=a.refunds.find(r=>r.receipt===live.receipt||r.providerRefundId===live.id);
    if(!r||r.paymentId!==live.payment_id||r.amountPaise!==live.amount||live.currency!=='INR'||r.receipt!==live.receipt||(r.providerRefundId&&r.providerRefundId!==live.id))fail('Gateway refund does not match an authorized advertising refund');
    if(r.status==='PROCESSED')return view(fresh);
    r.providerRefundId=live.id;r.status=live.status==='processed'?'PROCESSED':live.status==='failed'?'FAILED':'PENDING';
    if(r.status==='PROCESSED'){
      const capture=fresh.captures.find(row=>row.gatewayPaymentId===r.paymentId),extra=capture.disposition==='refund_required';
      const previous=a.refunds.filter(row=>row!==r&&row.paymentId===r.paymentId&&row.status==='PROCESSED').reduce((sum,row)=>sum+row.amountPaise,0);
      const tax=extra?0:Math.round((previous+r.amountPaise)*a.taxPaise/a.expectedPaise)-Math.round(previous*a.taxPaise/a.expectedPaise);
      await post(fresh,`REFUND:${live.id}`,'advertising_cash','debit',r.amountPaise,'advertising_refund',session,actor);
      const netRefund=r.amountPaise-tax,reverseRevenue=extra?0:Math.min(a.recognizedPaise,netRefund);
      await post(fresh,`REFUND:${live.id}`,'advertising_liability','debit',netRefund-reverseRevenue,'advertising_refund',session,actor);
      await post(fresh,`REFUND:${live.id}`,'advertising_revenue','debit',reverseRevenue,'advertising_refund',session,actor);
      a.recognizedPaise-=reverseRevenue;
      await post(fresh,`REFUND:${live.id}`,'advertising_tax','debit',tax,'advertising_refund',session,actor);
      a.refundedPaise+=r.amountPaise;r.resolvedAt=new Date();
      fresh.status=a.refundedPaise===a.receiptPaise?'refunded':'partial_refund';c.advertising.funding=fresh.status==='refunded'?'REFUNDED':'PARTIALLY_REFUNDED';
      c.advertising.delivery='CANCELLED';a.reconciliation=a.refundedPaise===a.receiptPaise?'MATCHED':'PARTIAL_REFUND_REVIEW';
      audit(c,'refund-verified',actor,'Authoritative provider refund recorded');await saveCampaign(c,session);
    } else if(r.status==='FAILED'){a.reconciliation='REFUND_FAILED';r.resolvedAt=new Date();}
    a.refundBusy=false;await fresh.save({session});return view(fresh);
  });
}
export async function recognizeAdvertisingRevenue(id,actor,input) {
  reason(input);await refreshAdvertisingLifecycle(id);
  return financialTransaction(async session=>{
    const {c,p}=await paymentForCampaign(id,undefined,session);if(!p||c.advertising.delivery!=='COMPLETED'||c.advertising.funding!=='FUNDED'||p.advertising.reconciliation!=='MATCHED')fail('Completed reconciled service and finance review are required');
    adCharge(c.advertising.terms);const a=p.advertising;if(a.recognizedPaise)return view(p);
    if(typeof input.evidenceReference!=='string'||!input.evidenceReference.trim()||input.evidenceReference.length>200)fail('Service-delivery review evidence reference required',400);
    await post(p,'RECOGNIZE','advertising_liability','debit',a.basePaise,'advertising_recognition',session,actor);
    await post(p,'RECOGNIZE','advertising_revenue','credit',a.basePaise,'advertising_recognition',session,actor);
    a.recognizedPaise=a.basePaise;audit(c,'revenue-recognized',actor,`${input.evidenceReference}: ${input.reason}`);await saveCampaign(c,session);await p.save({session});return view(p);
  });
}
export async function advertisingFinanceReport(query) {
  const {page,limit,skip}=advertisingPagination(query);
  const filter={'advertising.campaignId':{$exists:true}};
  const authorizationFilter={advertisingVersion:2,'advertising.review':'APPROVED','advertising.funding':'UNPAID','advertising.paid.authorizedBy':{$exists:false}};
  const [rows,total,totals,authorizationQueue,webhooks,authorizationTotal,webhookTotal]=await Promise.all([Payment.find(filter).sort({_id:-1}).skip(skip).limit(limit),Payment.countDocuments(filter),
    Payment.aggregate([{$match:filter},{$group:{_id:null,receivedPaise:{$sum:'$advertising.receiptPaise'},refundedPaise:{$sum:'$advertising.refundedPaise'},recognizedPaise:{$sum:'$advertising.recognizedPaise'}}}]),
    Promotion.find(authorizationFilter).select('_id title').sort({_id:1}).skip(skip).limit(limit).lean(),
    Receipt.find({}).sort({processedAt:-1}).skip(skip).limit(limit).lean(),Promotion.countDocuments(authorizationFilter),Receipt.countDocuments({})]);
  const discrepancies=[];
  for(const p of rows){
    for(const code of await accountingDiscrepancies(p))discrepancies.push({paymentId:p._id,code});
    if(p.advertising.creation!=='ISSUED'||!['MATCHED',undefined].includes(p.advertising.reconciliation))discrepancies.push({paymentId:p._id,code:p.advertising.reconciliation||'CREATION_UNRESOLVED'});
    if(!await Promotion.exists({_id:p.advertising.campaignId,advertisingVersion:2}))discrepancies.push({paymentId:p._id,code:'ORPHANED_PAYMENT'});
  }
  return {rows:rows.map(view),authorizationQueue:authorizationQueue.map(c=>({id:c._id,name:c.title})),webhooks,total,authorizationTotal,webhookTotal,page,limit,totals:totals[0]||{receivedPaise:0,refundedPaise:0,recognizedPaise:0},discrepancies};
}
