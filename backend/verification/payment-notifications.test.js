import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import crypto from 'node:crypto';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { randomUUID } from 'node:crypto';
process.env.PAYMENT_GATEWAY='razorpay'; process.env.RAZORPAY_MODE='test';
process.env.RAZORPAY_KEY_ID='rzp_test_notification_fixture';process.env.RAZORPAY_KEY_SECRET='fixture-razorpay-secret';process.env.RAZORPAY_WEBHOOK_SECRET='fixture-webhook-secret';
const originalGateway=await import('../services/razorpay.service.js');
const liveStatus=jest.fn();
jest.unstable_mockModule('../services/razorpay.service.js',()=>({...originalGateway,getRazorpayPaymentStatus:liveStatus}));
const push=jest.fn(async()=>({success:true}));
jest.unstable_mockModule('../services/fcm.service.js',()=>({sendPushNotification:push,sendBulkNotification:push}));
const emitToSeller=jest.fn();const emitToRider=jest.fn();
jest.unstable_mockModule('../socket/rooms.js',()=>({emitToSeller,emitToRider,emitToUser:jest.fn(),emitToAdmins:jest.fn(),broadcastToRiders:jest.fn()}));
const {default: orderRoutes}=await import('../routes/order.routes.js');
const {default: paymentRoutes}=await import('../routes/payment.routes.js');
const {getSellerOrders, getDashboard, updateOrderStatus}=await import('../controllers/seller.controller.js');
const {getMyNotifications,getUnreadCount}=await import('../controllers/notification.controller.js');
const {broadcastNewOrderToRiders}=await import('../controllers/deliveryPartner.controller.js');
const {publishEligibleSellerOrder,sweepEligibleSellerOrders}=await import('../services/sellerOrderNotification.service.js');
const {sweepUnacceptedOrdersOnce}=await import('../services/orderSweeper.service.js');
const {protect}=await import('../middlewares/auth.middleware.js');
const {errorHandler}=await import('../middlewares/error.middleware.js');
const {requestContext}=await import('../middlewares/requestContext.middleware.js');
const {JWT_SECRET}=await import('../config/jwt.js');
const {default:User}=await import('../models/User.js');const {default:Seller}=await import('../models/Seller.js');
const {default:Product}=await import('../models/Product.js');const {default:Cart}=await import('../models/Cart.js');
const {default:Order}=await import('../models/Order.js');const {default:Payment}=await import('../models/Payment.js');
const {default:Notification}=await import('../models/Notification.js');
const app=express();app.use(requestContext);app.use(express.json({verify:(req,_res,body)=>{req.rawBody=body;}}));
app.use('/api/orders',orderRoutes);app.use('/api/payments',paymentRoutes);
app.get('/api/sellers/dashboard',protect,getDashboard);app.get('/api/sellers/orders',protect,getSellerOrders);app.get('/api/sellers/orders/:id',protect,getSellerOrders);app.patch('/api/sellers/orders/:id/status',protect,updateOrderStatus);
app.get('/api/notifications',protect,getMyNotifications);app.get('/api/notifications/unread-count',protect,getUnreadCount);app.use(errorHandler);
let db,buyer,sellerUser,seller,product;const id=()=>new mongoose.Types.ObjectId();
const address={name:'Fixture Buyer',phone:'9876500000',line1:'Fixture address',city:'Mumbai',state:'Maharashtra',pincode:'400001',lat:19.11,lng:72.91};
const auth=(req,user=buyer,role='buyer')=>req.set('Authorization','Bearer '+jwt.sign({id:user._id,type:'user',role},JWT_SECRET));
const sellerAuth=req=>auth(req,sellerUser,'seller');
async function cart(){await Cart.create({userId:buyer._id,channel:'ecommerce',items:[{productId:product._id,variantId:product.variants[0]._id,sellerId:seller._id,name:'Fixture',price:100,qty:1}]});}
async function placed(method='online',path='/api/orders'){
 const res=await auth(request(app).post(path)).set('Idempotency-Key',randomUUID()).send({shippingAddress:address,channel:'ecommerce',paymentMethod:method});
 expect({status:res.status,error:res.status>=400?res.body.message:undefined}).toEqual({status:201,error:undefined});
 return Order.findById(res.body.data.order?._id||res.body.data.orders?.[0]._id);
}
async function gateway(order,state='COMPLETED'){
 const payment=await Payment.findById(order.paymentId);payment.gateway={provider:'razorpay',orderId:'order_fixture_gateway',merchantOrderId:'fixture-merchant'};
 payment.gatewayAttempts=[{attemptId:'attempt-fixture',provider:'razorpay',merchantOrderId:'fixture-merchant',gatewayOrderId:'order_fixture_gateway',orderId:order._id,amountPaise:Math.round(payment.amount*100),currency:'INR',status:'created'}];await payment.save();
 liveStatus.mockResolvedValue({state,orderId:'order_fixture_gateway',paymentId:'pay_fixture_capture',amountPaise:Math.round(payment.amount*100),currency:'INR',paymentDetails:[{id:'pay_fixture_capture'}]});return payment;
}
const verify=order=>auth(request(app).post('/api/payments/razorpay/verify')).send({orderId:String(order._id),razorpay_order_id:'order_fixture_gateway',razorpay_payment_id:'pay_fixture_capture',razorpay_signature:crypto.createHmac('sha256',process.env.RAZORPAY_KEY_SECRET).update('order_fixture_gateway|pay_fixture_capture').digest('hex')});
async function webhook(payment,event='payment.captured'){
 const body={event,payload:{payment:{entity:{id:'pay_fixture_capture',order_id:'order_fixture_gateway',amount:Math.round(payment.amount*100),currency:'INR',status:event==='payment.captured'?'captured':'failed'}}}};
 const raw=JSON.stringify(body);return request(app).post('/api/payments/razorpay/webhook').set('Content-Type','application/json').set('X-Razorpay-Signature',crypto.createHmac('sha256',process.env.RAZORPAY_WEBHOOK_SECRET).update(raw).digest('hex')).send(raw);
}
const sellerRows=()=>Notification.find({userId:sellerUser._id,event:'ORDER_CREATED'});
async function flushPush(){await new Promise(resolve=>setTimeout(resolve,30));}

