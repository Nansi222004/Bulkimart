import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import axios from 'axios';
import jwt from 'jsonwebtoken';
const notify = jest.fn(async()=>({_id:'fixture-notification'}));
jest.unstable_mockModule('../../services/notification.service.js',()=>({notifyRider:notify,notifyUser:jest.fn(async()=>{}),notifySeller:jest.fn(async()=>{}),notifyAllAdmins:jest.fn(async()=>{}),NOTIFICATION_EVENT:{RIDER_ASSIGNED:'RIDER_ASSIGNED'}}));
jest.unstable_mockModule('../../socket/rooms.js',()=>({emitToRider:jest.fn(),emitToUser:jest.fn(),emitToSeller:jest.fn()}));
const [{assignDeliveryPartner,getManualAssignmentQueue,setStorePickupLocation},{acceptOrder,getActiveDelivery},{errorHandler},{default:Order},{default:Seller},{default:DeliveryPartner},{default:User},{default:Delivery}] = await Promise.all([
  import('../../controllers/deliveryAssignment.controller.js'),import('../../controllers/deliveryPartner.controller.js'),import('../../middlewares/error.middleware.js'),import('../../models/Order.js'),import('../../models/Seller.js'),import('../../models/DeliveryPartner.js'),import('../../models/User.js'),import('../../models/Delivery.js')]);
const {storePickup,pickupCoordinates}=await import('../../services/storePickup.service.js');
const {reconcileDeliveryPhoneIndex}=await import('../../services/deliveryIndexCompatibility.service.js');
const {releaseIncompleteDeliveryClaim}=await import('../../services/incompleteDeliveryClaim.service.js');
const {createShiprocketShipment,getFulfillmentOptions}=await import('../../controllers/fulfillment.controller.js');
const {broadcastNewOrderToRiders,getPendingDeliveryOrders}=await import('../../controllers/deliveryPartner.controller.js');
const {protect,requireAdmin}=await import('../../middlewares/auth.middleware.js');
let db,order,seller,rider,user;
const app=express();app.use(express.json());
app.use((req,res,next)=>{req.user=user;req.partner=rider;next();});
app.get('/queue',getManualAssignmentQueue);app.post('/assign/:id',assignDeliveryPartner);app.patch('/pin/:id',setStorePickupLocation);app.post('/accept/:id',acceptOrder);app.get('/active',getActiveDelivery);app.use(errorHandler);
app.post('/shipment/:id',(req,res,next)=>{req.seller=seller;next();},createShiprocketShipment);
app.get('/options/:id',(req,res,next)=>{req.seller=seller;next();},getFulfillmentOptions);
app.get('/available',getPendingDeliveryOrders);
app.patch('/admin-pin/:id',protect,requireAdmin,setStorePickupLocation);
app.use(errorHandler);
beforeAll(async()=>{process.env.SHIPROCKET_MODE='mock';db=await MongoMemoryReplSet.create({replSet:{count:1}});await mongoose.connect(db.getUri('isolated_delivery_location'));});
afterAll(async()=>{await mongoose.disconnect();await db?.stop();});
beforeEach(async()=>{
  process.env.SHIPROCKET_MODE='mock';
  notify.mockReset().mockResolvedValue({_id:'fixture-notification'});
  for(const collection of Object.values(mongoose.connection.collections))await collection.deleteMany({});
  user=await User.create({name:'Fixture Rider',phone:'9800000071',roles:['delivery']});
  const vendor=await User.create({phone:'9800000072',roles:['seller']});
  seller=await Seller.create({userId:vendor._id,businessName:'Actual order store',status:'approved',storeDetails:{address:'Actual store street',city:'Mumbai',pincode:'400001',lat:19,lng:72}});
  rider=await DeliveryPartner.create({userId:user._id,status:'approved',isAvailable:true,baseLocation:{lat:19,lng:72},zones:['400001']});
  order=await Order.create({userId:user._id,type:'grocery',status:'dispatched',deliveryType:'internal',paymentMethod:'cod',vendorDecision:{status:'accepted'},items:[{productId:new mongoose.Types.ObjectId(),sellerId:seller._id,name:'Fixture beans',qty:1,price:100}],shippingAddress:{line1:'Fixture customer street',pincode:'400001',lat:19.01,lng:72.01},pricing:{subtotal:100,deliveryCharge:40,totalAmount:140}});
});
afterEach(()=>jest.restoreAllMocks());
const assign=()=>request(app).post('/assign/'+order._id).send({partnerId:String(rider._id)});
test.each(['flat','point'])('valid %s store coordinates permit manual assignment and preserve financial/status values',async format=>{
  if(format==='point')await Seller.collection.updateOne({_id:seller._id},{$unset:{'storeDetails.lat':'','storeDetails.lng':''},$set:{'storeDetails.point':{type:'Point',coordinates:[72,19]}}});
  const before=await Order.findById(order._id);const result=await assign().expect(200);const delivery=await Delivery.findById(result.body.data.deliveryId);const saved=await Order.findById(order._id);
  expect(delivery.pickupLocation).toMatchObject({lat:19,lng:72});expect(delivery.dropLocation).toMatchObject({lat:19.01,lng:72.01});expect(saved.status).toBe('dispatched');expect(saved.pricing.toObject()).toEqual(before.pricing.toObject());expect(saved.shiprocket?.shipmentId).toBeUndefined();expect(notify).toHaveBeenCalledTimes(1);
  await assign().expect(200);expect(await Delivery.countDocuments()).toBe(1);expect(notify).toHaveBeenCalledTimes(1);
});
test('simultaneous retries produce one assignment, one history entry and one notification',async()=>{
  const result=await Promise.all([assign(),assign()]);expect(result.every(row=>row.status===200)).toBe(true);expect(await Delivery.countDocuments()).toBe(1);expect((await Order.findById(order._id)).assignmentHistory).toHaveLength(1);expect(notify).toHaveBeenCalledTimes(1);
});

