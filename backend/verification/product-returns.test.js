import {jest} from '@jest/globals';
import mongoose from 'mongoose';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import {MongoMemoryReplSet} from 'mongodb-memory-server';
const cloudinary=await import('../services/cloudinary.service.js');
jest.unstable_mockModule('../services/cloudinary.service.js',()=>({...cloudinary,uploadToCloudinary:async()=> 'https://example.test/product.jpg'}));
const [{default:routes},{default:Product},{default:Category},{default:Policy},{default:Seller},{default:User},{errorHandler},{JWT_SECRET},{applyProductReturnSettings}]=await Promise.all([
  import('../routes/product.routes.js'),import('../models/Product.js'),import('../models/Category.js'),import('../models/CategoryReturnPolicy.js'),import('../models/Seller.js'),import('../models/User.js'),import('../middlewares/error.middleware.js'),import('../config/jwt.js'),import('../services/productReturns.service.js')]);
const app=express();app.use(express.json());app.use('/api/products',routes);app.use(errorHandler);
const {default:GlobalPolicy}=await import('../models/GlobalReturnPolicy.js');
const {saveGlobalReturnPolicy,resolveReturnPolicyForCategory}=await import('../services/returnPolicy.service.js');
let db,user,seller,other,category,product;
const auth=(r,u=user)=>r.set('Authorization','Bearer '+jwt.sign({id:String(u._id),type:'user',role:'seller'},JWT_SECRET));
beforeAll(async()=>{db=await MongoMemoryReplSet.create({binary:{version:'7.0.14'},replSet:{count:1}});await mongoose.connect(db.getUri());});
beforeEach(async()=>{
  for(const model of [Product,Category,Policy,GlobalPolicy,Seller,User])await model.deleteMany({});
  [user,other]=await User.create([{phone:'9876500891',roles:['seller']},{phone:'9876500892',roles:['seller']}]);
  seller=await Seller.create({userId:user._id,status:'approved',businessName:'Return test seller',salesChannels:['ecommerce','grocery']});
  category=await Category.create({name:'Return test category',slug:'return-test',type:'ecommerce',isActive:true});
  await Policy.create({categoryId:category._id,returnWindowDays:7,isActive:true});
  product=await Product.create({type:'ecommerce',name:'Return test item',category:category._id,sellerId:seller._id,images:['https://example.test/product.jpg'],variants:[{name:'Default',price:100,mrp:100,stock:10,unit:'piece'}],status:'approved',isActive:true});
});
afterAll(async()=>{await mongoose.disconnect();await db?.stop();});
test('checkout freezes the seller window on the persisted order item',async()=>{
  const {createOrdersFromGroups}=await import('../services/fulfilmentOrders.service.js');
  const {financialTransaction}=await import('../services/financeSafety.service.js');
  const {default:Order}=await import('../models/Order.js');
  product.returnSettings={enabled:true,windowDays:3};await product.save();
  const group={channel:'ecommerce',subtotal:100,total:100,deliveryCharge:0,items:[{productId:product._id,variantId:product.variants[0]._id,name:product.name,sellerId:seller._id,qty:1,price:100,type:'ecommerce'}]};
  const result=await financialTransaction(session=>createOrdersFromGroups({user,address:{name:'Test',phone:'9876500891',line1:'Test street',city:'Test city',state:'Madhya Pradesh',pincode:'452001'},groups:[group],paymentMethod:'cod',session}));
  const frozen=await Order.findById(result.orders[0]._id);expect(frozen.items[0].returnPolicy.returnWindowDays).toBe(3);expect(frozen.items[0].returnPolicy.returnEligible).toBe(true);
  product=await Product.findById(product._id);product.returnSettings={enabled:false};await product.save();await Policy.updateOne({categoryId:category._id},{$set:{returnWindowDays:1}});
  expect((await Order.findById(frozen._id)).items[0].returnPolicy.returnWindowDays).toBe(3);
});
test('historical Shop All products retain category returns until a seller sets an override',async()=>{
  const r=await request(app).get('/api/products/'+product._id).expect(200);expect(r.body.returnPolicy).toEqual({eligible:true,returnWindowDays:7});
});
test('seller can choose a Shop All product window, disable it and re-enable the category default',async()=>{
  await auth(request(app).put('/api/products/'+product._id)).send({returnable:true,returnWindowDays:'3'}).expect(200);
  let r=await request(app).get('/api/products/'+product._id).expect(200);expect(r.body.returnPolicy).toEqual({eligible:true,returnWindowDays:3});
  await auth(request(app).put('/api/products/'+product._id)).send({returnable:false,returnWindowDays:''}).expect(200);
  r=await request(app).get('/api/products/'+product._id).expect(200);expect(r.body.returnPolicy.eligible).toBe(false);
  await auth(request(app).put('/api/products/'+product._id)).send({returnable:true,returnWindowDays:''}).expect(200);
  r=await request(app).get('/api/products/'+product._id).expect(200);expect(r.body.returnPolicy.returnWindowDays).toBe(7);
});
test.each(['0','-1','1.5','8','abc'])('invalid product return window %s is rejected without changing saved settings',async days=>{
  await auth(request(app).put('/api/products/'+product._id)).send({returnable:true,returnWindowDays:days}).expect(400);
  expect((await Product.findById(product._id)).returnSettings).toBeUndefined();
});
test('another seller cannot change return terms',async()=>{await auth(request(app).put('/api/products/'+product._id),other).send({returnable:false}).expect(403);});
test('new product creation persists the seller-selected window',async()=>{
  const r=await auth(request(app).post('/api/products')).field('type','ecommerce').field('name','New return product').field('category',String(category._id)).field('returnable','true').field('returnWindowDays','2').field('variants',JSON.stringify([{name:'Default',price:100,mrp:100,stock:1,unit:'piece'}])).attach('images',Buffer.from('fixture'),'test.jpg').expect(201);
  expect(r.body.product.returnSettings.windowDays).toBe(2);
});
test('Quick Commerce uses its existing switch plus the seller window',async()=>{
  category.type='grocery';await category.save();product.type='grocery';product.returnable=true;product.returnSettings={enabled:true,windowDays:2};await product.save();
  let r=await request(app).get('/api/products/'+product._id).expect(200);expect(r.body.returnPolicy.returnWindowDays).toBe(2);
  await auth(request(app).put('/api/products/'+product._id)).send({returnable:false}).expect(200);
  r=await request(app).get('/api/products/'+product._id).expect(200);expect(r.body.returnPolicy.eligible).toBe(false);
});
test('category limits remain authoritative, and order snapshots stay unchanged after later edits',async()=>{
  const p={type:'ecommerce',returnSettings:{enabled:true,windowDays:3}};
  const snapshot=applyProductReturnSettings(p,{returnEligible:true,returnWindowDays:7});
  expect(snapshot.returnWindowDays).toBe(3);p.returnSettings.windowDays=1;
  expect(snapshot.returnWindowDays).toBe(3);expect(applyProductReturnSettings(p,{returnEligible:true,returnWindowDays:7}).returnWindowDays).toBe(1);
  expect(applyProductReturnSettings({...p,returnSettings:{enabled:true,windowDays:10}},{returnEligible:true,returnWindowDays:2}).returnWindowDays).toBe(2);
});
test('a missing category policy and digital products do not gain returns',async()=>{
  await Policy.deleteMany({});await auth(request(app).put('/api/products/'+product._id)).send({returnable:true,returnWindowDays:'3'}).expect(400);
  const resolved=applyProductReturnSettings({type:'ecommerce',fulfillmentType:'digital'},{returnEligible:true,returnWindowDays:7});expect(resolved.returnEligible).toBe(false);
});