beforeAll(async () => {
  db = await MongoMemoryReplSet.create({ binary: { version: '7.0.14' }, replSet: { count: 1 } }); await mongoose.connect(db.getUri());
  await Promise.all(Object.values(mongoose.models).map(model => model.init()));
  // Production requires this explicit index too; autoIndex is disabled on
  // CheckoutAttempt. Exercise the real uniqueness boundary in this fixture.
  await mongoose.models.CheckoutAttempt.createIndexes();
});

afterAll(async()=>{await mongoose.disconnect();await db?.stop();});
beforeEach(async () => {
  for (const collection of Object.values(mongoose.connection.collections)) await collection.deleteMany({});
  jest.clearAllMocks();
  buyer = await User.create({ name: 'Fixture Buyer', phone: '9876500000', roles: ['buyer'], wallet: { balance: 10000 }, isActive: true });
  sellerUser = await User.create({ name: 'Fixture Seller', phone: '9876500001', roles: ['buyer', 'seller'], isActive: true });
  const sellerId = id();
  await Seller.collection.insertOne({ _id: sellerId, userId: sellerUser._id, businessName: 'Fixture Store', status: 'approved', storeDetails: { name: 'Fixture Store', pincode: '400001', city: 'Mumbai', lat: 19.1, lng: 72.9 }, thirdPartyFulfillment: { enabled: true, shiprocketPickupLocation: 'fixture-pickup' } });
  seller = await Seller.findById(sellerId);
  sellerUser.pushTokens=[{token:'fixture-seller-device',platform:'web',active:true}];await sellerUser.save();
  product = { _id: id(), sellerId, type: 'ecommerce', category: id(), name: 'Fixture item', price: 100, stock: 10, isActive: true, status: 'approved', fulfillmentType: 'physical', images: [], variants: [{ _id: id(), name: 'One pack', sku: 'FIXTURE-1', price: 100, mrp: 100, stock: 10, weight: 500, unit: 'piece' }] };
  await Product.collection.insertOne(product); await cart();
});

