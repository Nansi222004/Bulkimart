import { buildShiprocketOrderPayload } from '../../controllers/fulfillment.controller.js';
import { shiprocketCodBlocked, assertShiprocketCodAllowed } from '../../services/courierTracking.service.js';

/**
 * Shiprocket COD (C1 amended): what the courier collects must equal the frozen order payable, prepaid bodies stay
 * exactly as they were, and COD is allowed only for Shop All behind SHIPROCKET_COD_ENABLED.
 */
const base = (extra = {}) => ({
  orderNo: 'ORD-1', createdAt: new Date('2026-11-20T10:00:00Z'), type: 'ecommerce', deliveryMethod: 'easy_ship', paymentMethod: 'online',
  shippingAddress: { name: 'Buyer', phone: '9876500000', line1: 'Line 1', city: 'Indore', state: 'Madhya Pradesh', pincode: '452001' },
  items: [{ name: 'Lamp', sku: 'LAMP-1', qty: 2, price: 250 }],
  pricing: { subtotal: 500, deliveryCharge: 40, couponDiscount: 0, tipAmount: 0, totalAmount: 540 },
  financialSnapshot: { version: 2, state: 'configured', expectedPaise: 54000 },
  ...extra,
});
const args = { pickupLocation: 'pickup-1', billingEmail: 'orders@example.test', customerDeliveryCharge: 40, packageSize: { length: 10, breadth: 10, height: 10 }, weight: 1 };
const collectable = (p) => Math.round((p.sub_total + p.shipping_charges - p.total_discount) * 100);
const withFlag = (value, fn) => { const before = process.env.SHIPROCKET_COD_ENABLED; if (value === undefined) delete process.env.SHIPROCKET_COD_ENABLED; else process.env.SHIPROCKET_COD_ENABLED = value;
  try { return fn(); } finally { if (before === undefined) delete process.env.SHIPROCKET_COD_ENABLED; else process.env.SHIPROCKET_COD_ENABLED = before; } };

describe('Shiprocket booking payload', () => {
  test('prepaid body is unchanged: items, tip line, gross sub_total, derived discount', () => {
    const order = base({ pricing: { subtotal: 500, deliveryCharge: 40, couponDiscount: 50, tipAmount: 20, totalAmount: 510 }, financialSnapshot: { version: 2, state: 'configured', expectedPaise: 51000 } });
    const p = buildShiprocketOrderPayload(order, args);
    expect(p.payment_method).toBe('Prepaid');
    expect(p.order_items).toEqual([{ name: 'Lamp', sku: 'LAMP-1', units: 2, selling_price: 250 }, { name: 'Delivery partner tip', sku: 'BULKIMART-TIP', units: 1, selling_price: 20 }]);
    // The exact formula prepaid bookings always used: sub_total = subtotal + tip; discount = gross + delivery − total.
    expect(p.sub_total).toBe(500 + 20);
    expect(p.total_discount).toBe(Number((520 + 40 - 510).toFixed(2)));
    expect(p.order_items.some((i) => i.sku === 'BULKIMART-COD-FEE')).toBe(false);
  });

  test('COD without a handling fee: the courier collects exactly the order total', () => {
    const p = buildShiprocketOrderPayload(base({ paymentMethod: 'cod' }), args);
    expect(p.payment_method).toBe('COD');
    expect(collectable(p)).toBe(54000);
    expect(p.total_discount).toBe(0);
  });

  test('COD with a handling fee (incl. GST) and a coupon: fee is its own line, no negative discount, collectable = payable', () => {
    // ₹500 goods − ₹50 coupon + ₹40 delivery + ₹23.60 COD fee = ₹513.60 (the old formula made the discount −23.60 and refused).
    const order = base({ paymentMethod: 'cod', pricing: { subtotal: 500, deliveryCharge: 40, couponDiscount: 50, tipAmount: 0, codFeeTotal: 23.6, totalAmount: 513.6 },
      financialSnapshot: { version: 2, state: 'configured', expectedPaise: 51360 } });
    const p = buildShiprocketOrderPayload(order, args);
    expect(p.order_items).toContainEqual({ name: 'Cash on Delivery handling fee', sku: 'BULKIMART-COD-FEE', units: 1, selling_price: 23.6 });
    expect(p.sub_total).toBe(523.6);
    expect(p.total_discount).toBe(50);
    expect(collectable(p)).toBe(51360);
  });

  test('COD with tip and fee reconciles to the paisa', () => {
    const order = base({ paymentMethod: 'cod', pricing: { subtotal: 333.33, deliveryCharge: 40, couponDiscount: 0, tipAmount: 10, codFeeTotal: 11.8, totalAmount: 395.13 },
      financialSnapshot: { version: 2, state: 'configured', expectedPaise: 39513 } });
    expect(collectable(buildShiprocketOrderPayload(order, args))).toBe(39513);
  });

  test('a COD order that disagrees with its frozen finance snapshot is refused before Shiprocket is contacted', () => {
    const order = base({ paymentMethod: 'cod', financialSnapshot: { version: 2, state: 'configured', expectedPaise: 50000 } });
    expect(() => buildShiprocketOrderPayload(order, args)).toThrow(expect.objectContaining({ status: 409 }));
  });

  test('pricing that cannot reconcile (negative discount) is refused', () => {
    const order = base({ pricing: { subtotal: 500, deliveryCharge: 40, totalAmount: 600 } });
    expect(() => buildShiprocketOrderPayload(order, args)).toThrow(/does not reconcile/);
  });

  test('an exchange replacement keeps its declared value with no discount', () => {
    const p = buildShiprocketOrderPayload(base({ exchange: { returnId: 'r1' }, paymentMethod: 'wallet', pricing: { subtotal: 500, deliveryCharge: 0, totalAmount: 0 } }), { ...args, customerDeliveryCharge: 0 });
    expect(p.total_discount).toBe(0);
  });
});

describe('C1: when Shiprocket may carry COD', () => {
  const cod = (extra = {}) => base({ paymentMethod: 'cod', ...extra });
  test('switched off (default): every COD booking stays blocked; prepaid is never blocked', () => withFlag(undefined, () => {
    expect(shiprocketCodBlocked(cod())).toBe(true);
    expect(shiprocketCodBlocked(base())).toBe(false);
    expect(() => assertShiprocketCodAllowed(cod())).toThrow(expect.objectContaining({ status: 409, meta: { code: 'SHIPROCKET_COD_UNAVAILABLE' } }));
  }));
  test('switched on: Shop All Easy Ship COD with a configured snapshot is allowed; everything else stays blocked', () => withFlag('true', () => {
    expect(shiprocketCodBlocked(cod())).toBe(false);
    expect(shiprocketCodBlocked({ ...cod(), deliveryMethod: undefined })).toBe(false); // older Shop All orders = Easy Ship
    expect(shiprocketCodBlocked(cod({ type: 'grocery' }))).toBe(true); // Quick Commerce stays blocked
    expect(shiprocketCodBlocked(cod({ deliveryMethod: 'self_delivery' }))).toBe(true);
    expect(shiprocketCodBlocked(cod({ exchange: { returnId: 'r1' } }))).toBe(true);
    expect(shiprocketCodBlocked(cod({ financialSnapshot: { version: 2, state: 'held_missing_rule' } }))).toBe(true);
    expect(shiprocketCodBlocked(cod({ financialSnapshot: undefined }))).toBe(true);
  }));
});