test('active delivery provides the assigned customer phone and removes access when the trip ends',async()=>{
  await Order.updateOne({_id:order._id},{$set:{'shippingAddress.name':'Fixture Customer','shippingAddress.phone':'+919876500001'}});
  expect((await request(app).get('/active').expect(200)).body.data).toBeNull();
  const assigned=await assign().expect(200);
  await Delivery.updateOne({_id:assigned.body.data.deliveryId},{$set:{status:'picked_up'}});
  const active=await request(app).get('/active').expect(200);
  expect(active.body.data).toMatchObject({orderId:String(order._id),customerName:'Fixture Customer',customerPhone:'+919876500001',step:'transit'});
  expect(active.body.data.otp).toBeUndefined();
  await Order.updateOne({_id:order._id},{$set:{status:'delivered'}});
  expect((await request(app).get('/active').expect(200)).body.data).toBeNull();
});

test('customer contact is not returned for another rider assignment',async()=>{
  await Order.updateOne({_id:order._id},{$set:{deliveryPartnerId:new mongoose.Types.ObjectId(),'shippingAddress.phone':'+919876500001'}});
  expect((await request(app).get('/active').expect(200)).body.data).toBeNull();
});
test('missing location names the actual store in queue and assignment error; saving a real pin enables retry',async()=>{
  await Seller.updateOne({_id:seller._id},{$unset:{'storeDetails.lat':'','storeDetails.lng':'','storeDetails.point':''}});
  const error=await assign().expect(409);expect(error.body.message).toMatch(/Actual order store.*map pin/);expect(await Delivery.countDocuments()).toBe(0);
  const queue=await request(app).get('/queue').expect(200);expect(queue.body.data.orders[0].pickupStore._id).toBe(String(seller._id));expect(queue.body.data.orders[0].pickupError).toMatch(/store profile/);
  await request(app).patch('/pin/'+seller._id).send({lat:0,lng:72}).expect(200);expect((await Seller.findById(seller._id)).storeDetails.address).toBe('Actual store street');await assign().expect(200);
});
test.each([{lat:null,lng:72},{lat:91,lng:72},{lat:19,lng:181},{lat:'',lng:72},{lat:true,lng:72}])('invalid coordinates are rejected: %j',async pin=>{
  await request(app).patch('/pin/'+seller._id).send(pin).expect(400);expect(await Delivery.countDocuments()).toBe(0);
});
test('wrong store and multi-store orders never borrow another store pin',async()=>{
  // Stored-data fixture: a raw write, because order item financial fields are immutable through the app.
  const other=await Seller.create({userId:new mongoose.Types.ObjectId(),businessName:'Unpinned actual store'});await Order.collection.updateOne({_id:order._id},{$set:{'items.0.sellerId':other._id}});await assign().expect(409);
  // Stored-data fixture: a raw write, because order item financial fields are immutable through the app.
  await Order.collection.updateOne({_id:order._id},{$push:{items:{sellerId:seller._id,name:'Other store',qty:1,price:10}}});await assign().expect(409);expect(await Delivery.countDocuments()).toBe(0);
});
test('rider accepts point-only pin and active delivery uses the saved pickup snapshot',async()=>{
  await Seller.collection.updateOne({_id:seller._id},{$unset:{'storeDetails.lat':'','storeDetails.lng':''},$set:{'storeDetails.point':{type:'Point',coordinates:[72,19]}}});
  await request(app).post('/accept/'+order._id).expect(200);expect((await Delivery.findOne()).pickupLocation.lat).toBe(19);
  await Seller.updateOne({_id:seller._id},{$set:{'storeDetails.lat':20,'storeDetails.lng':73,'storeDetails.point':{type:'Point',coordinates:[73,20]}}});
  const active=await request(app).get('/active').expect(200);expect(active.body.data.merchantLocation).toEqual({lat:19,lng:72});
});
test('acceptance blocks missing or invalid pins before claiming the order',async()=>{
  await Seller.updateOne({_id:seller._id},{$unset:{'storeDetails.lat':'','storeDetails.lng':''}});await request(app).post('/accept/'+order._id).expect(409);expect((await Order.findById(order._id)).deliveryPartnerId).toBeFalsy();expect(await Delivery.countDocuments()).toBe(0);
});
test('offline/inactive riders, courier orders and invalid customer pins stay blocked',async()=>{
  await DeliveryPartner.updateOne({_id:rider._id},{$set:{isAvailable:false}});await assign().expect(409);await DeliveryPartner.updateOne({_id:rider._id},{$set:{isAvailable:true}});
  await User.updateOne({_id:user._id},{$set:{isActive:false}});await assign().expect(409);await User.updateOne({_id:user._id},{$set:{isActive:true}});
  await Order.updateOne({_id:order._id},{$set:{deliveryType:'shiprocket'}});await assign().expect(409);await request(app).post('/accept/'+order._id).expect(409);
  await Order.updateOne({_id:order._id},{$set:{deliveryType:'internal','shippingAddress.lat':91}});await assign().expect(409);expect(await Delivery.countDocuments()).toBe(0);
});
test('notification failure reports committed assignment safely and retry creates no duplicates',async()=>{
  notify.mockRejectedValueOnce(new Error('Fixture provider unavailable'));const result=await assign().expect(200);expect(result.body.data.notificationWarning).toMatch(/notification failed/);await assign().expect(200);expect(notify).toHaveBeenCalledTimes(1);expect(await Delivery.countDocuments()).toBe(1);
});
test('zero-valued coordinates and finite/range validation are explicit',()=>{
  expect(pickupCoordinates({lat:0,lng:0})).toEqual({lat:0,lng:0});expect(storePickup({storeDetails:{point:{type:'Point',coordinates:[0,19]}}})).toMatchObject({lat:19,lng:0});expect(pickupCoordinates({lat:NaN,lng:72})).toBeNull();expect(pickupCoordinates({lat:Infinity,lng:72})).toBeNull();
});

