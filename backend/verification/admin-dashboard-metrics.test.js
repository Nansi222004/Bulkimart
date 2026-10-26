import mongoose from 'mongoose';
import { jest } from '@jest/globals';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import adminRoutes from '../routes/admin.routes.js';
import { errorHandler } from '../middlewares/error.middleware.js';
import { JWT_SECRET } from '../config/jwt.js';
import Order from '../models/Order.js';
import Payment from '../models/Payment.js';
import Return from '../models/Return.js';
import Ledger from '../models/SellerLedgerEntry.js';
import Admin from '../models/Admin.js';
import User from '../models/User.js';
import Seller from '../models/Seller.js';
import { ORDER_STATUSES } from '../constants/enums.js';
import { newMetric, addCompletedOrder, addOrderCollection, addPostedRevenue, getAdminFinancialMetrics } from '../services/adminDashboardMetrics.service.js';

const oid=()=>new mongoose.Types.ObjectId();
const app=express(); app.use(express.json()); app.use('/api/admin',adminRoutes); app.use(errorHandler);
let db,adminId;
const token=()=>`Bearer ${jwt.sign({id:String(adminId),type:'admin'},JWT_SECRET)}`;
const online=()=>({ _id:oid(),userId:'buyer',orderId:'order',method:'online',amount:100,status:'paid',captures:[{gatewayPaymentId:'capture',gatewayOrderId:'gateway-order',currency:'INR',amountPaise:10000,disposition:'settled'}],refundObligations:[] });
const orders=()=>[{_id:'order',userId:'buyer',status:'delivered',paymentMethod:'online',pricing:{totalAmount:100}}];
beforeAll(async()=>{db=await MongoMemoryReplSet.create({binary:{version:'7.0.14'},replSet:{count:1}});await mongoose.connect(db.getUri());});
afterAll(async()=>{await mongoose.disconnect();await db?.stop();});
beforeEach(async()=>{
  for(const collection of Object.values(mongoose.connection.collections))await collection.deleteMany({});
  adminId=oid();await Admin.collection.insertOne({_id:adminId,name:'Fixture',email:'dashboard@example.test',isActive:true,role:'admin',permissions:['manage_finance']});
});

test('gross completed order value uses canonical prices and remains distinct from payment and refund states',()=>{
  const metric=newMetric();
  for(const status of ['placed','confirmed','cancelled','returned','refunded','out_for_delivery'])addCompletedOrder(metric,{status,pricing:{totalAmount:999}});
  addCompletedOrder(metric,{status:'delivered',paymentStatus:'failed',pricing:{subtotal:100,couponDiscount:10,deliveryCharge:5,totalAmount:95}});
  expect(metric.verifiedSubtotalPaise).toBe(9500);
  addCompletedOrder(metric,{status:'delivered',pricing:{totalAmount:0}});expect(metric.incompleteRecords).toBe(0);
  addCompletedOrder(metric,{status:'delivered',payment:{totalAmount:999}});expect(metric.incompleteRecords).toBe(1);
});

test('abandoned online checkouts without an order are exclusions, not broken collections',()=>{
  for (const status of ['pending','failed']) {
    const metric=newMetric();addOrderCollection(metric,{...online(),status,captures:[]},[],[]);
    expect(metric).toMatchObject({incompleteRecords:0,excludedRecords:1,verifiedSubtotalPaise:0});
  }
});

test('missing capture and unmatched totals expose actionable reasons without leaking provider details',()=>{
  const legacy=newMetric();addOrderCollection(legacy,{...online(),captures:[]},orders(),[]);
  expect(legacy.issues[0]).toMatchObject({code:'capture_missing',count:1});
  const mismatch=newMetric();addOrderCollection(mismatch,online(),[{...orders()[0],pricing:{totalAmount:99}}],[]);
  expect(mismatch.issues[0].code).toBe('capture_total_mismatch');
});

const posted = extra => ({_id:oid(),entryNo:String(oid()),idempotencyKey:String(oid()),currency:'INR',account:'commission_revenue',amount:10,direction:'credit',type:'platform_commission',metadata:{source:'order-finance-v2'},...extra});