test.each(['/api/orders','/api/orders/unified'])('pending online checkout %s sends no seller notification and exposes no action',async path=>{
 const order=await placed('online',path);await flushPush();expect(await sellerRows()).toHaveLength(0);expect(emitToSeller.mock.calls.filter(c=>c[1]==='new_order')).toHaveLength(0);expect(push).not.toHaveBeenCalled();
 // Unpaid checkouts are hidden from both seller history and direct details.
 await sellerAuth(request(app).get('/api/sellers/orders/'+order._id)).expect(404);
 const list=await sellerAuth(request(app).get('/api/sellers/orders?status=placed')).expect(200);expect(list.body.data).toEqual([]);
 await sellerAuth(request(app).patch('/api/sellers/orders/'+order._id+'/status')).send({status:'confirmed'}).expect(409);
 await broadcastNewOrderToRiders(order._id);expect(emitToRider).not.toHaveBeenCalled();
 await sweepEligibleSellerOrders();expect(await sellerRows()).toHaveLength(0);
});
test('verified payment publishes exactly one logical seller event across concurrent retries',async()=>{
 const order=await placed();await gateway(order);await verify(order).expect(200);
 await Promise.all([verify(order).expect(200),publishEligibleSellerOrder(order._id),publishEligibleSellerOrder(order._id)]);await flushPush();
 expect((await Payment.findById(order.paymentId)).status).toBe('paid');expect(await sellerRows()).toHaveLength(1);
 expect(emitToSeller.mock.calls.filter(c=>c[1]==='new_order')).toHaveLength(1);expect(push).toHaveBeenCalledTimes(1);
 const detail=await sellerAuth(request(app).get('/api/sellers/orders/'+order._id)).expect(200);expect(detail.body.data.permittedActions.some(a=>a.to==='confirmed')).toBe(true);
});
test('signed webhook before browser verification and duplicate webhooks publish once',async()=>{
 const order=await placed();const payment=await gateway(order);await webhook(payment).then(r=>expect(r.status).toBe(200));
 await webhook(payment).then(r=>expect(r.status).toBe(200));await verify(order).expect(200);await flushPush();
 expect(await sellerRows()).toHaveLength(1);expect(emitToSeller.mock.calls.filter(c=>c[1]==='new_order')).toHaveLength(1);expect(push).toHaveBeenCalledTimes(1);
});
test('browser verification before delayed webhook also publishes once',async()=>{
 const order=await placed();const payment=await gateway(order);await verify(order).expect(200);await webhook(payment).then(r=>expect(r.status).toBe(200));expect(await sellerRows()).toHaveLength(1);
});
test('invalid signature, pending status, and failed payment never publish an eligible order',async()=>{
 const order=await placed();const payment=await gateway(order,'PENDING');
 await auth(request(app).post('/api/payments/razorpay/verify')).send({orderId:String(order._id),razorpay_order_id:'order_fixture_gateway',razorpay_payment_id:'pay_fixture_capture',razorpay_signature:'invalid'}).expect(401);
 await verify(order).expect(200);expect(await sellerRows()).toHaveLength(0);
 liveStatus.mockResolvedValue({state:'FAILED',orderId:'order_fixture_gateway',paymentId:'pay_fixture_capture',amountPaise:Math.round(payment.amount*100),currency:'INR'});
 await webhook(payment,'payment.failed').then(r=>expect(r.status).toBe(200));await publishEligibleSellerOrder(order._id);expect(await sellerRows()).toHaveLength(0);
});
test('COD preserves one seller notification and durable reconciliation does not duplicate it',async()=>{
 const order=await placed('cod');await sweepEligibleSellerOrders();await publishEligibleSellerOrder(order._id);await flushPush();expect(await sellerRows()).toHaveLength(1);expect(push).toHaveBeenCalledTimes(1);
});
test('post-commit notification failure is recovered by the durable order sweep',async()=>{
 const order=await placed();const payment=await gateway(order);await Payment.updateOne({_id:payment._id},{$set:{status:'paid'}});
 expect(await sellerRows()).toHaveLength(0);await sweepEligibleSellerOrders();expect(await sellerRows()).toHaveLength(1);
});
test('legacy premature seller notification is excluded from badge and history until payment is verified',async()=>{
 const order=await placed();await Notification.create({userId:sellerUser._id,type:'order',event:'ORDER_CREATED',title:'Legacy',message:'Legacy premature',metadata:{orderId:order._id,sellerId:seller._id}});
 const unread=await sellerAuth(request(app).get('/api/notifications/unread-count')).expect(200);expect(unread.body.data.count).toBe(0);
 const history=await sellerAuth(request(app).get('/api/notifications?event=ORDER_CREATED')).expect(200);expect(history.body.data).toEqual([]);
});
test('unauthenticated and different-customer payment verification remain protected',async()=>{
 const order=await placed();await gateway(order);await request(app).post('/api/payments/razorpay/verify').send({}).expect(401);
 await auth(request(app).post('/api/payments/razorpay/verify'),sellerUser,'seller').send({orderId:String(order._id),razorpay_order_id:'order_fixture_gateway',razorpay_payment_id:'pay_fixture_capture',razorpay_signature:'invalid'}).expect(404);expect(await sellerRows()).toHaveLength(0);
});

