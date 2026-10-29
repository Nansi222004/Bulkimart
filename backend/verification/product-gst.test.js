// Product GST calculator: one rounding rule (per line, half up, integer paise) for every caller.
import { PRODUCT_GST_RATES, resolveProductGst, validateProductGstInput, productGstLine, calculateProductGst, summarizeProductGst,
  validateProductTaxSnapshot, refundProductGst, itemGrossPaise } from '../services/productGst.service.js';
import { calculateMarketplaceLine } from '../services/vendorCommission.service.js';

// A pricing object that reconciles like the server's: payable = items − discounts.
const priced = (items, couponDiscount = 0) => { const gross = items.reduce((n, item) => n + productGstLine(item).grossPaise, 0);
  return { discountRepresentation: 'components-v1', subtotal: gross / 100, discount: 0, couponDiscount, cdsDiscount: 0, coinDiscount: 0, deliveryCharge: 0, tipAmount: 0, totalAmount: (gross - Math.round(couponDiscount * 100)) / 100 }; };
const line = (price, qty, gstRate, gstPriceType, extra = {}) => productGstLine({ productId: 'p', price, qty, gstRate, gstPriceType, fulfillmentType: 'physical', ...extra });

describe('inclusive and exclusive product GST at every supported rate', () => {
  test.each(PRODUCT_GST_RATES)('inclusive %s%%: the price already contains the GST', rate => {
    const row = line(100 + rate, 1, rate, 'inclusive');
    expect(row).toMatchObject({ sellingPricePaise: (100 + rate) * 100, taxableValuePaise: 10000, gstPaise: rate * 100, grossPaise: (100 + rate) * 100,
      includedGstPaise: rate * 100, addedGstPaise: 0, gstRate: rate, gstPriceType: 'inclusive' });
  });
  test.each(PRODUCT_GST_RATES)('exclusive %s%%: GST is added on top of the price', rate => {
    const row = line(100, 1, rate, 'exclusive');
    expect(row).toMatchObject({ sellingPricePaise: 10000, taxableValuePaise: 10000, gstPaise: rate * 100, grossPaise: 10000 + rate * 100,
      addedGstPaise: rate * 100, includedGstPaise: 0 });
  });
  test('the brief examples: ₹105 inclusive at 5% and ₹100 exclusive at 5% both total ₹105 with ₹100 taxable and ₹5 GST', () => {
    expect(line(105, 1, 5, 'inclusive')).toMatchObject({ taxableValuePaise: 10000, gstPaise: 500, grossPaise: 10500 });
    expect(line(100, 1, 5, 'exclusive')).toMatchObject({ taxableValuePaise: 10000, gstPaise: 500, grossPaise: 10500 });
  });
});

describe('quantities, rounding and edge values', () => {
  test('quantity multiplies before rounding, once per line', () => {
    // 3 × ₹33.33 inclusive at 18%: line ₹99.99 → taxable 8473.7… → ₹84.74, GST ₹15.25.
    expect(line(33.33, 3, 18, 'inclusive')).toMatchObject({ sellingPricePaise: 9999, taxableValuePaise: 8474, gstPaise: 1525, grossPaise: 9999 });
    // 3 × ₹33.33 exclusive at 18%: GST 1799.82 → ₹18.00 (half up).
    expect(line(33.33, 3, 18, 'exclusive')).toMatchObject({ taxableValuePaise: 9999, gstPaise: 1800, grossPaise: 11799 });
  });
  test('half-paisa amounts round up, and taxable + GST always equals the line total', () => {
    const exclusive = line(0.1, 1, 5, 'exclusive'); // 0.5 paise of GST rounds up
    expect(exclusive.gstPaise).toBe(1);
    for (const [price, qty, rate, type] of [[19.99, 7, 12, 'inclusive'], [0.01, 1, 28, 'inclusive'], [12345.67, 2, 28, 'exclusive'], [1, 999, 5, 'inclusive']]) {
      const row = line(price, qty, rate, type);
      expect(row.taxableValuePaise + row.gstPaise).toBe(row.grossPaise);
      expect(Number.isSafeInteger(row.gstPaise) && row.gstPaise >= 0).toBe(true);
    }
  });
  test('a zero-price line has no GST', () => {
    expect(line(0, 2, 18, 'exclusive')).toMatchObject({ taxableValuePaise: 0, gstPaise: 0, grossPaise: 0 });
  });
  test('repeated calculations give identical results', () => {
    const items = [{ price: 33.33, qty: 3, gstRate: 18, gstPriceType: 'inclusive' }, { price: 49.5, qty: 2, gstRate: 5, gstPriceType: 'exclusive' }];
    const pricing = priced(items, 10);
    expect(JSON.stringify(calculateProductGst(items, pricing))).toBe(JSON.stringify(calculateProductGst(items, pricing)));
  });
});