test('posted order commission becomes available, and reversals reduce it once',async()=>{
  await Ledger.collection.insertMany([posted(),posted({amount:2,direction:'debit',type:'reversal'})]);
  const result=await getAdminFinancialMetrics();
  expect(result.platformRevenue).toMatchObject({status:'complete',amountPaise:800,verifiedSubtotalPaise:800,breakdown:{orderCommissionPaise:800,parcelRevenuePaise:0,advertisingRevenuePaise:0}});
  expect(result.platformRevenue.blocker).toBeUndefined();
});

test('earned parcel and recognized advertising income are consolidated while taxes and receipts are excluded',async()=>{
  await Ledger.collection.insertMany([
    posted({account:'parcel_revenue',type:'adjustment',amount:10.2,parcelDeliveryId:oid(),metadata:{amountPaise:1020}}),
    posted({account:'parcel_revenue',type:'reversal',amount:2,direction:'debit',parcelDeliveryId:oid(),metadata:{amountPaise:200}}),
    posted({account:'advertising_revenue',type:'advertising_recognition',amount:40,advertisingCampaignId:oid(),paymentId:oid()}),
    posted({account:'advertising_revenue',type:'advertising_refund',amount:5,direction:'debit',advertisingCampaignId:oid(),paymentId:oid()}),
    posted({account:'parcel_collections',type:'adjustment',amount:100}),posted({account:'tax_liability',amount:18}),
    posted({serviceApplicationId:oid(),metadata:{},amount:25}),
  ]);
  const before=await Ledger.countDocuments(), result=await getAdminFinancialMetrics();
  expect(result.platformRevenue).toMatchObject({status:'complete',amountPaise:4320,excludedRecords:1,breakdown:{orderCommissionPaise:0,parcelRevenuePaise:820,advertisingRevenuePaise:3500}});
  expect(await Ledger.countDocuments()).toBe(before);
});

test('legacy orders retain missing-evidence warnings while available parcel income remains visible as a verified subtotal',async()=>{
  await Order.collection.insertMany([250,920,940].map(amount=>({_id:oid(),orderNo:`LEGACY-${amount}`,status:'delivered',pricing:{totalAmount:amount}})));
  await Ledger.collection.insertOne(posted({account:'parcel_revenue',type:'adjustment',amount:10.2,parcelDeliveryId:oid(),metadata:{amountPaise:1020}}));
  const result=await getAdminFinancialMetrics();
  expect(result.orderValue.amountPaise).toBe(211000);
  expect(result.platformRevenue).toMatchObject({status:'incomplete',amountPaise:null,verifiedSubtotalPaise:1020,incompleteRecords:3,issues:[{code:'historical_commission_missing',count:3}]});
});

test('reviewed historical commission is included and fully covered historical items stop blocking revenue',async()=>{
  const orderId=oid(),itemId=oid(),metadata={source:'historical-reviewed-v1',itemId:String(itemId),batchId:'HB-fixture',operatorId:String(oid()),reviewerId:String(oid()),evidenceHash:'fixture',policyVersion:'original-agreement'};
  await Order.collection.insertOne({_id:orderId,status:'delivered',items:[{_id:itemId}],pricing:{totalAmount:100}});
  await Ledger.collection.insertMany([posted({orderId,metadata}),posted({orderId,metadata,account:'merchandise_gross',type:'merchandise_gross',amount:100})]);
  expect((await getAdminFinancialMetrics()).platformRevenue).toMatchObject({status:'complete',amountPaise:1000,incompleteRecords:0});
});

test('unattributed income remains incomplete instead of being silently counted',()=>{
  const metric=newMetric();addPostedRevenue(metric,posted({account:'parcel_revenue',type:'adjustment',metadata:{amountPaise:1000}}));
  expect(metric).toMatchObject({verifiedSubtotalPaise:0,incompleteRecords:1,issues:[{code:'revenue_entry_invalid'}]});
});

test.each(['pending','failed'])('%s attempts without captures never count as collection',status=>{
  const metric=newMetric();addOrderCollection(metric,{...online(),status,captures:[]},orders(),[]);
  expect(metric).toMatchObject({verifiedSubtotalPaise:0,incompleteRecords:0,excludedRecords:1});
});

