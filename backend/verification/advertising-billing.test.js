import { jest } from '@jest/globals';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
const orders=new Map(),payments=new Map(),refunds=new Map();let orderCalls=0,refundCalls=0,creationUnknown=false,refundUnknown=false;
const sendPushNotification = jest.fn(async () => ({ success: true }));
const emitToAdmins = jest.fn(), emitToSeller = jest.fn();
jest.unstable_mockModule('../services/fcm.service.js', () => ({ sendPushNotification, sendBulkNotification: jest.fn(async () => ({ success: true })) }));
jest.unstable_mockModule('../socket/rooms.js', () => ({ emitToAdmins, emitToSeller, emitToUser: jest.fn(), emitToRider: jest.fn() }));
const realGateway=await import('../services/razorpay.service.js');
jest.unstable_mockModule('../services/razorpay.service.js',()=>({...realGateway,
  createRazorpayOrder:async({merchantOrderId,amountPaise,notes})=>{orderCalls++;const id=`order_test${orderCalls}`;
    orders.set(id,{id,receipt:merchantOrderId,amount:amountPaise,currency:'INR',notes});if(creationUnknown)throw Error('Synthetic lost creation response');return {orderId:id,amountPaise,currency:'INR',keyId:'rzp_test_synthetic'};},
  getRazorpayPaymentStatus:async({orderId,paymentId})=>{const p=paymentId?payments.get(paymentId):[...payments.values()].find(p=>p.order_id===orderId);if(!p)return {state:'PENDING',orderId};return {state:p.status==='captured'?'COMPLETED':'FAILED',orderId:p.order_id,paymentId:p.id,amountPaise:p.amount,refundedPaise:p.amount_refunded,currency:p.currency};},
  createRazorpayRefund:async({paymentId,amountPaise,receipt})=>{refundCalls++;const id=`rfnd_test${refundCalls}`;refunds.set(id,{id,payment_id:paymentId,amount:amountPaise,currency:'INR',receipt,status:'processed'});if(refundUnknown)throw Error('Synthetic lost refund response');return {refundId:id,state:'COMPLETED'};},
  getRazorpayClient:()=>({orders:{fetch:async id=>orders.get(id),fetchPayments:async id=>({items:[...payments.values()].filter(p=>p.order_id===id)})},
    payments:{fetchMultipleRefund:async id=>({items:[...refunds.values()].filter(r=>r.payment_id===id)})},refunds:{fetch:async id=>refunds.get(id)}}),
}));
const [{advertisingRouter},{advertisingPublicRouter},{razorpayWebhook},{errorHandler},{JWT_SECRET},{default:User},{default:Seller},{default:Admin},{default:Category},{default:Product},{default:Promotion},{default:Package},{default:Payment},{default:Ledger},{default:Receipt},{default:Event},billing,telemetry]=await Promise.all([
  import('../routes/advertising.routes.js'),import('../routes/advertisingPublic.routes.js'),import('../controllers/payment.controller.js'),import('../middlewares/error.middleware.js'),import('../config/jwt.js'),
  import('../models/User.js'),import('../models/Seller.js'),import('../models/Admin.js'),import('../models/Category.js'),import('../models/Product.js'),import('../models/SellerPromotion.js'),import('../models/PromotionPackage.js'),import('../models/Payment.js'),import('../models/SellerLedgerEntry.js'),import('../models/AdWebhookReceipt.js'),import('../models/AdEvent.js'),import('../services/advertisingBilling.service.js'),import('../services/advertisingTelemetry.service.js')]);
