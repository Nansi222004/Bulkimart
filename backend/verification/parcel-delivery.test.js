import {jest} from '@jest/globals';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import {MongoMemoryReplSet} from 'mongodb-memory-server';
import {fork} from 'node:child_process';
let orders=new Map(),payments=new Map(),refunds=new Map(),uncertain=false,routeAvailable=true,refundUnknown=false;
const sdk={orders:{create:jest.fn(async input=>{const row={id:`order_${orders.size+1}`,...input};orders.set(row.id,row);if(uncertain)throw Error('Synthetic lost response');return row;}),fetch:async id=>orders.get(id),all:async()=>({items:[...orders.values()]}),fetchPayments:async id=>({items:[...payments.values()].filter(x=>x.order_id===id)})},payments:{fetch:async id=>payments.get(id),refund:jest.fn(async(id,input)=>{const row={id:`rfnd_${refunds.size+1}`,payment_id:id,currency:'INR',status:'processed',...input};refunds.set(row.id,row);payments.get(id).amount_refunded=(payments.get(id).amount_refunded||0)+row.amount;if(refundUnknown)throw Error('Synthetic uncertain refund transport');return row;})},refunds:{fetch:async id=>refunds.get(id),all:async input=>({items:[...refunds.values()].filter(x=>x.payment_id===input.payment_id)})}};
jest.unstable_mockModule('razorpay',()=>({default:class{constructor(){return sdk;}}}));
const notify=jest.fn(async()=>{});
jest.unstable_mockModule('../services/notification.service.js',()=>({notifyUser:notify,notifyRider:notify,notifyAllAdmins:notify,notifySeller:notify,notifyAdmin:notify,NOTIFICATION_EVENT:{}}));
jest.unstable_mockModule('../services/maps.service.js',()=>({getRoute:async()=>{if(!routeAvailable)throw Error('No live directions');return {distanceKm:5.2,durationMin:18,polyline:'synthetic-polyline'};}}));
const [{customerParcelRouter,adminParcelRouter,driverParcelRouter},{default:Parcel},{default:Quote},{default:Policy},{default:Partner},{default:User},{default:Admin},{default:Payment},{default:Ledger},{default:Order},{default:Delivery},{errorHandler},{JWT_SECRET},policy,workflow,assignment,{razorpayWebhook},{riderIneligibility}]=await Promise.all([
  import('../routes/parcelDelivery.routes.js'),import('../models/ParcelDelivery.js'),import('../models/ParcelQuote.js'),import('../models/ParcelPolicy.js'),import('../models/DeliveryPartner.js'),import('../models/User.js'),import('../models/Admin.js'),import('../models/Payment.js'),import('../models/SellerLedgerEntry.js'),import('../models/Order.js'),import('../models/Delivery.js'),import('../middlewares/error.middleware.js'),import('../config/jwt.js'),import('../services/parcelPolicy.service.js'),import('../services/parcelWorkflow.service.js'),import('../services/parcelAssignment.service.js'),import('../controllers/payment.controller.js'),import('../services/riderEligibility.service.js'),
]);
const app=express();app.set('trust proxy',1);app.use(express.json({verify:(req,_res,buf)=>{req.rawBody=Buffer.from(buf);}}));app.use('/c',customerParcelRouter);app.use('/a',adminParcelRouter);app.use('/d',driverParcelRouter);app.post('/webhook',razorpayWebhook);app.use(errorHandler);
let testNetwork=0;
let db,customer,other,driver,driver2,partner,partner2,admin,limited,ops;
const fixture=()=>({approvalReference:'SYNTHETIC TEST POLICY ONLY',terms:'Synthetic admin-reviewed cancellation and delivery failure terms; exact cash at delivery. No production approval.',effectiveAt:'2020-01-01',categories:['test_documents'],prohibitedItems:['synthetic_restricted'],areas:[{name:'Synthetic test area',pincodes:['560001'],lat:12.97,lng:77.59,radiusKm:10}],basePaise:1000,perKmPaise:200,minimumPaise:1000,maximumPaise:10000,driverBasePaise:500,driverPerKmPaise:100,quoteSeconds:300,acceptanceSeconds:30,maxAttempts:2,maxActiveTasks:1,locationMaxAgeSeconds:300,maxWeightKg:5,maxDimensionCm:50,assignmentRadiusKm:5,maxRouteKm:20,taxTreatment:'inclusive',taxRateBps:0,surcharges:'none',cancellationMode:'admin_review',failureMode:'admin_review',cashCollectionPoint:'delivery',partialCash:false,payDriverEnabled:true,payDriverCategories:['test_documents']});
const details=()=>({pickup:{address:'Private pickup fixture',name:'Sender',phone:'9876500011',pincode:'560001',lat:12.97,lng:77.59},dropoff:{address:'Private dropoff fixture',name:'Recipient',phone:'9876500012',pincode:'560001',lat:12.98,lng:77.60},category:'test_documents',description:'Synthetic parcel',weightKg:1,dimensions:[10,10,10],acceptRestrictions:true});
function auth(r,u=customer,type='user',role='buyer'){return r.set('X-Forwarded-For',`192.0.2.${testNetwork}`).set('Authorization',`Bearer ${jwt.sign({id:String(u._id),type,...(type==='user'?{role}:{})},JWT_SECRET)}`);}
const adm=r=>auth(r,admin,'admin'),drv=(r,second=false)=>auth(r,second?driver2:driver,'user','delivery');
beforeAll(async()=>{
  db=await MongoMemoryReplSet.create({binary:{version:'7.0.14'},replSet:{count:1}});await mongoose.connect(db.getUri('parcel-readiness-isolated'));
  for(const m of [Parcel,Quote,Policy,Partner,User,Admin,Payment,Ledger,Order,Delivery]){await m.createCollection();await m.createIndexes();}
});
afterAll(async()=>{await mongoose.disconnect();await db?.stop();});
beforeEach(async()=>{
  testNetwork++;
  for(const c of Object.values(mongoose.connection.collections))await c.deleteMany({});
  orders.clear();payments.clear();refunds.clear();uncertain=false;routeAvailable=true;refundUnknown=false;jest.clearAllMocks();
  process.env.PAYMENT_GATEWAY='razorpay';process.env.RAZORPAY_MODE='test';process.env.RAZORPAY_KEY_ID='rzp_test_parcel_isolated';process.env.RAZORPAY_KEY_SECRET='isolated-secret';process.env.RAZORPAY_WEBHOOK_SECRET='isolated-webhook';delete process.env.DEPLOYMENT_ENV;process.env.NODE_ENV='test';
  for(const k of policy.flagNames)delete process.env[`PARCEL_DELIVERY_${k.toUpperCase()}_ENABLED`];
  [customer,other,driver,driver2]=await User.create([{phone:'9876500011',roles:['buyer']},{phone:'9876500012',roles:['buyer']},{phone:'9876500013',roles:['delivery']},{phone:'9876500014',roles:['delivery']}]);
  [partner,partner2]=await Partner.create([driver,driver2].map((u,i)=>({userId:u._id,status:'approved',isAvailable:true,zones:['560001'],currentLocation:{lat:12.97+i*.001,lng:77.59,updatedAt:new Date()}})));
  const ids=[0,1,2].map(()=>new mongoose.Types.ObjectId());await Admin.collection.insertMany(ids.map((id,i)=>({_id:id,email:`parcel-${i}@example.test`,name:'Synthetic admin',password:'synthetic',role:i===0?'superAdmin':'admin',permissions:i===2?['manage_orders']:[],isActive:true})));
  [admin,limited,ops]=await Promise.all(ids.map(id=>Admin.findById(id)));
  await adm(request(app).post('/a/policy')).send({version:0,config:fixture()}).expect(200);
});
const q=async input=>(await auth(request(app).post('/c/quotes')).send(input||details()).expect(201)).body.data;

