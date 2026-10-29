// Read-only classification of an existing order's product GST, for the historical dry run.
// Evidence is limited to what the order itself froze at purchase time; the current product is never consulted.
import { PRODUCT_GST_RATES, calculateProductGst, validateProductTaxSnapshot } from '../services/productGst.service.js';
import { moneyPaise } from './financeMoney.js';

export const HISTORICAL_GST_CLASSES = Object.freeze({
  COMPLETE: 'complete',                       // a valid product-gst-v1 snapshot is stored
  RECONSTRUCTABLE: 'reconstructable',         // rate frozen in the order's finance snapshot; treatment inclusive by precedent
  NEEDS_REVIEW: 'reconstructable_needs_review', // as above, but a frozen 0% may be the old "unusable rate → 0%" fallback
  INSUFFICIENT: 'insufficient_evidence',      // no frozen rate for every item: leave untouched
  CONFLICT: 'conflict',                       // stored figures disagree with the order's own items or totals
});

const clone = value => JSON.parse(JSON.stringify(value));

export function classifyHistoricalOrderGst(order) {
  const base = { orderId: String(order._id), orderNo: order.orderNo || null, createdAt: order.createdAt || null, items: order.items?.length || 0 };
  if (order.productTax) {
    try { validateProductTaxSnapshot(clone(order)); return { ...base, class: HISTORICAL_GST_CLASSES.COMPLETE }; }
    catch (error) { return { ...base, class: HISTORICAL_GST_CLASSES.CONFLICT, reasons: [error.message] }; }
  }
  const lines = order.financialSnapshot?.lines || [];
  const frozen = (order.items || []).map(item => lines.find(line => line.itemId === String(item._id)));
  if (!order.items?.length || frozen.some(line => !line || !PRODUCT_GST_RATES.includes(Number(line.gstRatePercent)))) {
    return { ...base, class: HISTORICAL_GST_CLASSES.INSUFFICIENT, reasons: [!order.financialSnapshot ? 'No finance snapshot froze a GST rate at purchase' : 'An item has no frozen supported GST rate'] };
  }
  // Every product was priced GST-inclusive before the GST price type existed, which the old
  // settlement formula (taxable = gross / (1 + rate)) also assumed.
  const items = order.items.map((item, index) => ({ ...clone(item), gstRate: Number(frozen[index].gstRatePercent), gstPriceType: 'inclusive', fulfillmentType: item.fulfillmentType || 'physical' }));
  let proposed;
  try { proposed = calculateProductGst(items, order.pricing || {}); }
  catch (error) { return { ...base, class: HISTORICAL_GST_CLASSES.CONFLICT, reasons: [`Pricing does not reconcile: ${error.message}`] }; }
  const reasons = [];
  proposed.lines.forEach((line, index) => {
    const stored = frozen[index];
    if (Number.isSafeInteger(stored.grossPaise) && stored.grossPaise !== line.grossPaise) reasons.push(`Item ${index + 1}: frozen gross ${stored.grossPaise} ≠ ${line.grossPaise}`);
    if (Number.isSafeInteger(stored.taxableValuePaise) && stored.taxableValuePaise !== line.taxableValuePaise) reasons.push(`Item ${index + 1}: frozen taxable value ${stored.taxableValuePaise} ≠ ${line.taxableValuePaise}`);
  });
  if (proposed.grossPaise !== moneyPaise(order.pricing?.subtotal ?? 0)) reasons.push(`Item total ${proposed.grossPaise} ≠ order subtotal ${moneyPaise(order.pricing?.subtotal ?? 0)}`);
  if (reasons.length) return { ...base, class: HISTORICAL_GST_CLASSES.CONFLICT, reasons };
  const zeroRated = proposed.lines.some(line => line.gstRate === 0);
  return { ...base, class: zeroRated ? HISTORICAL_GST_CLASSES.NEEDS_REVIEW : HISTORICAL_GST_CLASSES.RECONSTRUCTABLE,
    ...(zeroRated ? { reasons: ['A frozen 0% rate may come from the old fallback for unusable rates; confirm it before backfilling'] } : {}),
    evidence: 'financialSnapshot.lines.gstRatePercent (frozen at purchase); treatment inclusive by precedent',
    proposed: { taxableValuePaise: proposed.taxableValuePaise, gstPaise: proposed.gstPaise, grossPaise: proposed.grossPaise,
      rates: proposed.rates } };
}