test('duplicate exact capture is counted once; conflicting capture and legacy paid projection remain incomplete',()=>{
  const payment=online();payment.captures.push({...payment.captures[0]});const metric=newMetric();addOrderCollection(metric,payment,orders(),[]);expect(metric.verifiedSubtotalPaise).toBe(10000);
  payment.captures[1].amountPaise=9000;const conflict=newMetric();addOrderCollection(conflict,payment,orders(),[]);expect(conflict.incompleteRecords).toBe(1);
  const legacy=newMetric();addOrderCollection(legacy,{...online(),captures:[],gateway:{paymentId:'legacy'}},orders(),[]);expect(legacy.incompleteRecords).toBe(1);
});

test.each([2500,10000])('verified completed refund %i is netted once, including cancelled orders',amount=>{
  const payment=online(); const refund={providerRefundId:'refund',gatewayPaymentId:'capture',amountPaise:amount,currency:'INR',status:'processed',verifiedAt:new Date()};
  payment.refundObligations=[refund,{...refund}];payment.refund={totalRefundedAmount:amount/100};payment.status=amount===10000?'refunded':'partial_refund';
  const metric=newMetric();addOrderCollection(metric,payment,[{...orders()[0],status:'cancelled'}],[]);expect(metric.verifiedSubtotalPaise).toBe(10000-amount);expect(metric.incompleteRecords).toBe(0);
  delete payment.refundObligations[0].verifiedAt;const invalid=newMetric();addOrderCollection(invalid,payment,orders(),[]);expect(invalid.incompleteRecords).toBe(1);
});

test('completed Return without matching refund journal blocks total; pending refunds do not fabricate money movement',()=>{
  const metric=newMetric();addOrderCollection(metric,online(),orders(),[{_id:'return',orderId:'order',status:'REFUNDED',refundAmount:25,refundReference:'unknown'}]);expect(metric.incompleteRecords).toBe(1);
  const pending=newMetric();addOrderCollection(pending,{...online(),refundObligations:[{status:'pending'}]},orders(),[]);expect(pending.verifiedSubtotalPaise).toBe(10000);
});

test('wallet internal transfers are excluded; shared online payment is not multiplied by seller orders',()=>{
  const wallet=newMetric();addOrderCollection(wallet,{method:'wallet',amount:100,status:'paid'},[],[]);expect(wallet.verifiedSubtotalPaise).toBe(0);expect(wallet.excludedRecords).toBe(1);
  const payment={...online(),groupRef:'group'};const group=[30,70].map((amount,i)=>({...orders()[0],_id:`order-${i}`,groupRef:'group',pricing:{totalAmount:amount}}));
  const metric=newMetric();addOrderCollection(metric,payment,group,[]);expect(metric.verifiedSubtotalPaise).toBe(10000);
  const sales=newMetric();group.forEach(order=>addCompletedOrder(sales,order));expect(sales.verifiedSubtotalPaise).toBe(10000);
});

const cashOrder=()=>({_id:'order',userId:'buyer',paymentMethod:'cod',pricing:{totalAmount:100},financialSnapshot:{version:2,expectedPaise:10000},codFinance:{status:'verified',verifiedPaise:10000,events:[{action:'remit',actorId:'rider'},{action:'verify',actorId:'admin',amountPaise:10000,reference:'cash-proof'}]}});
test('COD requires independent exact platform receipt and separately evidenced manual refunds',()=>{
  const payment={...online(),method:'cod',captures:[]};
  for(const status of ['expected','collected','remittance_reported']){const metric=newMetric();const order=cashOrder();order.codFinance.status=status;addOrderCollection(metric,payment,[order],[]);expect(metric.verifiedSubtotalPaise).toBe(0);expect(metric.excludedRecords).toBe(1);}
  const metric=newMetric();addOrderCollection(metric,payment,[cashOrder()],[{orderId:'order',status:'REFUNDED',refundAmount:25,refundReference:'MANUAL-COD',codSettledBy:'admin',codSettledAt:new Date(),codSettlementNote:'Verified manual payment'}]);expect(metric.verifiedSubtotalPaise).toBe(7500);
  const invalid=newMetric();const order=cashOrder();order.codFinance.events[1].actorId='rider';addOrderCollection(invalid,payment,[order],[]);expect(invalid.incompleteRecords).toBe(1);
});

