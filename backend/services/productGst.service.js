import { toPaise, fromPaise, lineMoney } from '../utils/money.js';
import { cumulativePaise, moneyPaise } from '../utils/financeMoney.js';
import { discountAllocation } from './orderDiscounts.service.js';
import { httpError } from '../utils/response.js';

export const PRODUCT_GST_RATES = Object.freeze([0, 5, 12, 18, 28]);
export const PRODUCT_GST_VERSION = 'product-gst-v1';
const ratio = (amount, numerator, denominator) => Number((BigInt(amount) * BigInt(numerator) * 2n + BigInt(denominator)) / (2n * BigInt(denominator)));

// Missing treatment alone has authoritative precedent: all existing prices
// were inclusive. A missing/invalid rate has no such precedent and fails closed.
export function resolveProductGst(product) {
  if (product.fulfillmentType === 'digital') return { gstRate: 0, gstPriceType: 'inclusive', gstConfigurationSource: 'digital_unchanged' };
  // A loaded Mongoose document fills absent fields with schema defaults; only what was stored counts,
  // so every checkout path (lean or hydrated) treats a missing value the same way.
  const stored = path => typeof product.$isDefault === 'function' && product.$isDefault(path) ? undefined : product[path];
  const gstRate = stored('gstRate'), gstPriceType = stored('gstPriceType');
  if (gstRate === null || gstRate === undefined || gstRate === '' || !PRODUCT_GST_RATES.includes(Number(gstRate))) {
    throw httpError(409, 'Product GST rate needs seller review before checkout');
  }
  const treatment = gstPriceType ?? 'inclusive';
  if (!['inclusive', 'exclusive'].includes(treatment)) throw httpError(409, 'Product GST price type needs seller review before checkout');
  return { gstRate: Number(gstRate), gstPriceType: treatment,
    gstConfigurationSource: gstPriceType == null ? 'legacy_inclusive' : 'explicit' };
}

export function validateProductGstInput({ gstRate, gstPriceType, fulfillmentType = 'physical' }) {
  if (gstRate === null || gstRate === '' || !PRODUCT_GST_RATES.includes(Number(gstRate))) throw httpError(400, 'Select a supported product GST rate');
  if (!['inclusive', 'exclusive'].includes(gstPriceType)) throw httpError(400, 'Select GST inclusive or GST exclusive');
  if (fulfillmentType === 'digital' && (Number(gstRate) !== 0 || gstPriceType !== 'inclusive')) throw httpError(400, 'Product GST settings are only supported for physical products');
  return { gstRate: Number(gstRate), gstPriceType };
}

// Round once per line, half up, in integer paise. Keep the entered unit price
// unchanged; a rounded line total is not always divisible by its quantity.
export function productGstLine(item) {
  const config = item.product ? resolveProductGst(item.product) : resolveProductGst({ gstRate: item.gstRate ?? 0,
    gstPriceType: item.gstPriceType, fulfillmentType: item.fulfillmentType });
  const sellingPricePaise = toPaise(lineMoney(item.price, Number(item.qty)));
  const taxableValuePaise = config.gstPriceType === 'inclusive'
    ? ratio(sellingPricePaise, 100, 100 + config.gstRate) : sellingPricePaise;
  const gstPaise = config.gstPriceType === 'inclusive' ? sellingPricePaise - taxableValuePaise : ratio(taxableValuePaise, config.gstRate, 100);
  const grossPaise = taxableValuePaise + gstPaise;
  fromPaise(grossPaise); // Apply the same checkout limit as all other money.
  return { productId: String(item.productId || item.product?._id || ''), variantId: item.variantId ? String(item.variantId) : null,
    sellerId: item.sellerId ? String(item.sellerId) : null, qty: Number(item.qty), unitPricePaise: toPaise(item.price),
    originalUnitPricePaise: toPaise(item.originalPrice ?? item.price), ...config, sellingPricePaise,
    taxableValueBeforeDiscountPaise: taxableValuePaise, taxableValuePaise, gstPaise, grossPaise,
    addedGstPaise: config.gstPriceType === 'exclusive' ? gstPaise : 0,
    includedGstPaise: config.gstPriceType === 'inclusive' ? gstPaise : 0 };
}

