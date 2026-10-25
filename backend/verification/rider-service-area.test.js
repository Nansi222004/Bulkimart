import {jest} from '@jest/globals';
import express from 'express';
import request from 'supertest';
import mongoose from 'mongoose';
import {MongoMemoryServer} from 'mongodb-memory-server';
const notify=async()=>{};
jest.unstable_mockModule('../services/notification.service.js',()=>({notifyUser:notify,notifySeller:notify,notifyRider:notify,notifyAllAdmins:notify,NOTIFICATION_EVENT:{}}));
const [{default:routes},{default:Partner},{default:User},{errorHandler},{signSessionToken}]=await Promise.all([
  import('../routes/delivery.routes.js'),import('../models/DeliveryPartner.js'),import('../models/User.js'),import('../middlewares/error.middleware.js'),import('../config/jwt.js'),
]);
const app=express();app.use(express.json());app.use('/api/delivery',routes);app.use(errorHandler);
let db,user,partner,other;
beforeAll(async()=>{db=await MongoMemoryServer.create({binary:{version:'7.0.14'}});await mongoose.connect(db.getUri('rider-area-isolated'),{autoIndex:false,autoCreate:false});});
afterAll(async()=>{await mongoose.disconnect();await db?.stop();});
beforeEach(async()=>{
  await Partner.deleteMany({});await User.deleteMany({});
  [user,other]=await User.create([{phone:'9876500013',roles:['delivery']},{phone:'9876500014',roles:['delivery']}]);
  partner=await Partner.create({userId:user._id,status:'approved',zones:['456001','452015'],isAvailable:true,vehicleType:'bike',vehicleNo:'TEST',bankDetails:{accountNo:'12345678'},aadhaar:{number:'XXXX-XXXX-1234'},deliveryRadiusKm:5});
});
const save=(input,as=user)=>request(app).put('/api/delivery/service-area').set('Authorization','Bearer '+signSessionToken({id:String(as._id),type:'user',role:'delivery'})).send(input);
test('approved rider saves normalized pincodes after registration; approval, KYC, money and duty stay intact',async()=>{
  const result=await save({zones:'456001, 452015, 452001, 452006, 452001',version:0}).expect(200);
  expect(result.body.data).toEqual({zones:['456001','452015','452001','452006'],version:1});
  const stored=await Partner.findById(partner._id);
  expect(stored.zones).toEqual(result.body.data.zones);expect(stored.status).toBe('approved');expect(stored.isAvailable).toBe(true);expect(stored.vehicleNo).toBe('TEST');expect(stored.aadhaar.number).toBe('XXXX-XXXX-1234');expect(stored.bankDetails.accountNo).toBe('12345678');expect(stored.deliveryRadiusKm).toBe(5);
});
test.each([{}, {zones:[],version:0},{zones:'45200',version:0},{zones:'452001,abc',version:0},{zones:[452001],version:0},{zones:['452001'],version:-1},{zones:['452001'],version:'0'},{zones:Array.from({length:51},(_,i)=>String(452000+i)),version:0},{zones:['452001'],version:0,status:'approved'},{zones:['452001'],version:0,bankDetails:{}},{zones:['452001'],version:0,partnerId:'someone-else'}])('invalid or unrelated fields never change the profile: %j',async input=>{
  await save(input).expect(400);const stored=await Partner.findById(partner._id);expect(stored.zones).toEqual(['456001','452015']);expect(stored.__v).toBe(0);
});
test('unauthenticated requests fail and another account cannot edit this rider',async()=>{
  await request(app).put('/api/delivery/service-area').send({zones:['452001'],version:0}).expect(401);
  await save({zones:['452001'],version:0},other).expect(404);expect((await Partner.findById(partner._id)).zones).toEqual(['456001','452015']);
});
test('stale and concurrent changes cannot silently overwrite another save',async()=>{
  const results=await Promise.all([save({zones:['452001'],version:0}),save({zones:['452006'],version:0})]);expect(results.map(r=>r.status).sort()).toEqual([200,409]);
  await save({zones:['452015'],version:0}).expect(409);expect((await Partner.findById(partner._id)).__v).toBe(1);
});
test('service area edits preserve a rider active parcel reservation',async()=>{
  const bookingId=new mongoose.Types.ObjectId();await Partner.updateOne({_id:partner._id},{$set:{isAvailable:false,parcelReservation:{bookingId,previousDuty:true}}});
  await save({zones:['452001','452006'],version:0}).expect(200);const stored=await Partner.findById(partner._id);
  expect(String(stored.parcelReservation.bookingId)).toBe(String(bookingId));expect(stored.isAvailable).toBe(false);
});
test('adding the Indore pickup and drop pincodes makes an otherwise eligible rider eligible for that parcel',async()=>{
  const {eligibleParcelRider}=await import('../services/parcelAssignment.service.js');
  await Partner.updateOne({_id:partner._id},{$set:{currentLocation:{lat:22.74,lng:75.84,updatedAt:new Date()}}});
  const parcel={_id:new mongoose.Types.ObjectId(),pricing:{policy:{locationMaxAgeSeconds:300,assignmentRadiusKm:5,maxActiveTasks:1}},details:{pickup:{pincode:'452001',lat:22.74,lng:75.84},dropoff:{pincode:'452006'}}};
  expect(await eligibleParcelRider(await Partner.findById(partner._id),parcel)).toBe(false);
  await save({zones:['456001','452015','452001','452006'],version:0}).expect(200);
  expect(await eligibleParcelRider(await Partner.findById(partner._id),parcel)).toBe(true);
});
const presence=input=>request(app).put('/api/delivery/presence').set('Authorization','Bearer '+signSessionToken({id:String(user._id),type:'user',role:'delivery'})).send(input);
test('on-duty heartbeat refreshes live GPS without changing the base address, zones or duty',async()=>{
  await Partner.updateOne({_id:partner._id},{$set:{baseLocation:{address:'Original base',pincode:'452006',lat:22.70,lng:75.80},currentLocation:{lat:0,lng:0,updatedAt:new Date(0)}}});
  await presence({lat:22.74,lng:75.84,source:'gps',isAvailable:false,zones:['000000'],address:'Must not replace base'}).expect(200);
  const saved=await Partner.findById(partner._id);expect(saved.currentLocation.lat).toBe(22.74);expect(Date.now()-saved.currentLocation.updatedAt.getTime()).toBeLessThan(10000);expect(saved.baseLocation.address).toBe('Original base');expect(saved.zones).toEqual(['456001','452015']);expect(saved.isAvailable).toBe(true);
});
test.each([{}, {lat:22.74},{lat:95,lng:75.84},{lat:'invalid',lng:75.84}])('presence requires a valid coordinate pair: %j',async input=>{await presence(input).expect(400);});
test('suspended riders cannot heartbeat their way back into eligibility',async()=>{
  await Partner.updateOne({_id:partner._id},{$set:{status:'suspended',isAvailable:false}});await presence({lat:22.74,lng:75.84}).expect(403);expect((await Partner.findById(partner._id)).isAvailable).toBe(false);
});
