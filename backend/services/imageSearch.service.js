import { channelVisibility } from '../utils/productChannels.js';
import Product from '../models/Product.js';
import { publicProduct } from '../utils/publicProduct.js';
import ProductImageIndex from '../models/ProductImageIndex.js';
import { IMAGE_INDEX_VERSION, IMAGE_SEARCH_MODE, imageColorBands, imageSimilarity } from './imageFingerprint.service.js';
import { httpError } from '../utils/response.js';

// Same channel/cross-listing and legacy exclusions as public text search, plus
// explicit available-stock filtering. Always rechecked against live products.
export function imageSearchVisibility(type) {
  return { status: 'approved', isActive: true, isDeleted: false, shgStoreId: { $exists: false },
    $and: [
      channelVisibility(type),
      { type: { $ne: 'shg' } },
      { $or: [{ type }, { channels: { $elemMatch: { type, isActive: { $ne: false } } } }] },
      type === 'grocery' ? { fulfillmentType: { $ne: 'digital' }, stock: { $gt: 0 } } : { $or: [{ fulfillmentType: 'digital' }, { stock: { $gt: 0 } }] },
    ] };
}
export async function searchImageIndex(fingerprint, { type, page = 1, limit = 20 }) {
  if (!await ProductImageIndex.exists({ version: IMAGE_INDEX_VERSION })) throw httpError(503, 'Image search catalogue is not ready. Ask the administrator to run the image search indexer.');
  const visible = imageSearchVisibility(type);
  const candidates = ProductImageIndex.aggregate([
    { $match: { version: IMAGE_INDEX_VERSION, $or: [
      { bands: { $in: fingerprint.bands } },
      { colorBands: { $in: imageColorBands(fingerprint) } },
      // Existing indexes remain searchable before an optional catalogue refresh.
      { 'colorBands.0': { $exists: false } },
    ] } },
    { $lookup: { from: 'products', localField: 'productId', foreignField: '_id', pipeline: [{ $match: visible }, { $project: { _id: 1, images: 1 } }], as: 'product' } },
    { $unwind: '$product' },
    { $match: { $expr: { $in: ['$imageUrl', '$product.images'] } } },
    { $project: { productId: 1, imageUrl: 1, hash: 1, histogram: 1, spatial: 1, colorHistogram: 1 } },
  ]).cursor({ batchSize: 200 });
  const best = new Map();
  for await (const candidate of candidates) {
    const score = imageSimilarity(fingerprint, candidate), id = String(candidate.productId);
    const previous = best.get(id);
    if (score >= 0.78 && (!previous || score > previous.score || (score === previous.score && candidate.imageUrl < previous.imageUrl))) best.set(id, { score, imageUrl: candidate.imageUrl });
  }
  const ranked = [...best].sort((a, b) => b[1].score - a[1].score || a[0].localeCompare(b[0]));
  const selected = ranked.slice((page - 1) * limit, page * limit);
  const products = await Product.find({ ...visible, _id: { $in: selected.map(([id]) => id) } }).select('-digital.file').populate('category', 'name').populate('sellerId', 'businessName storeDetails.name').lean();
  const lookup = new Map(products.map(p => [String(p._id), p]));
  return { data: selected.filter(([id, match]) => lookup.get(id)?.images?.includes(match.imageUrl)).map(([id, match]) => publicProduct({ ...lookup.get(id), matchedImageUrl: match.imageUrl, imageSimilarity: Math.round(match.score * 1000) / 1000 })),
    meta: { page, limit, total: ranked.length, mode: IMAGE_SEARCH_MODE } };
}