test('global fallback lets a seller choose days when the category is unconfigured, without auto-enabling products',async()=>{
  await Policy.deleteMany({});await saveGlobalReturnPolicy({returnWindowDays:7,isActive:true,version:0});
  let r=await request(app).get('/api/products/'+product._id).expect(200);expect(r.body.returnPolicy.eligible).toBe(false);
  await auth(request(app).put('/api/products/'+product._id)).send({returnable:true,returnWindowDays:'3'}).expect(200);
  r=await request(app).get('/api/products/'+product._id).expect(200);expect(r.body.returnPolicy).toEqual({eligible:true,returnWindowDays:3,source:'global'});
  await auth(request(app).put('/api/products/'+product._id)).send({returnable:true,returnWindowDays:'8'}).expect(400);
});
test('explicit category limits, zero-day rules and inactive policies take precedence over global defaults',async()=>{
  await saveGlobalReturnPolicy({returnWindowDays:14,isActive:true,version:0});
  expect((await resolveReturnPolicyForCategory(category._id)).returnWindowDays).toBe(7);
  await Policy.updateOne({categoryId:category._id},{$set:{returnWindowDays:0}});expect((await resolveReturnPolicyForCategory(category._id)).eligible).toBe(false);
  await Policy.updateOne({categoryId:category._id},{$set:{returnWindowDays:7,isActive:false}});expect((await resolveReturnPolicyForCategory(category._id)).eligible).toBe(false);
  await Policy.deleteMany({});expect((await resolveReturnPolicyForCategory(category._id)).returnWindowDays).toBe(14);
});
test('global settings reject empty or stale updates and disabling the default removes fallback eligibility',async()=>{
  await expect(saveGlobalReturnPolicy({returnWindowDays:'',isActive:true,version:0})).rejects.toMatchObject({status:400});
  await saveGlobalReturnPolicy({returnWindowDays:7,isActive:true,version:0});
  await expect(saveGlobalReturnPolicy({returnWindowDays:14,isActive:true,version:0})).rejects.toMatchObject({status:409});
  await saveGlobalReturnPolicy({returnWindowDays:7,isActive:false,version:1});
  await Policy.deleteMany({});expect((await resolveReturnPolicyForCategory(category._id)).eligible).toBe(false);
  expect((await resolveReturnPolicyForCategory(new mongoose.Types.ObjectId())).eligible).toBe(false);
});
test('global fallback is frozen on a new order and later global edits do not change it',async()=>{
  await Policy.deleteMany({});await saveGlobalReturnPolicy({returnWindowDays:7,isActive:true,version:0});
  product.returnSettings={enabled:true,windowDays:3};await product.save();
  const {createOrdersFromGroups}=await import('../services/fulfilmentOrders.service.js');const {financialTransaction}=await import('../services/financeSafety.service.js');const {default:Order}=await import('../models/Order.js');
  const group={channel:'ecommerce',subtotal:100,total:100,deliveryCharge:0,items:[{productId:product._id,variantId:product.variants[0]._id,name:product.name,sellerId:seller._id,qty:1,price:100,type:'ecommerce'}]};
  const result=await financialTransaction(session=>createOrdersFromGroups({user,address:{name:'Test'},groups:[group],paymentMethod:'cod',session}));
  await saveGlobalReturnPolicy({returnWindowDays:1,isActive:true,version:1});
  const frozen=await Order.findById(result.orders[0]._id);expect(frozen.items[0].returnPolicy.returnWindowDays).toBe(3);expect(frozen.items[0].returnPolicy.source).toBe('global');
});
