import ExcelJS from 'exceljs';
import {
  resolveDeliveryMethodInput, effectiveDeliveryMethod, orderDeliveryMethod, fulfillmentOwnerFor,
  canSwitchDeliveryMethod, parseDeliveryMethodText, deliveryMethodOptions, shipmentView,
} from '../../services/deliveryMethod.service.js';
import { validateBulkRows } from '../../services/bulkProductValidation.service.js';
import { generateBulkTemplateExcelJS } from '../../utils/excelParser.js';

const ecom = { type: 'ecommerce', fulfillmentType: 'physical' };
const withFlag = (value, fn) => {
  const before = process.env.DELIVERY_METHODS_ENABLED;
  if (value === undefined) delete process.env.DELIVERY_METHODS_ENABLED; else process.env.DELIVERY_METHODS_ENABLED = value;
  try { return fn(); } finally { if (before === undefined) delete process.env.DELIVERY_METHODS_ENABLED; else process.env.DELIVERY_METHODS_ENABLED = before; }
};
const failure = (fn) => { try { fn(); return null; } catch (error) { return { status: error.status, message: error.message }; } };

describe('delivery method rules', () => {
  test('absent means Easy Ship for physical e-commerce only', () => {
    expect(effectiveDeliveryMethod(ecom)).toBe('easy_ship');
    expect(effectiveDeliveryMethod({ ...ecom, deliveryMethod: 'self_delivery' })).toBe('self_delivery');
    expect(effectiveDeliveryMethod({ type: 'grocery' })).toBeUndefined();
    expect(effectiveDeliveryMethod({ type: 'ecommerce', fulfillmentType: 'digital' })).toBeUndefined();
    expect(orderDeliveryMethod({ type: 'ecommerce', items: [{}] })).toBe('easy_ship');
    expect(orderDeliveryMethod({ type: 'ecommerce', items: [{ fulfillmentType: 'digital' }] })).toBeUndefined();
    expect(orderDeliveryMethod({ type: 'grocery', items: [{}] })).toBeUndefined();
    expect(orderDeliveryMethod({ type: 'ecommerce', deliveryMethod: 'self_delivery', items: [{}] })).toBe('self_delivery');
    expect(fulfillmentOwnerFor('fbb')).toBe('bulkimart');
    expect(fulfillmentOwnerFor('easy_ship')).toBe('seller');
  });

  test('switching table: FBB is one-way', () => {
    expect(canSwitchDeliveryMethod('easy_ship', 'self_delivery')).toBe(true);
    expect(canSwitchDeliveryMethod('self_delivery', 'easy_ship')).toBe(true);
    expect(canSwitchDeliveryMethod('easy_ship', 'fbb')).toBe(true);
    expect(canSwitchDeliveryMethod('self_delivery', 'fbb')).toBe(true);
    expect(canSwitchDeliveryMethod('fbb', 'easy_ship')).toBe(false);
    expect(canSwitchDeliveryMethod('fbb', 'self_delivery')).toBe(false);
  });

  test('switched off: only Easy Ship, and a rollback to it, are accepted; resending the current value is a no-op', () => withFlag(undefined, () => {
    expect(resolveDeliveryMethodInput(undefined, ecom, { isNew: true })).toBeUndefined();
    expect(resolveDeliveryMethodInput('easy_ship', ecom, { isNew: true })).toBeUndefined();
    expect(failure(() => resolveDeliveryMethodInput('self_delivery', ecom, { isNew: true }))).toEqual({ status: 400, message: 'Only Easy Ship is available right now' });
    expect(resolveDeliveryMethodInput('self_delivery', { ...ecom, deliveryMethod: 'self_delivery' })).toBeUndefined();
    expect(resolveDeliveryMethodInput('easy_ship', { ...ecom, deliveryMethod: 'self_delivery' })).toBe('easy_ship');
    expect(deliveryMethodOptions().enabled).toBe(false);
  }));

  test('switched on: allowed moves pass, FBB is closed for now and one-way, bad input is refused', () => withFlag('true', () => {
    expect(resolveDeliveryMethodInput('self_delivery', ecom, { isNew: true })).toBe('self_delivery');
    expect(resolveDeliveryMethodInput('self_delivery', ecom)).toBe('self_delivery');
    expect(resolveDeliveryMethodInput('easy_ship', { ...ecom, deliveryMethod: 'self_delivery' })).toBe('easy_ship');
    expect(failure(() => resolveDeliveryMethodInput('fbb', ecom))?.status).toBe(409);
    expect(failure(() => resolveDeliveryMethodInput('easy_ship', { ...ecom, deliveryMethod: 'fbb' }))?.status).toBe(409);
    expect(failure(() => resolveDeliveryMethodInput('self_delivery', { type: 'grocery' }, { isNew: true }))?.status).toBe(400);
    expect(failure(() => resolveDeliveryMethodInput('self_delivery', { type: 'ecommerce', fulfillmentType: 'digital' }, { isNew: true }))?.status).toBe(400);
    expect(failure(() => resolveDeliveryMethodInput('drone', ecom))?.status).toBe(400);
    // An older client sending the default for a Quick product is harmless.
    expect(resolveDeliveryMethodInput('easy_ship', { type: 'grocery' }, { isNew: true })).toBeUndefined();
    const options = deliveryMethodOptions();
    expect(options.enabled).toBe(true);
    expect(options.options.map(o => [o.value, o.available])).toEqual([['easy_ship', true], ['self_delivery', true], ['fbb', false]]);
  }));

  test('sheet text parsing', () => {
    expect(['Easy Ship', 'self delivery', 'Self-Delivery', 'FBB', '', 'Drone'].map(parseDeliveryMethodText))
      .toEqual(['easy_ship', 'self_delivery', 'self_delivery', 'fbb', undefined, 'drone']);
  });

  test('shipment view reads each provider without storing anything', () => {
    const shiprocket = shipmentView({ type: 'ecommerce', items: [{}], deliveryType: 'shiprocket', deliveredAt: new Date('2026-11-22'),
      shiprocket: { shipmentId: 'S1', awb: 'AWB1', courier: 'Fixture', trackingUrl: 'https://track', trackingStatus: 'DELIVERED' },
      timeline: [{ status: 'dispatched', timestamp: new Date('2026-11-20') }] });
    expect(shiprocket).toMatchObject({ deliveryMethod: 'easy_ship', shippingProvider: 'shiprocket', shipmentId: 'S1', awbNumber: 'AWB1', trackingUrl: 'https://track', shipmentStatus: 'DELIVERED' });
    expect(shiprocket.dispatchDate).toEqual(new Date('2026-11-20'));
    const rider = shipmentView({ type: 'ecommerce', items: [{}], deliveryType: 'internal', deliveryId: 'D1', deliveryPartnerId: 'P1' }, { status: 'picked_up' });
    expect(rider).toMatchObject({ shippingProvider: 'bulkimart_rider', shipmentId: 'D1', awbNumber: null, shipmentStatus: 'picked_up' });
    expect(shipmentView({ type: 'grocery', items: [{}] }).deliveryMethod).toBeNull();
  });
});

