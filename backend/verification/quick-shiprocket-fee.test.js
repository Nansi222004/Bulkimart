import { jest } from '@jest/globals';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
process.env.PAYMENT_GATEWAY='razorpay';process.env.RAZORPAY_MODE='test';process.env.SHIPROCKET_MODE='mock';process.env.SHIPROCKET_QUICK_COMMERCE_ENABLED='true';
process.env.RAZORPAY_KEY_ID='rzp_test_seller_fee';process.env.RAZORPAY_KEY_SECRET='isolated-seller-secret';process.env.RAZORPAY_WEBHOOK_SECRET='isolated-webhook-secret';
const original=await import('../services/razorpay.service.js');
const create=jest.fn(), live=jest.fn();
jest.unstable_mockModule('../services/razorpay.service.js',()=>({...original,createRazorpayOrder:create,getRazorpayPaymentStatus:live}));
const shipping=await import('../services/shiprocket.service.js');const quote=jest.fn();
jest.unstable_mockModule('../services/shiprocket.service.js',()=>({...shipping,checkServiceability:quote,verifyPickupLocation:jest.fn(async()=>({name:"Fixture pickup"}))}));
const {calculateOptionB,validateServiceFeeConfiguration,saveQuickCommerceDraft,recordQuickCommerceObligation,getQuickCommerceConfig}=await import('../services/quickCommerceFinance.service.js');
const {settleQuickShiprocketCollection,requireVerifiedQuickCollection}=await import('../services/quickShiprocketCollection.service.js');
const {initiateQuickShiprocketFee,verifyQuickShiprocketFee,getQuickShiprocketFee}=await import('../controllers/quickShiprocketFee.controller.js');
const {createShiprocketShipment}=await import('../controllers/fulfillment.controller.js');
const {razorpayWebhook}=await import('../controllers/payment.controller.js');
const {updateQuickCommerceDeliveryConfigAdmin,listQuickShiprocketFeesAdmin}=await import('../controllers/adminSellerFinance.controller.js');
const {protect,requireAdmin,requireSellerSession}=await import('../middlewares/auth.middleware.js');
const {requireApprovedSeller}=await import('../middlewares/vendor.middleware.js');
const {errorHandler}=await import('../middlewares/error.middleware.js');
const {JWT_SECRET}=await import('../config/jwt.js');
const {default:Order}=await import('../models/Order.js'),{default:User}=await import('../models/User.js'),{default:Seller}=await import('../models/Seller.js');
const {default:Payment}=await import('../models/Payment.js'),{default:Config}=await import('../models/QuickCommerceDeliveryConfig.js'),{default:Snapshot}=await import('../models/QuickCommerceFinancialSnapshot.js'),{default:Ledger}=await import('../models/SellerLedgerEntry.js');
const app=express();app.use(express.json({verify:(req,res,raw)=>{req.rawBody=raw;}}));
app.patch('/config',protect,requireAdmin,updateQuickCommerceDeliveryConfigAdmin);app.get('/monitor',protect,requireAdmin,listQuickShiprocketFeesAdmin);
app.post('/fee/verify',protect,requireSellerSession,requireApprovedSeller,verifyQuickShiprocketFee);
app.post('/orders/:id/fee',protect,requireSellerSession,requireApprovedSeller,initiateQuickShiprocketFee);app.get('/orders/:id/fee',protect,requireSellerSession,requireApprovedSeller,getQuickShiprocketFee);
app.post('/orders/:id/shipment',protect,requireSellerSession,requireApprovedSeller,createShiprocketShipment);app.post('/webhook',razorpayWebhook);app.use(errorHandler);
const id=()=>new mongoose.Types.ObjectId();
const fee={type:'flat',value:10,version:'TEST-NOT-BUSINESS-APPROVED',calculationBasis:'eligible_courier_freight',taxTreatment:'exclusive',taxRate:18};
const configuration=()=>({fee:{...fee},currency:'INR',effectiveAt:'2020-01-01T00:00:00Z',paymentRequired:true,enabled:false});
const calc=(rule={},customer=20,freight=100)=>calculateOptionB({customerDeliveryCharge:customer,eligibleCourierFreight:freight,feeRule:{...fee,...rule}});
let db,user,seller,order;
const auth=(req,role='seller',who=user)=>req.set('Authorization','Bearer '+jwt.sign({id:who._id,type:'user',role},JWT_SECRET));
async function obligation(){
 const session=await mongoose.startSession();let result;
 try {await session.withTransaction(async()=>{result=await recordQuickCommerceObligation({order,sellerId:seller._id,quote:{freight_charge:100,courier_company_id:'42'},config:{...configuration(),enabled:true,revision:1},session});});} finally{await session.endSession();}
 const payment=await Payment.create({userId:user._id,quickFeeSnapshotId:result.snapshot._id,amount:result.snapshot.vendorDeliveryFeeObligation,method:'online',gateway:{provider:'razorpay',orderId:'order_fee',merchantOrderId:'fee_receipt'},gatewayAttempts:[{attemptId:'attempt_fee',provider:'razorpay',orderId:order._id,gatewayOrderId:'order_fee',amountPaise:9180,currency:'INR',status:'issued'}]});
 return {snapshot:result.snapshot,payment};
}
const signal=payment=>({payment,state:'COMPLETED',gatewayOrderId:'order_fee',gatewayPaymentId:'pay_fee',amountPaise:9180,currency:'INR'});
beforeAll(async()=>{db=await MongoMemoryReplSet.create({binary:{version:'7.0.14'},replSet:{count:1}});await mongoose.connect(db.getUri());await Promise.all([Config.init(),Snapshot.init(),Ledger.init(),Payment.init()]);});
afterAll(async()=>{await mongoose.disconnect();await db?.stop();});
beforeEach(async()=>{
 for(const collection of Object.values(mongoose.connection.collections)) await collection.deleteMany({});jest.clearAllMocks();delete process.env.QUICK_SHIPROCKET_SELLER_COLLECTION_ENABLED;
 user=await User.create({phone:'9876500901',name:'Test Seller',roles:['buyer','seller'],isActive:true});
 const sellerId=id();await Seller.collection.insertOne({_id:sellerId,userId:user._id,status:'approved',businessName:'Test Store',storeDetails:{name:'Test Store',pincode:'400001',lat:19,lng:72},thirdPartyFulfillment:{enabled:true,shiprocketPickupLocation:'fixture'}});seller=await Seller.findById(sellerId);
 const orderId=id();await Order.collection.insertOne({_id:orderId,orderNo:'QSF-TEST-1',createdAt:new Date(),userId:id(),type:'grocery',paymentMethod:'cod',status:'preparing',__v:0,vendorDecision:{status:'accepted'},fulfillment:{readyAt:new Date()},pricing:{deliveryCharge:20,totalAmount:1000},items:[{sellerId,qty:2,weightSnapshot:250}],shippingAddress:{pincode:'400002'}});order=await Order.findById(orderId);
});
test('fixed fee and exclusive tax preserve Option B',()=>{expect(calc()).toMatchObject({customerFreightContribution:20,vendorFreightShare:80,serviceFeeNet:10,applicableTax:1.8,vendorDeliveryFeeObligation:91.8});});
test('percentage base can explicitly use seller remaining freight',()=>{expect(calc({type:'percent',value:10,calculationBasis:'vendor_freight_share'})).toMatchObject({basisAmount:80,serviceFeeNet:8,applicableTax:1.44,vendorDeliveryFeeObligation:89.44});});
test('percentage minimum and maximum clamp fee before tax',()=>{expect(calc({type:'percent',value:1,minimum:10}).serviceFeeNet).toBe(10);expect(calc({type:'percent',value:50,maximum:15}).serviceFeeNet).toBe(15);});
test('inclusive tax is extracted without charging twice',()=>{expect(calc({value:11.8,taxTreatment:'inclusive'})).toMatchObject({serviceFeeNet:10,applicableTax:1.8,serviceFeeGross:11.8,vendorDeliveryFeeObligation:91.8});});
test('explicit exempt rule and customer contribution cap',()=>{expect(calc({taxTreatment:'exempt',taxRate:0},200,100)).toMatchObject({customerFreightContribution:100,vendorFreightShare:0,applicableTax:0,vendorDeliveryFeeObligation:10});});
test.each([null,undefined,'',-1,NaN])('missing or invalid freight %s fails closed',freight=>expect(()=>calculateOptionB({customerDeliveryCharge:20,eligibleCourierFreight:freight,feeRule:fee})).toThrow());
test.each([{fee:{...fee,calculationBasis:''}},{fee:{...fee,value:-1}},{fee:{...fee,taxTreatment:'pending_approval'}},{fee:{...fee,minimum:20,maximum:10}},{fee:{...fee,taxTreatment:'exempt',taxRate:18}},{currency:'USD'},{effectiveAt:''}])('invalid configuration cannot activate %j',overrides=>expect(()=>validateServiceFeeConfiguration({...configuration(),...overrides})).toThrow());
test('disabled flag blocks fee collection and shipment without provider calls',async()=>{await auth(request(app).post('/orders/'+order._id+'/fee')).send({confirm:true,reviewedTotal:91.8,feeVersion:fee.version}).expect(409);await auth(request(app).post('/orders/'+order._id+'/shipment')).send({confirm:true}).expect(409);expect(create).not.toHaveBeenCalled();expect(quote).not.toHaveBeenCalled();expect(await Payment.countDocuments()).toBe(0);});
test('admin authorization protects configuration and monitoring',async()=>{await request(app).patch('/config').send(configuration()).expect(401);await auth(request(app).patch('/config')).send(configuration()).expect(403);await auth(request(app).get('/monitor')).expect(403);});
test('configuration history persists actor and rejects stale edits and live enable',async()=>{await saveQuickCommerceDraft({...configuration(),adminId:user._id,revision:0});const row=await Config.findOne().lean();expect(row.enabled).toBe(false);expect(row.history[0].changedBy).toEqual(user._id);expect(row.revision).toBe(1);await expect(saveQuickCommerceDraft({...configuration(),adminId:user._id,revision:0})).rejects.toMatchObject({status:409});await expect(saveQuickCommerceDraft({...configuration(),enabled:true,adminId:user._id,revision:1})).rejects.toMatchObject({status:409});expect((await getQuickCommerceConfig()).activationReady).toBe(false);});
test('immutable snapshot and unique payment protect refresh and duplicate submission',async()=>{const {snapshot,payment}=await obligation();expect(snapshot.configRevision).toBe(1);await expect(Payment.create({userId:user._id,quickFeeSnapshotId:snapshot._id,amount:91.8,method:'online'})).rejects.toMatchObject({code:11000});await auth(request(app).get('/orders/'+order._id+'/fee')).expect(200).then(res=>expect(res.body.data.payment.status).toBe('pending'));await expect(requireVerifiedQuickCollection(order,seller._id)).rejects.toMatchObject({status:409});expect(await Ledger.countDocuments()).toBe(3);expect(payment.amount).toBe(91.8);});
test('verified capture is atomic and idempotent under concurrent callbacks',async()=>{const {payment}=await obligation();await Promise.all([settleQuickShiprocketCollection(signal(payment)),settleQuickShiprocketCollection(signal(payment))]);expect((await Payment.findById(payment._id)).status).toBe('paid');expect(await Ledger.countDocuments({type:'quick_fee_payment'})).toBe(1);expect((await requireVerifiedQuickCollection(order,seller._id)).payment.status).toBe('paid');const totals=await Ledger.find().lean();expect(Math.round(totals.reduce((sum,row)=>sum+(row.direction==='credit'?row.amount:-row.amount),0)*100)).toBe(0);});
test('failed and pending payments do not activate shipment; delayed capture may reconcile',async()=>{const {payment}=await obligation();await settleQuickShiprocketCollection({...signal(payment),state:'PENDING'});await expect(requireVerifiedQuickCollection(order,seller._id)).rejects.toThrow();await settleQuickShiprocketCollection({...signal(payment),state:'FAILED'});expect(await Ledger.countDocuments({type:'quick_fee_payment'})).toBe(0);await settleQuickShiprocketCollection(signal(payment));expect((await Payment.findById(payment._id)).status).toBe('paid');});
test('amount and currency mismatch cannot settle',async()=>{const {payment}=await obligation();await expect(settleQuickShiprocketCollection({...signal(payment),amountPaise:1})).rejects.toMatchObject({status:400});await expect(settleQuickShiprocketCollection({...signal(payment),currency:'USD'})).rejects.toThrow();});
test('different sellers cannot inspect fee obligations and mixed-seller orders are rejected',async()=>{const other=id();await Order.updateOne({_id:order._id},{$push:{items:{sellerId:other,qty:1,weightSnapshot:100}}});await auth(request(app).get('/orders/'+order._id+'/fee')).expect(409);});
test('multiple items belong to one obligation without changing customer pricing',async()=>{const before=order.pricing.totalAmount;const {snapshot}=await obligation();expect(snapshot.vendorFreightShare).toBe(80);expect(await Snapshot.countDocuments({orderId:order._id})).toBe(1);expect((await Order.findById(order._id)).pricing.totalAmount).toBe(before);});
test('invalid signature cannot mark seller fee paid',async()=>{const {payment}=await obligation();await auth(request(app).post('/fee/verify')).send({orderId:String(payment._id),razorpay_order_id:'order_fee',razorpay_payment_id:'pay_fee',razorpay_signature:'invalid'}).expect(401);expect(live).not.toHaveBeenCalled();expect((await Payment.findById(payment._id)).status).toBe('pending');});
test('signed webhook before browser verification settles once and replay is harmless',async()=>{const {payment}=await obligation();const body={event:'payment.captured',payload:{payment:{entity:{id:'pay_fee',order_id:'order_fee',amount:9180,currency:'INR',status:'captured'}}}};const raw=JSON.stringify(body);const webhook=()=>request(app).post('/webhook').set('Content-Type','application/json').set('x-razorpay-signature',crypto.createHmac('sha256',process.env.RAZORPAY_WEBHOOK_SECRET).update(raw).digest('hex')).send(raw);await webhook().expect(200);await webhook().expect(200);live.mockResolvedValue({state:'COMPLETED',orderId:'order_fee',paymentId:'pay_fee',amountPaise:9180,currency:'INR'});await auth(request(app).post('/fee/verify')).send({orderId:String(payment._id),razorpay_order_id:'order_fee',razorpay_payment_id:'pay_fee',razorpay_signature:crypto.createHmac('sha256',process.env.RAZORPAY_KEY_SECRET).update('order_fee|pay_fee').digest('hex')}).expect(200);expect(await Ledger.countDocuments({type:'quick_fee_payment'})).toBe(1);});
test('capture after cancellation becomes reconciliation debt, never fulfillment credit',async()=>{const {payment}=await obligation();await Order.updateOne({_id:order._id},{$set:{status:'cancelled'}});await settleQuickShiprocketCollection(signal(payment));const fresh=await Payment.findById(payment._id);expect(fresh.refundObligations).toHaveLength(1);expect(fresh.status).toBe('pending');expect(await Ledger.countDocuments({type:'quick_fee_payment'})).toBe(0);});