test('rider broadcasts reject unpaid legacy dispatched orders before looking up riders',async()=>{
 const order=await placed();await Order.updateOne({_id:order._id},{$set:{status:'dispatched'}});
 const lookup=jest.spyOn(Seller,'findById');try{await broadcastNewOrderToRiders(order._id);expect(lookup).not.toHaveBeenCalled();expect(emitToRider).not.toHaveBeenCalled();}finally{lookup.mockRestore();}
});
test('seller pending-order KPI excludes unpaid online orders',async()=>{
 await placed();const res=await sellerAuth(request(app).get('/api/sellers/dashboard')).expect(200);expect(res.body.kpis.pendingOrders).toBe(0);
});
test('packaging and returns notifications retain their portal-specific destination',async()=>{
 const {notifySeller}=await import('../services/notification.service.js');
 const record=await notifySeller(seller.toObject(),{event:'PACKAGING_PAYMENT_CONFIRMED',title:'Packaging paid',message:'Fixture',metadata:{orderId:new mongoose.Types.ObjectId()},route:'/seller/packaging/orders'});
 expect(record.route).toBe('/seller/packaging/orders');expect(String(record.metadata.sellerId)).toBe(String(seller._id));
});

test('suspended sellers do not receive actionable paid-order alerts',async()=>{
 const order=await placed();await Seller.updateOne({_id:seller._id},{$set:{status:'suspended'}});await gateway(order);await verify(order).expect(200);expect(await sellerRows()).toHaveLength(0);
});

const abandon = order => auth(request(app).post(`/api/orders/${order._id}/abandon-payment`));

test('Quick seller acceptance does not time out an unpaid order or a newly verified payment', async () => {
 const order = await placed();
 await Order.collection.updateOne({ _id: order._id }, { $set: { type: 'grocery', createdAt: new Date(Date.now() - 20 * 60000) } });
 await sweepUnacceptedOrdersOnce();
 expect((await Order.findById(order._id)).status).toBe('placed');
 await gateway(order); await verify(order).expect(200);
 await sweepUnacceptedOrdersOnce();
 expect((await Order.findById(order._id)).status).toBe('placed');
 await Payment.updateOne({ _id: order.paymentId }, { $set: { paidAt: new Date(Date.now() - 6 * 60000) } });
 await sweepUnacceptedOrdersOnce();
 expect((await Order.findById(order._id)).status).toBe('cancelled');
});

test('Quick COD acceptance timeout continues to use the order creation time', async () => {
 const order = await placed('cod');
 await Order.collection.updateOne({ _id: order._id }, { $set: { type: 'grocery', createdAt: new Date(Date.now() - 6 * 60000) } });
 await sweepUnacceptedOrdersOnce();
 expect((await Order.findById(order._id)).status).toBe('cancelled');
});
test.each(['/api/orders', '/api/orders/unified'])('payment dismissal restores %s exactly once without order alerts', async path => {
 const order = await placed('online', path);
 expect((await Product.findById(product._id)).variants[0].stock).toBe(9);
 const responses = await Promise.all([abandon(order), abandon(order)]);
 for (const res of responses) { expect(res.status).toBe(200); expect(res.body.data.cancelled).toBe(true); }
 expect((await Order.findById(order._id)).status).toBe('cancelled');
 const payment = await Payment.findById(order.paymentId);
 expect(payment.status).toBe('failed'); expect(payment.checkoutAbandonedAt).toBeTruthy();
 for (const query of ['', '?status=cancelled', '?limit=1']) {
   const customerHistory = await auth(request(app).get('/api/orders' + query)).expect(200);
   expect(customerHistory.body.data).toEqual([]); expect(customerHistory.body.meta.total).toBe(0);
   const sellerHistory = await sellerAuth(request(app).get('/api/sellers/orders' + query)).expect(200);
   expect(sellerHistory.body.data).toEqual([]); expect(sellerHistory.body.meta.total).toBe(0);
 }
 expect((await Product.findById(product._id)).variants[0].stock).toBe(10);
 const restored = await Cart.findOne({userId:buyer._id, channel:'ecommerce'});
 expect(restored.items).toHaveLength(1); expect(restored.items[0].qty).toBe(1);
 await flushPush(); expect(await Notification.countDocuments({event:'ORDER_CREATED'})).toBe(0);
 await auth(request(app).post('/api/payments/initiate')).send({orderId:String(order._id)}).expect(400);
});