test('seller availability includes a nearby on-duty rider whose registered base has no coordinates',async()=>{
  await DeliveryPartner.updateOne({_id:rider._id},{$unset:{'baseLocation.lat':'','baseLocation.lng':'','baseLocation.point':''},$set:{currentLocation:{lat:19,lng:72,updatedAt:new Date()}}});
  await Order.updateOne({_id:order._id},{$set:{type:'ecommerce',status:'preparing','fulfillment.readyAt':new Date()}});
  const response=await request(app).get('/options/'+order._id).expect(200);
  expect(response.body.data.manual).toMatchObject({available:true,eligibleRiderCount:1,riders:[{name:'Fixture Rider',online:true}]});
});

test('nearby live GPS without a base pin is discoverable in offers, polling and rider acceptance',async()=>{
  await DeliveryPartner.updateOne({_id:rider._id},{$unset:{'baseLocation.lat':'','baseLocation.lng':'','baseLocation.point':''},$set:{currentLocation:{lat:19,lng:72,updatedAt:new Date()}}});
  rider=await DeliveryPartner.findById(rider._id);
  await Order.updateOne({_id:order._id},{$set:{type:'ecommerce','fulfillment.method':'manual'}});
  await broadcastNewOrderToRiders(order._id);
  const offered=await Order.findById(order._id);
  expect(offered.offerAttempts.some(attempt=>String(attempt.riderId)===String(rider._id))).toBe(true);
  const pending=await request(app).get('/available').expect(200);
  expect(pending.body.data.some(item=>String(item.orderId)===String(order._id))).toBe(true);
  await request(app).post('/accept/'+order._id).expect(200);
  expect(String((await Order.findById(order._id)).deliveryPartnerId)).toBe(String(rider._id));
});