export function summarizeProductGst(lines) {
  const keys = ['sellingPricePaise', 'taxableValueBeforeDiscountPaise', 'taxableValuePaise', 'gstPaise', 'grossPaise', 'addedGstPaise', 'includedGstPaise', 'discountPaise', 'customerPaidPaise'];
  const totals = Object.fromEntries(keys.map(key => [key, lines.reduce((n, line) => n + (line[key] || 0), 0)]));
  const rates = new Map();
  for (const line of lines) {
    const key = `${line.gstRate}:${line.gstPriceType}`;
    if (!rates.has(key)) rates.set(key, { gstRate: line.gstRate, gstPriceType: line.gstPriceType, taxableValuePaise: 0, gstPaise: 0 });
    const row = rates.get(key); row.taxableValuePaise += line.taxableValuePaise; row.gstPaise += line.gstPaise;
  }
  return { version: PRODUCT_GST_VERSION, currency: 'INR', rounding: 'line_half_up_paise',
    discountFunding: 'platform', taxBasis: 'seller_consideration_before_platform_discounts',
    jurisdictionStatus: 'unverified', components: null,
    deliveryTax: { status: 'unconfigured', amountPaise: null, treatment: null },
    ...totals, rates: [...rates.values()].sort((a, b) => a.gstRate - b.gstRate || a.gstPriceType.localeCompare(b.gstPriceType)), lines };
}

export function calculateProductGst(items, pricing) {
  const lines = items.map(productGstLine);
  const allocation = discountAllocation(pricing, lines.map(line => line.grossPaise));
  return summarizeProductGst(lines.map((line, index) => {
    const allocatedDiscounts = Object.fromEntries(allocation.keys.map(key => [key, allocation.discounts[key][index]]));
    const discountPaise = Object.values(allocatedDiscounts).reduce((n, amount) => n + amount, 0);
    return { ...line, lineIndex: index, allocatedDiscounts, discountPaise, customerPaidPaise: line.grossPaise - discountPaise };
  }));
}

export const itemGrossPaise = item => item.productTax?.version === PRODUCT_GST_VERSION
  ? item.productTax.grossPaise : moneyPaise(item.price) * item.qty;
export const itemGrossExpression = (prefix = '$items') => ({ $ifNull: [`${prefix}.productTax.grossPaise`, { $round: [{ $multiply: [`${prefix}.price`, `${prefix}.qty`, 100] }, 0] }] });

export function validateProductTaxSnapshot(order) {
  if (!order.productTax) return; // Historical documents are never reconstructed here.
  const tax = order.productTax;
  if (tax.version !== PRODUCT_GST_VERSION || tax.lines?.length !== order.items.length) throw httpError(409, 'Invalid product GST snapshot');
  const allocation = discountAllocation(order.pricing, tax.lines.map(line => line.grossPaise));
  for (const [index, item] of order.items.entries()) {
    const line = tax.lines[index];
    const expected = productGstLine({ ...item.toObject?.() || item, gstRate: line.gstRate, gstPriceType: line.gstPriceType });
    if (String(item.productId) !== line.productId || String(item.sellerId || '') !== String(line.sellerId || '')
      || String(item.variantId || '') !== String(line.variantId || '') || item.qty !== line.qty || toPaise(item.price) !== line.unitPricePaise
      || ['grossPaise', 'gstPaise', 'taxableValuePaise', 'sellingPricePaise', 'includedGstPaise', 'addedGstPaise'].some(key => line[key] !== expected[key])
      || allocation.keys.some(key => line.allocatedDiscounts[key] !== allocation.discounts[key][index])) throw httpError(409, 'Product GST snapshot does not reconcile with order items');
    line.itemId = String(item._id);
    item.productTax = { ...line, version: PRODUCT_GST_VERSION };
  }
  const expected = summarizeProductGst(tax.lines);
  if (['gstPaise', 'grossPaise', 'taxableValuePaise', 'sellingPricePaise', 'addedGstPaise', 'includedGstPaise', 'discountPaise', 'customerPaidPaise'].some(key => tax[key] !== expected[key])
    || tax.grossPaise !== toPaise(order.pricing.subtotal)) throw httpError(409, 'Product GST totals do not reconcile');
}

export function refundProductGst(line, before, quantity) {
  const share = amount => cumulativePaise(amount, before + quantity, line.qty) - cumulativePaise(amount, before, line.qty);
  const grossPaise = share(line.grossPaise), taxableValuePaise = share(line.taxableValuePaise);
  // GST is the residual, so successive partial credit amounts conserve each paisa.
  return { version: PRODUCT_GST_VERSION, gstRate: line.gstRate, gstPriceType: line.gstPriceType,
    grossPaise, taxableValuePaise, gstPaise: grossPaise - taxableValuePaise,
    customerRefundPaise: share(line.customerPaidPaise), platformDiscountPaise: grossPaise - share(line.customerPaidPaise),
    jurisdictionStatus: 'unverified', components: null };
}