test.each(['cod', 'online'])('a real cancelled %s order stays visible in both histories', async method => {
 const order = await placed(method);
 if (method === 'online') { await gateway(order); await verify(order).expect(200); }
 await auth(request(app).patch(`/api/orders/${order._id}/cancel`)).send({ reason: 'Payment cancelled by customer' }).expect(200);
 const customerHistory = await auth(request(app).get('/api/orders?status=cancelled')).expect(200);
 expect(customerHistory.body.data.map(row => row._id)).toEqual([String(order._id)]);
 expect(customerHistory.body.meta.total).toBe(1);
 const sellerHistory = await sellerAuth(request(app).get('/api/sellers/orders?status=cancelled')).expect(200);
 expect(sellerHistory.body.data.map(row => row._id)).toEqual([String(order._id)]);
 expect(sellerHistory.body.meta.total).toBe(1);
});

test('abandoned checkout does not consume a history page or hide a later genuine order', async () => {
 const abandoned = await placed(); await abandon(abandoned).expect(200);
 const genuine = await placed('cod');
 await Order.collection.updateOne({ _id: abandoned._id }, { $set: { createdAt: new Date(Date.now() + 60000) } });
 for (const [path, authenticate] of [['/api/orders', auth], ['/api/sellers/orders', sellerAuth]]) {
   const history = await authenticate(request(app).get(path + '?limit=1')).expect(200);
   expect(history.body.data.map(row => row._id)).toEqual([String(genuine._id)]);
   expect(history.body.meta).toMatchObject({ total: 1, pages: 1 });
 }
});

test('dismissal does not cancel a verified capture or put paid items back in the cart', async () => {
 const order = await placed(); await gateway(order); await verify(order).expect(200);
 const res = await abandon(order).expect(200); expect(res.body.data).toMatchObject({cancelled:false,status:'paid'});
 expect((await Order.findById(order._id)).status).toBe('placed');
 expect((await Product.findById(product._id)).variants[0].stock).toBe(9);
 expect((await Cart.findOne({userId:buyer._id,channel:'ecommerce'})).items).toHaveLength(0);
});

test('late and repeated captures after dismissal create one refund obligation without reviving the order', async () => {
 const order = await placed(); const payment = await gateway(order);
 await abandon(order).expect(200); await webhook(payment).then(res=>expect(res.status).toBe(200));
 await webhook(payment).then(res=>expect(res.status).toBe(200));
 const stored = await Payment.findById(payment._id);
 expect(stored.status).toBe('failed'); expect(stored.captures).toHaveLength(1);
 expect(stored.captures[0].disposition).toBe('refund_required');
 expect(stored.refundObligations).toHaveLength(1);
 expect(stored.refundObligations[0].amountPaise).toBe(Math.round(payment.amount*100));
 expect((await Order.findById(order._id)).status).toBe('cancelled');
 expect((await Product.findById(product._id)).variants[0].stock).toBe(10);
 expect(await Notification.countDocuments({event:'ORDER_CREATED'})).toBe(0);
});

test('dismissal requires the checkout owner and rejects cash-on-delivery orders', async () => {
 const order = await placed('cod');
 await request(app).post(`/api/orders/${order._id}/abandon-payment`).expect(401);
 await auth(request(app).post(`/api/orders/${order._id}/abandon-payment`),sellerUser,'seller').expect(403);
 await auth(request(app).post(`/api/orders/${order._id}/abandon-payment`),sellerUser,'buyer').expect(404);
 await abandon(order).expect(409);
 expect((await Order.findById(order._id)).status).toBe('placed');
});

