import mongoose from 'mongoose';
import Product from '../models/Product.js';
import Seller from '../models/Seller.js';
import User from '../models/User.js';
import Category from '../models/Category.js';
import { wholesaleAvailability } from './wholesaleEligibility.service.js';
import { MAX_CHECKOUT_PAISE } from '../utils/money.js';
import { httpError } from '../utils/response.js';

const number = path => ({ $cond: [{ $in: [{ $type: path }, ['int', 'long', 'double', 'string']] }, { $convert: { input: path, to: 'double', onError: null, onNull: null } }, null] });
const integer = path => ({ $and: [{ $ne: [path, null] }, { $gte: [path, 1] }, { $lte: [path, 100000] }, { $eq: [path, { $trunc: path }] }] });
const literalRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Resolve eligibility before pagination; purchase prices remain server-quoted
// by the existing priceWholesaleQuantity service. MongoDB 5.2+ ($sortArray).
const eligiblePipeline = ({ productId, variantId, q, category } = {}) => [
  { $match: { ...(productId ? { _id: new mongoose.Types.ObjectId(productId) } : {}), type: { $in: ['ecommerce', 'grocery'] }, status: 'approved', isActive: true, isDeleted: false, fulfillmentType: { $ne: 'digital' }, 'variants.wholesalePricing.enabled': { $in: [true, 'true'] } } },
  { $project: { name: 1, description: 1, images: 1, category: 1, sellerId: 1, sellerName: 1, type: 1, variants: 1 } },
  { $set: { variants: { $map: { input: { $cond: [{ $isArray: '$variants' }, '$variants', []] }, as: 'v', in: { $mergeObjects: ['$$v', { _terms: {
    enabled: { $in: ['$$v.wholesalePricing.enabled', [true, 'true']] },
    minimumQuantity: number('$$v.wholesalePricing.minimumQuantity'),
    quantityIncrement: number({ $ifNull: ['$$v.wholesalePricing.quantityIncrement', 1] }),
    priceTiers: { $sortArray: { input: { $map: { input: { $cond: [{ $isArray: '$$v.wholesalePricing.priceTiers' }, '$$v.wholesalePricing.priceTiers', []] }, as: 't', in: { minimumQuantity: number('$$t.minimumQuantity'), unitPrice: number('$$t.unitPrice') } } }, sortBy: { minimumQuantity: 1 } } },
  } }] } } } } },
  { $set: { variants: { $filter: { input: '$variants', as: 'v', cond: { $and: [
    { $eq: [{ $type: '$$v._id' }, 'objectId'] }, ...(variantId ? [{ $eq: ['$$v._id', new mongoose.Types.ObjectId(variantId)] }] : []),
    '$$v._terms.enabled', integer('$$v._terms.minimumQuantity'), integer('$$v._terms.quantityIncrement'),
    { $isNumber: '$$v.stock' }, { $lte: ['$$v.stock', Number.MAX_SAFE_INTEGER] }, { $gte: ['$$v.stock', '$$v._terms.minimumQuantity'] }, { $eq: [number('$$v.stock'), { $trunc: number('$$v.stock') }] },
    { $gt: [{ $size: '$$v._terms.priceTiers' }, 0] },
    { $eq: [{ $arrayElemAt: ['$$v._terms.priceTiers.minimumQuantity', 0] }, '$$v._terms.minimumQuantity'] },
    { $allElementsTrue: [{ $map: { input: '$$v._terms.priceTiers', as: 't', in: { $and: [
      integer('$$t.minimumQuantity'), { $gte: ['$$t.minimumQuantity', '$$v._terms.minimumQuantity'] },
      { $eq: [{ $mod: [{ $subtract: ['$$t.minimumQuantity', '$$v._terms.minimumQuantity'] }, { $max: [1, '$$v._terms.quantityIncrement'] }] }, 0] },
      { $gt: ['$$t.unitPrice', 0] }, { $lte: ['$$t.unitPrice', MAX_CHECKOUT_PAISE / 100] },
      { $lte: [{ $abs: { $subtract: ['$$t.unitPrice', { $divide: [{ $round: [{ $multiply: ['$$t.unitPrice', 100] }, 0] }, 100] }] } }, 0.00000001] },
    ] } } }] },
    { $allElementsTrue: [{ $map: { input: { $range: [1, { $max: [1, { $size: '$$v._terms.priceTiers' }] }] }, as: 'i', in: { $and: [
      { $gt: [{ $arrayElemAt: ['$$v._terms.priceTiers.minimumQuantity', '$$i'] }, { $arrayElemAt: ['$$v._terms.priceTiers.minimumQuantity', { $subtract: ['$$i', 1] }] }] },
      { $lte: [{ $arrayElemAt: ['$$v._terms.priceTiers.unitPrice', '$$i'] }, { $arrayElemAt: ['$$v._terms.priceTiers.unitPrice', { $subtract: ['$$i', 1] }] }] },
    ] } } }] },
  ] } } } } },
  { $match: { 'variants.0': { $exists: true } } },
  { $lookup: { from: Seller.collection.name, localField: 'sellerId', foreignField: '_id', pipeline: [{ $match: { status: 'approved', salesChannels: 'wholesale', 'wholesaleChannel.status': 'approved' } }, { $project: { userId: 1, businessName: 1, 'storeDetails.name': 1 } }], as: '_seller' } },
  { $unwind: '$_seller' },
  { $lookup: { from: User.collection.name, localField: '_seller.userId', foreignField: '_id', pipeline: [{ $match: { isActive: { $ne: false } } }, { $project: { _id: 1 } }], as: '_account' } },
  { $match: { '_account.0': { $exists: true } } },
  { $lookup: { from: Category.collection.name, localField: 'category', foreignField: '_id', pipeline: [{ $match: { isActive: { $ne: false }, ...(category ? { name: category } : {}) } }, { $project: { name: 1, slug: 1 } }], as: 'category' } },
  { $unwind: '$category' },
  ...(q ? [{ $match: { $or: ['name', '_seller.businessName', '_seller.storeDetails.name', 'category.name'].map(field => ({ [field]: { $regex: literalRegex(q), $options: 'i' } })) } }] : []),
];
const run = async pipeline => {
  try { return await Product.aggregate(pipeline).option({ maxTimeMS: 2000, allowDiskUse: false }); }
  catch (error) {
    if (error.code === 50 || error.code === 292) throw httpError(503, 'Wholesale search is busy. Narrow your search and retry.');
    throw error;
  }
};
const serialize = product => ({
  _id: product._id, name: product.name, description: product.description, images: product.images || [], category: product.category, type: product.type,
  seller: { name: product._seller.storeDetails?.name || product._seller.businessName || product.sellerName },
  variants: product.variants.map(variant => {
    const terms = wholesaleAvailability({ ...variant, wholesalePricing: variant._terms });
    return { variantId: variant._id, name: variant.name, sku: variant.sku, attributes: variant.attributes || [], unit: variant.unit, available: true, availableStock: variant.stock, minimumQuantity: terms.minimumQuantity, quantityIncrement: terms.quantityIncrement, priceTiers: terms.priceTiers, maxQuantity: terms.maxQuantity, startingPrice: terms.startingPrice };
  }),
});
export const getWholesaleCatalogPage = async ({ page = 1, limit = 24, ...filters } = {}) => {
  const [result] = await run([...eligiblePipeline(filters), { $sort: { _id: 1 } }, { $facet: { data: [{ $skip: (page - 1) * limit }, { $limit: limit }], count: [{ $count: 'total' }] } }]);
  const total = result?.count[0]?.total || 0;
  return { data: (result?.data || []).map(serialize), meta: { page, limit, total, pages: Math.ceil(total / limit) } };
};
export const hasWholesaleOffers = async filters => (await run([...eligiblePipeline(filters), { $limit: 1 }, { $project: { _id: 1 } }])).length > 0;
// Admin-only management summary retains its existing complete inventory view.
export const getEligibleWholesaleCatalog = async () => (await run(eligiblePipeline())).map(serialize);
