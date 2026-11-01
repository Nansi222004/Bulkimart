// Port of frontend/src/modules/Seller/utils/{wholesaleOffer,wholesaleEligibility}.js.
// The server (services/sellerWholesaleOffers.service.js + wholesalePricing.service.js)
// re-validates everything; these checks only give the seller early feedback.

const whole = (value) => String(value ?? '').trim() !== '' && Number.isSafeInteger(Number(value)) && Number(value) >= 1 && Number(value) <= 100000;

export function validateWholesaleOffer(pricing, stock) {
  const errors = {};
  if (!pricing?.enabled) return errors;
  const moq = Number(pricing.minimumQuantity);
  const increment = Number(pricing.quantityIncrement);
  if (!whole(pricing.minimumQuantity)) errors.minimumQuantity = 'MOQ must be a whole number from 1 to 100,000';
  else if (!Number.isSafeInteger(Number(stock)) || moq > Number(stock)) errors.minimumQuantity = 'Available stock must meet the MOQ';
  if (!whole(pricing.quantityIncrement)) errors.quantityIncrement = 'Increment must be a whole number from 1 to 100,000';
  if (!pricing.priceTiers?.length) errors.priceTiers = 'Add at least one price tier';
  let previousQuantity = 0;
  let previousPrice = Infinity;
  (pricing.priceTiers || []).forEach((tier, index) => {
    const quantity = Number(tier.minimumQuantity);
    const price = String(tier.unitPrice ?? '').trim();
    if (!whole(tier.minimumQuantity) || quantity < moq || (quantity - moq) % increment !== 0 || quantity <= previousQuantity || (index === 0 && quantity !== moq)) {
      errors[`tier.${index}.quantity`] = 'Use increasing quantities that line up with MOQ + increments; the first tier starts at the MOQ';
    }
    // Validation only: prices stay decimal rupees in the API contract.
    const parts = price.split('.');
    const paise = Number(parts[0]) * 100 + Number((parts[1] || '').padEnd(2, '0'));
    if (!/^\d+(\.\d{1,2})?$/.test(price) || !Number.isSafeInteger(paise) || paise <= 0 || paise > 10000000 || paise > previousPrice) {
      errors[`tier.${index}.price`] = 'Use a positive price up to ₹1,00,000 with at most two decimals; higher tiers cannot cost more';
    }
    previousQuantity = quantity;
    previousPrice = paise;
  });
  return errors;
}

export const offerPayload = (pricing) => (pricing?.enabled
  ? {
    enabled: true,
    minimumQuantity: Number(pricing.minimumQuantity),
    quantityIncrement: Number(pricing.quantityIncrement),
    priceTiers: pricing.priceTiers.map((t) => ({ minimumQuantity: Number(t.minimumQuantity), unitPrice: Number(t.unitPrice) })),
  }
  : { enabled: false });

// Same conditions the server checks before it accepts an enabled offer.
export const hasWholesaleAccess = (seller) => seller?.status === 'approved'
  && seller?.wholesaleChannel?.status === 'approved'
  && Array.isArray(seller?.salesChannels) && seller.salesChannels.includes('wholesale');

export const eligibleWholesaleProduct = (product) => !!product && ['ecommerce', 'grocery'].includes(product.type)
  && product.fulfillmentType !== 'digital' && !product.isDeleted && product.status === 'approved'
  && product.isActive === true && !!product.category && product.category?.isActive !== false;

// Editable copy of a saved offer (numbers become strings for text inputs).
export const editableOffer = (pricing) => (pricing?.enabled
  ? {
    enabled: true,
    minimumQuantity: String(pricing.minimumQuantity ?? ''),
    quantityIncrement: String(pricing.quantityIncrement ?? ''),
    priceTiers: (pricing.priceTiers || []).map((t) => ({ minimumQuantity: String(t.minimumQuantity ?? ''), unitPrice: String(t.unitPrice ?? '') })),
  }
  : { enabled: false });
