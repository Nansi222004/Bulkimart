import { jest } from '@jest/globals';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

// Provider boundary is replaced before importing any refund workflow module.
const providerRefunds = [];
const client = {
  payments: {
    fetch: jest.fn(async () => ({ id:'pay-fixture',order_id:'order-fixture',status:'captured',currency:'INR',amount:10000,amount_refunded:providerRefunds.reduce((n,row)=>n+row.amount,0) })),
    refund: jest.fn(async (payment_id, data) => { const row={...data,payment_id,id:`refund-${providerRefunds.length}`,currency:'INR',status:'processed'}; providerRefunds.push(row); return row; }),
  },
  refunds: { all:jest.fn(async()=>({items:providerRefunds})),fetch:jest.fn(async id=>providerRefunds.find(row=>row.id===id)) },
};
const original = await import('../services/razorpay.service.js');
jest.unstable_mockModule('../services/razorpay.service.js',()=>({...original,getRazorpayClient:()=>client}));
jest.unstable_mockModule('../services/fcm.service.js',()=>({sendPushNotification:jest.fn(),sendBulkNotification:jest.fn()}));
const {processReturnRefund}=await import('../services/return.service.js');
const {postOrderFinance,reverseRefundedReturn,releaseOrderFinance}=await import('../services/orderFinance.service.js');
const {saveCommissionVersion}=await import('../services/vendorCommission.service.js');
const {sellerBalances}=await import('../services/sellerLedger.service.js');
const {default:Order}=await import('../models/Order.js'),{default:Payment}=await import('../models/Payment.js'),{default:Return}=await import('../models/Return.js');
const {default:Seller}=await import('../models/Seller.js'),{default:Product}=await import('../models/Product.js'),{default:Admin}=await import('../models/Admin.js'),{default:User}=await import('../models/User.js');
const {default:Ledger}=await import('../models/SellerLedgerEntry.js');
let db;
beforeAll(async()=>{db=await MongoMemoryReplSet.create({binary:{version:'7.0.14'},replSet:{count:1}});await mongoose.connect(db.getUri());await Ledger.init();});
afterAll(async()=>{await mongoose.disconnect();await db?.stop();});
beforeEach(async()=>{
  for(const collection of Object.values(mongoose.connection.collections))await collection.deleteMany({});
  providerRefunds.length=0;client.payments.refund.mockClear();process.env.RAZORPAY_MODE='test';
  process.env.FINANCE_POLICY_APPROVAL_REFERENCE='SYNTHETIC';process.env.FINANCE_E2E_APPROVAL_REFERENCE='SYNTHETIC';
});
afterEach(()=>{for(const key of ['FINANCE_OPERATIONS_ENABLED','FINANCE_POLICY_APPROVAL_REFERENCE','FINANCE_E2E_APPROVAL_REFERENCE','FINANCE_SNAPSHOTS_ENABLED','RAZORPAY_MODE'])delete process.env[key];});

test.each([1,2])('actual verified provider refund → compensation → release, quantity %i',async quantity=>{
  const user=await User.create({name:'Fixture customer',phone:'9876609001',roles:['buyer'],isActive:true});
  const adminId=new mongoose.Types.ObjectId();await Admin.collection.insertOne({_id:adminId,name:'Fixture finance operator',email:'refund@example.test',role:'admin',isActive:true,permissions:['manage_finance']});
  const sellerId=new mongoose.Types.ObjectId();await Seller.collection.insertOne({_id:sellerId,userId:user._id,businessName:'Fixture',status:'approved'});
  const productId=new mongoose.Types.ObjectId();await Product.collection.insertOne({_id:productId,type:'grocery'});
  await saveCommissionVersion({vendorType:'general',channel:'quick',method:'percentage',value:10,base:'eligible_item_subtotal',fixedScope:'order_item',taxTreatment:'exempt',taxRate:0,effectiveDate:'2020-01-01',isActive:true,reason:'Synthetic fixture contract'},adminId);
  const payment=await Payment.create({userId:user._id,amount:100,method:'online',status:'paid',gateway:{provider:'razorpay',orderId:'order-fixture',paymentId:'pay-fixture'},captures:[{gatewayOrderId:'order-fixture',gatewayPaymentId:'pay-fixture',amountPaise:10000,currency:'INR',disposition:'settled'}]});
  const order=await Order.create({userId:user._id,type:'grocery',status:'delivered',paymentMethod:'online',paymentId:payment._id,pricing:{discountRepresentation:'components-v1',subtotal:100,totalAmount:100},items:[{sellerId,productId,type:'grocery',name:'Fixture',price:50,qty:2,deliveredAt:new Date('2020-01-01')}]});
  delete process.env.FINANCE_SNAPSHOTS_ENABLED;payment.orderId=order._id;await payment.save();
  await postOrderFinance(order._id,adminId);
  const ret=await Return.create({returnNumber:'RET-PROVIDER',orderId:order._id,orderItemId:order.items[0]._id,sellerId,customerId:user._id,productId,unitPriceSnapshot:50,quantity,reason:'OTHER',status:'RETURN_RECEIVED'});
  const result=await processReturnRefund({returnId:ret._id,adminId});
  expect(result.status).toBe('REFUNDED');expect(result.refundAmount).toBe(quantity*50);
  expect((await Payment.findById(payment._id)).status).toBe(quantity===1?'partial_refund':'refunded');
  await reverseRefundedReturn(ret._id,adminId);await releaseOrderFinance(order._id,adminId);
  await processReturnRefund({returnId:ret._id,adminId});await reverseRefundedReturn(ret._id,adminId);
  expect(client.payments.refund).toHaveBeenCalledTimes(1);
  expect(await sellerBalances(sellerId)).toMatchObject({held:0,eligible:quantity===1?45:0});
});