test.each([
  ['pickup', {pincode:'452006'}, /Pickup.*pincode 452006 is not approved/],
  ['dropoff', {pincode:'452006'}, /Drop.*pincode 452006 is not approved/],
  ['pickup', {lat:22.72,lng:75.85}, /Pickup.*pin is outside the coverage radius/],
  ['dropoff', {lat:22.72,lng:75.85}, /Drop.*pin is outside the coverage radius/],
])('coverage rejection identifies %s and distinguishes pincode approval from pin radius: %j',async(field,patch,message)=>{
  const input=details();input[field]={...input[field],...patch};
  const result=await auth(request(app).post('/c/quotes')).send(input).expect(400);
  expect(result.body.message).toMatch(message);
  expect(await Quote.countDocuments()).toBe(0);expect(await Parcel.countDocuments()).toBe(0);
});
async function booking(method='pay_driver',key=crypto.randomUUID(),quote){const quoteRow=quote||await q();return (await auth(request(app).post('/c/bookings')).set('Idempotency-Key',key).send({quoteId:quoteRow._id,policyVersion:1,paymentMethod:method,acceptTerms:true}).expect(201)).body.data;}
const adminDetail=async id=>(await adm(request(app).get(`/a/bookings/${id}`)).expect(200)).body.data;
const driverDetail=async(id,second=false)=>(await drv(request(app).get(`/d/bookings/${id}`),second).expect(200)).body.data;
async function accept(b,second=false){const d=await driverDetail(b._id,second);return (await drv(request(app).post(`/d/bookings/${b._id}/offer`),second).send({action:'accept',version:d.version,token:d.offer.token}).expect(200)).body.data;}
async function dact(b,action,extra={}){const d=await driverDetail(b._id);return (await drv(request(app).post(`/d/bookings/${b._id}/actions`)).send({action,version:d.version,...extra}).expect(r=>{if(r.status!==200)throw Error(JSON.stringify({action,status:r.status,body:r.body}));}).expect(200)).body.data;}
async function aact(b,action,extra={}){const d=await adminDetail(b._id);return (await adm(request(app).post(`/a/bookings/${b._id}/actions`)).send({action,version:d.version,reason:'Synthetic authorized review',...extra}).expect(200)).body.data;}
async function checkout(b,key=crypto.randomUUID()){return (await auth(request(app).post(`/c/bookings/${b._id}/payment`)).set('Idempotency-Key',key).send({policyVersion:1,acceptTerms:true}).expect(200)).body.data;}
function capture(c,id='pay_parcel'){const row={id,order_id:c.razorpayOrderId,amount:c.amountPaise,currency:'INR',status:'captured',captured:true,amount_refunded:0};payments.set(id,row);return row;}
async function verify(b,c,id='pay_parcel'){const signature=crypto.createHmac('sha256',process.env.RAZORPAY_KEY_SECRET).update(`${c.razorpayOrderId}|${id}`).digest('hex');return auth(request(app).post('/c/payments/verify')).send({orderId:b._id,razorpay_order_id:c.razorpayOrderId,razorpay_payment_id:id,razorpay_signature:signature});}
async function webhook(body,valid=true){const raw=JSON.stringify(body),signature=crypto.createHmac('sha256',process.env.RAZORPAY_WEBHOOK_SECRET).update(raw).digest('hex');return request(app).post('/webhook').set('Content-Type','application/json').set('x-razorpay-signature',valid?signature:'invalid').send(raw);}
async function paid(){const b=await booking('online'),c=await checkout(b);capture(c);expect((await verify(b,c)).status).toBe(200);await assignment.assignParcel(b._id);return adminDetail(b._id);}
async function toDrop(b){await accept(b);await dact(b,'driver_arriving');await dact(b,'arrived_at_pickup');await dact(b,'pickup_code');const customerView=(await auth(request(app).get(`/c/bookings/${b._id}`)).expect(200)).body.data;await dact(b,'verify_pickup',{code:customerView.pickupCode});await dact(b,'in_transit');await dact(b,'arrived_at_dropoff');}

test.each([undefined,'false'])('parcel capabilities stay enabled with legacy switches %s; production remains blocked',value=>{
  for(const k of policy.flagNames){const name=`PARCEL_DELIVERY_${k.toUpperCase()}_ENABLED`;if(value===undefined)delete process.env[name];else process.env[name]=value;}
  expect(Object.values(policy.parcelFlags()).every(x=>x===true)).toBe(true);
  for(const k of policy.flagNames)expect(()=>policy.requireParcel(k)).not.toThrow();
  expect(()=>policy.requireParcelGateway()).not.toThrow();
  process.env.DEPLOYMENT_ENV='production';expect(()=>policy.requireParcel('booking')).toThrow(/release-blocked/);
});
test('live gateway keys cannot execute parcel payments',()=>{process.env.RAZORPAY_KEY_ID='rzp_live_forbidden';expect(()=>policy.requireParcelGateway()).toThrow(/test mode/);});
test('policy requires explicit approved values and rejects unsupported tax, surcharge and cash combinations',()=>{
  for(const change of [{basePaise:-1},{areas:[]},{surcharges:'automatic'},{taxTreatment:'exempt'},{partialCash:true},{cashCollectionPoint:'unsupported'},{payDriverCategories:['unknown']}])expect(()=>policy.validateParcelPolicy({...fixture(),...change})).toThrow();
});
test('server computes frozen fare, ignores supplied fare/distance/driver and uses road provider',async()=>{
  const row=await q({...details(),amountPaise:1,distanceKm:1,partnerId:partner2._id});expect(row.pricing.totalPaise).toBe(2040);expect(row.pricing.distanceMetres).toBe(5200);expect(row.pricing).not.toHaveProperty('driverPaise');
  expect(row.route).toEqual({distanceMetres:5200,durationSeconds:1080,polyline:'synthetic-polyline'});expect(row.service).toMatchObject({id:'parcel',name:'Doorstep delivery',maxWeightKg:5});
  const b=await booking('pay_driver',crypto.randomUUID(),row);expect(b.feePaise).toBe(2040);expect(await Order.countDocuments()).toBe(0);expect(await Delivery.countDocuments()).toBe(0);
  expect(b.route).toEqual({distanceMetres:5200});expect(b).not.toHaveProperty('pricing');expect(b).not.toHaveProperty('requestHash');
  expect((await Quote.findById(row._id)).pricing).not.toHaveProperty('route');
  expect((await Parcel.findById(b._id)).pricing).not.toHaveProperty('route');
});
test('no effective policy or verified route fails quotation closed',async()=>{routeAvailable=false;await auth(request(app).post('/c/quotes')).send(details()).expect(503);routeAvailable=true;await Policy.collection.deleteMany({});await auth(request(app).post('/c/quotes')).send(details()).expect(409);});
test('service area, size, category, coordinates and restriction validation',async()=>{
  for(const change of [{pickup:{...details().pickup,pincode:'999999'}},{weightKg:6},{dimensions:[10,60,10]},{category:'unknown'},{acceptRestrictions:false},{pickup:{...details().pickup,lat:91}}])await auth(request(app).post('/c/quotes')).send({...details(),...change}).expect(400);
});
test('expired, stale and foreign quotes cannot confirm',async()=>{
  const row=await q();await auth(request(app).post('/c/bookings'),other).set('Idempotency-Key',crypto.randomUUID()).send({quoteId:row._id,policyVersion:1,paymentMethod:'pay_driver',acceptTerms:true}).expect(404);
  await Quote.updateOne({_id:row._id},{$set:{expiresAt:new Date(0)}});await auth(request(app).post('/c/bookings')).set('Idempotency-Key',crypto.randomUUID()).send({quoteId:row._id,policyVersion:1,paymentMethod:'pay_driver',acceptTerms:true}).expect(409);
  const fresh=await q();await adm(request(app).post('/a/policy')).send({version:1,config:fixture()}).expect(200);await auth(request(app).post('/c/bookings')).set('Idempotency-Key',crypto.randomUUID()).send({quoteId:fresh._id,policyVersion:1,paymentMethod:'pay_driver',acceptTerms:true}).expect(409);
});
test('idempotent booking replays and changed key payload conflicts',async()=>{const row=await q(),key=crypto.randomUUID(),a=await booking('pay_driver',key,row),b=await booking('pay_driver',key,row);expect(a._id).toBe(b._id);expect(await Parcel.countDocuments()).toBe(1);await auth(request(app).post('/c/bookings')).set('Idempotency-Key',key).send({quoteId:row._id,policyVersion:1,paymentMethod:'online',acceptTerms:true}).expect(409);});
test('concurrent booking confirmations cannot create two bookings from one quote',async()=>{
  const row=await q(),key=crypto.randomUUID(),send=()=>auth(request(app).post('/c/bookings')).set('Idempotency-Key',key).send({quoteId:row._id,policyVersion:1,paymentMethod:'pay_driver',acceptTerms:true});const responses=await Promise.all([send(),send()]);expect(responses.some(r=>r.status===201)).toBe(true);expect(responses.every(r=>[201,409].includes(r.status))).toBe(true);expect(await Parcel.countDocuments()).toBe(1);
});
test('customer ownership, driver privacy and admin finance permission enforcement',async()=>{
  const b=await booking();await auth(request(app).get(`/c/bookings/${b._id}`),other).expect(404);await request(app).get('/c/bookings').expect(401);await drv(request(app).get('/c/bookings')).expect(403);await auth(request(app).get('/a/bookings'),limited,'admin').expect(403);await auth(request(app).get('/a/policy'),ops,'admin').expect(403);
  const second=await driverDetail(b._id,true);expect(JSON.stringify(second)).not.toMatch(/Private pickup|9876500011|pickupCode|requestHash/);const offer=await driverDetail(b._id);expect(JSON.stringify(offer)).not.toMatch(/Private pickup|9876500011|pickupCode|requestHash/);await accept(b);expect(JSON.stringify(await driverDetail(b._id))).toContain('Private pickup');await drv(request(app).get(`/d/bookings/${b._id}`),true).expect(404);
});
test('all eligible drivers receive offers and only acceptance reserves the winning rider',async()=>{const b=await booking();const row=await Parcel.findById(b._id);expect(row.assignment.offer.partnerIds).toEqual([String(partner._id),String(partner2._id)]);expect((await Partner.findById(partner._id)).isAvailable).toBe(true);expect((await Partner.findById(partner2._id)).isAvailable).toBe(true);await accept(b);const p=await Partner.findById(partner._id);expect(p.isAvailable).toBe(false);expect(riderIneligibility(p,driver,{},{})).toBe('parcel_reserved');expect((await Partner.findById(partner2._id)).isAvailable).toBe(true);});
test('suspended, inactive, offline and stale drivers are excluded with explicit admin fallback',async()=>{await Partner.updateOne({_id:partner._id},{$set:{status:'suspended'}});await Partner.updateOne({_id:partner2._id},{$set:{'currentLocation.updatedAt':new Date(0)}});const b=await booking();expect(b.status).toBe('needs_admin_assignment');const d=await adminDetail(b._id);expect(d.assignment.reason).toBe('no_eligible_driver');});
test('existing active orders exclude driver from parcel offers',async()=>{await Order.collection.insertOne({deliveryPartnerId:partner._id,status:'dispatched'});const b=await booking();expect((await Parcel.findById(b._id)).assignment.offer.partnerIds).toEqual([String(partner2._id)]);});
test('concurrent dispatch creates one broadcast and leaves riders available',async()=>{const b=await booking('online'),c=await checkout(b);capture(c);await verify(b,c);await Promise.all([assignment.assignParcel(b._id),assignment.assignParcel(b._id)]);const row=await Parcel.findById(b._id);expect(row.assignment.attempts).toHaveLength(2);expect(new Set(row.assignment.attempts.map(a=>a.token)).size).toBe(1);expect(await Partner.countDocuments({'parcelReservation.bookingId':row._id})).toBe(0);});
test('expired broadcast cannot be accepted; sweep rebroadcasts and respects the round limit',async()=>{const b=await booking(),old=await driverDetail(b._id);await Parcel.updateOne({_id:b._id},{$set:{'assignment.offer.expiresAt':new Date(0)}});await drv(request(app).post(`/d/bookings/${b._id}/offer`)).send({action:'accept',version:old.version,token:old.offer.token}).expect(409);await assignment.sweepParcelsOnce();let row=await Parcel.findById(b._id);expect(row.assignment.attempts[0].outcome).toBe('timeout');expect(row.assignment.offer.partnerIds).toEqual([String(partner._id),String(partner2._id)]);expect(row.assignment.offer.token).not.toBe(old.offer.token);await drv(request(app).post(`/d/bookings/${b._id}/offer`)).send({action:'accept',version:old.version,token:old.offer.token}).expect(409);await Parcel.updateOne({_id:b._id},{$set:{'assignment.offer.expiresAt':new Date(0)}});await assignment.sweepParcelsOnce();row=await Parcel.findById(b._id);expect(row.status).toBe('needs_admin_assignment');expect(row.assignment.reason).toBe('attempts_exhausted');expect((await Partner.findById(partner._id)).isAvailable).toBe(true);});
test('rejection retries and exhaustion enters admin queue; old driver cannot see next offer token',async()=>{const b=await booking(),d=await driverDetail(b._id);const response=await drv(request(app).post(`/d/bookings/${b._id}/offer`)).send({action:'reject',token:d.offer.token,version:d.version}).expect(200);expect(response.body.data).toEqual({status:'rejected'});const d2=await driverDetail(b._id,true);await drv(request(app).post(`/d/bookings/${b._id}/offer`),true).send({action:'reject',token:d2.offer.token,version:d2.version}).expect(200);expect((await Parcel.findById(b._id)).status).toBe('needs_admin_assignment');});
test('manual fallback assignment rechecks eligibility and requires version/reason',async()=>{await Partner.updateMany({},{$set:{isAvailable:false}});const b=await booking();await adm(request(app).post(`/a/bookings/${b._id}/assign`)).send({partnerId:String(partner._id),version:b.version,reason:'Fixture'}).expect(409);await Partner.updateOne({_id:partner._id},{$set:{isAvailable:true}});const d=await adminDetail(b._id);await adm(request(app).post(`/a/bookings/${b._id}/assign`)).send({partnerId:String(partner._id),version:d.version,reason:'Fixture fallback'}).expect(200);expect((await Parcel.findById(b._id)).assignment.offer.partnerIds).toEqual([String(partner._id)]);});
test('concurrent offer acceptance has one winner and stale mutation is rejected',async()=>{const b=await booking(),d=await driverDetail(b._id),send=()=>drv(request(app).post(`/d/bookings/${b._id}/offer`)).send({action:'accept',token:d.offer.token,version:d.version});const r=await Promise.all([send(),send()]);expect(r.map(x=>x.status).sort()).toEqual([200,409]);await drv(request(app).post(`/d/bookings/${b._id}/actions`)).send({action:'driver_arriving',version:d.version}).expect(409);});
test('online pending booking never dispatches or accepts driver cash',async()=>{const b=await booking('online');expect(b.status).toBe('payment_pending');await expect(assignment.assignParcel(b._id)).rejects.toThrow(/dispatch eligible/);expect(await Partner.countDocuments({'parcelReservation.bookingId':b._id})).toBe(0);});
test('verified online payment immediately broadcasts to eligible riders without waiting for the sweep',async()=>{
  const b=await booking('online'),checkoutData=await checkout(b);capture(checkoutData);
  await verify(b,checkoutData);const row=await Parcel.findById(b._id);
  expect(row.paymentStatus).toBe('paid');expect(row.assignment.offer.partnerIds).toEqual([String(partner._id),String(partner2._id)]);
  await driverDetail(b._id);await driverDetail(b._id,true);
});
test('admin partner choices and request history show names without exposing customer-only or driver-only profile data',async()=>{
  await User.updateOne({_id:driver._id},{$set:{name:'Ritik Tiwari'}});const b=await booking();
  const choices=(await adm(request(app).get(`/a/bookings/${b._id}/candidates`)).expect(200)).body.data;
  const rider=choices.find(p=>p._id===String(partner._id));expect(rider.name).toBe('Ritik Tiwari');expect(rider.pickupDistanceKm).toBe(0);expect(rider.phone).toBeUndefined();
  expect((await adminDetail(b._id)).drivers.find(p=>p._id===String(partner._id)).name).toBe('Ritik Tiwari');
  expect((await driverDetail(b._id)).drivers).toBeUndefined();expect((await auth(request(app).get(`/c/bookings/${b._id}`)).expect(200)).body.data.drivers).toBeUndefined();
});
test('on-duty rider with stale GPS is explained in Admin and becomes selectable only after a fresh location fix',async()=>{
  await User.updateOne({_id:driver._id},{$set:{name:'Ritik Tiwari'}});
  await Partner.updateOne({_id:partner._id},{$set:{'currentLocation.updatedAt':new Date(Date.now()-19*60000)}});
  const b=await booking(),response=(await adm(request(app).get(`/a/bookings/${b._id}/candidates`)).expect(200)).body;
  expect(response.data.some(p=>p._id===String(partner._id))).toBe(false);
  const blocked=response.meta.unavailableDrivers.find(p=>p._id===String(partner._id));
  expect(blocked.name).toBe('Ritik Tiwari');expect(blocked.reason).toBe('location_outdated');expect(blocked.locationAgeSeconds).toBeGreaterThanOrEqual(19*60);expect(blocked.locationMaxAgeSeconds).toBe(300);expect(blocked.pickupDistanceKm).toBe(0);
  expect(blocked.currentLocation).toBeUndefined();expect(blocked.phone).toBeUndefined();
  await Partner.updateOne({_id:partner._id},{$set:{'currentLocation.updatedAt':new Date()}});
  const fresh=(await adm(request(app).get(`/a/bookings/${b._id}/candidates`)).expect(200)).body;
  expect(fresh.data.some(p=>p._id===String(partner._id))).toBe(true);expect(fresh.meta.unavailableDrivers.some(p=>p._id===String(partner._id))).toBe(false);
});
test('an expired paid booking in admin fallback can be re-offered without another payment',async()=>{
  const b=await booking('online'),checkoutData=await checkout(b);capture(checkoutData);await verify(b,checkoutData);
  await Parcel.updateOne({_id:b._id},{$set:{'assignment.offer.expiresAt':new Date(0)}});
  await Partner.updateMany({},{$set:{'currentLocation.updatedAt':new Date(0)}});await assignment.sweepParcelsOnce();
  let row=await Parcel.findById(b._id);expect(row.status).toBe('needs_admin_assignment');
  await Partner.updateOne({_id:partner._id},{$set:{'currentLocation.updatedAt':new Date()}});
  await adm(request(app).post(`/a/bookings/${b._id}/assign`)).send({partnerId:String(partner._id),version:row.__v,reason:'Re-offer paid booking after rider location refreshed'}).expect(200);
  await accept(b);row=await Parcel.findById(b._id);expect(row.paymentStatus).toBe('paid');expect(row.status).toBe('driver_assigned');
  expect((await Payment.findById(b._id)).captures).toHaveLength(1);expect(await Ledger.countDocuments({parcelDeliveryId:b._id,account:'parcel_collections',direction:'credit'})).toBe(1);
});