test('dismissal releases reserved Coins and coupon use once, merging newer basket items', async () => {
 const order = await placed();
 const {default:CoinWallet} = await import('../models/CoinWallet.js');
 const {default:Coupon} = await import('../models/Coupon.js');
 const {default:Redemption} = await import('../models/CouponRedemption.js');
 const coupon = await Coupon.create({code:'FIXTURE',title:'Fixture',discountType:'fixed',value:10,usedCount:1});
 await Redemption.create({couponId:coupon._id,code:coupon.code,userId:buyer._id,orderId:order._id,discountAmount:10});
 await Order.updateOne({_id:order._id},{$set:{coupon:coupon._id}});
 await Payment.updateOne({_id:order.paymentId},{$set:{coinsUsed:10}});
 await CoinWallet.updateOne({userId:buyer._id},{$set:{availableCoins:90,reservedCoins:10}},{upsert:true});
 await Cart.updateOne({userId:buyer._id,channel:'ecommerce'},{$push:{items:{productId:product._id,variantId:product.variants[0]._id,qty:2,deliveryMode:order.delivery?.mode}}});
 await abandon(order).expect(200); await abandon(order).expect(200);
 expect((await Cart.findOne({userId:buyer._id,channel:'ecommerce'})).items[0].qty).toBe(3);
 expect((await CoinWallet.findOne({userId:buyer._id})).availableCoins).toBe(100);
 expect((await CoinWallet.findOne({userId:buyer._id})).reservedCoins).toBe(0);
 expect((await Coupon.findById(coupon._id)).usedCount).toBe(0);
 expect(await Redemption.countDocuments({orderId:order._id})).toBe(0);
});

test('digital checkout dismissal restores its cart without inventing physical inventory', async () => {
 const order = await placed();
 // Digital checkout does not reserve physical stock.
 await Product.updateOne({_id:product._id},{$set:{stock:10,'variants.0.stock':10}});
 await Order.updateOne({_id:order._id},{$set:{'items.0.fulfillmentType':'digital'}});
 await Cart.updateOne({userId:buyer._id,channel:'ecommerce'},{$push:{items:{productId:product._id,variantId:product.variants[0]._id,qty:1,fulfillmentType:'digital'}}});
 await abandon(order).expect(200);
 expect((await Product.findById(product._id)).variants[0].stock).toBe(10);
 expect((await Cart.findOne({userId:buyer._id,channel:'ecommerce'})).items[0].fulfillmentType).toBe('digital');
 expect((await Cart.findOne({userId:buyer._id,channel:'ecommerce'})).items[0].qty).toBe(1);
});

test('one dismissal cancels all fulfilment groups and restores every line atomically', async () => {
 const secondSeller = id();
 const secondUser = await User.create({name:'Second fixture seller',phone:'9876500002',roles:['buyer','seller'],isActive:true});
 await Seller.collection.insertOne({...seller.toObject(),_id:secondSeller,userId:secondUser._id});
 const secondProduct = {...product,_id:id(),sellerId:secondSeller,variants:[{...product.variants[0],_id:id(),sku:'FIXTURE-2'}]};
 await Product.collection.insertOne(secondProduct);
 await Cart.updateOne({userId:buyer._id,channel:'ecommerce'},{$push:{items:{productId:secondProduct._id,variantId:secondProduct.variants[0]._id,sellerId:secondSeller,name:'Second fixture',price:100,qty:1}}});
 const order = await placed('online','/api/orders/unified');
 const orders = await Order.find({paymentId:order.paymentId}); expect(orders).toHaveLength(2);
 await abandon(order).expect(200);
 expect(await Order.countDocuments({paymentId:order.paymentId,status:'cancelled'})).toBe(2);
 expect((await Cart.findOne({userId:buyer._id,channel:'ecommerce'})).items).toHaveLength(2);
 expect((await Product.findById(secondProduct._id)).variants[0].stock).toBe(10);
 expect((await Product.findById(product._id)).variants[0].stock).toBe(10);
});

test('capture racing dismissal either keeps a paid order or records a refund for the cancelled order', async () => {
 const order = await placed(); const payment = await gateway(order);
 const [cancelled,captured] = await Promise.all([abandon(order),webhook(payment)]);
 expect(cancelled.status).toBe(200); expect(captured.status).toBe(200);
 const stored = await Payment.findById(payment._id); const finalOrder = await Order.findById(order._id);
 const stock = (await Product.findById(product._id)).variants[0].stock;
 if (stored.checkoutAbandonedAt) {
   expect(finalOrder.status).toBe('cancelled'); expect(stock).toBe(10);
   expect(stored.captures[0].disposition).toBe('refund_required'); expect(stored.refundObligations).toHaveLength(1);
 } else { expect(stored.status).toBe('paid'); expect(finalOrder.status).toBe('placed'); expect(stock).toBe(9); }
});
