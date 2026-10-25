// Disposable acceptance server. Never imports bootstrap/db.js or developer env.
import crypto from 'node:crypto';
if (process.env.NODE_ENV !== 'test' || process.env.MONGO_URI || process.env.MONGODB_URI) throw Error('Sanitized isolated test environment required');
const manual = process.argv.includes('--manual');
process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex');
process.env.MAPS_MODE = manual ? 'mock' : 'live';
process.env.GOOGLE_MAPS_API_KEY = 'synthetic-maps-server-key';
process.env.FCM_MODE = 'mock';
const [{ default: mongoose }, { MongoMemoryReplSet }, { default: express }, { customerParcelRouter }, { default: geoRouter }, { default: userRouter }, { default: User }, { default: Policy }, { default: Parcel }, { default: Quote }, { validateParcelPolicy }, { errorHandler }, { signSessionToken }] = await Promise.all([
  import('mongoose'), import('mongodb-memory-server'), import('express'), import('../routes/parcelDelivery.routes.js'), import('../routes/geo.routes.js'), import('../routes/user.routes.js'), import('../models/User.js'), import('../models/ParcelPolicy.js'), import('../models/ParcelDelivery.js'), import('../models/ParcelQuote.js'), import('../services/parcelPolicy.service.js'), import('../middlewares/error.middleware.js'), import('../config/jwt.js'),
]);
let database, server, routeCalls = 0, blockedNetworkCalls = 0, routeAvailable = true, forwardLookups = 0, reverseLookups = 0;
globalThis.fetch = async url => {
  const parsed = new URL(url);
  if (parsed.hostname === 'maps.googleapis.com') {
    if (parsed.searchParams.has('address')) forwardLookups++;
    if (parsed.searchParams.has('latlng')) reverseLookups++;
  }
  if (parsed.hostname === 'routes.googleapis.com') {
    routeCalls++;
    return { ok: routeAvailable, json: async () => ({ routes: [{ distanceMeters: 7315, duration: '1062s', polyline: { encodedPolyline: '_ibE_seK_seK_seK' } }] }) };
  }
  if (parsed.hostname === 'places.googleapis.com') return { ok: true, json: async () => ({ places: [] }) };
  if (manual && parsed.hostname === 'maps.googleapis.com') {
    const pickup = /botejhari|481332|katangjhari/i.test(parsed.searchParams.get('address') || '') || Number((parsed.searchParams.get('latlng') || '').split(',')[1]) > 78;
    const point = pickup ? { lat: 21.81159925, lng: 79.94459221, pincode: '481332', city: 'Botejhari', address: 'TEST centre — Botejhari / Katangjhari' } : { lat: 22.7196, lng: 75.8577, pincode: '452006', city: 'Indore', address: 'TEST centre — Indore' };
    return { ok: true, json: async () => ({ status: 'OK', results: [{ formatted_address: point.address + ', Madhya Pradesh ' + point.pincode, geometry: { location: { lat: point.lat, lng: point.lng }, location_type: 'APPROXIMATE' }, address_components: [{ long_name: point.address, types: ['route'] }, { long_name: point.city, types: ['locality'] }, { long_name: 'Madhya Pradesh', types: ['administrative_area_level_1'] }, { long_name: point.pincode, types: ['postal_code'] }] }] }) };
  }
  if (parsed.hostname === 'maps.googleapis.com') {
    const postalRegression = /postcode preservation/i.test(parsed.searchParams.get('address') || '');
    const pincode = postalRegression ? '452015' : '560001';
    return { ok: true, json: async () => ({ status: 'OK', results: [{ formatted_address: postalRegression ? 'Synthetic selected street, Indore 452015' : 'Synthetic route street, Bengaluru 560001', geometry: { location: { lat: 12.97, lng: 77.59 }, location_type: 'ROOFTOP' }, address_components: [{ long_name: 'Synthetic route street', types: ['route'] }, { long_name: postalRegression ? 'Indore' : 'Bengaluru', types: ['locality'] }, { long_name: postalRegression ? 'Madhya Pradesh' : 'Karnataka', types: ['administrative_area_level_1'] }, { long_name: pincode, types: ['postal_code'] }] }] }) };
  }
  blockedNetworkCalls++; throw Error('Unexpected external network in isolated parcel acceptance');
};
async function close() { await new Promise(resolve => server ? server.close(resolve) : resolve()); await mongoose.disconnect(); await database?.stop(); }
process.on('message', message => {
  if (message?.action === 'stop') void close().then(() => process.exit(0));
});
try {
  database = await MongoMemoryReplSet.create({ binary: { version: '7.0.14' }, replSet: { count: 1 } });
  await mongoose.connect(database.getUri('parcel-journey-isolated'), { autoCreate: false, autoIndex: false });
  const user = await User.create({ name: 'Synthetic Sender', phone: '9876500011', roles: ['buyer'], addresses: [{ label: 'Home', name: 'Synthetic Sender', phone: '9876500011', line1: 'Saved synthetic pickup', city: 'Bengaluru', state: 'Karnataka', pincode: '560001', lat: 12.97, lng: 77.59 }] });
  let adminToken;
  if (manual) {
    // These users/addresses exist only in the freshly created memory replica set.
    user.addresses = [
      { label: 'Home', name: user.name, phone: user.phone, line1: 'Synthetic Botejhari pickup', city: 'Botejhari', state: 'Madhya Pradesh', pincode: '481332', lat: 21.81159925, lng: 79.94459221 },
      { label: 'Work', name: user.name, phone: user.phone, line1: 'Synthetic Indore destination', city: 'Indore', state: 'Madhya Pradesh', pincode: '452006', lat: 22.7196, lng: 75.8577 },
    ];
    await user.save();
    const { default: Admin } = await import('../models/Admin.js');
    const admin = await Admin.create({ name: 'Local Test Admin', email: 'parcel-local@example.test', password: crypto.randomBytes(32).toString('hex'), role: 'superAdmin', isActive: true });
    adminToken = signSessionToken({ id: String(admin._id), type: 'admin' });
  }
  await Policy.create({ version: 1, config: validateParcelPolicy({ approvalReference: 'SYNTHETIC LOCAL TEST ONLY', terms: 'Synthetic test delivery terms. Cancellation and delivery failures require review.', effectiveAt: '2020-01-01', categories: ['documents'], prohibitedItems: ['dangerous goods'], areas: [{ name: 'Synthetic service area', pincodes: ['560001'], lat: 12.97, lng: 77.59, radiusKm: 10 }], basePaise: 1000, perKmPaise: 200, minimumPaise: 1000, maximumPaise: 10000, driverBasePaise: 500, driverPerKmPaise: 100, quoteSeconds: 300, acceptanceSeconds: 30, maxAttempts: 2, maxActiveTasks: 1, locationMaxAgeSeconds: 300, maxWeightKg: 5, maxDimensionCm: 50, assignmentRadiusKm: 5, maxRouteKm: 20, taxTreatment: 'inclusive', taxRateBps: 0, surcharges: 'none', cancellationMode: 'admin_review', failureMode: 'admin_review', cashCollectionPoint: manual ? 'delivery' : 'customer_choice', partialCash: false, payDriverEnabled: true, payDriverCategories: ['documents'] }) });
  const app = express(); app.use(express.json());
  app.get('/__fixture/stats', async (_req, res) => res.json({ bookings: await Parcel.countDocuments(), quotes: await Quote.countDocuments(), routeCalls, forwardLookups, reverseLookups, blockedNetworkCalls, addresses: (await User.findById(user._id)).addresses.length }));
  app.post('/__fixture/route-failure', (req, res) => { routeAvailable = req.body.fail !== true; res.json({ ok: true }); });
  if (manual) {
    const { default: routes } = await import('../routes/index.js');
    app.use('/api', routes);
  } else { app.use('/api/parcel-delivery', customerParcelRouter); app.use('/api/geo', geoRouter); app.use('/api/users', userRouter); }
  app.use(errorHandler);
  server = app.listen(0, '127.0.0.1', () => process.send?.({ ready: true, port: server.address().port, ...(manual ? {adminToken} : {}), token: signSessionToken({ id: String(user._id), type: 'user', role: 'buyer' }), profile: { _id: String(user._id), name: user.name, phone: user.phone } }));
} catch (error) { console.error('Isolated parcel server failed:', error.name, error.message); await close(); process.exitCode = 1; }
