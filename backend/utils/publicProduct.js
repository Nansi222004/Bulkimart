import { retailAllowed } from './productChannels.js';
// Public retail responses use an allowlist even when aggregation/lean queries
// bypass Mongoose select:false. Never pass wholesale or private digital data.
const pick = (value, keys) => Object.fromEntries(keys.filter((key) => value?.[key] !== undefined).map((key) => [key, value[key]]));
const fields = '_id id type fulfillmentType name slug description images category subCategory sku brandName gstRate price mrp discountPercent stock unit weight dimensions tags sameDay returnable channels isHandmade isActive isDeleted isFeatured isSponsored sponsoredRank isClientBrand sellerName status ratings faqs createdAt updatedAt campaignPrice campaignDiscountValue campaignTitle campaignId subscriptionUnavailable returnPolicy imageSimilarity'.split(' ');
export const publicProduct = (document) => {
  const source = document?.toObject ? document.toObject() : document;
  if (!source) return source;
  if (!retailAllowed(source)) return null;
  const result = pick(source, fields);
  if (source.variants) result.variants = source.variants.map((variant) => pick(variant, ['_id', 'name', 'price', 'mrp', 'stock', 'unit', 'weight', 'sku', 'attributes']));
  if (source.digital) result.digital = pick(source.digital, ['author', 'language', 'format', 'licenseTerms']);
  if (source.sellerId) result.sellerId = source.sellerId.businessName !== undefined || source.sellerId.storeDetails !== undefined
    ? pick(source.sellerId, ['_id', 'businessName', 'storeDetails', 'serviceRadiusKm']) : source.sellerId;
  return result;
};
