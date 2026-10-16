import { httpError } from '../utils/response.js';
import { toPaise, fromPaise } from '../utils/money.js';

export const MAX_WHOLESALE_QUANTITY = 100000;
const numeric = (value) => (typeof value === 'number' || (typeof value === 'string' && value.trim() !== '')) && Number.isFinite(Number(value));
const positiveInteger = (value) => numeric(value) && Number.isSafeInteger(Number(value)) && Number(value) >= 1 && Number(value) <= MAX_WHOLESALE_QUANTITY;

/**
 * Validate and normalize wholesale terms for one variant. Retail `price` is
 * deliberately not read or changed here; the wholesale schedule is a separate
 * optional price book used by the catalog, cart and transactional checkout.
 */
export const normalizeWholesalePricing = (raw) => {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'object' || Array.isArray(raw)) throw httpError(400, 'Wholesale pricing must be an object');

  const enabled = raw.enabled === true || raw.enabled === 'true';
  if (!enabled) return { enabled: false };

  const minimumQuantity = Number(raw.minimumQuantity);
  const quantityIncrement = Number(raw.quantityIncrement ?? 1);
  if (!positiveInteger(raw.minimumQuantity)) throw httpError(400, 'Wholesale minimum quantity must be a positive whole number within the supported limit');
  if (!positiveInteger(raw.quantityIncrement ?? 1)) throw httpError(400, 'Wholesale quantity increment must be a positive whole number');
  if (!Array.isArray(raw.priceTiers) || raw.priceTiers.length === 0) {
    throw httpError(400, 'Wholesale pricing needs at least one quantity price tier');
  }

  const priceTiers = raw.priceTiers.map((tier, index) => {
    const tierQuantity = Number(tier?.minimumQuantity);
    const unitPrice = Number(tier?.unitPrice);
    if (!positiveInteger(tier?.minimumQuantity) || tierQuantity < minimumQuantity || (tierQuantity - minimumQuantity) % quantityIncrement !== 0) {
      throw httpError(400, `Wholesale price tier ${index + 1} must use an allowed quantity at or above the MOQ`);
    }
    if (!numeric(tier?.unitPrice) || !Number.isSafeInteger(Math.round(unitPrice * 100)) || unitPrice <= 0 || Math.abs(Math.round(unitPrice * 100) / 100 - unitPrice) > 1e-8) {
      throw httpError(400, `Wholesale price tier ${index + 1} must have a positive price with at most two decimals`);
    }
    return { minimumQuantity: tierQuantity, unitPrice: fromPaise(toPaise(unitPrice)) };
  });

  priceTiers.sort((a, b) => a.minimumQuantity - b.minimumQuantity);
  if (priceTiers[0].minimumQuantity !== minimumQuantity) {
    throw httpError(400, 'The first wholesale price tier must start at the minimum order quantity');
  }
  for (let index = 1; index < priceTiers.length; index += 1) {
    if (priceTiers[index].minimumQuantity === priceTiers[index - 1].minimumQuantity) {
      throw httpError(400, 'Wholesale price tier quantities must be unique');
    }
    if (priceTiers[index].unitPrice > priceTiers[index - 1].unitPrice) {
      throw httpError(400, 'Wholesale unit prices cannot increase at higher quantity tiers');
    }
  }

  return { enabled: true, minimumQuantity, quantityIncrement, priceTiers };
};

/** Resolve a server-side unit price for a requested variant quantity. */
export const priceWholesaleQuantity = (pricing, quantity) => {
  const normalized = normalizeWholesalePricing(pricing);
  const qty = Number(quantity);
  if (!normalized?.enabled) throw httpError(400, 'Wholesale is not available for this variant');
  if (!positiveInteger(quantity) || qty < normalized.minimumQuantity || (qty - normalized.minimumQuantity) % normalized.quantityIncrement !== 0) {
    throw httpError(400, 'Quantity does not meet the wholesale MOQ or increment');
  }

  const tier = [...normalized.priceTiers].reverse().find((item) => qty >= item.minimumQuantity);
  if (!tier) throw httpError(400, 'No wholesale price is configured for this quantity');
  const cents = toPaise(tier.unitPrice) * qty;
  if (!Number.isSafeInteger(cents)) throw httpError(400, 'Wholesale line amount exceeds the supported limit');
  return { unitPrice: tier.unitPrice, quantity: qty, lineTotal: fromPaise(cents) };
};
