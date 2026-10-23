// Strict release gate for an existing shopping-only capacity race. This test
// intentionally remains failing until the original order capacity bug is fixed
// in its own reviewed change; the same test runs against clean HEAD sources.
import {jest} from '@jest/globals';
import mongoose from 'mongoose';
import express from 'express';
import request from 'supertest';
import {MongoMemoryReplSet} from 'mongodb-memory-server';
const notify=async()=>{};
jest.unstable_mockModule('../services/notification.service.js',()=>({notifyUser:notify,notifySeller:notify,notifyRider:notify,notifyAllAdmins:notify,NOTIFICATION_EVENT:{}}));
jest.unstable_mockModule('../socket/rooms.js',()=>({emitToUser:notify,emitToSeller:notify,emitToRider:notify,emitToAdmins:notify,broadcastToRiders:notify}));
const [{default:Order},{default:Delivery},{default:Partner},{default:User},{default:Seller},{acceptOrder},{errorHandler}]=await Promise.all([
  import('../models/Order.js'),import('../models/Delivery.js'),import('../models/DeliveryPartner.js'),import('../models/User.js'),import('../models/Seller.js'),import('../controllers/deliveryPartner.controller.js'),import('../middlewares/error.middleware.js'),
]);
let db,driver,partner;
const app=express();app.use(express.json());
app.post('/orders/:id/accept',async(req,_res,next)=>{try{req.user=driver;req.userType='user';req.partner=await Partner.findById(partner._id);next();}catch(e){next(e);}},acceptOrder);app.use(errorHandler);
beforeAll(async()=>{
  process.env.RIDER_MAX_CONCURRENT_DELIVERIES='1';process.env.PARCEL_DELIVERY_FULFILMENT_ENABLED='false';
  db=await MongoMemoryReplSet.create({binary:{version:'7.0.14'},replSet:{count:1}});await mongoose.connect(db.getUri('shopping-capacity-isolated'));
  for(const m of [Order,Delivery,Partner,User,Seller])await m.init();
});
afterAll(async()=>{delete process.env.RIDER_MAX_CONCURRENT_DELIVERIES;delete process.env.PARCEL_DELIVERY_FULFILMENT_ENABLED;await mongoose.disconnect();await db?.stop();});
test('release blocker: two concurrent shopping accepts must respect RIDER_MAX_CONCURRENT_DELIVERIES=1',async()=>{
  driver=await User.create({phone:'9876500099',roles:['delivery']});partner=await Partner.create({userId:driver._id,status:'approved',isAvailable:true});
  const sellerId=new mongoose.Types.ObjectId();await Seller.collection.insertOne({_id:sellerId,userId:new mongoose.Types.ObjectId(),businessName:'Synthetic capacity fixture',storeDetails:{name:'Fixture store',address:'Fixture',city:'Fixture',pincode:'560001',lat:12.97,lng:77.59}});
  const make=()=>Order.create({userId:driver._id,type:'grocery',paymentMethod:'cod',deliveryType:'internal',status:'dispatched',items:[{sellerId,name:'Synthetic product',qty:1,price:10}],shippingAddress:{name:'Fixture',line1:'Fixture',pincode:'560001',lat:12.98,lng:77.60},pricing:{totalAmount:10}});
  const a=await make(),b=await make();let arrived,resume;
  const paused=new Promise(r=>arrived=r),release=new Promise(r=>resume=r),create=Delivery.create.bind(Delivery);
  const spy=jest.spyOn(Delivery,'create').mockImplementation(async(...args)=>{const result=await create(...args);if(String(args[0]?.[0]?.orderId)===String(a._id)){arrived();await release;}return result;});
  const first=request(app).post(`/orders/${a._id}/accept`).send({}).then(r=>r);
  try{
    await Promise.race([paused,first.then(r=>{throw Error(`First acceptance ended before barrier: ${r.status} ${r.body.message||''}`);})]);
    const second=await request(app).post(`/orders/${b._id}/accept`).send({});resume();const result=await first;
    expect([200,409]).toContain(second.status);expect([200,409]).toContain(result.status);
    const active=await Order.countDocuments({deliveryPartnerId:partner._id,status:'dispatched'});
    expect(active).toBeLessThanOrEqual(1);
  }finally{resume();await first;spy.mockRestore();}
});