test('approved isolated configuration creates one provider order and reuses it on retry',async()=>{
 process.env.QUICK_SHIPROCKET_SELLER_COLLECTION_ENABLED='true';
 const policy=Object.fromEntries(['customerSurplusTreatment','returnAndHoldPolicy','cancellationCostPolicy','codReconciliationPolicy','insufficientFundsPolicy','sharedFreightAllocation','liveReleaseApproval'].map(key=>[key,'approved-fixture-only']));
 await Config.create({...configuration(),enabled:true,revision:1,policy});
 quote.mockResolvedValue({available:true,couriers:[{freight_charge:100,courier_company_id:'42'}]});
 create.mockResolvedValue({orderId:'order_fee_created',amountPaise:9180,currency:'INR'});
 const submit=()=>auth(request(app).post('/orders/'+order._id+'/fee')).send({confirm:true,reviewedTotal:91.8,feeVersion:fee.version});
 const first=await submit();expect({status:first.status,message:first.body.message}).toEqual({status:200,message:''});
 await submit().expect(200);expect(create).toHaveBeenCalledTimes(1);expect(await Snapshot.countDocuments()).toBe(1);expect(await Payment.countDocuments()).toBe(1);
});

async function enableIsolatedFixture(){
 process.env.QUICK_SHIPROCKET_SELLER_COLLECTION_ENABLED='true';
 const policy=Object.fromEntries(['customerSurplusTreatment','returnAndHoldPolicy','cancellationCostPolicy','codReconciliationPolicy','insufficientFundsPolicy','sharedFreightAllocation','liveReleaseApproval'].map(key=>[key,'approved-fixture-only']));
 await Config.create({...configuration(),enabled:true,revision:1,policy});quote.mockResolvedValue({available:true,couriers:[{freight_charge:100,courier_company_id:'42'}]});
}
test('uncertain provider creation is durable and cannot create a second charge',async()=>{
 await enableIsolatedFixture();create.mockRejectedValue(new Error('Isolated timeout fixture'));
 const submit=()=>auth(request(app).post('/orders/'+order._id+'/fee')).send({confirm:true,reviewedTotal:91.8,feeVersion:fee.version});
 await submit().expect(503);await submit().expect(409);expect(create).toHaveBeenCalledTimes(1);expect((await Payment.findOne()).gatewayAttempts[0].status).toBe('creation_unknown');expect(await Snapshot.countDocuments()).toBe(1);
});
test('client-supplied amount cannot change the authoritative fee',async()=>{await enableIsolatedFixture();await auth(request(app).post('/orders/'+order._id+'/fee')).send({confirm:true,reviewedTotal:1,feeVersion:fee.version}).expect(409);expect(await Snapshot.countDocuments()).toBe(0);expect(await Ledger.countDocuments()).toBe(0);expect(create).not.toHaveBeenCalled();});
test('an unpaid online customer order cannot incur a seller fee',async()=>{await Order.updateOne({_id:order._id},{$set:{paymentMethod:'online'}});await auth(request(app).post('/orders/'+order._id+'/fee')).send({confirm:true,reviewedTotal:91.8,feeVersion:fee.version}).expect(409);expect(quote).not.toHaveBeenCalled();expect(await Payment.countDocuments()).toBe(0);});
test('test-mode payment cannot activate shipping after environment switch',async()=>{const {payment}=await obligation();await settleQuickShiprocketCollection(signal(payment));process.env.SHIPROCKET_MODE='live';try{await expect(requireVerifiedQuickCollection(order,seller._id)).rejects.toThrow();}finally{process.env.SHIPROCKET_MODE='mock';}});
test('another seller cannot inspect or verify this seller collection',async()=>{const {payment}=await obligation();const other=await User.create({phone:'9876500902',name:'Other Seller',roles:['buyer','seller'],isActive:true});await Seller.collection.insertOne({_id:id(),userId:other._id,status:'approved'});await auth(request(app).get('/orders/'+order._id+'/fee'),'seller',other).expect(403);await auth(request(app).post('/fee/verify'),'seller',other).send({orderId:String(payment._id),razorpay_order_id:'order_fee'}).expect(404);});