const { default: Notification } = await import('../models/Notification.js');
const { default: notificationRouter } = await import('../routes/notification.routes.js');
let db,app,user,other,seller,admin,reviewer,category,product,pack,campaign;
const policy=()=>({approvalReference:'SYNTHETIC-TEST-POLICY-NOT-LEGAL-APPROVAL',issuer:'Synthetic fixture issuer',taxTreatment:'EXCLUSIVE',taxRateBps:500,taxRecognition:'ON_RECEIPT',invoiceMode:'NOT_REQUIRED',creditNoteMode:'NOT_REQUIRED',startCondition:'VERIFIED_PAYMENT_OR_REQUESTED_START',interruption:'STOP_AND_REVIEW',refunds:{cancellationBps:10000,suspensionBps:10000,unavailableBps:10000,unusedBps:10000},recognition:'MANUAL_AFTER_COMPLETION'});
const auth=(r,u=user,type='user')=>r.set('Authorization',`Bearer ${jwt.sign({id:String(u._id),type,role:'seller'},JWT_SECRET)}`);
const adminPost=(path,body,u=admin)=>auth(request(app).post(`/admin${path}`),u,'admin').send(body);
const init=(body={})=>auth(request(app).post(`/seller/campaigns/${campaign.id}/payment-attempts`)).send({version:campaign.version,idempotencyKey:'synthetic-idempotency-0001',...body});
async function checkout(){return (await init().expect(200)).body.data;}
function capture(orderId,id='pay_test1',extra={}){const p={id,order_id:orderId,status:'captured',amount:10500,currency:'INR',...extra};payments.set(id,p);return p;}
const signature=(orderId,paymentId)=>crypto.createHmac('sha256',process.env.RAZORPAY_KEY_SECRET).update(`${orderId}|${paymentId}`).digest('hex');
const verify=(orderId,paymentId='pay_test1',extra={})=>auth(request(app).post(`/seller/campaigns/${campaign.id}/payment-verification`)).send({razorpay_order_id:orderId,razorpay_payment_id:paymentId,razorpay_signature:signature(orderId,paymentId),...extra});
async function paid(){const order=await checkout();capture(order.checkout.razorpayOrderId);await verify(order.checkout.razorpayOrderId).expect(200);return order;}
const webhook=(p,event='payment.captured',id='evt_synthetic1')=>{const body={event,payload:{payment:{entity:p}}},raw=JSON.stringify(body);return request(app).post('/webhook').set('x-razorpay-event-id',id).set('x-razorpay-signature',crypto.createHmac('sha256',process.env.RAZORPAY_WEBHOOK_SECRET).update(raw).digest('hex')).set('Content-Type','application/json').send(raw);};
beforeAll(async()=>{db=await MongoMemoryReplSet.create({binary:{version:'7.0.14'},replSet:{count:1}});await mongoose.connect(db.getUri('advertising-billing-isolated'));for(const model of [User,Seller,Admin,Category,Product,Promotion,Package,Payment,Ledger,Receipt,Event,Notification])await model.init();});
beforeEach(async()=>{
  Object.assign(process.env,{PAYMENT_GATEWAY:'razorpay',RAZORPAY_MODE:'test',RAZORPAY_KEY_ID:'rzp_test_synthetic',RAZORPAY_KEY_SECRET:'synthetic-test-only-key',RAZORPAY_WEBHOOK_SECRET:'synthetic-webhook-only-key',ADVERTISING_EVENT_RETENTION_DAYS:'7',ADVERTISING_TOKEN_SECRET:'synthetic-test-signing-key-at-least-thirty-two-characters'});
  delete process.env.ADVERTISING_CATEGORY_PILOT_ENABLED;delete process.env.ADVERTISING_PRODUCTION_ENABLED;
  for(const c of Object.values(mongoose.connection.collections))await c.deleteMany({});orders.clear();payments.clear();refunds.clear();orderCalls=0;refundCalls=0;creationUnknown=false;refundUnknown=false;
  app=express();app.use(express.json({verify:(req,_res,buffer)=>{req.rawBody=buffer;}}));app.use('/api/notifications',notificationRouter);app.use('/seller',advertisingRouter());app.use('/admin',advertisingRouter(true));app.use('/public',advertisingPublicRouter);app.post('/webhook',razorpayWebhook);app.use(errorHandler);
  [user,other]=await User.create([{phone:'9876500931',roles:['seller']},{phone:'9876500932',roles:['seller']}]);seller=await Seller.create({userId:user._id,status:'approved',salesChannels:['ecommerce']});await Seller.create({userId:other._id,status:'approved',salesChannels:['ecommerce']});
  admin={_id:new mongoose.Types.ObjectId(),role:'superAdmin',isActive:true,email:'ad-finance@example.test'};reviewer={_id:new mongoose.Types.ObjectId(),role:'admin',isActive:true,email:'ad-review@example.test',permissions:['advertising_review']};await Admin.collection.insertMany([admin,reviewer].map(a=>({...a,password:'synthetic-fixture-not-used-for-login'})));
  category=await Category.create({name:'Fixture',slug:'billing-fixture',type:'ecommerce'});product=await Product.create({sellerId:seller._id,name:'Fixture product',type:'ecommerce',category:category._id,price:10,mrp:12,stock:8,unit:'piece',status:'approved',isActive:true});
  pack=(await adminPost('/packages',{name:'Synthetic fixed offer',module:'ECOMMERCE',durationDays:9,maxProducts:2,amountPaise:10000,categories:[],isActive:true,reason:'Synthetic policy test',policies:{billing:policy()}}).expect(201)).body.data;
  campaign=(await auth(request(app).post('/seller/campaigns')).send({name:'Synthetic paid category',module:'ECOMMERCE',categoryId:String(category._id),items:[{productId:String(product._id),variantId:String(product.variants[0]._id)}],packageId:pack.id,requestedStartAt:new Date(Date.now()+3600000).toISOString()}).expect(201)).body.data;
  campaign=(await auth(request(app).post(`/seller/campaigns/${campaign.id}/submit`)).send({version:campaign.version,packageVersion:1}).expect(200)).body.data;
  campaign=(await adminPost(`/campaigns/${campaign.id}/approve`,{version:campaign.version,reason:'Synthetic approval'},reviewer).expect(200)).body.data;
});
afterAll(async()=>{await mongoose.disconnect();await db?.stop();});