describe('mixed rates, totals and discounts', () => {
  const items = [{ productId: 'a', sellerId: 's1', price: 105, qty: 1, gstRate: 5, gstPriceType: 'inclusive' },
    { productId: 'b', sellerId: 's2', price: 100, qty: 2, gstRate: 18, gstPriceType: 'exclusive' },
    { productId: 'c', sellerId: 's1', price: 50, qty: 1, gstRate: 0, gstPriceType: 'inclusive' }];
  test('mixed rates and sellers: per-rate rows and totals reconcile', () => {
    const tax = calculateProductGst(items, priced(items));
    expect(tax.rates).toEqual([{ gstRate: 0, gstPriceType: 'inclusive', taxableValuePaise: 5000, gstPaise: 0 },
      { gstRate: 5, gstPriceType: 'inclusive', taxableValuePaise: 10000, gstPaise: 500 },
      { gstRate: 18, gstPriceType: 'exclusive', taxableValuePaise: 20000, gstPaise: 3600 }]);
    expect(tax).toMatchObject({ sellingPricePaise: 35500, taxableValuePaise: 35000, gstPaise: 4100, grossPaise: 39100, addedGstPaise: 3600, includedGstPaise: 500 });
    expect(tax.taxableValuePaise + tax.gstPaise).toBe(tax.grossPaise);
  });
  test('a coupon is shared across lines in proportion to their totals, keeps every paisa, and does not change the GST', () => {
    const tax = calculateProductGst(items, priced(items, 10));
    const shares = tax.lines.map(row => row.allocatedDiscounts.couponDiscount);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(1000);
    expect(shares).toEqual([268, 604, 128]); // 268.54 / 603.58 / 127.88: largest remainders get the 2 spare paise
    expect(tax.gstPaise).toBe(4100);
    expect(tax.customerPaidPaise).toBe(39100 - 1000);
  });
  test('the server summary of stored lines matches a fresh calculation', () => {
    const tax = calculateProductGst(items, priced(items));
    expect(summarizeProductGst(tax.lines)).toEqual(tax);
  });
});

describe('configuration: supported values, legacy products and digital goods', () => {
  test('a product without a GST price type keeps its historical inclusive interpretation', () => {
    expect(resolveProductGst({ gstRate: 5 })).toEqual({ gstRate: 5, gstPriceType: 'inclusive', gstConfigurationSource: 'legacy_inclusive' });
    expect(resolveProductGst({ gstRate: 5, gstPriceType: 'exclusive' })).toEqual({ gstRate: 5, gstPriceType: 'exclusive', gstConfigurationSource: 'explicit' });
  });
  test('a missing or unsupported rate is never treated as 0%: checkout stops for seller review', () => {
    for (const gstRate of [undefined, null, '', 7, -5, 'abc']) expect(() => resolveProductGst({ gstRate })).toThrow('Product GST rate needs seller review before checkout');
    expect(() => resolveProductGst({ gstRate: 5, gstPriceType: 'mixed' })).toThrow('Product GST price type needs seller review before checkout');
  });
  test('seller input is validated on the server', () => {
    expect(validateProductGstInput({ gstRate: '18', gstPriceType: 'exclusive' })).toEqual({ gstRate: 18, gstPriceType: 'exclusive' });
    expect(() => validateProductGstInput({ gstRate: 15, gstPriceType: 'inclusive' })).toThrow('Select a supported product GST rate');
    expect(() => validateProductGstInput({ gstRate: 5, gstPriceType: 'both' })).toThrow('Select GST inclusive or GST exclusive');
    expect(() => validateProductGstInput({ gstRate: 5, gstPriceType: 'inclusive', fulfillmentType: 'digital' })).toThrow('only supported for physical products');
  });
  test('digital products are unchanged: no product GST is added or extracted', () => {
    expect(productGstLine({ productId: 'e', price: 99, qty: 1, gstRate: 18, gstPriceType: 'exclusive', fulfillmentType: 'digital' }))
      .toMatchObject({ gstRate: 0, gstPaise: 0, grossPaise: 9900, gstConfigurationSource: 'digital_unchanged' });
  });
});

describe('commission stays separate from product GST', () => {
  const rule = { method: 'percentage', value: 10, minimum: 0, maximum: null, base: 'eligible', taxTreatment: 'exclusive', taxRate: 18 };
  test('commission is charged on what the seller is paid for, and its GST is separate from product GST', () => {
    const tax = line(100, 1, 18, 'exclusive'); // customer pays ₹118, of which ₹18 is product GST
    const settlement = calculateMarketplaceLine(tax.grossPaise, tax.grossPaise, rule, { gstRatePercent: 18, taxableValuePaise: tax.taxableValuePaise });
    expect(settlement.taxableValuePaise).toBe(10000);     // the frozen product taxable value, not re-derived as if inclusive
    expect(settlement.commissionPaise).toBe(1180);        // 10% of the eligible ₹118
    expect(settlement.taxPaise).toBe(212);                // 18% GST on the commission only
    expect(settlement.netPaise).toBe(11800 - 1180 - 212); // product GST stays inside the seller's amount, counted once
  });
  test('without a commission rule the product GST is still calculated', () => {
    const items = [{ productId: 'a', price: 105, qty: 1, gstRate: 5, gstPriceType: 'inclusive' }];
    const tax = calculateProductGst(items, priced(items));
    expect(tax).toMatchObject({ taxableValuePaise: 10000, gstPaise: 500 });
  });
});