test('two different riders accepting simultaneously produce one winner; loser loses list and detail access',async()=>{
  const b=await booking(),a=await driverDetail(b._id),c=await driverDetail(b._id,true);
  const results=await Promise.all([drv(request(app).post(`/d/bookings/${b._id}/offer`)).send({action:'accept',token:a.offer.token,version:a.version}),drv(request(app).post(`/d/bookings/${b._id}/offer`),true).send({action:'accept',token:c.offer.token,version:c.version})]);
  expect(results.map(r=>r.status).sort()).toEqual([200,409]);
  const secondWon=results[1].status===200,row=await Parcel.findById(b._id);
  expect(String(row.partnerId)).toBe(String(secondWon?partner2._id:partner._id));expect(row.assignment.offer).toBeUndefined();
  expect(row.assignment.attempts.map(a=>a.outcome).sort()).toEqual(['accepted','withdrawn']);
  expect(await Partner.countDocuments({'parcelReservation.bookingId':row._id})).toBe(1);
  await drv(request(app).get(`/d/bookings/${b._id}`),!secondWon).expect(404);
  expect((await drv(request(app).get('/d/bookings'),!secondWon).expect(200)).body.data).toHaveLength(0);
  expect((await Partner.findById(secondWon?partner._id:partner2._id)).isAvailable).toBe(true);
});

test('one rejection removes only that rider and does not invalidate the other rider original offer',async()=>{
  const b=await booking(),a=await driverDetail(b._id),c=await driverDetail(b._id,true);
  await drv(request(app).post(`/d/bookings/${b._id}/offer`)).send({action:'reject',token:a.offer.token,version:a.version}).expect(200);
  await drv(request(app).get(`/d/bookings/${b._id}`)).expect(404);
  await drv(request(app).post(`/d/bookings/${b._id}/offer`),true).send({action:'accept',token:c.offer.token,version:c.version}).expect(200);
  expect(String((await Parcel.findById(b._id)).partnerId)).toBe(String(partner2._id));
});