test('standard approval opens payment without a second finance action and does not collect money',async()=>{
  const row=await Promotion.findById(campaign.id);
  expect(row.advertising.paid).toMatchObject({revision:row.advertising.revision,authorizedBy:reviewer._id});
  expect(row.advertising.history.at(-1)).toMatchObject({action:'approve',actorId:reviewer._id,reason:'Synthetic approval'});
  const view=await auth(request(app).get(`/seller/campaigns/${campaign.id}/billing`)).expect(200);
  expect(view.body.data.paidAuthorization).toBe(true);expect(view.body.data.campaign.paid.authorized).toBe(true);
  expect(orderCalls).toBe(0);expect(await Payment.countDocuments()).toBe(0);
  expect((await checkout()).checkout.amountPaise).toBe(10500);
});
test('immutable server-calculated quote, one stable payment/order, and no merchandise posting',async()=>{
  const first=await checkout();expect(first.checkout.amountPaise).toBe(10500);expect(first.payment.basePaise).toBe(10000);expect(first.payment.taxPaise).toBe(500);
  const second=await checkout();expect(second.checkout.razorpayOrderId).toBe(first.checkout.razorpayOrderId);expect(orderCalls).toBe(1);expect(await Payment.countDocuments()).toBe(1);
  const p=await Payment.findById(campaign.id);expect(p.orderId).toBeUndefined();expect(p.sellerPromotionId).toBeUndefined();expect(await Ledger.countDocuments()).toBe(0);
});
test('seller ownership, approved revision, policy, amount injection and financial permission',async()=>{
  await auth(request(app).post(`/seller/campaigns/${campaign.id}/payment-attempts`),other).send({version:campaign.version,idempotencyKey:'synthetic-idempotency-0001'}).expect(404);
  await init({amountPaise:1}).expect(400);await init({version:0}).expect(409);
  await adminPost(`/campaigns/${campaign.id}/billing-authorize`,{version:campaign.version,reason:'Forbidden'},reviewer).expect(403);
  await Promotion.updateOne({_id:campaign.id},{$set:{'advertising.approvedRevision':999}});await init().expect(409);expect(orderCalls).toBe(0);
});
test('signature and authoritative amount/currency mismatch cannot fund service',async()=>{
  const order=await checkout(),id=order.checkout.razorpayOrderId;capture(id);
  await verify(id,'pay_test1',{razorpay_signature:'wrong'}).expect(401);
  capture(id,'pay_test1',{amount:1});await verify(id).expect(400);
  capture(id,'pay_test1',{currency:'USD'});await verify(id).expect(400);
  expect((await Promotion.findById(campaign.id)).advertising.funding).toBe('PAYMENT_PENDING');expect(await Ledger.countDocuments()).toBe(0);
});
test('browser verification and repeated signed webhooks converge on one receipt and immutable ledger',async()=>{
  const order=await checkout(),id=order.checkout.razorpayOrderId,p=capture(id);
  const outcomes=await Promise.all([verify(id),webhook(p),webhook(p)]);expect(outcomes.map(r=>r.status)).toEqual([200,200,200]);
  expect(await Receipt.countDocuments()).toBe(1);expect(await Ledger.countDocuments()).toBe(3);
  const record=await Payment.findById(campaign.id);expect(record.captures).toHaveLength(1);expect(record.advertising.recognizedPaise).toBe(0);
  expect(await Ledger.countDocuments({sellerId:{$exists:true}})).toBe(0);expect(await Ledger.countDocuments({account:'seller_payable'})).toBe(0);
  await verify(id).expect(200);expect(await Ledger.countDocuments()).toBe(3);
});
test('concurrent initiation creates at most one provider order',async()=>{
  const results=await Promise.all([init(),init()]);expect(results.every(r=>[200,409].includes(r.status))).toBe(true);expect(orderCalls).toBe(1);
});
test('uncertain order creation never blindly retries; admin binds only a verified matching order',async()=>{
  creationUnknown=true;await init().expect(503);await init().expect(409);expect(orderCalls).toBe(1);
  const r=await adminPost(`/campaigns/${campaign.id}/reconcile`,{gatewayOrderId:'order_test1'}).expect(200);expect(r.body.data.payment.creation).toBe('ISSUED');
  await init().expect(200);expect(orderCalls).toBe(1);
});
test('failed payment can retry the same order; delayed capture after cancellation cannot activate',async()=>{
  const order=await checkout(),id=order.checkout.razorpayOrderId;capture(id,'pay_test1',{status:'failed'});await verify(id).expect(200);await init().expect(200);expect(orderCalls).toBe(1);
  let row=await Promotion.findById(campaign.id);await auth(request(app).post(`/seller/campaigns/${campaign.id}/cancel`)).send({version:row.__v,reason:'Cancel pending checkout'}).expect(200);
  capture(id);await webhook(payments.get('pay_test1')).expect(200);row=await Promotion.findById(campaign.id);expect(row.advertising.delivery).toBe('CANCELLED');expect(row.advertising.funding).toBe('REFUND_PENDING');
});
test('expired checkout and duplicate captures are kept for reconciliation rather than renewed service',async()=>{
  const order=await checkout(),id=order.checkout.razorpayOrderId;await Payment.updateOne({_id:campaign.id},{$set:{'advertising.checkoutExpiresAt':new Date(0)}});await init().expect(409);
  capture(id);await verify(id).expect(200);capture(id,'pay_extra');await webhook(payments.get('pay_extra'),'payment.captured','evt_extra').expect(200);
  const p=await Payment.findById(campaign.id);expect(p.captures).toHaveLength(2);expect(p.advertising.receiptPaise).toBe(21000);expect(p.advertising.reconciliation).toBe('EXTRA_CAPTURE_REFUND_REQUIRED');expect(p.advertising.recognizedPaise).toBe(0);
});
test('paid serving requires verified funding, dates and active package; never consumes requested wait time',async()=>{
  const before=await request(app).get('/public/placements').query({type:'ecommerce',category:String(category._id)}).expect(200);expect(before.body.data).toEqual([]);
  await paid();let row=await Promotion.findById(campaign.id);expect(row.advertising.delivery).toBe('SCHEDULED');expect(row.advertising.paid.endAt-row.advertising.paid.startAt).toBe(9*86400000);
  await Promotion.updateOne({_id:campaign.id},{$set:{'advertising.paid.startAt':new Date(Date.now()-1000)}});
  const result=await request(app).get('/public/placements').query({type:'ecommerce',category:String(category._id)}).expect(200);
  expect(result.body.data[0].mode).toBe('PAID_CATEGORY');expect(result.body.data[0].serveToken).toBeTruthy();
  await Package.updateOne({_id:pack.id},{$set:{isActive:false}});expect((await request(app).get('/public/placements').query({type:'ecommerce',category:String(category._id)})).body.data).toEqual([]);
});
test('partial/full refunds verify gateway results, reverse liabilities and never credit seller payables',async()=>{
  await paid();const row=await Promotion.findById(campaign.id);await adminPost(`/campaigns/${campaign.id}/cancel`,{version:row.__v,reason:'Synthetic cancellation'}).expect(200);
  const body={key:'synthetic-refund-key-0001',amountPaise:5250,reason:'Approved partial refund'};
  await adminPost(`/campaigns/${campaign.id}/refund`,body).expect(200);await adminPost(`/campaigns/${campaign.id}/refund`,body).expect(200);expect(refundCalls).toBe(1);
  expect((await Payment.findById(campaign.id)).status).toBe('partial_refund');
  await adminPost(`/campaigns/${campaign.id}/refund`,{...body,key:'synthetic-refund-key-0002'}).expect(200);expect((await Payment.findById(campaign.id)).status).toBe('refunded');
  const report=await adminPost(`/campaigns/${campaign.id}/refund-reconcile`,{providerRefundId:'rfnd_test2'}).expect(200);expect(report.body.data.refundedPaise).toBe(10500);
  expect(await Ledger.countDocuments({sellerId:{$exists:true}})).toBe(0);
});
test('lost refund response stays uncertain until receipt reconciliation, without duplicate provider refund',async()=>{
  await paid();const row=await Promotion.findById(campaign.id);await adminPost(`/campaigns/${campaign.id}/cancel`,{version:row.__v,reason:'Stop'}).expect(200);refundUnknown=true;
  const body={key:'synthetic-refund-key-0001',amountPaise:10500,reason:'Approved refund'};
  await adminPost(`/campaigns/${campaign.id}/refund`,body).expect(503);await adminPost(`/campaigns/${campaign.id}/refund`,body).expect(200);expect(refundCalls).toBe(1);
  await adminPost(`/campaigns/${campaign.id}/refund-reconcile`,{key:body.key}).expect(200);expect((await Payment.findById(campaign.id)).status).toBe('refunded');
  payments.get('pay_test1').status='refunded';payments.get('pay_test1').amount_refunded=10500;
  await adminPost(`/campaigns/${campaign.id}/reconcile`,{}).expect(200);
});
test('revenue requires completed service and explicit finance evidence, never capture alone',async()=>{
  await paid();await adminPost(`/campaigns/${campaign.id}/recognize`,{reason:'Not yet',evidenceReference:'synthetic'}).expect(409);
  await Promotion.updateOne({_id:campaign.id},{$set:{'advertising.paid.startAt':new Date(Date.now()-10*86400000),'advertising.paid.endAt':new Date(Date.now()-1000)}});
  await adminPost(`/campaigns/${campaign.id}/recognize`,{reason:'Manual synthetic service review',evidenceReference:'synthetic-service-review'}).expect(200);
  expect((await Payment.findById(campaign.id)).advertising.recognizedPaise).toBe(10000);
});
test('signed telemetry deduplicates concurrent retries and stores no customer or payment identity',async()=>{
  await paid();await Promotion.updateOne({_id:campaign.id},{$set:{'advertising.paid.startAt':new Date(Date.now()-1000)}});
  const c=await Promotion.findById(campaign.id).lean(),token=telemetry.advertisingServeToken(c,c.advertising.items[0],'PAID_CATEGORY',c.advertising.paid.endAt);
  const before=await Ledger.countDocuments();const results=await Promise.all([1,2,3].map(()=>request(app).post('/public/events').send({token,type:'IMPRESSION'})));
  expect(results.every(r=>r.status===200)).toBe(true);expect(await Event.countDocuments()).toBe(1);
  await request(app).post('/public/events').send({token,type:'CLICK'}).expect(200);expect(await Event.countDocuments()).toBe(2);
  expect(JSON.stringify(await Event.find({}).lean())).not.toMatch(/userId|sellerId|paymentId|token|ip|email|phone|address/);expect(await Ledger.countDocuments()).toBe(before);
  await request(app).post('/public/events').send({token:token+'x',type:'CLICK'}).expect(401);
  await request(app).post('/public/events').send({token:token.split('.')[0]+'.'+'é'.repeat(43),type:'CLICK'}).expect(401);
  await request(app).post('/public/events').send({token,type:'ORDER'}).expect(400);
  await Product.updateOne({_id:product._id},{$set:{isActive:false}});await request(app).post('/public/events').send({token,type:'CLICK'}).expect(409);
});
test('finance reports flag cash mismatches; production/test configuration cannot silently cross',async()=>{
  await paid();const r=await auth(request(app).get('/admin/finance'),admin,'admin').expect(200);expect(r.body.data.totals.recognizedPaise).toBe(0);
  process.env.APP_ENV='production';try{await init().expect(503);}finally{delete process.env.APP_ENV;}
});

