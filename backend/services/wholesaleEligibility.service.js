import { httpError } from '../utils/response.js';
import { resolveInventoryItem } from './inventory.service.js';
import { normalizeWholesalePricing, priceWholesaleQuantity, MAX_WHOLESALE_QUANTITY } from './wholesalePricing.service.js';

// Business policy confirmed by the owner: any authenticated customer may buy.
// A seller-session token is never a customer session, even with buyer membership.
export const assertWholesaleBuyer = (req) => {
  if (req.userType !== 'user' || (req.tokenRole !== undefined && req.tokenRole !== 'buyer') || !req.user?.roles?.includes('buyer') || req.user.isActive === false) {
    throw httpError(403, 'Sign in with a customer account to use Wholesale');
  }
};
export const assertWholesaleSeller = (seller) => {
  if (!seller || seller.status !== 'approved' || seller.wholesaleChannel?.status !== 'approved'
    || !seller.salesChannels?.includes('wholesale') || !seller.userId || seller.userId?.isActive === false) {
    throw httpError(409, 'This seller is no longer eligible for Wholesale');
  }
};
export const quoteWholesaleVariant = (product, seller, variantId, quantity) => {
  assertWholesaleSeller(seller);
  if (!product || !['ecommerce', 'grocery'].includes(product.type) || product.fulfillmentType === 'digital'
    || product.isDeleted || !product.isActive || product.status !== 'approved' || product.category?.isActive === false) {
    throw httpError(409, 'This Wholesale product is unavailable');
  }
  const inventory = resolveInventoryItem(product, variantId);
  const variant = product.variants?.find((item) => String(item._id) === String(variantId));
  const terms = normalizeWholesalePricing(variant?.wholesalePricing);
  const quote = priceWholesaleQuantity(terms, quantity);
  if (!Number.isSafeInteger(inventory.stock) || inventory.stock < quote.quantity) throw httpError(409, 'There is not enough stock for this Wholesale quantity');
  const tier = [...terms.priceTiers].reverse().find((entry) => quote.quantity >= entry.minimumQuantity);
  return { inventory, ...quote, wholesaleSnapshot: {
    minimumQuantity: terms.minimumQuantity, quantityIncrement: terms.quantityIncrement,
    tierMinimumQuantity: tier.minimumQuantity, unitPrice: quote.unitPrice,
  } };
};
export const wholesaleAvailability = (variant) => {
  const terms = normalizeWholesalePricing(variant.wholesalePricing);
  if (!terms?.enabled || !Number.isSafeInteger(variant.stock) || variant.stock < terms.minimumQuantity) return null;
  const maxQuantity = terms.minimumQuantity + Math.floor((Math.min(variant.stock, MAX_WHOLESALE_QUANTITY) - terms.minimumQuantity) / terms.quantityIncrement) * terms.quantityIncrement;
  const tiers = terms.priceTiers.filter((tier) => tier.minimumQuantity <= maxQuantity);
  return { ...terms, priceTiers: tiers, maxQuantity, startingPrice: tiers.at(-1).unitPrice };
};
