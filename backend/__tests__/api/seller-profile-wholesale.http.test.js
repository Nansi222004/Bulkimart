import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
jest.unstable_mockModule('../../services/cloudinary.service.js',()=>({uploadToCloudinary:jest.fn(),uploadFileWithMeta:jest.fn()}));
jest.unstable_mockModule('../../services/notification.service.js',()=>({registerPushToken:jest.fn(),notifyUser:jest.fn(),notifySeller:jest.fn(),notifyRider:jest.fn(),notifyAllAdmins:jest.fn(),NOTIFICATION_EVENT:new Proxy({},{get:(_,key)=>String(key)})}));
const [{default:sellerRoutes},{default:productRoutes},{errorHandler},{default:Seller},{default:User},{default:Product},{default:Category},{default:Admin},{protect,requireAdmin},{decideSellerWholesaleChannel}]=await Promise.all([
  import('../../routes/seller.routes.js'),import('../../routes/product.routes.js'),import('../../middlewares/error.middleware.js'),import('../../models/Seller.js'),import('../../models/User.js'),import('../../models/Product.js'),import('../../models/Category.js'),import('../../models/Admin.js'),import('../../middlewares/auth.middleware.js'),import('../../controllers/admin.controller.js'),
]);
const app=express();app.use(express.json());app.use('/api/sellers',sellerRoutes);app.use('/api/products',productRoutes);app.patch('/api/admin/sellers/:id/wholesale',protect,requireAdmin,decideSellerWholesaleChannel);app.use(errorHandler);
let database,user,other,seller,product,category,token,otherToken;
const terms={enabled:true,minimumQuantity:10,quantityIncrement:5,priceTiers:[{minimumQuantity:10,unitPrice:95},{minimumQuantity:50,unitPrice:85}]};
const auth=(req,value=token)=>req.set('Authorization','Bearer '+value);
const encode=(id,role='seller',type='user')=>jwt.sign({id:String(id),...(type==='user'?{role}:{}),type},process.env.JWT_SECRET);
const save=(pricing=terms,extra={})=>auth(request(app).patch(`/api/products/${product._id}/wholesale-pricing`)).send({variants:[{variantId:product.variants[0]._id,wholesalePricing:pricing}],...extra});
beforeAll(async()=>{database=await MongoMemoryReplSet.create({replSet:{count:1}});await mongoose.connect(database.getUri('isolated_seller_profile_wholesale'));});
afterAll(async()=>{await mongoose.disconnect();await database?.stop();});
beforeEach(async()=>{
  for(const collection of Object.values(mongoose.connection.collections))await collection.deleteMany({});
  [user,other]=await User.create([{name:'Profile Owner',phone:'9876500001',email:'owner@example.invalid',roles:['buyer','seller']},{name:'Other Owner',phone:'9876500002',roles:['seller']}]);
  seller=await Seller.create({userId:user._id,businessName:'Legal Business',status:'approved',salesChannels:['ecommerce','grocery','wholesale'],wholesaleChannel:{status:'approved'},storeDetails:{name:'Owner Store',phone:'9876500003',email:'store@example.invalid',city:'Mumbai'}});
  await Seller.create({userId:other._id,status:'approved',businessName:'Other Store'});
  category=await Category.create({name:'Fixture physical',type:'ecommerce',isActive:true});
  product=await Product.create({name:'Shared physical product',sellerId:seller._id,category:category._id,type:'ecommerce',status:'approved',isActive:true,variants:[{name:'Case',price:100,mrp:120,stock:100,unit:'piece'},{name:'Box',price:200,mrp:220,stock:80,unit:'piece'}],channels:[]});
  token=encode(user._id);otherToken=encode(other._id);
});
test('profile identifies only the authenticated owner and keeps account/store contacts distinct',async()=>{
  const {body}=await auth(request(app).get('/api/sellers/me')).expect(200);
  expect(body.seller.userId).toMatchObject({_id:String(user._id),name:user.name,phone:user.phone,email:user.email});
  expect(body.seller.storeDetails).toMatchObject({name:'Owner Store',phone:'9876500003',email:'store@example.invalid'});
  const otherProfile=await auth(request(app).get('/api/sellers/me'),otherToken).expect(200);expect(otherProfile.body.seller._id).not.toBe(String(seller._id));
  await request(app).get('/api/sellers/me').expect(401);
});
test('store profile edits persist, clear optional fields, preserve identity/approval and reject stale versions',async()=>{
  const response=await auth(request(app).put('/api/sellers/profile')).send({name:'Updated Store',phone:'',email:'new@example.invalid',city:'Pune',version:0}).expect(200);
  expect(response.body.seller.userId.phone).toBe(user.phone);
  const saved=(await auth(request(app).get('/api/sellers/me')).expect(200)).body.seller;
  expect(saved.storeDetails).toMatchObject({name:'Updated Store',phone:'',email:'new@example.invalid',city:'Pune'});
  expect(saved.wholesaleChannel.status).toBe('approved');expect(saved.businessName).toBe('Legal Business');
  await auth(request(app).put('/api/sellers/profile')).send({name:'Stale',version:0}).expect(409);
  expect((await Seller.findById(seller._id)).storeDetails.name).toBe('Updated Store');
});
test('concurrent profile saves with the same version cannot overwrite one another',async()=>{
  const results=await Promise.all(['First Store','Second Store'].map(name=>auth(request(app).put('/api/sellers/profile')).send({name,version:0})));
  expect(results.map(result=>result.status).sort()).toEqual([200,409]);
  expect((await Seller.findById(seller._id)).storeDetails.name).toBe(results.find(result=>result.status===200).body.seller.storeDetails.name);
});
test.each([{name:''},{email:'bad'},{phone:'123'},{pincode:'123'},{lat:95,lng:72},{lat:20},{name:{injected:true}}])('invalid profile fields are rejected without persistence (%j)',async body=>{
  await auth(request(app).put('/api/sellers/profile')).send(body).expect(400);expect((await Seller.findById(seller._id)).storeDetails.name).toBe('Owner Store');
});
test.each(['status','wholesaleChannel','salesChannels','userId','businessName','approvedBy','bankDetails'])('seller cannot edit server-controlled %s',async field=>{
  await auth(request(app).put('/api/sellers/profile')).send({[field]:field==='status'?'approved':{status:'approved'}}).expect(400);
  expect((await Seller.findById(seller._id)).businessName).toBe('Legal Business');
});
test('pending, approved and suspended Wholesale states are authoritative after admin transitions',async()=>{
  await Seller.updateOne({_id:seller._id},{$set:{'wholesaleChannel.status':'pending',salesChannels:['ecommerce','grocery']}});
  expect((await auth(request(app).get('/api/sellers/me'))).body.seller.wholesaleChannel.status).toBe('pending');
  const admin=await Admin.create({email:'fixture-admin@example.invalid',password:'FixturePasswordOnly',role:'superAdmin'});
  for(const status of ['approved','suspended']){
    const current=await Seller.findById(seller._id);
    await auth(request(app).patch(`/api/admin/sellers/${seller._id}/wholesale`),encode(admin._id,'superAdmin','admin')).send({status,version:current.__v,suspensionReason:'Fixture review'}).expect(200);
    expect((await auth(request(app).get('/api/sellers/me'))).body.seller.wholesaleChannel.status).toBe(status);
  }
  await auth(request(app).patch(`/api/admin/sellers/${seller._id}/wholesale`)).send({status:'approved',version:2}).expect(403);
});
test.each(['ecommerce','grocery'])('variant offers save/reload/disable without changing %s retail or inventory',async type=>{
  await Category.updateOne({_id:category._id},{$set:{type}});await Product.updateOne({_id:product._id},{$set:{type}});
  const before=await Product.findById(product._id).lean();const saved=await save(terms,{version:before.__v}).expect(200);
  expect(saved.body.version).toBe(before.__v+1);
  const list=(await auth(request(app).get('/api/products/seller/mine?roleContext=seller'))).body;
  expect(list[0].variants[0].wholesalePricing.minimumQuantity).toBe(10);
  expect(list[0].variants[1].wholesalePricing).toBeUndefined();
  const after=await Product.findById(product._id).select('+variants.wholesalePricing').lean();
  expect(after.variants.map(v=>[v._id,v.price,v.mrp,v.stock,v.sku])).toEqual(before.variants.map(v=>[v._id,v.price,v.mrp,v.stock,v.sku]));
  await save({enabled:false},{version:saved.body.version}).expect(200);
  const disabled=await Product.findById(product._id).select('+variants.wholesalePricing');expect(disabled.variants[0].wholesalePricing.enabled).toBe(false);expect(disabled.isActive).toBe(true);expect(disabled.variants[0].price).toBe(100);
  const publicResponse=await request(app).get('/api/products/'+product._id).expect(200);expect(JSON.stringify(publicResponse.body)).not.toContain('wholesalePricing');
});
test.each(['pending','rejected','suspended','not_requested'])('unapproved Wholesale access cannot enable an offer (%s)',async status=>{
  await Seller.updateOne({_id:seller._id},{$set:{'wholesaleChannel.status':status,salesChannels:['ecommerce','grocery']}});await save().expect(403);
});
test('ownership, variant association, duplicates and stale saves are enforced',async()=>{
  await auth(request(app).patch(`/api/products/${product._id}/wholesale-pricing`),otherToken).send({variants:[{variantId:product.variants[0]._id,wholesalePricing:terms}]}).expect(404);
  await save(terms,{variants:[{variantId:new mongoose.Types.ObjectId(),wholesalePricing:terms}]}).expect(400);
  await save(terms,{variants:[1,2].map(()=>({variantId:product.variants[0]._id,wholesalePricing:terms}))}).expect(400);
  await save(terms,{version:0}).expect(200);await save({...terms,priceTiers:[{minimumQuantity:10,unitPrice:90}]},{version:0}).expect(409);
});
test('offer activation and an admin suspension serialize through the seller version',async()=>{
  const admin=await Admin.create({email:'race-admin@example.invalid',password:'FixturePasswordOnly',role:'superAdmin'});
  const [offer,decision]=await Promise.all([save(terms,{version:0}),auth(request(app).patch(`/api/admin/sellers/${seller._id}/wholesale`),encode(admin._id,'superAdmin','admin')).send({status:'suspended',version:0})]);
  expect([200,403]).toContain(offer.status);expect([200,409]).toContain(decision.status);
  const current=await Seller.findById(seller._id);
  if(offer.status===403){expect(current.wholesaleChannel.status).toBe('suspended');expect((await Product.findById(product._id).select('+variants.wholesalePricing')).variants[0].wholesalePricing).toBeUndefined();}
  if(offer.status===200&&decision.status===409)expect(current.wholesaleChannel.status).toBe('approved');
});
test.each([{minimumQuantity:0},{minimumQuantity:1.5},{quantityIncrement:0},{priceTiers:[]},{priceTiers:[{minimumQuantity:11,unitPrice:95}]},{priceTiers:[{minimumQuantity:10,unitPrice:0}]},{priceTiers:[{minimumQuantity:10,unitPrice:95.001}]},{priceTiers:[{minimumQuantity:10,unitPrice:95},{minimumQuantity:50,unitPrice:96}]},{priceTiers:[{minimumQuantity:10,unitPrice:95},{minimumQuantity:10,unitPrice:85}]}])('invalid terms are rejected (%j)',async change=>{await save({...terms,...change}).expect(400);});
test.each(['digital','inactive','pending','category','stock','account'])('ineligible %s cannot receive enabled Wholesale terms',async scenario=>{
  if(scenario==='digital')await Product.updateOne({_id:product._id},{$set:{fulfillmentType:'digital'}});
  if(scenario==='inactive')await Product.updateOne({_id:product._id},{$set:{isActive:false}});
  if(scenario==='pending')await Product.updateOne({_id:product._id},{$set:{status:'pending'}});
  if(scenario==='category')await Category.updateOne({_id:category._id},{$set:{isActive:false}});
  if(scenario==='stock')await Product.updateOne({_id:product._id},{$set:{'variants.0.stock':2}});
  if(scenario==='account')await User.updateOne({_id:user._id},{$set:{isActive:false}});
  const result=await save();expect([400,401,403,409]).toContain(result.status);
  expect((await Product.findById(product._id).select('+variants.wholesalePricing')).variants[0].wholesalePricing).toBeUndefined();
});
test.each([
  {minimumQuantity:100001},
  {quantityIncrement:100001},
  {priceTiers:[{minimumQuantity:10,unitPrice:100000.01}]},
  {priceTiers:[{minimumQuantity:10,unitPrice:-1}]},
])('seller offer API enforces quantity and money limits (%j)',async change=>{
  await save({...terms,...change}).expect(400);
  expect((await Product.findById(product._id).select('+variants.wholesalePricing')).variants[0].wholesalePricing).toBeUndefined();
});