test('missing legal policy and invoice reference block financial authorization without guessed defaults',async()=>{
  const {adCharge,validateAdBillingPolicy}=await import('../services/advertisingBillingPolicy.service.js');
  expect(()=>adCharge({amountPaise:10000,currency:'INR'})).toThrow(/policy snapshot/);
  expect(()=>validateAdBillingPolicy({...policy(),taxRateBps:undefined})).toThrow();
  expect(()=>validateAdBillingPolicy({...policy(),refunds:{}})).toThrow();
  expect(adCharge({amountPaise:10500,currency:'INR',policies:{billing:{...policy(),taxTreatment:'INCLUSIVE'}}})).toMatchObject({basePaise:10000,taxPaise:500,totalPaise:10500});
  await Promotion.updateOne({_id:campaign.id},{$unset:{'advertising.paid':1},$set:{'advertising.terms.policies.billing.invoiceMode':'EXTERNAL_REFERENCE'}});
  const row=await Promotion.findById(campaign.id);
  await adminPost(`/campaigns/${campaign.id}/billing-authorize`,{version:row.__v,reason:'Needs invoice'}).expect(400);
  expect(orderCalls).toBe(0);
});

test('live eligibility loss immediately suppresses serving and records an interruption, without automatic refund',async()=>{
  await paid();await Promotion.updateOne({_id:campaign.id},{$set:{'advertising.paid.startAt':new Date(Date.now()-1000)}});
  await Seller.updateOne({_id:seller._id},{$set:{status:'suspended'}});
  expect((await request(app).get('/public/placements').query({type:'ecommerce',category:String(category._id)})).body.data).toEqual([]);
  await billing.refreshAdvertisingLifecycle(campaign.id);
  const row=await Promotion.findById(campaign.id);expect(row.advertising.delivery).toBe('UNAVAILABLE');expect(row.advertising.funding).toBe('REFUND_PENDING');expect(refundCalls).toBe(0);
});