test.each(['busy','offline','stale','outside radius'])('acceptance rechecks rider becoming %s after the broadcast',async state=>{
  const b=await booking(),a=await driverDetail(b._id);
  if(state==='busy')await Order.collection.insertOne({deliveryPartnerId:partner._id,status:'dispatched'});
  else await Partner.updateOne({_id:partner._id},{$set:state==='offline'?{isAvailable:false}:state==='stale'?{'currentLocation.updatedAt':new Date(0)}:{'currentLocation.lat':0}});
  await drv(request(app).post(`/d/bookings/${b._id}/offer`)).send({action:'accept',token:a.offer.token,version:a.version}).expect(409);
  expect((await Parcel.findById(b._id)).partnerId).toBeUndefined();await accept(b,true);
});

test('notification fanout reaches both riders for offer and withdrawal without private details',async()=>{
  notify.mockClear();const b=await booking();
  for(const p of [partner,partner2])expect(notify.mock.calls.some(([id,opts])=>id===String(p._id)&&opts.route==='/delivery/parcels')).toBe(true);
  notify.mockClear();await accept(b);
  for(const p of [partner,partner2])expect(notify.mock.calls.some(([id,opts])=>id===String(p._id)&&opts.event==='PARCEL_UPDATED')).toBe(true);
  for(const args of notify.mock.calls)expect(JSON.stringify(args)).not.toMatch(/Private pickup|9876500011|pickupCode/);
});

test('a rider outside the broadcast cannot claim the parcel even with its token',async()=>{
  await Partner.updateOne({_id:partner2._id},{$set:{isAvailable:false}});const b=await booking(),d=await driverDetail(b._id);
  await drv(request(app).get(`/d/bookings/${b._id}`),true).expect(404);
  await drv(request(app).post(`/d/bookings/${b._id}/offer`),true).send({action:'accept',token:d.offer.token,version:d.version}).expect(409);
});
test('Razorpay initialization reuses attempt and ignores client amount',async()=>{const b=await booking('online'),c=await checkout(b),d=await checkout(b);expect(c.razorpayOrderId).toBe(d.razorpayOrderId);expect(c.amountPaise).toBe(2040);expect(sdk.orders.create).toHaveBeenCalledTimes(1);expect((await Payment.findById(b._id)).orderId).toBeUndefined();});
test('uncertain initialization is blocked until exact provider reconciliation',async()=>{const b=await booking('online'),key=crypto.randomUUID();uncertain=true;await auth(request(app).post(`/c/bookings/${b._id}/payment`)).set('Idempotency-Key',key).send({policyVersion:1,acceptTerms:true}).expect(503);uncertain=false;await auth(request(app).post(`/c/bookings/${b._id}/payment`)).set('Idempotency-Key',key).send({policyVersion:1,acceptTerms:true}).expect(409);await adm(request(app).post(`/a/bookings/${b._id}/recover-payment`)).send({key,gatewayOrderId:'order_1'}).expect(200);expect((await checkout(b,key)).razorpayOrderId).toBe('order_1');expect(sdk.orders.create).toHaveBeenCalledTimes(1);});
test('invalid signature, foreign owner, amount and gateway association cannot mark paid',async()=>{const b=await booking('online'),c=await checkout(b);capture(c);await auth(request(app).post('/c/payments/verify')).send({orderId:b._id,razorpay_order_id:c.razorpayOrderId,razorpay_payment_id:'pay_parcel',razorpay_signature:'forged'}).expect(401);await auth(request(app).post(`/c/bookings/${b._id}/payment-status`),other).send({}).expect(404);payments.get('pay_parcel').amount=1;expect((await verify(b,c)).status).toBe(409);payments.get('pay_parcel').amount=c.amountPaise;payments.get('pay_parcel').order_id='unrelated';expect((await verify(b,c)).status).toBe(409);expect((await Parcel.findById(b._id)).status).toBe('payment_pending');});
test('verified capture and signed duplicate webhooks post once without creating product orders',async()=>{const b=await booking('online'),c=await checkout(b),p=capture(c);expect((await verify(b,c)).status).toBe(200);const body={event:'payment.captured',payload:{payment:{entity:p}}};expect((await webhook(body)).status).toBe(200);expect((await webhook(body)).status).toBe(200);expect((await webhook(body,false)).status).toBe(401);expect(await Ledger.countDocuments({parcelDeliveryId:b._id,account:'parcel_collections'})).toBe(1);expect(await Order.countDocuments()).toBe(0);});
test('failed then delayed capture is verified; late capture after cancellation is held without dispatch',async()=>{const b=await booking('online'),c=await checkout(b),p=capture(c);p.status='failed';expect((await verify(b,c)).status).toBe(200);expect((await Parcel.findById(b._id)).status).toBe('payment_failed');p.status='captured';let d=await adminDetail(b._id);await auth(request(app).post(`/c/bookings/${b._id}/cancellation`)).send({version:d.version,reason:'Fixture abandon'}).expect(200);await aact(b,'approve_cancellation');expect((await webhook({event:'payment.captured',payload:{payment:{entity:p}}})).status).toBe(200);d=await adminDetail(b._id);expect(d.status).toBe('cancelled');expect(d.finance.dispute).toMatch(/Late/);expect(d.paymentStatus).not.toBe('paid');});
test('pickup and delivery transitions require proof and bounded attempts are durable',async()=>{const b=await booking();await accept(b);await dact(b,'driver_arriving');await dact(b,'arrived_at_pickup');let d=await driverDetail(b._id);await drv(request(app).post(`/d/bookings/${b._id}/actions`)).send({action:'in_transit',version:d.version}).expect(409);await dact(b,'pickup_code');for(let n=0;n<5;n++){d=await driverDetail(b._id);await drv(request(app).post(`/d/bookings/${b._id}/actions`)).send({action:'verify_pickup',version:d.version,code:'000000'}).expect(400);}d=await driverDetail(b._id);await drv(request(app).post(`/d/bookings/${b._id}/actions`)).send({action:'pickup_code',version:d.version}).expect(409);expect(JSON.stringify(d)).not.toMatch(/"code"|pickupCode/);});
test('pay-driver full lifecycle keeps custody separate and earnings held until finance review',async()=>{const b=await booking();await toDrop(b);await dact(b,'collect_cash',{amountPaise:2040});await dact(b,'collect_cash',{amountPaise:2040});await dact(b,'delivery_code');const c=(await auth(request(app).get(`/c/bookings/${b._id}`)).expect(200)).body.data;await dact(b,'verify_delivery',{code:c.deliveryCode});const d=await adminDetail(b._id);expect(d.status).toBe('delivered');expect(d.cash.status).toBe('collected_unreconciled');expect(d.finance.held).toBe(true);expect(await Ledger.countDocuments({parcelDeliveryId:b._id,account:'parcel_cash_custody',direction:'credit'})).toBe(1);expect(await Ledger.countDocuments({parcelDeliveryId:b._id,account:'parcel_driver_payable'})).toBe(1);expect((await Partner.findById(partner._id)).isAvailable).toBe(true);expect((await Partner.findById(partner._id)).earnings.total).toBe(0);});
test('cash collection rejects wrong amount and online bookings cannot collect cash',async()=>{const b=await paid();await toDrop(b);const d=await driverDetail(b._id);await drv(request(app).post(`/d/bookings/${b._id}/actions`)).send({action:'collect_cash',version:d.version,amountPaise:2040}).expect(409);});

async function cashChoice(point='pickup',mode='customer_choice',key=crypto.randomUUID()) {
  await adm(request(app).post('/a/policy')).send({version:1,config:{...fixture(),cashCollectionPoint:mode}}).expect(200);
  const quote=await q();
  const payload={quoteId:quote._id,policyVersion:2,paymentMethod:'pay_driver',cashCollectionPoint:point,acceptTerms:true};
  const b=(await auth(request(app).post('/c/bookings')).set('Idempotency-Key',key).send(payload).expect(201)).body.data;
  return {b,payload,key};
}
async function atPickup(b) {await accept(b);await dact(b,'driver_arriving');await dact(b,'arrived_at_pickup');}
async function pickupProof(b) {await dact(b,'pickup_code');return (await auth(request(app).get(`/c/bookings/${b._id}`)).expect(200)).body.data.pickupCode;}

