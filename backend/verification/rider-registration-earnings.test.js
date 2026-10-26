import {jest} from '@jest/globals';
import express from 'express';
import request from 'supertest';
import mongoose from 'mongoose';
import {MongoMemoryServer} from 'mongodb-memory-server';
const notify=async()=>{};
jest.unstable_mockModule('../services/notification.service.js',()=>({notifyUser:notify,notifySeller:notify,notifyRider:notify,notifyAllAdmins:notify,NOTIFICATION_EVENT:{}}));
const [{default:routes},{default:Partner},{default:User},{default:Delivery},{default:Order},{errorHandler},{signSessionToken},docs]=await Promise.all([
  import('../routes/delivery.routes.js'),import('../models/DeliveryPartner.js'),import('../models/User.js'),import('../models/Delivery.js'),import('../models/Order.js'),
  import('../middlewares/error.middleware.js'),import('../config/jwt.js'),import('../shared/riderDocuments.mjs'),
]);
const app=express();app.use(express.json());app.use('/api/delivery',routes);app.use(errorHandler);
let db,user,partner;
const auth=()=> 'Bearer '+signSessionToken({id:String(user._id),type:'user',role:'delivery'});
beforeAll(async()=>{db=await MongoMemoryServer.create({binary:{version:'7.0.14'}});await mongoose.connect(db.getUri('rider-registration-earnings'),{autoIndex:false,autoCreate:false});});
afterAll(async()=>{await mongoose.disconnect();await db?.stop();});
beforeEach(async()=>{
  for (const collection of Object.values(mongoose.connection.collections)) await collection.deleteMany({});
  user=await User.create({phone:'9876500021',roles:['delivery']});
});

describe('vehicle and licence formats', () => {
  test.each(['MH31AB1234','mh 31 ab 1234','MH-31-AB-1234','DL3C1234','KA011234','22BH1234AB'])('accepts vehicle number %s', value => {
    expect(docs.vehicleNumberError(value,'bike')).toBe('');
  });
  test.each(['', 'TEST', '1234', 'MH31AB123', 'MH31ABCD1234', 'M31AB1234', '22BH123AB'])('rejects vehicle number %j', value => {
    expect(docs.vehicleNumberError(value,'car')).not.toBe('');
  });
  test('a bicycle needs an identifier but no plate format', () => {
    expect(docs.vehicleNumberError('FRAME 77','bicycle')).toBe('');
    expect(docs.vehicleNumberError('','bicycle')).not.toBe('');
  });
  test.each(['MH3120230001234','mh31 2023 0001234','MH-31-2023-0001234'])('accepts licence %s', value => {
    expect(docs.drivingLicenceError(value)).toBe('');
  });
  test.each(['', 'MH31AB1234', 'MH312023000123', 'MH3118230001234', '1131202300012345'])('rejects licence %j', value => {
    expect(docs.drivingLicenceError(value)).not.toBe('');
  });
});

describe('PUT /api/delivery/step/1', () => {
  beforeEach(async()=>{ partner=await Partner.create({userId:user._id,status:'incomplete',onboardingStep:1,drivingLicense:{url:'https://example.test/licence.jpg'}}); });
  const step1=body=>request(app).put('/api/delivery/step/1').set('Authorization',auth()).send(body);

  test('stores normalized numbers when both formats are valid', async()=>{
    await step1({vehicleType:'bike',vehicleNo:'mh 31 ab 1234',licenseNo:'MH31-2023-0001234'}).expect(200);
    const stored=await Partner.findById(partner._id);
    expect(stored.vehicleNo).toBe('MH31AB1234');expect(stored.drivingLicense.no).toBe('MH3120230001234');expect(stored.onboardingStep).toBe(2);
  });
  test('rejects a malformed vehicle number or licence and saves nothing', async()=>{
    const badPlate=await step1({vehicleType:'bike',vehicleNo:'TEST',licenseNo:'MH3120230001234'}).expect(400);
    expect(badPlate.body.message).toMatch(/registration plate/);
    const badLicence=await step1({vehicleType:'car',vehicleNo:'MH31AB1234',licenseNo:'12345'}).expect(400);
    expect(badLicence.body.message).toMatch(/15-character licence/);
    const stored=await Partner.findById(partner._id);expect(stored.vehicleNo).toBeUndefined();expect(stored.onboardingStep).toBe(1);
  });
  test('a bicycle rider is not asked for a licence or a plate format', async()=>{
    await step1({vehicleType:'bicycle',vehicleNo:'frame 77'}).expect(200);
    expect((await Partner.findById(partner._id)).vehicleNo).toBe('FRAME77');
  });
});

describe('GET /api/delivery/earnings/summary', () => {
  const IST=5.5*3600*1000;
  const istMidnight=()=>{const ist=new Date(Date.now()+IST);return new Date(Date.UTC(ist.getUTCFullYear(),ist.getUTCMonth(),ist.getUTCDate())-IST);};
  beforeEach(async()=>{ partner=await Partner.create({userId:user._id,status:'approved',vehicleType:'bike',vehicleNo:'MH31AB1234'}); });
  const delivery=async(endTime,extra={})=>{
    const orderId=new mongoose.Types.ObjectId();
    await Order.collection.insertOne({_id:orderId,orderNo:`ORD-${orderId}`,paymentMethod:extra.cod?'cod':'online',pricing:{totalAmount:250}});
    return Delivery.collection.insertOne({orderId,partnerId:partner._id,status:'delivered',direction:'forward',endTime,partnerEarnings:extra.pay??40.5,partnerTip:extra.tip??0,...extra.doc});
  };

  test('totals today and this week from completed deliveries, in India time', async()=>{
    const today=istMidnight();
    await delivery(new Date(Date.now()-60*1000),{pay:50.25,tip:10,cod:true});
    await delivery(new Date(today.getTime()+1000),{pay:30.1});
    await delivery(new Date(today.getTime()-1000),{pay:999});              // yesterday (IST): not today
    await delivery(new Date(Date.now()-120*1000),{pay:70,doc:{status:'rejected'}}); // not completed
    await Delivery.collection.insertOne({orderId:new mongoose.Types.ObjectId(),partnerId:new mongoose.Types.ObjectId(),status:'delivered',endTime:new Date(),partnerEarnings:500}); // another rider

    const res=await request(app).get('/api/delivery/earnings/summary').set('Authorization',auth()).expect(200);
    const {daily,weekly}=res.body.data;
    expect(daily).toMatchObject({trips:2,total:80.35,tips:10});
    expect(daily.breakdown[0]).toMatchObject({type:'Delivery',amount:50.25,tip:10,isCod:true,codAmount:250});
    const weekdayIndex=(new Date(Date.now()+IST).getUTCDay()+6)%7;
    // Yesterday only counts toward this week when today is not Monday.
    expect(weekly.trips).toBe(weekdayIndex===0?2:3);
    expect(weekly.days).toHaveLength(7);
    expect(weekly.days[weekdayIndex].amount).toBe(80.35);
    expect(weekly.days.reduce((sum,day)=>sum+Math.round(day.amount*100),0)).toBe(Math.round(weekly.total*100));
  });

  test('an unapproved rider cannot read a summary', async()=>{
    await Partner.updateOne({_id:partner._id},{$set:{status:'pending'}});
    await request(app).get('/api/delivery/earnings/summary').set('Authorization',auth()).expect(403);
  });
});