test('package repricing cannot change accepted billing and paid revisions cannot be edited or repaid',async()=>{
  await Package.updateOne({_id:pack.id},{$set:{price:9999,durationDays:2,'advertising.amountPaise':999900}});
  const order=await paid();expect(order.checkout.amountPaise).toBe(10500);
  const row=await Promotion.findById(campaign.id);expect(row.advertising.terms.durationDays).toBe(9);
  await auth(request(app).patch(`/seller/campaigns/${campaign.id}`)).send({version:row.__v,name:'Cannot rewrite paid history'}).expect(409);
  await init().expect(409);expect(orderCalls).toBe(1);
});

test('out of order failed webhook cannot downgrade captured funds; invalid webhook signature is rejected',async()=>{
  const order=await paid(),id=order.checkout.razorpayOrderId;
  const p=capture(id,'pay_latefailure',{status:'failed'});await webhook(p,'payment.failed','evt_latefail').expect(200);
  expect((await Payment.findById(campaign.id)).status).toBe('paid');expect((await Promotion.findById(campaign.id)).advertising.funding).toBe('FUNDED');
  await request(app).post('/webhook').set('x-razorpay-signature','invalid').send({event:'payment.captured',payload:{payment:{entity:payments.get('pay_test1')}}}).expect(401);
});

test('external refunds are not silently imported as authorized refunds and prevent paid service',async()=>{
  await paid();refunds.set('rfnd_external',{id:'rfnd_external',payment_id:'pay_test1',amount:1,currency:'INR',receipt:'unapproved-external',status:'processed'});
  await adminPost(`/campaigns/${campaign.id}/reconcile`,{}).expect(409);
  const p=await Payment.findById(campaign.id),c=await Promotion.findById(campaign.id);
  expect(p.advertising.reconciliation).toBe('UNAUTHORIZED_OR_MISMATCHED_REFUND');expect(p.advertising.refundedPaise).toBe(0);expect(c.advertising.funding).toBe('RECONCILIATION_REQUIRED');
});

test('concurrent refund requests cannot dispatch twice',async()=>{
  await paid();const row=await Promotion.findById(campaign.id);await adminPost(`/campaigns/${campaign.id}/cancel`,{version:row.__v,reason:'Stop'}).expect(200);
  const body={key:'concurrent-refund-key-0001',amountPaise:10500,reason:'Reviewed refund'};
  const results=await Promise.all([adminPost(`/campaigns/${campaign.id}/refund`,body),adminPost(`/campaigns/${campaign.id}/refund`,body)]);
  expect(results.every(r=>[200,409].includes(r.status))).toBe(true);expect(refundCalls).toBe(1);
  expect((await Payment.findById(campaign.id)).advertising.refundedPaise).toBe(10500);
});

test('authoritative failed refunds remain unpaid obligations and are never posted as returned money',async()=>{
  await paid();const row=await Promotion.findById(campaign.id);await adminPost(`/campaigns/${campaign.id}/cancel`,{version:row.__v,reason:'Stop'}).expect(200);
  refundUnknown=true;await adminPost(`/campaigns/${campaign.id}/refund`,{key:'failed-refund-key-0001',amountPaise:10500,reason:'Review'}).expect(503);
  refunds.get('rfnd_test1').status='failed';await adminPost(`/campaigns/${campaign.id}/refund-reconcile`,{key:'failed-refund-key-0001'}).expect(200);
  const p=await Payment.findById(campaign.id);expect(p.advertising.refunds[0].status).toBe('FAILED');expect(p.advertising.refundedPaise).toBe(0);expect(p.advertising.reconciliation).toBe('REFUND_FAILED');expect(await Ledger.countDocuments({type:'advertising_refund'})).toBe(0);
});

test('generic merchandise recovery cannot process advertising records and ledger discrepancies stay visible',async()=>{
  await paid();const recovery=await import('../services/paymentRecovery.service.js');
  await expect(recovery.processRefundObligation({paymentId:campaign.id,key:'synthetic'})).rejects.toThrow(/advertising/);
  await expect(recovery.reconcileCreationAttempt({paymentId:campaign.id,key:'synthetic'})).rejects.toThrow(/advertising/);
  await Payment.updateOne({_id:campaign.id},{$inc:{'advertising.receiptPaise':1}});
  const report=await auth(request(app).get('/admin/finance'),admin,'admin').expect(200);expect(report.body.data.discrepancies.map(d=>d.code)).toContain('CASH_LEDGER_MISMATCH');
});

test('refund after completed revenue recognition reverses revenue rather than over-debiting liabilities',async()=>{
  await paid();await Promotion.updateOne({_id:campaign.id},{$set:{'advertising.paid.startAt':new Date(Date.now()-10*86400000),'advertising.paid.endAt':new Date(Date.now()-1000)}});
  await adminPost(`/campaigns/${campaign.id}/recognize`,{reason:'Reviewed service',evidenceReference:'synthetic-evidence'}).expect(200);
  await adminPost(`/campaigns/${campaign.id}/refund`,{key:'post-recognition-refund-0001',amountPaise:5250,reason:'Configured unused-service review'}).expect(200);
  expect((await Payment.findById(campaign.id)).advertising.recognizedPaise).toBe(5000);
  const liability=await Ledger.find({account:'advertising_liability'}).lean();
  expect(liability.reduce((sum,e)=>sum+(e.direction==='credit'?1:-1)*Math.round(e.amount*100),0)).toBe(0);
});