test.each(['pickup','delivery'])('customer choice persists %s and cannot be changed using the same booking identity',async point=>{
  const {b,payload,key}=await cashChoice(point);
  expect(b.cashCollectionPoint).toBe(point);expect((await adminDetail(b._id)).cashCollectionPoint).toBe(point);
  expect((await auth(request(app).get('/c/catalogue')).expect(200)).body.data.cashCollectionPoints).toEqual(['pickup','delivery']);
  expect((await Quote.findById(payload.quoteId)).pricing.driverPaise).toBe(1020);
  await auth(request(app).post('/c/bookings')).set('Idempotency-Key',key).send(payload).expect(201);
  await auth(request(app).post('/c/bookings')).set('Idempotency-Key',key).send({...payload,cashCollectionPoint:point==='pickup'?'delivery':'pickup'}).expect(409);
  expect(await Parcel.countDocuments()).toBe(1);
});
test.each([['delivery','pickup'],['pickup','delivery']])('server rejects %s policy with unauthorized %s collection',async(mode,point)=>{
  await adm(request(app).post('/a/policy')).send({version:1,config:{...fixture(),cashCollectionPoint:mode}}).expect(200);
  const quote=await q();expect(quote.cashCollectionPoints).toEqual([mode]);
  await auth(request(app).post('/c/bookings')).set('Idempotency-Key',crypto.randomUUID()).send({quoteId:quote._id,policyVersion:2,paymentMethod:'pay_driver',cashCollectionPoint:point,acceptTerms:true}).expect(409);
  expect(await Parcel.countDocuments()).toBe(0);
});
test.each([['pay_driver','unknown'],['pay_driver',null],['online','pickup']])('invalid cash point %s/%s cannot create a booking',async(method,point)=>{
  const quote=await q();await auth(request(app).post('/c/bookings')).set('Idempotency-Key',crypto.randomUUID()).send({quoteId:quote._id,policyVersion:1,paymentMethod:method,cashCollectionPoint:point,acceptTerms:true}).expect(400);
  expect(await Parcel.countDocuments()).toBe(0);
});
test('pickup cash requires the exact fee before handover, posts custody once, and earns only after delivery',async()=>{
  const {b}=await cashChoice();
  let d=await driverDetail(b._id);
  await drv(request(app).post(`/d/bookings/${b._id}/actions`)).send({action:'collect_cash',version:d.version,amountPaise:2040}).expect(404);
  await atPickup(b);const code=await pickupProof(b);d=await driverDetail(b._id);
  await drv(request(app).post(`/d/bookings/${b._id}/actions`)).send({action:'verify_pickup',version:d.version,code}).expect(409);
  await drv(request(app).post(`/d/bookings/${b._id}/actions`)).send({action:'collect_cash',version:d.version,amountPaise:100}).expect(409);
  await dact(b,'collect_cash',{amountPaise:2040});await dact(b,'collect_cash',{amountPaise:2040});
  expect(await Ledger.countDocuments({parcelDeliveryId:b._id,account:'parcel_driver_payable'})).toBe(0);
  expect(await Ledger.countDocuments({parcelDeliveryId:b._id,account:'parcel_cash_custody',direction:'credit'})).toBe(1);
  await dact(b,'verify_pickup',{code});await dact(b,'in_transit');await dact(b,'arrived_at_dropoff');
  d=await driverDetail(b._id);await drv(request(app).post(`/d/bookings/${b._id}/actions`)).send({action:'collect_cash',version:d.version,amountPaise:2040}).expect(409);
  await dact(b,'delivery_code');const customerView=(await auth(request(app).get(`/c/bookings/${b._id}`))).body.data;
  await dact(b,'verify_delivery',{code:customerView.deliveryCode});
  const final=await adminDetail(b._id);expect(final.status).toBe('delivered');expect(final.cashCollectionPoint).toBe('pickup');expect(final.finance.held).toBe(true);
  expect((await driverDetail(b._id)).finance.earningPaise).toBe(1020);
  expect(await Ledger.countDocuments({parcelDeliveryId:b._id,account:'parcel_driver_payable'})).toBe(1);
  expect((await Partner.findById(partner._id)).earnings.total).toBe(0);
});
test('legacy drop bookings still reject pickup collection and preserve old retry hashes',async()=>{
  const key=crypto.randomUUID(),quote=await q(),b=await booking('pay_driver',key,quote);
  await Parcel.updateOne({_id:b._id},{$unset:{'cash.collectionPoint':1}});
  const repeat=await auth(request(app).post('/c/bookings')).set('Idempotency-Key',key).send({quoteId:quote._id,policyVersion:1,paymentMethod:'pay_driver',cashCollectionPoint:'delivery',acceptTerms:true}).expect(201);
  expect(repeat.body.data._id).toBe(b._id);expect(repeat.body.data.cashCollectionPoint).toBe('delivery');
  await atPickup(b);const d=await driverDetail(b._id);await drv(request(app).post(`/d/bookings/${b._id}/actions`)).send({action:'collect_cash',version:d.version,amountPaise:2040}).expect(409);
});
test('pickup collection cancellation uses evidence and existing held-cash reversal, never an automatic payout',async()=>{
  const {b}=await cashChoice();await atPickup(b);await dact(b,'collect_cash',{amountPaise:2040});
  const d=await adminDetail(b._id);await auth(request(app).post(`/c/bookings/${b._id}/cancellation`)).send({version:d.version,reason:'Synthetic pickup cancellation'}).expect(200);
  await aact(b,'approve_cancellation');await aact(b,'cash_refund_evidence',{amountPaise:2040,evidence:'SYNTHETIC VERIFIED SENDER REFUND'});
  const final=await adminDetail(b._id);expect(final.cash.status).toBe('refunded_with_evidence');expect(final.refund.refundedPaise).toBe(2040);
  expect(await Ledger.countDocuments({parcelDeliveryId:b._id,account:'parcel_driver_payable'})).toBe(0);
});
test('cash reconciliation needs finance permission, exact amount and deposit evidence',async()=>{const b=await booking();await toDrop(b);await dact(b,'collect_cash',{amountPaise:2040});const d=await adminDetail(b._id);await auth(request(app).post(`/a/bookings/${b._id}/actions`),ops,'admin').send({action:'reconcile_cash',version:d.version,amountPaise:2040,reason:'Fixture',evidence:'Fixture bank'}).expect(403);await adm(request(app).post(`/a/bookings/${b._id}/actions`)).send({action:'reconcile_cash',version:d.version,amountPaise:2040,reason:'Fixture'}).expect(400);await aact(b,'reconcile_cash',{amountPaise:2040,evidence:'SYNTHETIC BANK DEPOSIT'});expect((await adminDetail(b._id)).cash.status).toBe('reconciled');expect(await Ledger.countDocuments({parcelDeliveryId:b._id,account:'parcel_collections',direction:'credit'})).toBe(1);});
test('cancellation pauses offers, is auditable, and releases driver only on approval',async()=>{const b=await booking(),d=await driverDetail(b._id);await auth(request(app).post(`/c/bookings/${b._id}/cancellation`)).send({version:d.version,reason:'Fixture request'}).expect(200);await drv(request(app).post(`/d/bookings/${b._id}/offer`)).send({action:'accept',version:d.version,token:d.offer.token}).expect(409);await aact(b,'approve_cancellation');expect((await Partner.findById(partner._id)).isAvailable).toBe(true);expect((await adminDetail(b._id)).status).toBe('cancelled');});
test('failed delivery and refusal retain custody until explicit admin evidence',async()=>{const b=await booking();await toDrop(b);await dact(b,'exception',{reason:'recipient_refusal'});expect((await Partner.findById(partner._id)).isAvailable).toBe(false);const d=await adminDetail(b._id);await adm(request(app).post(`/a/bookings/${b._id}/actions`)).send({action:'resolve_exception',version:d.version,reason:'Reviewed'}).expect(400);await aact(b,'resolve_exception',{custodyEvidence:'SYNTHETIC RETURN RECEIPT'});expect((await Partner.findById(partner._id)).isAvailable).toBe(true);});
test('approved online refunds use shared recovery and compensating ledger entries idempotently',async()=>{const b=await paid(),d=await adminDetail(b._id);await auth(request(app).post(`/c/bookings/${b._id}/cancellation`)).send({version:d.version,reason:'Synthetic cancellation'}).expect(200);await aact(b,'approve_cancellation');await aact(b,'approve_refund',{amountPaise:2040});let a=await adminDetail(b._id),key=a.payment.refundObligations[0].key;await adm(request(app).post(`/a/bookings/${b._id}/refund`)).send({key}).expect(200);await adm(request(app).post(`/a/bookings/${b._id}/refund`)).send({key}).expect(200);a=await adminDetail(b._id);expect(a.refund.refundedPaise).toBe(2040);expect(sdk.payments.refund).toHaveBeenCalledTimes(1);expect(a.ledger.filter(x=>x.direction==='debit'&&x.account==='parcel_collections')).toHaveLength(1);});
test('financial ledger parcel identity participates in replay validation and remains append-only',async()=>{const b=await paid(),entries=await Ledger.find({parcelDeliveryId:b._id});expect(entries).toHaveLength(1);await expect(Ledger.updateOne({_id:entries[0]._id},{$set:{amount:1}})).rejects.toThrow(/append-only/);});
test('notifications contain no contacts or addresses and failure cannot undo acceptance',async()=>{notify.mockRejectedValue(new Error('Synthetic notification outage'));const b=await booking();expect(b.status).toBe('searching_for_driver');for(const args of notify.mock.calls)expect(JSON.stringify(args)).not.toMatch(/Private pickup|9876500011/);});
test('new parcel models cannot automatically create production collections or indexes',()=>{for(const m of [Parcel,Quote,Policy]){expect(m.schema.options.autoIndex).toBe(false);expect(m.schema.options.autoCreate).toBe(false);}});

