import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
const upload = jest.fn(async () => 'https://fixture.invalid/cover.png');
jest.unstable_mockModule('../../services/cloudinary.service.js', () => ({ uploadToCloudinary: upload, uploadFileWithMeta: jest.fn() }));
const [{default:routes},{default:cartRoutes},{errorHandler},{default:Seller},{default:User},{default:Product},{default:Category},{default:Cart},{buildFulfilmentGroups},{publicProduct},{imageSearchVisibility}] = await Promise.all([
  import('../../routes/product.routes.js'),import('../../routes/cart.routes.js'),import('../../middlewares/error.middleware.js'),import('../../models/Seller.js'),import('../../models/User.js'),import('../../models/Product.js'),import('../../models/Category.js'),import('../../models/Cart.js'),import('../../services/fulfilmentGroups.service.js'),import('../../utils/publicProduct.js'),import('../../services/imageSearch.service.js'),
]);
const app=express();app.use(express.json());app.use('/api/products',routes);app.use('/api/cart',cartRoutes);app.use(errorHandler);
let db,user,seller,category,token,buyerToken,otherToken;
const terms={enabled:true,minimumQuantity:10,quantityIncrement:5,priceTiers:[{minimumQuantity:10,unitPrice:95},{minimumQuantity:50,unitPrice:85}]};
const variant=()=>({name:'Case',stock:100,unit:'pack',sku:'B2B-CASE',attributes:[{name:'Size',value:'Large'}],wholesalePricing:terms});
const auth=(req,t=token)=>req.set('Authorization','Bearer '+t);
const create=(changes={},t=token)=>{const body={type:'ecommerce',name:'Wholesale-only fixture',category:String(category._id),sellingChannels:['wholesale'],variants:[variant()],...changes};let req=auth(request(app).post('/api/products'),t);for(const [key,value] of Object.entries(body))req=req.field(key,typeof value==='object'?JSON.stringify(value):String(value));return req.attach('images',Buffer.from('fixture'),'cover.jpg');};
beforeAll(async()=>{db=await MongoMemoryReplSet.create({replSet:{count:1}});await mongoose.connect(db.getUri('wholesale_creation_fixture'));await Promise.all(Object.values(mongoose.models).map(model=>model.init()));});
afterAll(async()=>{await mongoose.disconnect();await db?.stop();});
beforeEach(async()=>{
  for(const collection of Object.values(mongoose.connection.collections))await collection.deleteMany({});
  upload.mockReset().mockResolvedValue('https://fixture.invalid/cover.png');
  const users=await User.create([{name:'Owner',phone:'9876500111',roles:['seller','buyer']},{name:'Other',phone:'9876500112',roles:['seller']}]);user=users[0];
  seller=await Seller.create({userId:user._id,status:'approved',businessName:'Wholesale Fixture',salesChannels:['ecommerce','grocery','wholesale'],wholesaleChannel:{status:'approved'}});
  await Seller.create({userId:users[1]._id,status:'approved',businessName:'Other',salesChannels:['ecommerce']});
  category=await Category.create({name:'Physical fixture',type:'ecommerce',isActive:true});
  const encode=(id,role)=>jwt.sign({id:String(id),type:'user',role},process.env.JWT_SECRET);token=encode(user._id,'seller');buyerToken=encode(user._id,'buyer');otherToken=encode(users[1]._id,'seller');
});
test('creates one complete Wholesale-only product with server IDs, photos, attributes, tiers and shared stock; reload and edit retain isolation',async()=>{
  const response=await create({sellerId:'foreign',status:'pending'}).expect(201);const p=response.body.product;
  expect(p.sellerId).toBe(String(seller._id));expect(p.sellingChannels).toEqual(['wholesale']);expect(p.status).toBe('approved');expect(p.images).toHaveLength(1);expect(p.price).toBe(0);expect(p.variants[0].wholesalePricing.priceTiers).toHaveLength(2);expect(p.variants[0].attributes[0]).toMatchObject({name:'Size',value:'Large'});
  const own=await auth(request(app).get('/api/products/seller/mine')).expect(200);expect(own.body.products||own.body.data||own.body).toEqual(expect.arrayContaining([expect.objectContaining({_id:p._id})]));
  const catalog=await auth(request(app).get('/api/products/wholesale/catalog'),buyerToken).expect(200);expect(catalog.body.data[0]._id).toBe(p._id);
  await auth(request(app).put('/api/products/'+p._id)).send({name:'Updated Wholesale',variants:p.variants}).expect(200);
  const stored=await Product.findById(p._id).select('+variants.wholesalePricing');expect(stored.variants[0].wholesalePricing.priceTiers).toHaveLength(2);expect(stored.sellingChannels).toEqual(['wholesale']);
  await auth(request(app).put('/api/products/'+p._id),otherToken).send({name:'Intrusion'}).expect(403);
});
test('all retail catalogs/search/featured/image search/direct details/delivery and seller retail tabs exclude Wholesale-only listings',async()=>{
  const {body:{product:p}}=await create().expect(201);await Product.updateOne({_id:p._id},{$set:{isFeatured:true,isSponsored:true}});
  for(const path of ['?type=ecommerce','?type=grocery','/grocery','/featured?type=ecommerce','/search?type=ecommerce&q=Wholesale']){const r=await request(app).get('/api/products'+path).expect(200);expect(JSON.stringify(r.body)).not.toContain(p._id);}
  for(const path of ['','?type=ecommerce','?type=grocery','/delivery-options','/reviews','/faqs'])await request(app).get('/api/products/'+p._id+path).expect(404);
  for(const type of ['ecommerce','grocery']){const r=await auth(request(app).get('/api/products/seller/mine?type='+type)).expect(200);expect(JSON.stringify(r.body)).not.toContain(p._id);expect(await Product.countDocuments(imageSearchVisibility(type))).toBe(0);}
  expect(publicProduct(await Product.findById(p._id))).toBeNull();
});
test('direct retail cart and stale injected retail checkout lines reject Wholesale-only products; Wholesale quote works',async()=>{
  const {body:{product:p}}=await create().expect(201);const v=p.variants[0];
  await auth(request(app).post('/api/cart/items'),buyerToken).send({productId:p._id,variantId:v._id,qty:1}).expect(404);
  const quote=await auth(request(app).post('/api/products/wholesale/quote'),buyerToken).send({productId:p._id,variantId:v._id,quantity:10}).expect(200);expect(quote.body.data.unitPrice).toBe(95);expect(quote.body.data.retailUnitPrice).toBeNull();
  await Cart.create({userId:user._id,channel:'ecommerce',items:[{productId:p._id,variantId:v._id,name:p.name,price:0,qty:1}]});
  const grouped=await buildFulfilmentGroups({userId:user._id,destination:{},user});expect(grouped.items[0].available).toBe(false);
});
test.each(['pending','suspended','rejected'])('unapproved Wholesale seller (%s) cannot create; no partial product',async status=>{await Seller.updateOne({_id:seller._id},{$set:{'wholesaleChannel.status':status}});await create().expect(403);expect(await Product.countDocuments()).toBe(0);expect(upload).not.toHaveBeenCalled();});
test.each([
  {fulfillmentType:'digital'}, {variants:[]}, {variants:[null]}, {variants:'{'}, {variants:[{...variant(),attributes:[{name:'Size',value:''}]}]}, {variants:[{...variant(),stock:2}]}, {variants:[{...variant(),stock:1.5}]},
  {variants:[{...variant(),wholesalePricing:{enabled:false}}]},
  ...[{minimumQuantity:0},{quantityIncrement:0},{priceTiers:[{minimumQuantity:11,unitPrice:1}]},{priceTiers:[{minimumQuantity:10,unitPrice:0}]},{priceTiers:[{minimumQuantity:10,unitPrice:1.001}]},{priceTiers:[{minimumQuantity:10,unitPrice:5},{minimumQuantity:10,unitPrice:4}]}].map(change=>({variants:[{...variant(),wholesalePricing:{...terms,...change}}]})),
  {sellingChannels:[]}, {sellingChannels:['wholesale','foreign']}, {channels:[]},
])('invalid creation is atomic (%j)',async changes=>{const r=await create(changes);expect([400,409]).toContain(r.status);expect(await Product.countDocuments()).toBe(0);expect(upload).not.toHaveBeenCalled();});
test('upload failure and concurrent approval revocation leave no product or terms',async()=>{
  upload.mockRejectedValueOnce(new Error('Upload fixture failure'));await create().expect(500);expect(await Product.countDocuments()).toBe(0);
  upload.mockImplementationOnce(async()=>{await Seller.updateOne({_id:seller._id},{$set:{'wholesaleChannel.status':'suspended'}});return 'https://fixture.invalid/cover.png';});await create().expect(403);expect(await Product.countDocuments()).toBe(0);
});
test('explicit multi-channel physical products retain retail visibility and existing offer flow can extend explicit retail-only channels',async()=>{
  const {body:{product:p}}=await create({sellingChannels:['ecommerce'],variants:[{name:'Retail',price:100,mrp:120,stock:100,unit:'piece'}]}).expect(201);
  await request(app).get('/api/products/'+p._id).expect(200);
  await auth(request(app).patch('/api/products/'+p._id+'/wholesale-pricing')).send({variants:[{variantId:p.variants[0]._id,wholesalePricing:terms}]}).expect(200);
  const saved=await Product.findById(p._id);expect(saved.sellingChannels).toEqual(['ecommerce','wholesale']);expect(saved.price).toBe(100);expect(saved.stock).toBe(100);await request(app).get('/api/products/'+p._id).expect(200);
});
test('disabling an offer retains the Wholesale listing, inventory and channel restrictions; channel edits cannot publish it in retail',async()=>{
  const {body:{product:p}}=await create().expect(201);
  await auth(request(app).patch('/api/products/'+p._id+'/wholesale-pricing')).send({variants:[{variantId:p.variants[0]._id,wholesalePricing:{enabled:false}}]}).expect(200);
  const stored=await Product.findById(p._id);expect(stored.stock).toBe(100);expect(stored.price).toBe(0);
  await auth(request(app).put('/api/products/'+p._id)).send({sellingChannels:['ecommerce']}).expect(400);
  await auth(request(app).patch('/api/products/'+p._id+'/channels')).send({type:'grocery',category:String(category._id),isActive:true}).expect(400);
  await request(app).get('/api/products/'+p._id).expect(404);
});
test.each(['ecommerce','grocery'])('explicit %s plus Wholesale visibility preserves both price books',async type=>{
  if(type==='grocery')await Category.updateOne({_id:category._id},{$set:{type}});
  const {body:{product:p}}=await create({type,sellingChannels:[type,'wholesale'],variants:[{...variant(),price:150,mrp:170}]}).expect(201);
  const retail=await request(app).get('/api/products?type='+type).expect(200);expect(retail.body.products[0]._id).toBe(p._id);expect(retail.body.products[0].price).toBe(150);expect(retail.body.products[0].variants[0].wholesalePricing).toBeUndefined();
  const wholesale=await auth(request(app).get('/api/products/wholesale/catalog'),buyerToken).expect(200);expect(wholesale.body.data[0].variants[0].priceTiers[0].unitPrice).toBe(95);
});
test('a failed second variant prevents the entire listing and no upload runs',async()=>{
  await create({variants:[variant(),{...variant(),name:'Bad box',wholesalePricing:{...terms,quantityIncrement:-1}}]}).expect(400);expect(await Product.countDocuments()).toBe(0);expect(upload).not.toHaveBeenCalled();
});
test.each(['account','seller','category'])('ineligible %s cannot create a Wholesale-only product',async kind=>{
  if(kind==='account')await User.updateOne({_id:user._id},{$set:{isActive:false}});
  if(kind==='seller')await Seller.updateOne({_id:seller._id},{$set:{status:'suspended'}});
  if(kind==='category')await Category.updateOne({_id:category._id},{$set:{isActive:false}});
  const result=await create();expect([400,401,403,409]).toContain(result.status);expect(await Product.countDocuments()).toBe(0);expect(upload).not.toHaveBeenCalled();
});
test('public Wholesale detail returns only safe metadata, approved reviews and answered questions',async()=>{
  const {body:{product:p}}=await create({brandName:'Actual brand',description:'Actual description',variants:[{...variant(),weight:500}]}).expect(201);
  await Product.updateOne({_id:p._id},{$set:{ratings:{average:5,count:1,reviews:[{userId:user._id,userName:'Public reviewer',rating:5,comment:'Approved comment',status:'approved'},{userId:user._id,userName:'Private pending',rating:1,comment:'Pending comment',status:'pending'}]},faqs:[{userId:user._id,question:'Public question',answer:'Public answer',answeredBy:'Store',status:'answered'},{userId:user._id,question:'Private question',status:'unanswered'}]}});
  const response=await auth(request(app).get('/api/products/wholesale/catalog?productId='+p._id),buyerToken).expect(200),data=response.body.data[0];
  expect(data).toMatchObject({name:p.name,brandName:'Actual brand',description:'Actual description',retailAvailable:false});expect(data.variants[0].weight).toBe(500);expect(data.reviewData.summary).toMatchObject({average:5,count:1});expect(data.reviewData.reviews).toHaveLength(1);expect(data.faqs).toHaveLength(1);expect(JSON.stringify(data)).not.toMatch(/userId|ownerSellerId|bankDetails|Pending comment|Private question|wholesaleChannel|retailPrice/);
  await request(app).get('/api/products/'+p._id).expect(404);
  const guest=await request(app).get('/api/products/wholesale/catalog?productId='+p._id).expect(200);
  expect(guest.body.data[0]).toEqual(data);
  await auth(request(app).get('/api/products/wholesale/catalog?productId='+p._id)).expect(200);
});