test('signed event bindings reject fabrication; legacy telemetry flags cannot disable valid events',async()=>{
  await paid();await Promotion.updateOne({_id:campaign.id},{$set:{'advertising.paid.startAt':new Date(Date.now()-1000)}});
  const c=await Promotion.findById(campaign.id).lean(),token=telemetry.advertisingServeToken(c,c.advertising.items[0],'PAID_CATEGORY',c.advertising.paid.endAt);
  const base=JSON.parse(Buffer.from(token.split('.')[0],'base64url').toString());
  const signed=extra=>{const payload=Buffer.from(JSON.stringify({...base,...extra})).toString('base64url');return `${payload}.${crypto.createHmac('sha256',process.env.ADVERTISING_TOKEN_SECRET).update(payload).digest('base64url')}`;};
  for(const [changes,status]of [[{exp:0},400],[{placement:'SEARCH'},400],[{p:String(new mongoose.Types.ObjectId())},409],[{r:999},409],[{m:'CPC'},400]])await request(app).post('/public/events').send({token:signed(changes),type:'CLICK'}).expect(status);
  expect(await Event.countDocuments()).toBe(0);
  process.env.ADVERTISING_TELEMETRY_ENABLED='false';await request(app).post('/public/events').send({token,type:'CLICK'}).expect(200);
  expect(await Event.countDocuments()).toBe(1);
});

test('pilot events remain non-billable and never authorize paid funding',async()=>{
  await Promotion.updateOne({_id:campaign.id},{$set:{'advertising.pilot':{enabled:true,revision:1,authorizedBy:admin._id,authorizedAt:new Date(),startAt:new Date(Date.now()-1000),endAt:new Date(Date.now()+60000)}}});
  const c=await Promotion.findById(campaign.id).lean(),token=telemetry.advertisingServeToken(c,c.advertising.items[0],'NON_BILLABLE_PILOT',c.advertising.pilot.endAt);
  await request(app).post('/public/events').send({token,type:'IMPRESSION'}).expect(200);await init().expect(409);
  expect((await Event.findOne()).mode).toBe('NON_BILLABLE_PILOT');expect(await Payment.countDocuments()).toBe(0);expect(await Ledger.countDocuments()).toBe(0);
});

test('legacy management flags cannot disable finance access; refunds still stop delivery',async()=>{
  await paid();process.env.ADVERTISING_MANAGEMENT_ENABLED='false';
  await auth(request(app).get('/admin/finance'),admin,'admin').expect(200);
  await adminPost(`/campaigns/${campaign.id}/reconcile`,{}).expect(200);
  const row=await Promotion.findById(campaign.id);
  await adminPost(`/campaigns/${campaign.id}/cancel`,{version:row.__v,reason:'Approved cancellation'}).expect(200);
  await adminPost(`/campaigns/${campaign.id}/refund`,{key:'cancelled-refund-key-0001',amountPaise:10500,reason:'Approved refund after cancellation'}).expect(200);
  await init().expect(409);expect((await request(app).get('/public/placements').query({type:'ecommerce',category:String(category._id)})).body.data).toEqual([]);
});

test('capture already refunded at the provider cannot activate service even before its refund webhook arrives',async()=>{
  const order=await checkout(),id=order.checkout.razorpayOrderId;capture(id,'pay_test1',{amount_refunded:100});
  await verify(id).expect(200);const c=await Promotion.findById(campaign.id);
  expect(c.advertising.funding).toBe('REFUND_PENDING');expect(c.advertising.paid.startAt).toBeUndefined();
});

test('signed orphan advertising webhooks are durably visible and never treated as merchandise payments',async()=>{
  const p={id:'pay_orphan',order_id:'order_orphan',amount:10500,currency:'INR',status:'captured',notes:{purpose:'ADVERTISING_V2',advertisingPaymentId:String(new mongoose.Types.ObjectId())}};
  await webhook(p,'payment.captured','evt_orphan').expect(409);await webhook(p,'payment.captured','evt_orphan').expect(409);
  expect(await Receipt.countDocuments({stage:'INCIDENT',code:'ORPHANED_GATEWAY_EVENT'})).toBe(1);expect(await Ledger.countDocuments()).toBe(0);
});

test('database uniqueness and purpose validation prohibit gateway reuse and cross-posting',async()=>{
  await paid();const p=await Payment.findById(campaign.id),id=new mongoose.Types.ObjectId();
  const record={_id:id,userId:user._id,amount:p.amount,method:'online',advertising:{...p.advertising.toObject(),campaignId:id},gateway:{provider:'razorpay',orderId:p.gateway.orderId}};
  await expect(Payment.create(record)).rejects.toMatchObject({code:11000});
  await expect(Payment.create({...record,gateway:{provider:'razorpay',orderId:'order_other'},captures:p.captures.map(c=>c.toObject())})).rejects.toMatchObject({code:11000});
  await expect(Payment.create({...record,orderId:new mongoose.Types.ObjectId()})).rejects.toThrow(/exclusive/);
  await expect(Ledger.create({idempotencyKey:'INVALID-AD-POST',sellerId:seller._id,advertisingCampaignId:campaign.id,advertiserSellerId:seller._id,advertisingRevision:1,paymentId:p._id,account:'advertising_cash',bucket:'held',type:'advertising_receipt',direction:'credit',currency:'INR',amount:1,description:'Invalid fixture'})).rejects.toThrow(/exclusive/);
});

test('missing duplicate-payment indexes are rebuilt before checkout instead of blocking it',async()=>{
  await Payment.collection.dropIndex('advertising_gateway_order_unique');
  try{await init().expect(200);expect(orderCalls).toBe(1);expect(await Payment.collection.indexExists('advertising_gateway_order_unique')).toBe(true);}
  finally{await Payment.createIndexes();}
});
test('checkout works without ADVERTISING_CHECKOUT_TTL_SECONDS and expires after 30 minutes',async()=>{
  delete process.env.ADVERTISING_CHECKOUT_TTL_SECONDS;
  const order=await checkout(),left=new Date(order.payment.checkoutExpiresAt).getTime()-Date.now();
  expect(left).toBeGreaterThan(29*60000);expect(left).toBeLessThanOrEqual(30*60000);
});