test('inclusive tax and approved driver allocation reconcile to the exact quoted fee',()=>{
  const p={version:1,config:policy.validateParcelPolicy({...fixture(),taxRateBps:2000})},fare=policy.parcelFare(5.2,p);
  expect(fare.taxPaise).toBe(340);expect(fare.driverPaise).toBe(1020);expect(fare.platformPaise).toBe(680);
  expect(fare.taxPaise+fare.driverPaise+fare.platformPaise).toBe(fare.totalPaise);
  expect(()=>policy.validateParcelPolicy({...fixture(),maxActiveTasks:2})).toThrow(/single-task/);
});
test('concurrent independent bookings cannot reserve the same driver',async()=>{
  await Partner.updateOne({_id:partner2._id},{$set:{isAvailable:false}});
  const a=await booking('online'),c=await checkout(a);capture(c,'pay_first');await verify(a,c,'pay_first');
  const b=await booking('online'),d=await checkout(b);capture(d,'pay_second');await verify(b,d,'pay_second');
  await Promise.all([assignment.assignParcel(a._id),assignment.assignParcel(b._id)]);
  let rows=await Parcel.find({_id:{$in:[a._id,b._id]}});expect(rows.filter(x=>x.assignment.offer)).toHaveLength(2);
  await Promise.all([claimParcel(a),claimParcel(b)]);
  rows=await Parcel.find({_id:{$in:[a._id,b._id]}});expect(rows.filter(x=>x.partnerId)).toHaveLength(1);expect(await Partner.countDocuments({'parcelReservation.bookingId':{$in:[a._id,b._id]}})).toBe(1);
});
test('a reverse-acceptance claim excludes parcel assignment and a failed reverse claim releases only its own token',async()=>{
  const {acceptReturnPickup}=await import('../services/returnPickup.service.js');
  await Partner.updateOne({_id:partner._id},{$set:{parcelReturnClaim:{token:'synthetic-inflight',startedAt:new Date()}}});
  const b=await booking();expect((await Parcel.findById(b._id)).assignment.offer.partnerIds).toEqual([String(partner2._id)]);
  await Partner.updateOne({_id:partner._id},{$unset:{parcelReturnClaim:1}});
  await expect(acceptReturnPickup({returnId:'invalid',partnerId:partner._id})).rejects.toMatchObject({status:400});
  expect((await Partner.findById(partner._id)).parcelReturnClaim?.token).toBeUndefined();
  await accept(b,true);await expect(acceptReturnPickup({returnId:String(new mongoose.Types.ObjectId()),partnerId:partner2._id})).rejects.toMatchObject({status:409});
});
test('shopping mutation middleware blocks reserved drivers while their parcel remains active',async()=>{
  const {protect}=await import('../middlewares/auth.middleware.js'),{requireApprovedPartner}=await import('../middlewares/vendor.middleware.js');
  const legacy=express();legacy.use(express.json());legacy.post('/legacy',protect,requireApprovedPartner,(_req,res)=>res.json({ok:true}));legacy.use(errorHandler);
  await drv(request(legacy).post('/legacy')).send({}).expect(200);
  const b=await booking();await drv(request(legacy).post('/legacy')).send({}).expect(200);await accept(b);await drv(request(legacy).post('/legacy')).send({}).expect(409);
});
test('correct delivery proof cannot bypass exact cash collection and partial cash is rejected',async()=>{
  const b=await booking();await toDrop(b);await dact(b,'delivery_code');const customerView=(await auth(request(app).get(`/c/bookings/${b._id}`))).body.data;
  let d=await driverDetail(b._id);await drv(request(app).post(`/d/bookings/${b._id}/actions`)).send({action:'verify_delivery',version:d.version,code:customerView.deliveryCode}).expect(409);
  d=await driverDetail(b._id);await drv(request(app).post(`/d/bookings/${b._id}/actions`)).send({action:'collect_cash',version:d.version,amountPaise:1000}).expect(409);
  expect((await Parcel.findById(b._id)).cash.amountPaise).toBe(0);
});
test('an additional verified capture is held and cannot dispatch or double-post the original fee',async()=>{
  const b=await booking('online'),c=await checkout(b);capture(c,'pay_original');await verify(b,c,'pay_original');capture(c,'pay_additional');await verify(b,c,'pay_additional');
  const d=await adminDetail(b._id);expect(d.finance.dispute).toMatch(/additional/);expect(d.payment.captures).toHaveLength(2);
  await expect(assignment.assignParcel(b._id)).rejects.toThrow(/dispatch eligible/);
  expect(await Ledger.countDocuments({parcelDeliveryId:b._id,account:'parcel_collections'})).toBe(2);
});
test('cumulative refund approvals cannot exceed the original verified capture',async()=>{
  const b=await paid(),d=await adminDetail(b._id);await auth(request(app).post(`/c/bookings/${b._id}/cancellation`)).send({version:d.version,reason:'Synthetic cancellation'}).expect(200);await aact(b,'approve_cancellation');await aact(b,'approve_refund',{amountPaise:2040});
  const fresh=await adminDetail(b._id);await adm(request(app).post(`/a/bookings/${b._id}/actions`)).send({action:'approve_refund',version:fresh.version,reason:'Excess refund fixture',amountPaise:1}).expect(409);
});
test('parcel ledger replay refuses a different parcel reference for the same financial event',async()=>{
  const {postLedgerEntry}=await import('../services/sellerLedger.service.js'),b=await paid(),entry=await Ledger.findOne({parcelDeliveryId:b._id});
  await expect(postLedgerEntry({...entry.toObject(),parcelDeliveryId:new mongoose.Types.ObjectId()})).rejects.toThrow(/different financial data/);
});
test('admin retry resumes a failed parcel at the same stage without extra fees or earnings',async()=>{
  const b=await booking();await toDrop(b);await dact(b,'exception',{reason:'unreachable_recipient'});await aact(b,'retry_exception');const d=await adminDetail(b._id);expect(d.status).toBe('arrived_at_dropoff');expect(d.feePaise).toBe(2040);expect(d.ledger).toHaveLength(0);
});
test('a single late capture on a cancelled booking requires explicit finance allocation before refund',async()=>{
  const b=await booking('online'),c=await checkout(b),d=await adminDetail(b._id);
  await auth(request(app).post(`/c/bookings/${b._id}/cancellation`)).send({version:d.version,reason:'Synthetic cancelled pending payment'}).expect(200);await aact(b,'approve_cancellation');capture(c);await verify(b,c);
  const held=await adminDetail(b._id);await adm(request(app).post(`/a/bookings/${b._id}/actions`)).send({action:'approve_refund',version:held.version,reason:'Blocked before allocation',amountPaise:2040}).expect(409);
  await aact(b,'allocate_cancelled_capture');await aact(b,'approve_refund',{amountPaise:2040});
  const fresh=await adminDetail(b._id);expect(fresh.status).toBe('cancelled');expect(fresh.payment.refundObligations).toHaveLength(1);
});
test('cancelling a failed delivery after pickup still requires custody evidence',async()=>{
  const b=await booking();await toDrop(b);await dact(b,'exception',{reason:'recipient_refusal'});const d=await adminDetail(b._id);
  await auth(request(app).post(`/c/bookings/${b._id}/cancellation`)).send({version:d.version,reason:'Synthetic cancellation of failed trip'}).expect(200);
  const review=await adminDetail(b._id);await adm(request(app).post(`/a/bookings/${b._id}/actions`)).send({action:'approve_cancellation',version:review.version,reason:'Missing custody evidence'}).expect(409);
});

test('readiness: refunds cannot be approved during cancellation review and then resume delivery',async()=>{
  const b=await paid(),d=await adminDetail(b._id);
  await auth(request(app).post(`/c/bookings/${b._id}/cancellation`)).send({version:d.version,reason:'Pending review'}).expect(200);
  const review=await adminDetail(b._id);
  await adm(request(app).post(`/a/bookings/${b._id}/actions`)).send({action:'approve_refund',version:review.version,reason:'Review is not an approved cancellation',amountPaise:2040}).expect(409);
  expect((await Payment.findById(b._id)).refundObligations).toHaveLength(0);
});
test('readiness: an incomplete ASSIGNED reverse pickup blocks parcel assignment',async()=>{
  const {default:Return}=await import('../models/Return.js');
  await Partner.updateOne({_id:partner2._id},{$set:{isAvailable:false}});
  await Return.collection.insertOne({returnNumber:'SYNTHETIC-INCOMPLETE',pickup:{partnerId:partner._id,status:'ASSIGNED'}});
  const b=await booking();expect(b.status).toBe('needs_admin_assignment');expect(await Delivery.countDocuments()).toBe(0);
});
test('readiness: driver task mutations require the booking reservation to remain held',async()=>{
  const b=await booking();await accept(b);
  await Partner.updateOne({_id:partner._id},{$unset:{parcelReservation:1}});
  const d=await driverDetail(b._id);
  await drv(request(app).post(`/d/bookings/${b._id}/actions`)).send({action:'driver_arriving',version:d.version}).expect(409);
  expect((await Parcel.findById(b._id)).status).toBe('driver_assigned');
});
test('readiness: cleanup does not turn a suspended driver back on duty',async()=>{
  const b=await booking();await accept(b);await Partner.updateOne({_id:partner._id},{$set:{status:'suspended'}});
  const d=await adminDetail(b._id);await auth(request(app).post(`/c/bookings/${b._id}/cancellation`)).send({version:d.version,reason:'Cancel offered parcel'}).expect(200);await aact(b,'approve_cancellation');
  const p=await Partner.findById(partner._id);expect(p.isAvailable).toBe(false);expect(p.parcelReservation?.bookingId).toBeUndefined();
});
test('readiness: expired proof codes are omitted from customer DTOs',async()=>{
  const b=await booking();await accept(b);await dact(b,'driver_arriving');await dact(b,'arrived_at_pickup');await dact(b,'pickup_code');
  await Parcel.updateOne({_id:b._id},{$set:{'proof.pickup.expiresAt':new Date(0)}});
  const d=(await auth(request(app).get(`/c/bookings/${b._id}`)).expect(200)).body.data;expect(d.pickupCode).toBeUndefined();
});
test('readiness: operations-only admins cannot read bank evidence or payment recovery journals',async()=>{
  const b=await paid();await aact(b,'bank_reconciled',{amountPaise:2040,evidence:'SYNTHETIC-PRIVATE-BANK-EVIDENCE'});
  const d=(await auth(request(app).get(`/a/bookings/${b._id}`),ops,'admin').expect(200)).body.data;
  expect(d.payment).toBeUndefined();expect(d.ledger).toBeUndefined();expect(JSON.stringify(d)).not.toContain('SYNTHETIC-PRIVATE-BANK-EVIDENCE');
});
test('readiness: parcel reference cannot post to ordinary rider or seller accounts',async()=>{
  const b=await booking();
  for(const account of ['rider_payable','seller_payable','cod_custody','merchandise_gross']){
    await expect(Ledger.create({entryNo:crypto.randomUUID(),idempotencyKey:crypto.randomUUID(),parcelDeliveryId:b._id,partnerId:partner._id,sellerId:new mongoose.Types.ObjectId(),account,type:'adjustment',direction:'credit',bucket:'eligible',amount:1,description:'Forbidden cross-product allocation'})).rejects.toThrow(/Parcel/);
  }
});
test('readiness: a gateway dispute cannot be cleared by allocating a late capture',async()=>{
  const b=await booking('online'),c=await checkout(b),d=await adminDetail(b._id);
  await auth(request(app).post(`/c/bookings/${b._id}/cancellation`)).send({version:d.version,reason:'Cancel pending payment'}).expect(200);await aact(b,'approve_cancellation');capture(c);await verify(b,c);
  await webhook({event:'payment.dispute.created',payload:{dispute:{entity:{id:'disp_fixture',payment_id:'pay_parcel'}}}});
  const held=await adminDetail(b._id);
  await adm(request(app).post(`/a/bookings/${b._id}/actions`)).send({action:'allocate_cancelled_capture',version:held.version,reason:'Must not clear a chargeback hold'}).expect(409);
});