describe('bulk upload delivery method column', () => {
  const category = { _id: 'cat1', name: 'Gadgets', parent: null };
  const row = (extra) => ({ 'Product Name': 'Fixture Lamp', 'Main Category': 'Gadgets', 'Sell Price (₹)': 100, Stock: 5, 'Primary Image URL': 'https://img.example/lamp.jpg', ...extra });

  test('reads the product-level value from the first row and refuses conflicting rows', async () => {
    const one = await validateBulkRows([row({ 'Delivery Method': 'Self Delivery' })], [category]);
    expect(one.errors).toEqual([]);
    expect(one.products[0].deliveryMethodText).toBe('Self Delivery');
    const none = await validateBulkRows([row({})], [category]);
    expect(none.products[0].deliveryMethodText).toBeUndefined();
    const conflict = await validateBulkRows([
      row({ 'Variant Name': 'Small', 'Delivery Method': 'Self Delivery' }),
      row({ 'Variant Name': 'Large', 'Delivery Method': 'Easy Ship' }),
    ], [category]);
    expect(conflict.errors[0].reason).toMatch(/Delivery Method differs/);
  });

  const headersOf = async (options) => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await generateBulkTemplateExcelJS([], 'ecommerce', [], [], options));
    return workbook.worksheets[0].getRow(2).values.filter(Boolean);
  };
  test('template gains the column only when asked', async () => {
    expect(await headersOf()).not.toContain('Delivery Method');
    const headers = await headersOf({ deliveryMethodColumn: true });
    expect(headers).toContain('Delivery Method');
    expect(headers.indexOf('Delivery Method')).toBe(headers.indexOf('Stock') + 1);
  });
});