test('legacy phone index failure rolls back acceptance, and verified index replacement permits a safe retry',async()=>{
  await Delivery.collection.createIndex({phone:1},{name:'phone_1',unique:true});
  try {
    await Delivery.create({partnerId:rider._id});
    await Order.updateOne({_id:order._id},{$set:{offerAttempts:[{riderId:rider._id,status:'OFFERED',offeredAt:new Date()}]}});
    const before=await Order.findById(order._id);
    await request(app).post('/accept/'+order._id).expect(409);
    const failed=await Order.findById(order._id);
    expect(failed.deliveryPartnerId).toBeFalsy();expect(failed.deliveryId).toBeFalsy();
    expect(failed.offerAttempts[0].status).toBe('OFFERED');expect(failed.timeline.length).toBe(before.timeline.length);
    expect(await Delivery.countDocuments({orderId:order._id})).toBe(0);
    expect(await reconcileDeliveryPhoneIndex(mongoose.connection.db)).toMatchObject({legacyPresent:true,applied:false});
    expect(await reconcileDeliveryPhoneIndex(mongoose.connection.db,{apply:true})).toMatchObject({legacyPresent:false,replacementVerified:true});
    const accepted=await request(app).post('/accept/'+order._id).expect(200);
    const repeated=await request(app).post('/accept/'+order._id).expect(200);
    expect(repeated.body.data.deliveryId).toBe(accepted.body.data.deliveryId);
    expect(await Delivery.countDocuments({orderId:order._id})).toBe(1);
    await Delivery.collection.insertOne({phone:'fixture-unique-phone'});
    await expect(Delivery.collection.insertOne({phone:'fixture-unique-phone'})).rejects.toMatchObject({code:11000});
  } finally {
    for(const name of ['phone_1','legacy_delivery_phone_unique_present'])await Delivery.collection.dropIndex(name).catch(()=>{});
  }
});

test('simultaneous retries from the same rider return one committed delivery',async()=>{
  const responses=await Promise.all([request(app).post('/accept/'+order._id),request(app).post('/accept/'+order._id)]);
  expect(responses.map(response=>response.status)).toEqual([200,200]);
  expect(responses[0].body.data.deliveryId).toBe(responses[1].body.data.deliveryId);
  expect(await Delivery.countDocuments({orderId:order._id})).toBe(1);
  expect((await Order.findById(order._id)).timeline.filter(event=>event.note.includes('assigned'))).toHaveLength(1);
});

test('maintenance releases only a claimed order with no delivery record, preserving price and status',async()=>{
  await Order.updateOne({_id:order._id},{$set:{deliveryPartnerId:rider._id,offerAttempts:[{riderId:rider._id,status:'ACCEPTED',respondedAt:new Date()}]}});
  const before=await Order.findById(order._id);
  expect(await releaseIncompleteDeliveryClaim(mongoose.connection.db,order._id)).toEqual({eligible:true,released:false});
  expect((await Order.findById(order._id)).deliveryPartnerId).toBeTruthy();
  const session=await mongoose.startSession();
  try {await session.withTransaction(async()=>{expect(await releaseIncompleteDeliveryClaim(mongoose.connection.db,order._id,{apply:true,session})).toEqual({eligible:true,released:true});});}
  finally {await session.endSession();}
  const after=await Order.findById(order._id);
  expect(after.deliveryPartnerId).toBeFalsy();expect(after.status).toBe(before.status);expect(after.pricing.toObject()).toEqual(before.pricing.toObject());
  expect(after.offerAttempts[0].status).toBe('OFFERED');expect(after.offerAttempts[0].respondedAt).toBeUndefined();
  expect(await releaseIncompleteDeliveryClaim(mongoose.connection.db,order._id,{apply:true})).toEqual({eligible:false,released:false});
});