test('Quick shipment cannot activate under an approved fixture until seller payment is verified',async()=>{await enableIsolatedFixture();await auth(request(app).post('/orders/'+order._id+'/shipment')).send({confirm:true}).expect(409);expect(quote).not.toHaveBeenCalled();});
test('verified seller collection permits the existing isolated mock shipment workflow',async()=>{
 await enableIsolatedFixture();
 await Order.updateOne({_id:order._id},{$set:{'pricing.subtotal':980,'shippingAddress.name':'Test buyer','shippingAddress.phone':'9876500910','shippingAddress.line1':'Test address','shippingAddress.city':'Mumbai','shippingAddress.state':'Maharashtra','items.0.name':'Test product','items.0.price':490,'items.0.productId':id()}});
 order=await Order.findById(order._id);const {payment}=await obligation();await settleQuickShiprocketCollection(signal(payment));
 const response=await auth(request(app).post('/orders/'+order._id+'/shipment')).send({confirm:true,quotedCourierCharge:100,package:{length:10,breadth:10,height:10}});
 expect({status:response.status,message:response.status>=400?response.body.message:undefined}).toEqual({status:200,message:undefined});
 const fresh=await Order.findById(order._id);expect(fresh.deliveryType).toBe('shiprocket');expect(fresh.fulfillment.chargeStatus).toBe('collected');expect(fresh.shiprocket.environment).toBe('mock');
});