test('integer precision refuses fractional paise, missing pricing and over-refunds',()=>{
  const metric=newMetric();addCompletedOrder(metric,{status:'delivered',pricing:{totalAmount:.001}});expect(metric.incompleteRecords).toBe(1);
  const payment=online();payment.captures[0].amountPaise=10000.1;const invalid=newMetric();addOrderCollection(invalid,payment,orders(),[]);expect(invalid.incompleteRecords).toBe(1);
  const over=online();over.status='refunded';over.refundObligations=[{providerRefundId:'over',gatewayPaymentId:'capture',amountPaise:10001,currency:'INR',status:'processed',verifiedAt:new Date()}];over.refund={totalRefundedAmount:100.01};const excessive=newMetric();addOrderCollection(excessive,over,orders(),[]);expect(excessive.incompleteRecords).toBe(1);
});

test('receipt IDs reused across payments and amount mismatches cannot produce a complete collection total',()=>{
  const metric=newMetric(),seen=new Set();addOrderCollection(metric,online(),orders(),[],seen);addOrderCollection(metric,online(),orders(),[],seen);expect(metric.verifiedSubtotalPaise).toBe(10000);expect(metric.incompleteRecords).toBe(1);
  const mismatch=newMetric();addOrderCollection(mismatch,online(),[{...orders()[0],pricing:{totalAmount:90}}],[]);expect(mismatch.incompleteRecords).toBe(1);
  const projection=newMetric();addOrderCollection(projection,{...online(),status:'refunded'},orders(),[]);expect(projection.incompleteRecords).toBe(1);
});

test('delivered COD without cash receipt is historical incomplete evidence, not a confirmed zero',()=>{
  const order=cashOrder();order.status='delivered';delete order.codFinance;const metric=newMetric();addOrderCollection(metric,{...online(),method:'cod'},[order],[]);expect(metric).toMatchObject({incompleteRecords:1,verifiedSubtotalPaise:0,excludedRecords:1});
});

test('real HTTP summary uses canonical recent amount and approved-only sellers; finance read is non-mutating',async()=>{
  const userId=oid(),paymentId=oid(),orderId=oid();
  await Order.collection.insertOne({_id:orderId,userId,paymentId,paymentMethod:'online',type:'grocery',status:'delivered',pricing:{subtotal:100,couponDiscount:10,deliveryCharge:5,tipAmount:5,totalAmount:100},createdAt:new Date()});
  await Payment.collection.insertOne({...online(),_id:paymentId,userId,orderId});
  await Seller.collection.insertMany([{_id:oid(),userId:oid(),status:'approved'},{_id:oid(),userId:oid(),status:'pending'}]);
  for(const [account,amount,direction,type] of [['commission_revenue',10,'credit','platform_commission'],['commission_revenue',7.25,'credit','platform_commission'],['commission_revenue',2,'debit','reversal'],['tax_liability',1.8,'credit','commission_tax'],['seller_payable',90,'credit','order_earning'],['rider_payable',20,'credit','delivery_earning'],['seller_payable',90,'credit','payout_settlement']]) await Ledger.collection.insertOne({_id:oid(),entryNo:String(oid()),idempotencyKey:String(oid()),sellerId:oid(),account,amount,direction,type,currency:'INR',metadata:{source:'order-finance-v2'}});
  const before={order:await Order.findById(orderId).lean(),payment:await Payment.findById(paymentId).lean(),entries:await Ledger.countDocuments()};
  const overview=await request(app).get('/api/admin/dashboard/overview').set('Authorization',token());expect(overview.status).toBe(200);expect(overview.body.data).toMatchObject({totalOrders:1,totalSellers:1,pendingSellers:1,revenue:null});expect(overview.body.data.recentOrders[0].amount).toBe(100);
  const response=await request(app).get('/api/admin/dashboard/financial-metrics').set('Authorization',token());expect(response.status).toBe(200);
  expect(response.body.data.orderValue).toMatchObject({amountPaise:10000,status:'complete'});expect(response.body.data.collections.amountPaise).toBe(10000);
  expect(response.body.data.platformRevenue).toMatchObject({amountPaise:null,verifiedSubtotalPaise:1525,status:'incomplete',breakdown:{orderCommissionPaise:1525,parcelRevenuePaise:0,advertisingRevenuePaise:0}});
  expect(JSON.stringify(response.body)).not.toContain('capture');
  expect(await Order.findById(orderId).lean()).toEqual(before.order);expect(await Payment.findById(paymentId).lean()).toEqual(before.payment);expect(await Ledger.countDocuments()).toBe(before.entries);
});

