// Isolated acceptance process: real marketing APIs/authentication and disposable
// MongoDB. Never boots the application or loads the developer's database URI.
import crypto from 'node:crypto';
if (process.env.NODE_ENV !== 'test' || process.env.MONGO_URI || process.env.MONGODB_URI) throw Error('A sanitized test environment is required');
process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex');
const [{ default: mongoose }, { MongoMemoryServer }, { default: express }, { default: sharp },
  { storefrontRouter, storefrontAdminRouter }, { default: bannerRoutes }, { default: categoryRoutes }, { default: campaignRoutes },
  { errorHandler }, { default: Admin }, { default: Campaign }, { default: Experience }, { signSessionToken }] = await Promise.all([
  import('mongoose'), import('mongodb-memory-server'), import('express'), import('sharp'),
  import('../routes/storefront.routes.js'), import('../routes/banner.routes.js'), import('../routes/category.routes.js'), import('../routes/campaign.routes.js'),
  import('../middlewares/error.middleware.js'), import('../models/Admin.js'), import('../models/Campaign.js'), import('../models/StorefrontExperience.js'), import('../config/jwt.js'),
]);
let database, server, stopping = false;
const media = new Map();
// Optional real-provider verification is explicitly constrained by the parent.
// The route's validation/transcoding options are preserved; only the test folder
// and collision-safe public ID are supplied here. No application config changes.
if (process.env.STOREFRONT_VERIFY_FOLDER) {
  const folder = process.env.STOREFRONT_VERIFY_FOLDER;
  if (!/^bulkimart\/storefront-verification\/[a-zA-Z0-9-]+$/.test(folder)) throw Error('Invalid verification folder');
  const { v2: cloudinary } = await import('cloudinary');
  const originalUpload = cloudinary.uploader.upload_stream.bind(cloudinary.uploader);
  cloudinary.uploader.upload_stream = (options, callback) => originalUpload({ ...options, folder, public_id: `synthetic-${crypto.randomUUID()}`, overwrite: false }, (error, result) => {
    if (!error) process.send?.({ uploaded: { url: result.secure_url, publicId: result.public_id, type: result.resource_type, format: result.format, duration: result.duration, bytes: result.bytes, width: result.width, height: result.height } });
    callback(error, result);
  });
}
async function close() { if (stopping) return; stopping = true; await new Promise(resolve => server ? server.close(resolve) : resolve()); await mongoose.disconnect(); await database?.stop(); }
process.on('message', message => {
  if (message?.action === 'stop') void close().then(() => process.exit(0));
  if (message?.action === 'media') { media.set('/uploads/storefront-acceptance/video.webm', { type: 'video/webm', data: Buffer.from(message.data, 'base64') }); process.send?.({ mediaReady: true }); }
});
process.on('SIGTERM', () => void close().then(() => process.exit(0)));
try {
  database = await MongoMemoryServer.create({ binary: { version: '7.0.14' } });
  const uri = database.getUri('storefront_acceptance');
  if (!/^mongodb:\/\/(127\.0\.0\.1|localhost):/.test(uri)) throw Error('Only a loopback fixture database is allowed');
  await mongoose.connect(uri); await Experience.init();
  const adminId = new mongoose.Types.ObjectId(), dealId = new mongoose.Types.ObjectId();
  await Admin.collection.insertOne({ _id: adminId, email: 'storefront-acceptance@example.test', role: 'superAdmin', isActive: true });
  await Campaign.collection.insertOne({ _id: dealId, name: 'Synthetic local deal page', isEnabled: true, isDraft: false, startAt: new Date(Date.now() - 1000), endAt: new Date(Date.now() + 3600000) });
  for (const [name, width, height, background] of [['poster', 640, 240, '#79000B'], ['mobile', 240, 400, '#116B52']]) media.set(`/uploads/storefront-acceptance/${name}.webp`, { type: 'image/webp', data: await sharp({ create: { width, height, channels: 3, background } }).webp().toBuffer() });
  const app = express(); app.use(express.json());
  app.get('/uploads/storefront-acceptance/:name', (req, res) => {
    const asset = media.get(req.path); if (!asset) return res.sendStatus(404);
    res.type(asset.type); res.set('Accept-Ranges', 'bytes');
    const range = req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
    if (range) { const start = Number(range[1]), end = Math.min(range[2] ? Number(range[2]) : asset.data.length - 1, asset.data.length - 1); if (start > end) return res.sendStatus(416); res.status(206).set('Content-Range', `bytes ${start}-${end}/${asset.data.length}`).send(asset.data.subarray(start, end + 1)); }
    else res.send(asset.data);
  });
  app.use('/api/storefront', storefrontRouter); app.use('/api/admin/storefront', storefrontAdminRouter);
  app.use('/api/banners', bannerRoutes); app.use('/api/categories', categoryRoutes); app.use('/api/admin/campaigns', campaignRoutes); app.use(errorHandler);
  server = app.listen(0, '127.0.0.1', () => process.send?.({ ready: true, port: server.address().port, adminToken: signSessionToken({ id: String(adminId), type: 'admin' }), dealId: String(dealId) }));
} catch (error) { console.error('Storefront acceptance server failed:', error.name); await close(); process.exitCode = 1; }
