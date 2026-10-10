import '../config/bootstrap.js';
import mongoose from 'mongoose';

const EXPECTED_DATABASE = 'bulkimart';
const EXPECTED_CLUSTER = 'cluster0.q39nutg.mongodb.net';

const configuredUri = process.env.MONGO_URI;
if (!configuredUri) throw new Error('MONGO_URI is required');

const parsedUri = new URL(configuredUri);
const configuredDatabase = parsedUri.pathname.replace(/^\//, '');
const configuredCluster = parsedUri.hostname.toLowerCase();

if (configuredDatabase !== EXPECTED_DATABASE || configuredCluster !== EXPECTED_CLUSTER) {
  throw new Error(
    `Safety lock refused connection: expected ${EXPECTED_DATABASE} on ${EXPECTED_CLUSTER}; ` +
    `received database=${configuredDatabase || '(none)'}, cluster=${configuredCluster || '(none)'}`,
  );
}

const client = await mongoose.connect(configuredUri, {
  serverSelectionTimeoutMS: 20_000,
  readPreference: 'secondaryPreferred',
});

try {
  const db = mongoose.connection.db;
  const actualDatabase = db.databaseName;
  const actualHosts = [...client.connection.getClient().options.hosts]
    .map((host) => String(host.host).toLowerCase());

  if (actualDatabase !== EXPECTED_DATABASE || !actualHosts.some((host) => host.endsWith('.q39nutg.mongodb.net'))) {
    throw new Error(
      `Safety lock rejected active connection: database=${actualDatabase}, ` +
      `clusterMatch=${actualHosts.some((host) => host.endsWith('.q39nutg.mongodb.net'))}`,
    );
  }

  const collection = (name) => db.collection(name);
  const nhcSellers = await collection('sellers')
    .find({ isNscSeller: true }, { projection: { _id: 1, businessName: 1, status: 1 } })
    .toArray();
  const shgStores = await collection('shgstores')
    .find({}, { projection: { _id: 1, groupName: 1, status: 1, userId: 1 } })
    .toArray();

  const nhcSellerIds = nhcSellers.map(({ _id }) => _id);
  const shgStoreIds = shgStores.map(({ _id }) => _id);
  const legacyProductFilter = {
    $or: [
      { sellerId: { $in: nhcSellerIds } },
      { shgStoreId: { $in: shgStoreIds } },
      { type: 'shg' },
    ],
  };
  const legacyProducts = await collection('products')
    .find(legacyProductFilter, { projection: { _id: 1, name: 1, sellerId: 1, shgStoreId: 1, category: 1, subCategory: 1 } })
    .toArray();
  const legacyProductIds = legacyProducts.map(({ _id }) => _id);

  const shgCategories = await collection('categories')
    .find({ type: 'shg' }, { projection: { _id: 1, name: 1, parent: 1, isActive: 1 } })
    .toArray();
  const shgCategoryIds = shgCategories.map(({ _id }) => _id);
  const sharedCategoryProductCount = await collection('products').countDocuments({
    _id: { $nin: legacyProductIds },
    $or: [
      { category: { $in: shgCategoryIds } },
      { subCategory: { $in: shgCategoryIds } },
      { 'channels.category': { $in: shgCategoryIds } },
      { 'channels.subCategory': { $in: shgCategoryIds } },
    ],
  });

  const legacyBannerFilter = {
    $or: [
      { type: 'shg' },
      { targetProduct: { $in: legacyProductIds } },
      { targetCategory: { $in: shgCategoryIds } },
      { targetRoute: { $regex: '(nhc|shg)[-_ ]?stores?', $options: 'i' } },
      { title: { $regex: '\\b(nhc|shg)\\b', $options: 'i' } },
    ],
  };

  const count = async (name, filter) => collection(name).countDocuments(filter);
  const proposed = {
    sellers: {
      count: nhcSellers.length,
      criterion: 'isNscSeller === true',
      action: 'delete',
    },
    shgstores: {
      count: shgStores.length,
      criterion: 'all SHG store profiles',
      action: 'delete',
    },
    products: {
      count: legacyProducts.length,
      criterion: 'owned by an NHC seller, owned by an SHG store, or primary type === shg',
      action: 'delete',
    },
    categories: {
      count: shgCategories.length,
      criterion: 'type === shg; only eligible if no non-legacy product references them',
      action: sharedCategoryProductCount === 0 ? 'delete' : 'preserve (ambiguous/shared)',
    },
    banners: {
      count: await count('banners', legacyBannerFilter),
      criterion: 'SHG placement, legacy product/category target, legacy route, or explicit NHC/SHG title',
      action: 'delete after record review',
    },
    campaignparticipations: {
      count: await count('campaignparticipations', {
        $or: [{ sellerId: { $in: nhcSellerIds } }, { productId: { $in: legacyProductIds } }],
      }),
      criterion: 'references a legacy seller or product',
      action: 'delete mapping only',
    },
    sellerpromotions: {
      count: await count('sellerpromotions', { sellerId: { $in: nhcSellerIds } }),
      criterion: 'references an NHC seller',
      action: 'delete promotion only',
    },
    shgsubscriptions: {
      count: await count('shgsubscriptions', { shgStoreId: { $in: shgStoreIds } }),
      criterion: 'references an SHG store',
      action: 'preserve pending status review (may contain commercial history)',
    },
    subscriptionbaskets: {
      count: await count('subscriptionbaskets', { shgStoreId: { $in: shgStoreIds } }),
      criterion: 'references an SHG store',
      action: 'delete basket only',
    },
  };

  const preserved = {
    orders: await count('orders', {
      $or: [
        { 'items.sellerId': { $in: nhcSellerIds } },
        { 'items.shgStoreId': { $in: shgStoreIds } },
        { 'items.productId': { $in: legacyProductIds } },
      ],
    }),
    payments: await count('payments', {
      $or: [
        { sellerId: { $in: nhcSellerIds } },
        { shgStoreId: { $in: shgStoreIds } },
      ],
    }),
    returns: await count('returns', {
      $or: [
        { sellerId: { $in: nhcSellerIds } },
        { shgStoreId: { $in: shgStoreIds } },
        { productId: { $in: legacyProductIds } },
      ],
    }),
    usersLinkedToLegacyProfiles: await count('users', {
      $or: [
        { sellerId: { $in: nhcSellerIds } },
        { shgStoreId: { $in: shgStoreIds } },
      ],
    }),
    cartsContainingLegacyProducts: await count('carts', {
      $or: [
        { 'items.productId': { $in: legacyProductIds } },
        { 'items.sellerId': { $in: nhcSellerIds } },
        { 'items.shgStoreId': { $in: shgStoreIds } },
      ],
    }),
    wishlistsContainingLegacyProducts: await count('users', { wishlist: { $in: legacyProductIds } }),
    sellerPayouts: await count('seller_payouts', { sellerId: { $in: nhcSellerIds } }),
    packagingOrders: await count('packagingorders', { sellerId: { $in: nhcSellerIds } }),
    shgSubscriptionStatusSummary: await collection('shgsubscriptions').aggregate([
      { $match: { shgStoreId: { $in: shgStoreIds } } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
      { $project: { _id: 0, status: { $ifNull: ['$_id', '(unset)'] }, count: 1 } },
    ]).toArray(),
    sharedCategoryProductCount,
  };

  console.log(JSON.stringify({
    mode: 'DRY_RUN_READ_ONLY',
    connection: {
      database: actualDatabase,
      cluster: EXPECTED_CLUSTER,
      verified: true,
      sourceConnectionUsed: false,
    },
    identities: {
      nhcSellers: nhcSellers.map(({ businessName, status }) => ({ businessName, status })),
      shgStores: shgStores.map(({ groupName, status }) => ({ groupName, status })),
    },
    proposed,
    preserved,
    notes: [
      'No writes were executed.',
      'Orders, payments, returns, shared customers, and common configuration are preservation-only.',
      'Linked users will be preserved; only legacy role/profile links would be unset after approval.',
      'Cart lines and wishlist references require pull-only cleanup after approval so customer accounts are preserved.',
      'Financial and historical records are preservation-only.',
    ],
  }, null, 2));
} finally {
  await mongoose.disconnect();
}