// Actual shopping/return controllers and actual persistence: only provider
// transport is mocked, as in the rest of this isolated suite.
const {default:Seller}=await import('../models/Seller.js');
const {default:Return}=await import('../models/Return.js');
const {acceptOrder}=await import('../controllers/deliveryPartner.controller.js');
const {assignDeliveryPartner}=await import('../controllers/deliveryAssignment.controller.js');
const {acceptReturnPickup}=await import('../services/returnPickup.service.js');
const {protect,requireAdmin}=await import('../middlewares/auth.middleware.js');
const {requireApprovedPartner}=await import('../middlewares/vendor.middleware.js');
app.post('/shopping/:id/accept',protect,requireApprovedPartner,acceptOrder);
app.post('/shopping/:id/manual',protect,requireAdmin,assignDeliveryPartner);app.use(errorHandler);
async function shoppingFixture(){
  const sellerId=new mongoose.Types.ObjectId();await Seller.collection.insertOne({_id:sellerId,userId:new mongoose.Types.ObjectId(),businessName:'Synthetic shop',storeDetails:{name:'Fixture store',address:'Synthetic pickup',city:'Fixture',pincode:'560001',lat:12.97,lng:77.59}});
  return Order.create({userId:customer._id,type:'grocery',paymentMethod:'cod',deliveryType:'internal',status:'dispatched',items:[{sellerId,productId:new mongoose.Types.ObjectId(),name:'Fixture product',qty:1,price:10}],shippingAddress:{name:'Fixture recipient',phone:'9876500011',line1:'Synthetic dropoff',city:'Fixture',pincode:'560001',lat:12.98,lng:77.60},pricing:{subtotal:10,totalAmount:10}});
}
async function pendingPaidParcel(){const b=await booking('online'),c=await checkout(b);capture(c);await verify(b,c);return b;}
async function claimParcel(b){
  const offered=await assignment.assignParcel(b._id);
  if(!offered.assignment.offer?.partnerIds?.includes(String(partner._id)))return offered;
  const r=await drv(request(app).post(`/d/bookings/${b._id}/offer`)).send({action:'accept',token:offered.assignment.offer.token,version:offered.__v});
  expect([200,409]).toContain(r.status);return Parcel.findById(b._id);
}
async function assertSingleProduct(partnerId){
  const parcels=await Parcel.countDocuments({partnerId,status:{$nin:['cancelled','delivered']}});
  const forward=await Order.countDocuments({deliveryPartnerId:partnerId,status:{$nin:['cancelled','delivered','returned','refunded']}});
  const reverse=await Return.countDocuments({'pickup.partnerId':partnerId,'pickup.status':{$in:['ASSIGNED','PICKED_UP']}});
  expect(parcels+Number(forward>0)+Number(reverse>0)).toBeLessThanOrEqual(1);
}
test.each([0,1,2])('readiness: concurrent shopping acceptance and parcel reservation preserve capacity limit %s',async limit=>{
  process.env.RIDER_MAX_CONCURRENT_DELIVERIES=String(limit);
  try{
    await Partner.updateOne({_id:partner2._id},{$set:{isAvailable:false}});
    const order=await shoppingFixture(),b=await pendingPaidParcel();
    const results=await Promise.allSettled([drv(request(app).post(`/shopping/${order._id}/accept`)).send({}),claimParcel(b)]);
    expect(results[0].status).toBe('fulfilled');expect([200,409]).toContain(results[0].value.status);expect(results[1].status).toBe('fulfilled');
    await assertSingleProduct(partner._id);
    const shopping=await Order.findById(order._id),parcel=await Parcel.findById(b._id);
    expect(Boolean(shopping.deliveryPartnerId)!==Boolean(parcel.partnerId)).toBe(true);
  }finally{delete process.env.RIDER_MAX_CONCURRENT_DELIVERIES;}
});
test('readiness: manual shopping assignment races safely with parcel reservation',async()=>{
  await Partner.updateOne({_id:partner2._id},{$set:{isAvailable:false}});
  const order=await shoppingFixture(),b=await pendingPaidParcel();
  const r=await Promise.all([adm(request(app).post(`/shopping/${order._id}/manual`)).send({partnerId:String(partner._id),reason:'Synthetic concurrent manual assignment'}),claimParcel(b)]);
  expect([200,409]).toContain(r[0].status);await assertSingleProduct(partner._id);
  expect(Boolean((await Order.findById(order._id)).deliveryPartnerId)!==Boolean((await Parcel.findById(b._id)).partnerId)).toBe(true);
});
test('readiness: reverse pickup acceptance races safely with parcel reservation',async()=>{
  await Partner.updateOne({_id:partner2._id},{$set:{isAvailable:false}});
  const order=await shoppingFixture();await Order.updateOne({_id:order._id},{$set:{status:'delivered'}});
  const {RETURN_REASONS}=await import('../constants/enums.js');
  const id=new mongoose.Types.ObjectId();await Return.collection.insertOne({_id:id,returnNumber:'SYNTHETIC-REVERSE-RACE',orderId:order._id,orderItemId:order.items[0]._id,customerId:customer._id,sellerId:order.items[0].sellerId,productId:order.items[0].productId,unitPriceSnapshot:10,quantity:1,reason:RETURN_REASONS[0],pickup:{status:'NOT_ASSIGNED',offerAttempts:[{riderId:partner._id,status:'OFFERED'}]}});
  const b=await pendingPaidParcel();
  const r=await Promise.allSettled([acceptReturnPickup({returnId:String(id),partnerId:partner._id}),claimParcel(b)]);
  expect(r[1].status).toBe('fulfilled');if(r[0].status==='rejected'){if(r[0].reason.status!==409)throw r[0].reason;expect(r[0].reason.status).toBe(409);}
  await assertSingleProduct(partner._id);expect((await Partner.findById(partner._id)).parcelReturnClaim?.token).toBeUndefined();
});
test('readiness: independent application workers share the durable assignment claim',async()=>{
  const b=await pendingPaidParcel();
  const worker=()=>new Promise((resolve,reject)=>{
    const child=fork(new URL('./parcel-assignment-worker.mjs',import.meta.url),[],{execArgv:[],windowsHide:true,stdio:['ignore','ignore','ignore','ipc'],env:{SystemRoot:process.env.SystemRoot,NODE_ENV:'test',PARCEL_READINESS_WORKER:'isolated',PARCEL_DELIVERY_AUTO_ASSIGNMENT_ENABLED:'true',PARCEL_DELIVERY_ADMIN_FALLBACK_ENABLED:'true'}});
    const timer=setTimeout(()=>{child.kill();reject(Error('Isolated worker timed out'));},30000);
    let result;child.on('message',value=>{result=value;});child.on('error',reject);child.on('exit',()=>{clearTimeout(timer);result?.ok?resolve(result):reject(Error(result?.message||'Worker exited before result'));});
    child.send({uri:db.getUri('parcel-readiness-isolated'),bookingId:b._id});
  });
  await Promise.all([worker(),worker()]);
  const fresh=await Parcel.findById(b._id);expect(fresh.assignment.attempts).toHaveLength(2);expect(new Set(fresh.assignment.attempts.map(a=>a.token)).size).toBe(1);expect(await Partner.countDocuments({'parcelReservation.bookingId':fresh._id})).toBe(0);
});
test('readiness: disabling a parcel capability mid-request cannot remove the shopping reservation guard',async()=>{
  process.env.RIDER_MAX_CONCURRENT_DELIVERIES='0';
  let resume,arrived;const paused=new Promise(r=>arrived=r),release=new Promise(r=>resume=r);
  const create=Delivery.create.bind(Delivery);
  const spy=jest.spyOn(Delivery,'create').mockImplementation(async(...args)=>{
    const result=await create(...args);if(Array.isArray(args[0])&&args[0][0]?.orderId){arrived();await release;}return result;
  });
  let shopping;
  try{
    await Partner.updateOne({_id:partner2._id},{$set:{isAvailable:false}});
    const order=await shoppingFixture(),b=await pendingPaidParcel();
    shopping=drv(request(app).post(`/shopping/${order._id}/accept`)).send({}).then(r=>r);
    await paused;await claimParcel(b);process.env.PARCEL_DELIVERY_FULFILMENT_ENABLED='false';resume();
    expect((await shopping).status).toBe(409);await assertSingleProduct(partner._id);
  }finally{resume();if(shopping)await shopping;spy.mockRestore();delete process.env.RIDER_MAX_CONCURRENT_DELIVERIES;process.env.PARCEL_DELIVERY_FULFILMENT_ENABLED='true';}
});
test('readiness: parcel and shopping acceptance cannot both claim an already offered driver',async()=>{
  const order=await shoppingFixture(),b=await booking(),d=await driverDetail(b._id);
  const [parcel,shopping]=await Promise.all([drv(request(app).post(`/d/bookings/${b._id}/offer`)).send({action:'accept',version:d.version,token:d.offer.token}),drv(request(app).post(`/shopping/${order._id}/accept`)).send({})]);
  expect([parcel.status,shopping.status].sort()).toEqual([200,409]);await assertSingleProduct(partner._id);
});