describe('order snapshots and refunds', () => {
  const order = () => {
    const items = [{ _id: 'i1', productId: 'a', sellerId: 's1', price: 105, qty: 3 }, { _id: 'i2', productId: 'b', sellerId: 's2', price: 100, qty: 1 }];
    const taxed = [{ ...items[0], gstRate: 5, gstPriceType: 'inclusive' }, { ...items[1], gstRate: 18, gstPriceType: 'exclusive' }];
    const pricing = priced(taxed, 12), productTax = calculateProductGst(taxed, pricing);
    return { items, pricing, productTax };
  };
  test('a server-built snapshot validates and is stamped onto each item', () => {
    const o = order(); validateProductTaxSnapshot(o);
    expect(o.items[0].productTax).toMatchObject({ version: 'product-gst-v1', itemId: 'i1', gstRate: 5, gstPaise: 1500 });
    expect(itemGrossPaise(o.items[1])).toBe(11800);
  });
  test('a tampered snapshot or total is rejected', () => {
    const changed = order(); changed.productTax.lines[1].gstPaise -= 1;
    expect(() => validateProductTaxSnapshot(changed)).toThrow('Product GST snapshot does not reconcile with order items');
    const total = order(); total.pricing.subtotal += 1;
    expect(() => validateProductTaxSnapshot(total)).toThrow('Product GST totals do not reconcile');
  });
  test('partial refunds use the stored line and add up to the original exactly', () => {
    const o = order(); validateProductTaxSnapshot(o); const stored = o.productTax.lines[0];
    const first = refundProductGst(stored, 0, 1), rest = refundProductGst(stored, 1, 2);
    expect(first.grossPaise + rest.grossPaise).toBe(stored.grossPaise);
    expect(first.gstPaise + rest.gstPaise).toBe(stored.gstPaise);
    expect(first.customerRefundPaise + rest.customerRefundPaise).toBe(stored.customerPaidPaise);
    expect(first).toMatchObject({ gstRate: 5, gstPriceType: 'inclusive', grossPaise: 10500, taxableValuePaise: 10000, gstPaise: 500 });
  });
  test('historical items without a snapshot keep their price × quantity', () => {
    expect(itemGrossPaise({ price: 99.5, qty: 2 })).toBe(19900);
  });
});

describe('historical dry-run classification (read-only)', () => {
  let classify;
  beforeAll(async () => { ({ classifyHistoricalOrderGst: classify } = await import('../utils/productGstHistory.js')); });
  const legacy = (rate, extra = {}) => ({ _id: 'o1', orderNo: 'ORD-1', items: [{ _id: 'i1', productId: 'p', price: 105, qty: 2 }],
    pricing: { subtotal: 210, discount: 0, couponDiscount: 0, cdsDiscount: 0, deliveryCharge: 0, totalAmount: 210 },
    financialSnapshot: { lines: [{ itemId: 'i1', grossPaise: 21000, gstRatePercent: rate, ...extra }] } });
  test('a rate frozen in the finance snapshot is reconstructable as inclusive, without reading the product', () => {
    expect(classify(legacy(5))).toMatchObject({ class: 'reconstructable', proposed: { taxableValuePaise: 20000, gstPaise: 1000, grossPaise: 21000 } });
  });
  test('a frozen 0% needs review; no frozen rate is insufficient evidence; missing never means 0%', () => {
    expect(classify(legacy(0)).class).toBe('reconstructable_needs_review');
    expect(classify({ ...legacy(5), financialSnapshot: undefined }).class).toBe('insufficient_evidence');
    expect(classify(legacy(undefined)).class).toBe('insufficient_evidence');
  });
  test('stored figures that disagree with the order are conflicts', () => {
    expect(classify(legacy(5, { taxableValuePaise: 19000 }))).toMatchObject({ class: 'conflict' });
    expect(classify({ ...legacy(5), pricing: { ...legacy(5).pricing, subtotal: 200, totalAmount: 200 } }).class).toBe('conflict');
  });
  test('a valid stored snapshot is complete', () => {
    const items = [{ _id: 'i1', productId: 'p', price: 105, qty: 2 }], pricing = priced([{ ...items[0], gstRate: 5, gstPriceType: 'inclusive' }]);
    const productTax = calculateProductGst([{ ...items[0], gstRate: 5, gstPriceType: 'inclusive' }], pricing);
    expect(classify({ _id: 'o2', items, pricing, productTax }).class).toBe('complete');
  });
});