test('maintenance never releases a claim that has an actual delivery record',async()=>{
  await request(app).post('/accept/'+order._id).expect(200);
  expect(await releaseIncompleteDeliveryClaim(mongoose.connection.db,order._id,{apply:true})).toEqual({eligible:false,released:false});
  expect((await Order.findById(order._id)).deliveryPartnerId).toBeTruthy();
});

test('pickup editor retains admin authorization',async()=>{
  await request(app).patch('/admin-pin/'+seller._id).send({lat:19,lng:72}).expect(401);
  const token=jwt.sign({id:String(user._id),type:'user',role:'delivery'},process.env.JWT_SECRET);
  await request(app).patch('/admin-pin/'+seller._id).set('Authorization','Bearer '+token).send({lat:19,lng:72}).expect(403);
});
const shipmentFixture=async()=>{
  Object.assign(process.env,{SHIPROCKET_MODE:'sandbox',SHIPROCKET_SANDBOX_BASE_URL:'https://isolated-provider.invalid',SHIPROCKET_SANDBOX_EMAIL:'shipment-fixture@example.invalid',SHIPROCKET_SANDBOX_PASSWORD:'fixture-secret',SHIPROCKET_SANDBOX_WEBHOOK_SECRET:'fixture-webhook',SHIPROCKET_SANDBOX_CONFIRMED:'true'});
  seller.thirdPartyFulfillment={enabled:true,shiprocketPickupLocation:'actual-store'};await seller.save();
  await Order.updateOne({_id:order._id},{$set:{type:'ecommerce',status:'preparing','items.0.weightSnapshot':500}});
  jest.spyOn(axios,'get').mockImplementation(async url=>({data:url.includes('/pickup')?{data:{shipping_address:[{pickup_location:'actual-store',pin_code:'400001',address:'Actual store street',status:2,phone_verified:1}]}}:{data:{available_courier_companies:[{courier_company_id:1,courier_name:'Fixture',rate:50}]}}}));
  return jest.spyOn(axios,'post').mockImplementation(async url=>({data:url.endsWith('/auth/login')?{token:'fixture-token'}:url.endsWith('/orders/create/adhoc')?{order_id:'101',shipment_id:'102'}:url.endsWith('/courier/assign/awb')?{response:{data:{awb_code:'SANDBOX-AWB',courier_name:'Fixture'}}}:url.endsWith('/label')?{label_url:'https://example.invalid/label'}:{pickup_status:1}}));
};
const shipment=()=>request(app).post('/shipment/'+order._id).send({confirm:true,quotedCourierCharge:50,package:{length:10,breadth:10,height:10}});
test('mocked provider success persists sandbox identity without shipping or changing customer money; retry is idempotent',async()=>{
  const post=await shipmentFixture();await shipment().expect(200);const saved=await Order.findById(order._id);
  expect(saved.status).toBe('preparing');expect(saved.shiprocket).toMatchObject({environment:'sandbox',shipmentId:'102',awb:'SANDBOX-AWB',status:'awb_assigned'});expect(saved.pricing.totalAmount).toBe(140);expect(saved.shiprocket.pickupScheduledAt).toBeTruthy();
  const calls=post.mock.calls.length;await shipment().expect(200);expect(post).toHaveBeenCalledTimes(calls);
  process.env.SHIPROCKET_MODE='mock';await shipment().expect(409);
});
test('mocked timeout after remote creation begins requires reconciliation and never marks shipped or retries creation',async()=>{
  const post=await shipmentFixture();post.mockImplementation(async url=>{if(url.endsWith('/auth/login'))return {data:{token:'fixture-token'}};throw new Error('Fixture timeout');});
  jest.spyOn(console,'error').mockImplementation(()=>{});await shipment().expect(502);const saved=await Order.findById(order._id);expect(saved.status).toBe('preparing');expect(saved.shiprocket.status).toBe('reconciliation_required');expect(saved.shiprocket.awb).toBeUndefined();
  await shipment().expect(409);expect(post.mock.calls.filter(([url])=>url.endsWith('/orders/create/adhoc'))).toHaveLength(1);
});
