// Local test setup using the same validated, versioned save handler as Admin.
// No booking, driver, payment or notification is created by this command.
import '../config/environment.js';
import mongoose from 'mongoose';
import Admin from '../models/Admin.js';
import Policy from '../models/ParcelPolicy.js';
import { savePolicy } from '../controllers/parcelDelivery.controller.js';
import { validateParcelPolicy, parcelPermission, requireParcel } from '../services/parcelPolicy.service.js';

if (process.env.NODE_ENV !== 'development' || process.env.RAZORPAY_MODE !== 'test' || process.env.MAPS_MODE !== 'mock' || !process.env.MONGO_URI) throw new Error('Parcel manual-test setup requires the configured development database, Razorpay test mode and mock routes');
requireParcel('booking');
const apply = process.argv.includes('--apply');
const deadline = setTimeout(() => { console.error('Setup timed out. Run the readiness check before retrying.'); process.exit(1); }, 30000);
try {
  await mongoose.connect(process.env.MONGO_URI, { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 10000 });
  const prior = await Policy.findById('parcel').lean();
  const defaults = {
    approvalReference: 'Local parcel delivery test', effectiveAt: new Date(),
    categories: ['Documents'], prohibitedItems: ['Hazardous goods'],
    areas: [{ name: 'Bengaluru test area', pincodes: ['560001'], lat: 12.97, lng: 77.59, radiusKm: 10 }],
    basePaise: 1000, perKmPaise: 200, minimumPaise: 1000, maximumPaise: 10000,
    driverBasePaise: 500, driverPerKmPaise: 100, taxRateBps: 0,
    maxWeightKg: 5, maxDimensionCm: 50, maxRouteKm: 20, assignmentRadiusKm: 5,
    quoteSeconds: 300, acceptanceSeconds: 120, maxAttempts: 3, maxActiveTasks: 1, locationMaxAgeSeconds: 300,
    taxTreatment: 'inclusive', surcharges: 'none', cancellationMode: 'admin_review', failureMode: 'admin_review',
    cashCollectionPoint: 'delivery', partialCash: false, payDriverEnabled: true, payDriverCategories: ['Documents'],
    terms: 'Local testing only. Documents up to 5 kg are accepted. Hazardous goods are prohibited. Exact cash payment is required at delivery. Cancellations, refunds and failed deliveries require admin review.',
  };
  // Keep any settings the admin has already saved. Fill only missing values.
  const candidate = { ...defaults, ...prior?.config };
  if (new Date(candidate.effectiveAt) > new Date()) candidate.effectiveAt = new Date();
  const config = validateParcelPolicy(candidate);
  let saved = prior, changed = !prior || new Date(prior.config.effectiveAt) > new Date();
  if (apply && changed) {
    const admin = await Admin.findOne({ isActive: true, role: 'superAdmin' }).select('_id role permissions');
    if (!admin) throw new Error('An existing active super admin is required');
    const req = { userType: 'admin', user: admin, body: { version: prior?.version || 0, config } };
    parcelPermission(req, 'manage_finance');
    const res = { status() { return this; }, json(body) { saved = body.data; return this; } };
    await savePolicy(req, res);
  }
  console.log(JSON.stringify({
    applied: apply && changed, status: prior && !changed ? 'Existing effective parcel settings preserved' : apply ? 'Parcel test settings saved through Admin handler' : 'Preview; pass --apply to save',
    version: saved?.version || 0, area: config.areas.map(a => ({ name: a.name, pincodes: a.pincodes })),
    baseRupees: config.basePaise / 100, perKmRupees: config.perKmPaise / 100,
    priceValidMinutes: config.quoteSeconds / 60, driverAcceptMinutes: config.acceptanceSeconds / 60,
    driverLocationUpdatedWithinMinutes: config.locationMaxAgeSeconds / 60,
    mockRouteFeeRupees: Math.max(config.minimumPaise, config.basePaise + Math.ceil(5200 * config.perKmPaise / 1000)) / 100,
  }, null, 2));
} catch (error) {
  console.error(error.message?.includes('super admin') ? error.message : 'Parcel setup could not finish. Check connectivity, permissions and existing policy values; no bookings or payments were created.');
  console.error(JSON.stringify({ errorType: error.name, code: error.code, detail: error.status ? error.message : undefined }));
  process.exitCode = 1;
} finally { clearTimeout(deadline); await mongoose.disconnect(); }
