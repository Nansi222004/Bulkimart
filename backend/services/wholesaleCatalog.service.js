import Product from '../models/Product.js';
import Seller from '../models/Seller.js';
import { CHANNEL, APPROVAL, WHOLESALE_CHANNEL } from '../constants/enums.js';
import { resolveInventoryItem } from './inventory.service.js';
import { wholesaleAvailability } from './wholesaleEligibility.service.js';

/** Shared eligibility query for the authenticated customer catalog, its
 * public availability bit, and the admin read-only management summary. */
export const getEligibleWholesaleCatalog = async () => {
  const sellers = await Seller.find({
    status: 'approved',
    salesChannels: WHOLESALE_CHANNEL,
    'wholesaleChannel.status': 'approved',
  }).select('_id businessName storeDetails.name userId').populate('userId', 'isActive');
  const sellerIds = sellers
    .filter((seller) => seller.userId && seller.userId.isActive !== false)
    .map((seller) => seller._id);
  if (!sellerIds.length) return [];

  const products = await Product.find({
    sellerId: { $in: sellerIds },
    type: { $in: [CHANNEL.ECOM, CHANNEL.GROCERY] },
    status: APPROVAL.APPROVED,
    isActive: true,
    isDeleted: false,
    fulfillmentType: { $ne: 'digital' },
  })
    .select('_id name description images category sellerId sellerName type variants._id variants.name variants.sku variants.stock variants.unit variants.weight variants.attributes +variants.wholesalePricing')
    .populate('category', 'name slug isActive')
    .lean();

  const sellerById = new Map(sellers.map((seller) => [String(seller._id), seller]));
  return products.map((product) => {
    if (!product.category || product.category.isActive === false) return null;
    const seller = sellerById.get(String(product.sellerId));
    const variants = (product.variants || []).flatMap((variant) => {
      const pricing = variant.wholesalePricing;
      if (!variant._id || !pricing?.enabled) return [];
      let normalizedPricing;
      try {
        normalizedPricing = wholesaleAvailability(variant);
        if (!normalizedPricing) return [];
      } catch {
        return [];
      }
      const inventory = resolveInventoryItem(product, variant._id);
      return [{
        variantId: variant._id,
        name: variant.name,
        sku: variant.sku,
        attributes: variant.attributes || [],
        unit: variant.unit,
        available: true,
        availableStock: inventory.stock,
        minimumQuantity: normalizedPricing.minimumQuantity,
        quantityIncrement: normalizedPricing.quantityIncrement,
        priceTiers: normalizedPricing.priceTiers,
        maxQuantity: normalizedPricing.maxQuantity,
        startingPrice: normalizedPricing.startingPrice,
      }];
    });
    if (!variants.some((variant) => variant.available)) return null;
    return {
      _id: product._id,
      name: product.name,
      description: product.description,
      images: product.images || [],
      category: product.category,
      type: product.type,
      seller: { name: seller?.storeDetails?.name || seller?.businessName || product.sellerName },
      variants,
    };
  }).filter(Boolean);
};
