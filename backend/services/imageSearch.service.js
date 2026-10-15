import Product from '../models/Product.js';
import ProductImageIndex from '../models/ProductImageIndex.js';
import { IMAGE_INDEX_VERSION, imageSimilarity } from './imageFingerprint.service.js';
import { httpError } from '../utils/response.js';

// Same channel/cross-listing and legacy exclusions as public text search, plus
// explicit available-stock filtering. Always rechecked against live products.
export function imageSearchVisibility(type) {
  return { status: 'approved', isActive: true, isDeleted: false, shgStoreId: { $exists: false },
    $and: [
      { type: { $ne: 'shg' } },
      { $or: [{ type }, { channels: { $elemMatch: { type, isActive: { $ne: false } } } }] },
      type === 'grocery' ? { fulfillmentType: { $ne: 'digital' }, stock: { $gt: 0 } } : { $or: [{ fulfillmentType: 'digital' }, { stock: { $gt: 0 } }] },
    ] };
}
export async function searchImageIndex(fingerprint, { type, page = 1, limit = 20 }) {
  if (!await ProductImageIndex.exists({ version: IMAGE_INDEX_VERSION })) throw httpError(503, 'Image search catalogue is not ready. Ask the administrator to run the image search indexer.');
  const visible = imageSearchVisibility(type);
  const candidates = await ProductImageIndex.aggregate([
    { $match: { version: IMAGE_INDEX_VERSION, bands: { $in: fingerprint.bands } } },
    { $lookup: { from: 'products', localField: 'productId', foreignField: '_id', pipeline: [{ $match: visible }, { $project: { _id: 1, images: 1 } }], as: 'product' } },
    { $unwind: '$product' },
    { $match: { $expr: { $in: ['$imageUrl', '$product.images'] } } },
    { $addFields: { bandMatches: { $size: { $setIntersection: ['$bands', fingerprint.bands] } } } },
    { $sort: { bandMatches: -1, _id: 1 } }, { $limit: 500 },
    { $project: { productId: 1, hash: 1, histogram: 1, spatial: 1 } },
  ]);
  const best = new Map();
  for (const candidate of candidates) {
    const score = imageSimilarity(fingerprint, candidate), id = String(candidate.productId);
    if (score >= 0.86 && score > (best.get(id) || 0)) best.set(id, score);
  }
  const ranked = [...best].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 100);
  const selected = ranked.slice((page - 1) * limit, page * limit);
  const products = await Product.find({ ...visible, _id: { $in: selected.map(([id]) => id) } }).select('-digital.file').populate('category', 'name').populate('sellerId', 'businessName storeDetails.name').lean();
  const lookup = new Map(products.map(p => [String(p._id), p]));
  return { data: selected.filter(([id]) => lookup.has(id)).map(([id, score]) => ({ ...lookup.get(id), imageSimilarity: Math.round(score * 1000) / 1000 })),
    meta: { page, limit, total: ranked.length, mode: 'visual-fingerprint-v1' } };
}