test('advertising accounting is excluded from merchandise finance endpoints and exposed only in its authorized workspace',async()=>{
  await paid();
  const {listFinanceLedger}=await import('../controllers/financeWorkflow.controller.js');
  const {listSellerLedgerAdmin}=await import('../controllers/adminSellerFinance.controller.js');
  const isolated=express();isolated.get('/finance',listFinanceLedger);isolated.get('/sellers',listSellerLedgerAdmin);isolated.use(errorHandler);
  const finance=await request(isolated).get('/finance').expect(200);expect(finance.body.data.rows).toHaveLength(0);expect(finance.body.data.balances).toHaveLength(0);
  const sellers=await request(isolated).get('/sellers').expect(200);expect(sellers.body.data).toHaveLength(0);
  await request(isolated).get('/finance?account=advertising_cash').expect(403);
  const own=await auth(request(app).get(`/seller/campaigns/${campaign.id}/billing`)).expect(200);expect(own.body.data.journal).toBeUndefined();
  const adminView=await auth(request(app).get(`/admin/campaigns/${campaign.id}/billing`),admin,'admin').expect(200);expect(adminView.body.data.journal).toHaveLength(3);
});

test('review, configuration, reconciliation and refund permissions stay separate from financial authorization',async()=>{
  const roles=['advertising_finance','advertising_reconcile','advertising_refund'].map((permission,i)=>({_id:new mongoose.Types.ObjectId(),role:'admin',isActive:true,email:`ad-permission-${i}@example.test`,permissions:[permission]}));await Admin.collection.insertMany(roles);
  await adminPost(`/campaigns/${campaign.id}/refund`,{key:'not-authorized-0001',amountPaise:1,reason:'Denied'},roles[0]).expect(403);
  await adminPost(`/campaigns/${campaign.id}/billing-authorize`,{version:campaign.version,reason:'Denied'},roles[2]).expect(403);
  await adminPost(`/campaigns/${campaign.id}/reconcile`,{},reviewer).expect(403);
  await auth(request(app).get('/admin/finance'),reviewer,'admin').expect(403);
  await auth(request(app).get(`/seller/campaigns/${campaign.id}/analytics`),other).expect(404);
});

test('signed webhook amount mismatch is held as an incident and the same delivery can recover after authoritative correction',async()=>{
  const order=await checkout(),id=order.checkout.razorpayOrderId;const wrong=capture(id,'pay_mismatch',{amount:1});
  await webhook(wrong,'payment.captured','evt_correctable').expect(400);
  expect(await Ledger.countDocuments()).toBe(0);expect(await Receipt.countDocuments({stage:'INCIDENT'})).toBe(1);
  capture(id,'pay_mismatch');await webhook(payments.get('pay_mismatch'),'payment.captured','evt_correctable').expect(200);
  await webhook(payments.get('pay_mismatch'),'payment.captured','evt_correctable').expect(200);
  expect(await Receipt.countDocuments({stage:'PROCESSED'})).toBe(1);expect(await Ledger.countDocuments()).toBe(3);
});

test('different concurrent checkout keys still share one campaign payment and one provider order',async()=>{
  const results=await Promise.all([init({idempotencyKey:'acceptance-checkout-key-one'}),init({idempotencyKey:'acceptance-checkout-key-two'})]);
  expect(results.every(r=>[200,409].includes(r.status))).toBe(true);expect(results.some(r=>r.status===200)).toBe(true);expect(orderCalls).toBe(1);expect(await Payment.countDocuments()).toBe(1);
});

test('paid schedule expiry suppresses category serving and completes without recognizing revenue',async()=>{
  await paid();await Promotion.updateOne({_id:campaign.id},{$set:{'advertising.paid.startAt':new Date(Date.now()-10*86400000),'advertising.paid.endAt':new Date(Date.now()-1000)}});
  const result=await request(app).get('/public/placements').query({type:'ecommerce',category:String(category._id)}).expect(200);expect(result.body.data).toEqual([]);
  await billing.sweepAdvertisingLifecycle();expect((await Promotion.findById(campaign.id)).advertising.delivery).toBe('COMPLETED');
  expect((await Payment.findById(campaign.id)).advertising.recognizedPaise).toBe(0);expect(await Ledger.countDocuments({account:'advertising_revenue'})).toBe(0);
});

test('configured external invoice and credit-note obligations cannot be bypassed at authorization or refund',async()=>{
  await Promotion.updateOne({_id:campaign.id},{$unset:{'advertising.paid':1},$set:{'advertising.terms.policies.billing.invoiceMode':'EXTERNAL_REFERENCE','advertising.terms.policies.billing.creditNoteMode':'EXTERNAL_REFERENCE'}});
  const row=await Promotion.findById(campaign.id);
  await adminPost(`/campaigns/${campaign.id}/billing-authorize`,{version:row.__v,reason:'Synthetic required invoice'}).expect(400);
  campaign=(await adminPost(`/campaigns/${campaign.id}/billing-authorize`,{version:row.__v,reason:'Synthetic required invoice',invoiceReference:'SYNTHETIC-EXTERNAL-INVOICE'}).expect(200)).body.data;
  expect(await Notification.countDocuments({'metadata.campaignId':campaign.id,event:'ADVERTISING_BILLING_AUTHORIZE',audience:'seller'})).toBe(1);
  await paid();const active=await Promotion.findById(campaign.id);await adminPost(`/campaigns/${campaign.id}/cancel`,{version:active.__v,reason:'Synthetic cancellation'}).expect(200);
  const refund={key:'external-credit-note-key-0001',amountPaise:10500,reason:'Synthetic reviewed refund'};
  await adminPost(`/campaigns/${campaign.id}/refund`,refund).expect(400);expect(refundCalls).toBe(0);
  await adminPost(`/campaigns/${campaign.id}/refund`,{...refund,creditNoteReference:'SYNTHETIC-EXTERNAL-CREDIT-NOTE'}).expect(200);
  const sellerView=await auth(request(app).get(`/seller/campaigns/${campaign.id}/billing`)).expect(200);
  expect(sellerView.body.data.payment.invoiceReference).toBe('SYNTHETIC-EXTERNAL-INVOICE');expect(sellerView.body.data.payment.refunds[0].creditNoteReference).toBe('SYNTHETIC-EXTERNAL-CREDIT-NOTE');
});