test('empty covered zeros differ from missing historical evidence; financial authorization is explicit',async()=>{
  const empty=await getAdminFinancialMetrics();expect(empty.orderValue.amountPaise).toBe(0);expect(empty.collections.amountPaise).toBe(0);expect(empty.platformRevenue.amountPaise).toBe(0);expect(empty.platformRevenue.status).toBe('complete');
  await Order.collection.insertOne({_id:oid(),status:'delivered',pricing:{totalAmount:250}});
  const missing=await getAdminFinancialMetrics();expect(missing.collections).toMatchObject({amountPaise:null,status:'incomplete'});expect(missing.orderValue.amountPaise).toBe(25000);
  await Admin.updateOne({_id:adminId},{$set:{permissions:[]}});
  expect((await request(app).get('/api/admin/dashboard/financial-metrics').set('Authorization',token())).status).toBe(403);
  expect((await request(app).get('/api/admin/dashboard/overview').set('Authorization',token())).status).toBe(200);
  expect((await request(app).get('/api/admin/dashboard/financial-metrics')).status).toBe(401);
});

test('an orphaned or wrong-purpose Payment linked by an Order cannot silently become verified zero',async()=>{
  const paymentId=oid(),userId=oid();
  await Order.collection.insertOne({_id:oid(),userId,paymentId,paymentMethod:'online',status:'delivered',pricing:{totalAmount:100}});
  await Payment.collection.insertOne({_id:paymentId,userId,method:'online',status:'paid',amount:100,subscriptionId:oid()});
  const result=await getAdminFinancialMetrics();expect(result.collections.status).toBe('incomplete');expect(result.collections.amountPaise).toBeNull();
});

test('a financial read failure is an API error, never a successful empty metric contract',async()=>{
  const failure=jest.spyOn(Ledger,'find').mockImplementation(()=>{throw Error('Isolated read failure');});
  try {const response=await request(app).get('/api/admin/dashboard/financial-metrics').set('Authorization',token());expect(response.status).toBe(500);expect(response.body).toMatchObject({success:false,data:null});}
  finally {failure.mockRestore();}
});

test('order analytics counts distinct fulfilment Orders by current canonical status, not shared Payments',async()=>{
  const shared=oid();
  await Order.collection.insertMany([...ORDER_STATUSES.map(status=>({_id:oid(),status,type:'ecommerce',salesChannel:'retail',paymentId:shared})),
    {_id:oid(),status:'old_status',type:'grocery',salesChannel:'wholesale',paymentId:shared},
    {_id:oid(),type:'subscription'}].map(row=>({...row,orderNo:`CHART-${oid()}`})));
  const before=await Order.find().lean();
  const response=await request(app).get('/api/admin/dashboard/order-analytics').set('Authorization',token());
  expect(response.status).toBe(200);expect(response.headers['cache-control']).toBe('no-store');
  expect(response.body.data).toMatchObject({version:1,scope:'all-time',timezone:'Asia/Kolkata',unit:'orders',measure:'fulfilment-orders',totalOrders:ORDER_STATUSES.length+2});
  expect(response.body.data.statuses).toEqual([...ORDER_STATUSES.map(key=>({key,count:1})),{key:'unknown',count:2}]);
  expect(response.body.data.channels).toEqual([{key:'ecommerce',count:ORDER_STATUSES.length},{key:'grocery',count:1},{key:'subscription',count:1}]);
  expect(response.body.data.salesChannels).toEqual([{key:'retail',count:ORDER_STATUSES.length},{key:'wholesale',count:1},{key:'unknown',count:1}]);
  expect(await Order.find().lean()).toEqual(before);
  for(const privateField of ['paymentId','userId','sellerId','pricing','amount','email','captures'])expect(JSON.stringify(response.body)).not.toContain(`"${privateField}"`);
});

