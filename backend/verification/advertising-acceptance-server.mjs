// Local browser acceptance fixture: real authentication, routers, services and
// database. No application bootstrap, configured URI, provider or notifications.
import crypto from 'node:crypto';
if(process.env.NODE_ENV!=='test'||process.env.MONGO_URI||process.env.MONGODB_URI||process.env.RAZORPAY_KEY_SECRET)throw Error('Acceptance fixture requires a sanitized test environment');
Object.assign(process.env,{JWT_SECRET:crypto.randomBytes(32).toString('hex'),
  ADVERTISING_PRODUCTION_ENABLED:'false',
  ADVERTISING_EVENT_RETENTION_DAYS:'7',ADVERTISING_TOKEN_SECRET:crypto.randomBytes(32).toString('hex'),
  PAYMENT_GATEWAY:'razorpay',RAZORPAY_MODE:'test'});
const [{default:mongoose},{MongoMemoryReplSet},{default:express},{signSessionToken},
  {advertisingRouter},{advertisingPublicRouter},{errorHandler},
  {default:User},{default:Seller},{default:Admin},{default:Category},{default:Product},
  {default:Payment},{default:Event},{default:Receipt},{default:Ledger},{default:Promotion},{default:Package}]=await Promise.all([
  import('mongoose'),import('mongodb-memory-server'),import('express'),import('../config/jwt.js'),
  import('../routes/advertising.routes.js'),import('../routes/advertisingPublic.routes.js'),import('../middlewares/error.middleware.js'),
  import('../models/User.js'),import('../models/Seller.js'),import('../models/Admin.js'),import('../models/Category.js'),import('../models/Product.js'),
  import('../models/Payment.js'),import('../models/AdEvent.js'),import('../models/AdWebhookReceipt.js'),import('../models/SellerLedgerEntry.js'),import('../models/SellerPromotion.js'),import('../models/PromotionPackage.js')]);
let database,server,stopping=false;
async function close(){if(stopping)return;stopping=true;await new Promise(resolve=>server?server.close(resolve):resolve());await mongoose.disconnect();await database?.stop();}
process.on('message',message=>{if(message?.action==='stop')void close().then(()=>process.exit(0));});
process.on('SIGTERM',()=>{void close().then(()=>process.exit(0));});
try{
  database=await MongoMemoryReplSet.create({binary:{version:'7.0.14'},replSet:{count:1}});
  const uri=database.getUri('advertising_browser_acceptance');
  if(!/^mongodb:\/\/(127\.0\.0\.1|localhost):/.test(uri))throw Error('Refused non-loopback fixture database');
  await mongoose.connect(uri);
  for(const model of [User,Seller,Admin,Category,Product,Payment,Event,Receipt,Ledger,Promotion,Package])await model.init();
  const [user,other]=await User.create([{phone:'9876500881',roles:['seller']},{phone:'9876500882',roles:['seller']}]);
  const seller=await Seller.create({userId:user._id,status:'approved',salesChannels:['ecommerce'],businessName:'Acceptance Traders',storeDetails:{name:'Acceptance Store',city:'Indore'}});
  await Seller.create({userId:other._id,status:'approved',salesChannels:['ecommerce']});
  const admin=await Admin.create({email:'advertising-acceptance@example.test',password:crypto.randomBytes(32).toString('hex'),role:'superAdmin'});
  const category=await Category.create({name:'Acceptance category',slug:'advertising-acceptance-category',type:'ecommerce'});
  await Product.create({sellerId:seller._id,name:'Acceptance product',type:'ecommerce',category:category._id,price:12,mrp:15,stock:9,unit:'piece',status:'approved',isActive:true,images:['/acceptance-product.svg']});
  // Several categories for the multi-category wizard: a sub-category of the first one and an unrelated one.
  const child=await Category.create({name:'Acceptance child',slug:'advertising-acceptance-child',type:'ecommerce',parent:category._id});
  const otherCategory=await Category.create({name:'Acceptance other',slug:'advertising-acceptance-other',type:'ecommerce'});
  await Product.create({sellerId:seller._id,name:'Acceptance shirt',type:'ecommerce',category:category._id,subCategory:child._id,price:20,mrp:25,stock:6,unit:'piece',status:'approved',isActive:true,images:['/acceptance-product.svg']});
  const lamp=await Product.create({sellerId:seller._id,name:'Acceptance lamp',type:'ecommerce',category:otherCategory._id,price:30,mrp:35,stock:4,unit:'piece',status:'approved',isActive:true,images:['/acceptance-product.svg']});
  const app=express();app.use(express.json({limit:'100kb',verify:(req,_res,buffer)=>{req.rawBody=buffer;}}));
  app.use('/api/sellers/advertising',advertisingRouter());app.use('/api/admin/advertising',advertisingRouter(true));app.use('/api/advertising',advertisingPublicRouter);app.use(errorHandler);
  server=app.listen(0,'127.0.0.1',()=>{
    // Private IPC, never stdout/logs: synthetic expiring sessions only.
    process.send?.({ready:true,port:server.address().port,categoryId:String(category._id),childId:String(child._id),otherId:String(otherCategory._id),lampId:String(lamp._id),
      sellerToken:signSessionToken({id:String(user._id),type:'user',role:'seller'}),otherToken:signSessionToken({id:String(other._id),type:'user',role:'seller'}),adminToken:signSessionToken({id:String(admin._id),type:'admin'})});
  });
}catch{console.error('Isolated advertising acceptance server failed');await close();process.exitCode=1;}