// Real persistence, authentication and campaign transitions; only outbound
// gateway, Socket.io and Firebase transports are isolated test doubles.
test('campaign submission and approval deliver persisted, live and push alerts to the correct portals', async () => {
  const register = (account, type, token) => auth(request(app).post('/api/notifications/tokens'), account, type).send({ token, platform: 'web' });
  await register(admin, 'admin', 'admin-browser-fixture').expect(200);
  await register(user, 'user', 'seller-browser-fixture').expect(200);
  const inactive = { _id: new mongoose.Types.ObjectId(), email: 'inactive@example.test', isActive: false, role: 'admin', pushTokens: [{ token: 'inactive-device', active: true, platform: 'web', sessionRoles: ['admin'] }] };
  await Admin.collection.insertOne(inactive);
  expect((await Admin.findById(admin._id)).pushTokens).toBeUndefined(); // never disclose devices through profile
  sendPushNotification.mockClear(); emitToAdmins.mockClear(); emitToSeller.mockClear();
  let c = (await auth(request(app).post('/seller/campaigns')).send({name:'Notification fixture',module:'ECOMMERCE',categoryId:String(category._id),items:[{productId:String(product._id),variantId:String(product.variants[0]._id)}],packageId:pack.id,requestedStartAt:new Date(Date.now()+3600000).toISOString()}).expect(201)).body.data;
  const version = c.version;
  c = (await auth(request(app).post('/seller/campaigns/'+c.id+'/submit')).send({version,packageVersion:pack.version}).expect(200)).body.data;
  await auth(request(app).post('/seller/campaigns/'+c.id+'/submit')).send({version,packageVersion:pack.version}).expect(409);
  const adminRows = await Notification.find({'metadata.campaignId':c.id,recipientModel:'Admin'});
  expect(adminRows).toHaveLength(2);expect(adminRows.every(n=>n.route==='/admin/advertising?campaign='+c.id && !n.isRead)).toBe(true);
  expect(adminRows.some(n=>String(n.userId)===String(inactive._id))).toBe(false);
  c = (await adminPost('/campaigns/'+c.id+'/approve',{version:c.version,reason:'Notification test'},reviewer).expect(200)).body.data;
  const sellerRow = await Notification.findOne({'metadata.campaignId':c.id,audience:'seller'});
  expect(String(sellerRow.userId)).toBe(String(user._id));expect(sellerRow.event).toBe('ADVERTISING_APPROVE');
  expect(sellerRow.route).toBe('/seller/advertising?campaign='+c.id);
  const inbox = (await auth(request(app).get('/api/notifications')).expect(200)).body.data;
  expect(inbox.some(n=>n._id===String(sellerRow._id))).toBe(true);
  for(let i=0;i<100 && sendPushNotification.mock.calls.length<2;i++) await new Promise(r=>setTimeout(r,10));
  expect(emitToAdmins).toHaveBeenCalledWith('notification_new',expect.objectContaining({event:'ADVERTISING_SUBMITTED'}));
  expect(emitToSeller).toHaveBeenCalledWith(String(seller._id),'notification_new',expect.objectContaining({event:'ADVERTISING_APPROVE'}));
  expect(sendPushNotification).toHaveBeenCalledWith('admin-browser-fixture',expect.objectContaining({web:true,data:expect.objectContaining({audience:'admin',recipientId:String(admin._id),route:'/admin/advertising?campaign='+c.id})}));
  expect(sendPushNotification).toHaveBeenCalledWith('seller-browser-fixture',expect.objectContaining({web:true,data:expect.objectContaining({audience:'seller',recipientId:String(user._id),route:'/seller/advertising?campaign='+c.id})}));
  expect(sendPushNotification).not.toHaveBeenCalledWith('inactive-device',expect.anything());
  await adminPost('/campaigns/'+c.id+'/request-payment',{version:c.version}).expect(200);
  await adminPost('/campaigns/'+c.id+'/request-payment',{version:c.version}).expect(200);
  expect(await Notification.countDocuments({'metadata.campaignId':c.id,event:'ADVERTISING_REQUEST_PAYMENT'})).toBe(1);
  expect(await Payment.countDocuments()).toBe(0);expect(await Ledger.countDocuments()).toBe(0);
  await adminPost('/campaigns/'+c.id+'/request-payment',{version:c.version-1}).expect(409);
  await auth(request(app).delete('/api/notifications/tokens/admin-browser-fixture'),admin,'admin').expect(200);
  expect((await Admin.findById(admin._id).select('+pushTokens')).pushTokens).toHaveLength(0);
});

test('admin device ownership transfers only within admin accounts and rejects inactive sessions', async () => {
  const register = account => auth(request(app).post('/api/notifications/tokens'),account,'admin').send({token:'shared-admin-browser',platform:'web'});
  await register(admin).expect(200);await register(reviewer).expect(200);
  expect((await Admin.findById(admin._id).select('+pushTokens')).pushTokens).toHaveLength(0);
  expect((await Admin.findById(reviewer._id).select('+pushTokens')).pushTokens).toHaveLength(1);
  await Admin.updateOne({_id:reviewer._id},{$set:{isActive:false}});
  await register(reviewer).expect(403);
});
