// Read-only local manual-testing audit. Does not initialize models or write data.
import '../config/environment.js';
import { MongoClient } from 'mongodb';

if (!process.env.MONGO_URI) throw new Error('MONGO_URI is required');
const deadline = setTimeout(() => {
  console.error('Customer-services readiness timed out while reading the database; no data was changed.');
  process.exit(1);
}, 20000);
const client = new MongoClient(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000, connectTimeoutMS: 10000 });
try {
  await client.connect();
  const db = client.db(), now = new Date();
  const collections = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map(c => c.name));
  const indexes = async name => collections.has(name) ? (await db.collection(name).indexes()).map(i => i.name) : [];
  const [hello, parcelPolicy, publishedServices, approvedProviders, legalPolicy, applicationIndexes, providerIndexes] = await Promise.all([
    db.admin().command({ hello: 1 }),
    db.collection('parcelpolicies').findOne({ _id: 'parcel' }, { projection: { version: 1, 'config.effectiveAt': 1 } }),
    db.collection('services').countDocuments({ status: 'published', audiences: 'customer' }),
    db.collection('legalproviders').countDocuments({ status: 'approved' }),
    db.collection('commissions').countDocuments({ financeVersion: 2, channel: 'legal', isActive: true, effectiveDate: { $lte: now } }),
    indexes('serviceapplications'), indexes('legalproviders'),
  ]);
  console.log(JSON.stringify({
    readOnly: true,
    localRuntime: !['production', 'prod', 'deployment-production'].includes(String(process.env.NODE_ENV).trim().toLowerCase()) && !['production', 'prod', 'deployment-production'].includes(String(process.env.DEPLOYMENT_ENV).trim().toLowerCase()),
    transactionsSupported: Boolean(hello.setName || hello.msg === 'isdbgrid'),
    razorpayTestConfigured: process.env.PAYMENT_GATEWAY === 'razorpay' && process.env.RAZORPAY_MODE === 'test' && Boolean(process.env.RAZORPAY_KEY_ID?.startsWith('rzp_test_') && process.env.RAZORPAY_KEY_SECRET && process.env.RAZORPAY_WEBHOOK_SECRET),
    parcel: { effectivePolicy: Boolean(parcelPolicy?.config?.effectiveAt && new Date(parcelPolicy.config.effectiveAt) <= now), mapsMode: process.env.MAPS_MODE || 'unset', liveDirectionsImplemented: false },
    legal: { publishedCustomerServices: publishedServices, approvedProviders, effectivePolicies: legalPolicy, submissionIndexReady: applicationIndexes.includes('legal_customer_key_unique'), providerIndexReady: providerIndexes.includes('legal_provider_user_unique') },
    externalProviderPayoutsImplemented: false,
    note: 'Configuration presence is checked; no live gateway calls, payments, bookings or messages are sent.',
  }, null, 2));
} catch {
  console.error('Customer-services readiness could not be read. Check database connectivity and read permissions; no data was changed.');
  process.exitCode = 1;
} finally { clearTimeout(deadline); await client.close(); }