test('unknown and missing channels remain unattributed; salesChannel never substitutes for type',async()=>{
  await Order.collection.insertMany([
    {_id:oid(),status:'delivered',type:'grocery',salesChannel:'wholesale'},
    ...['qcommerce','shg','wholesale',null].map(type=>({_id:oid(),status:'placed',type,salesChannel:'retail'})),
    {_id:oid(),status:'cancelled',salesChannel:'legacy'},
  ].map(row=>({...row,orderNo:`CHANNEL-${oid()}`})));
  const response=await request(app).get('/api/admin/dashboard/order-analytics').set('Authorization',token());
  expect(response.status).toBe(200);
  expect(response.body.data.channels).toEqual([{key:'grocery',count:1},{key:'unknown',count:5}]);
  expect(response.body.data.salesChannels).toEqual([{key:'retail',count:4},{key:'wholesale',count:1},{key:'unknown',count:1}]);
  for(const key of ['statuses','channels','salesChannels'])expect(response.body.data[key].reduce((sum,row)=>sum+row.count,0)).toBe(6);
});

test('successful empty operational analytics differs from failed reads and rejects unsupported filters',async()=>{
  const response=await request(app).get('/api/admin/dashboard/order-analytics').set('Authorization',token());
  expect(response.status).toBe(200);expect(response.body.data).toMatchObject({totalOrders:0,statuses:[],channels:[],salesChannels:[]});
  expect((await request(app).get('/api/admin/dashboard/order-analytics?from=2026-01-01').set('Authorization',token())).status).toBe(400);
  const failure=jest.spyOn(Order,'aggregate').mockReturnValue({option:()=>Promise.reject(Error('Fixture timeout'))});
  try {const error=await request(app).get('/api/admin/dashboard/order-analytics').set('Authorization',token());expect(error.status).toBe(500);expect(error.body.success).toBe(false);expect(error.body.data).toBeNull();}
  finally {failure.mockRestore();}
});

test('malformed aggregation cannot be published as a valid operational chart',async()=>{
  const failure=jest.spyOn(Order,'aggregate').mockReturnValue({option:()=>Promise.resolve([{total:[{count:1}],statuses:[],channels:[],salesChannels:[]}])});
  try {const response=await request(app).get('/api/admin/dashboard/order-analytics').set('Authorization',token());expect(response.status).toBe(500);expect(response.body.success).toBe(false);}
  finally {failure.mockRestore();}
});

test('operational charts require Admin but do not require finance permission',async()=>{
  expect((await request(app).get('/api/admin/dashboard/order-analytics')).status).toBe(401);
  const buyerId=oid();await User.collection.insertOne({_id:buyerId,isActive:true,roles:['buyer']});
  const buyer=`Bearer ${jwt.sign({id:String(buyerId),type:'user',role:'buyer'},JWT_SECRET)}`;
  expect((await request(app).get('/api/admin/dashboard/order-analytics').set('Authorization',buyer)).status).toBe(403);
  await Admin.updateOne({_id:adminId},{$set:{permissions:[]}});
  expect((await request(app).get('/api/admin/dashboard/order-analytics').set('Authorization',token())).status).toBe(200);
  expect((await request(app).get('/api/admin/dashboard/financial-metrics').set('Authorization',token())).status).toBe(403);
});

test('snapshot transaction failure has no non-atomic financial fallback',async()=>{
  const withTransaction=jest.fn().mockRejectedValue(Error('Snapshot transactions unavailable'));
  const endSession=jest.fn();
  const session=jest.spyOn(mongoose,'startSession').mockResolvedValue({withTransaction,endSession});
  const reads=jest.spyOn(Order,'aggregate');
  try {
    const response=await request(app).get('/api/admin/dashboard/financial-metrics').set('Authorization',token());
    expect(response.status).toBe(500);expect(response.body.success).toBe(false);
    expect(withTransaction).toHaveBeenCalledWith(expect.any(Function),expect.objectContaining({readConcern:{level:'snapshot'},readPreference:'primary'}));
    expect(reads).not.toHaveBeenCalled();expect(endSession).toHaveBeenCalledTimes(1);
  } finally {session.mockRestore();reads.mockRestore();}
});