test.each([0,1,2])('capacity fix: a parcel commit defeats a paused manual shopping claim with flags off, limit %s',async limit=>{
  process.env.RIDER_MAX_CONCURRENT_DELIVERIES=String(limit);
  await Partner.updateOne({_id:partner2._id},{$set:{isAvailable:false}});
  const order=await shoppingFixture(),b=await pendingPaidParcel();let entered,resume,held=false;
  const paused=new Promise(r=>entered=r),release=new Promise(r=>resume=r),update=Partner.updateOne.bind(Partner);
  const spy=jest.spyOn(Partner,'updateOne').mockImplementation(async(...args)=>{
    if(args[2]?.session&&!held&&args[0]?.['parcelReturnClaim.token']?.$exists===false){held=true;entered();await release;}
    return update(...args);
  });
  const shopping=adm(request(app).post(`/shopping/${order._id}/manual`)).send({partnerId:String(partner._id),reason:'Synthetic concurrency review'}).then(r=>r);
  try{
    await Promise.race([paused,shopping.then(r=>{throw Error(`Manual claim missed barrier: ${r.status} ${r.body.message}`);})]);
    await claimParcel(b);process.env.PARCEL_DELIVERY_FULFILMENT_ENABLED='false';resume();
    expect((await shopping).status).toBe(409);expect(await Delivery.countDocuments({orderId:order._id})).toBe(0);
    expect((await Order.findById(order._id)).deliveryPartnerId).toBeUndefined();
    expect(String((await Partner.findById(partner._id)).parcelReservation.bookingId)).toBe(String(b._id));
    await assertSingleProduct(partner._id);
  }finally{resume();await shopping;spy.mockRestore();delete process.env.RIDER_MAX_CONCURRENT_DELIVERIES;process.env.PARCEL_DELIVERY_FULFILMENT_ENABLED='true';}
});
test('readiness: disabling the parcel flag does not allow reverse pickup to bypass an existing reservation',async()=>{
  const b=await booking();await accept(b);process.env.PARCEL_DELIVERY_FULFILMENT_ENABLED='false';
  try{await expect(acceptReturnPickup({returnId:String(new mongoose.Types.ObjectId()),partnerId:partner._id})).rejects.toMatchObject({status:409});}
  finally{process.env.PARCEL_DELIVERY_FULFILMENT_ENABLED='true';}
});
test('readiness: ordinary shopping keeps unlimited/limited sequential acceptance and duty semantics',async()=>{
  process.env.RIDER_MAX_CONCURRENT_DELIVERIES='0';process.env.PARCEL_DELIVERY_FULFILMENT_ENABLED='false';
  try{
    for(let i=0;i<2;i++){const order=await shoppingFixture();await drv(request(app).post(`/shopping/${order._id}/accept`)).send({}).expect(200);}
    expect((await Partner.findById(partner._id)).isAvailable).toBe(true);
    process.env.RIDER_MAX_CONCURRENT_DELIVERIES='1';const order=await shoppingFixture();await drv(request(app).post(`/shopping/${order._id}/accept`)).send({}).expect(409);
  }finally{delete process.env.RIDER_MAX_CONCURRENT_DELIVERIES;process.env.PARCEL_DELIVERY_FULFILMENT_ENABLED='true';}
});
test('readiness: a stale expired offer cannot release another reservation on the same driver',async()=>{
  const b=await booking(),otherBooking=new mongoose.Types.ObjectId();
  await Parcel.updateOne({_id:b._id},{$set:{'assignment.offer.expiresAt':new Date(0)}});
  await Partner.updateOne({_id:partner._id},{$set:{parcelReservation:{bookingId:otherBooking,previousDuty:true},isAvailable:false}});
  await assignment.sweepParcelsOnce();const p=await Partner.findById(partner._id);
  expect(String(p.parcelReservation.bookingId)).toBe(String(otherBooking));expect(p.isAvailable).toBe(false);
});
test('readiness: cancellation racing with capture never dispatches an unverified or held booking',async()=>{
  const b=await booking('online'),c=await checkout(b),d=await adminDetail(b._id);capture(c);
  const [payment,cancel]=await Promise.all([verify(b,c),auth(request(app).post(`/c/bookings/${b._id}/cancellation`)).send({version:d.version,reason:'Concurrent cancellation'})]);
  expect(payment.status).toBe(200);expect([200,409]).toContain(cancel.status);
  const fresh=await Parcel.findById(b._id);expect((await Payment.findById(b._id)).captures).toHaveLength(1);
  if(cancel.status===200){expect(fresh.status).toBe('cancellation_review');expect(assignment.dispatchReady(fresh)).toBe(false);}else expect(fresh.paymentStatus).toBe('paid');
});
test('readiness: concurrent duplicate capture and a delayed failure do not double-post or downgrade paid money',async()=>{
  const b=await booking('online'),c=await checkout(b),p=capture(c);
  const results=await Promise.all([verify(b,c),webhook({event:'payment.captured',payload:{payment:{entity:p}}})]);expect(results.map(r=>r.status)).toEqual([200,200]);
  await webhook({event:'payment.failed',payload:{payment:{entity:{...p,status:'failed'}}}});
  expect((await Parcel.findById(b._id)).paymentStatus).toBe('paid');expect(await Ledger.countDocuments({parcelDeliveryId:b._id,account:'parcel_collections',direction:'credit'})).toBe(1);
});
test('readiness: a signed late event recovers an uncertain initialization using independent provider notes',async()=>{
  const b=await booking('online'),key=crypto.randomUUID();uncertain=true;
  await auth(request(app).post(`/c/bookings/${b._id}/payment`)).set('Idempotency-Key',key).send({policyVersion:1,acceptTerms:true}).expect(503);
  uncertain=false;const p=capture({razorpayOrderId:'order_1',amountPaise:2040});
  expect((await webhook({event:'payment.captured',payload:{payment:{entity:p}}})).status).toBe(200);
  expect((await Parcel.findById(b._id)).paymentStatus).toBe('paid');expect(sdk.orders.create).toHaveBeenCalledTimes(1);
});
test('readiness: uncertain refund retries require reconciliation and issue no second provider request',async()=>{
  const b=await paid(),d=await adminDetail(b._id);
  await auth(request(app).post(`/c/bookings/${b._id}/cancellation`)).send({version:d.version,reason:'Refund transport test'}).expect(200);await aact(b,'approve_cancellation');await aact(b,'approve_refund',{amountPaise:2040});
  const key=(await adminDetail(b._id)).payment.refundObligations[0].key;refundUnknown=true;
  await adm(request(app).post(`/a/bookings/${b._id}/refund`)).send({key}).expect(200);expect((await adminDetail(b._id)).refund.refundedPaise).toBe(0);
  refundUnknown=false;await adm(request(app).post(`/a/bookings/${b._id}/refund`)).send({key}).expect(409);
  await adm(request(app).post(`/a/bookings/${b._id}/refund`)).send({key,reconcile:true}).expect(200);
  await adm(request(app).post(`/a/bookings/${b._id}/refund`)).send({key,reconcile:true}).expect(200);
  expect(sdk.payments.refund).toHaveBeenCalledTimes(1);expect((await adminDetail(b._id)).refund.refundedPaise).toBe(2040);
});
test('readiness: cash collection and reconciliation races post once and never fund ordinary rider payouts',async()=>{
  const b=await booking();await toDrop(b);let d=await driverDetail(b._id);
  const collect=()=>drv(request(app).post(`/d/bookings/${b._id}/actions`)).send({action:'collect_cash',version:d.version,amountPaise:2040});
  expect((await Promise.all([collect(),collect()])).map(r=>r.status).sort()).toEqual([200,409]);
  d=await adminDetail(b._id);const reconcile=()=>adm(request(app).post(`/a/bookings/${b._id}/actions`)).send({action:'reconcile_cash',version:d.version,reason:'Reviewed bank deposit',evidence:'SYNTHETIC-VERIFIED-DEPOSIT',amountPaise:2040});
  expect((await Promise.all([reconcile(),reconcile()])).map(r=>r.status).sort()).toEqual([200,409]);
  await dact(b,'delivery_code');const customerView=(await auth(request(app).get(`/c/bookings/${b._id}`))).body.data;await dact(b,'verify_delivery',{code:customerView.deliveryCode});
  const rows=await Ledger.find({parcelDeliveryId:b._id});expect(rows.some(r=>['rider_payable','seller_payable','cod_custody','merchandise_gross'].includes(r.account))).toBe(false);
  await Partner.updateOne({_id:partner._id},{$set:{financialWorkflowVersion:2}});
  const {riderFinancialSummary}=await import('../services/deliveryPayout.service.js');expect((await riderFinancialSummary(await Partner.findById(partner._id))).verifiedPayable).toBe(0);
  const {default:Payout}=await import('../models/DeliveryPayout.js');expect(await Payout.countDocuments()).toBe(0);
});
test('readiness: parcel payments and ledger replays reject incompatible shopping references and currencies',async()=>{
  await expect(Payment.create({userId:customer._id,parcelDeliveryId:new mongoose.Types.ObjectId(),orderId:new mongoose.Types.ObjectId(),amount:1,method:'online'})).rejects.toThrow(/exclusive/);
  const b=await paid(),entry=await Ledger.findOne({parcelDeliveryId:b._id}),{postLedgerEntry}=await import('../services/sellerLedger.service.js');
  await expect(postLedgerEntry({...entry.toObject(),currency:'USD'})).rejects.toThrow(/currency/);
  await expect(Ledger.create({entryNo:crypto.randomUUID(),idempotencyKey:crypto.randomUUID(),parcelDeliveryId:b._id,partnerId:partner._id,account:'parcel_driver_payable',type:'adjustment',direction:'credit',bucket:'eligible',amount:1,description:'Unapproved release'})).rejects.toThrow(/held/);
});
