import { buildCreateFormData, buildUpdateFormData, emptyForm, formFromProduct } from '../src/utils/productForm';
jest.mock('../src/services/apiClient', () => ({ api: {} }));
import { describeFbbRates } from '../src/services/fbb.api';

// FormData entries as { field: [values] }, whatever FormData implementation the preset provides.
const fields = (fd) => {
  const parts = fd.getParts ? fd.getParts().map((p) => [p.fieldName, p.string]) : [...fd.entries()];
  return parts.reduce((out, [k, v]) => ({ ...out, [k]: [...(out[k] || []), v] }), {});
};
const product = (extra = {}) => ({ _id: 'p1', type: 'ecommerce', name: 'Lamp', category: 'c1', variants: [{ _id: 'v1', name: 'Default', price: 100, mrp: 100, stock: 3 }], ...extra });

describe('delivery method on the product form', () => {
  test('new form defaults to Easy Ship and does not send it', () => {
    const form = { ...emptyForm(), name: 'Lamp', categoryId: 'c1' };
    expect(form.deliveryMethod).toBe('easy_ship');
    expect(fields(buildCreateFormData(form, 'ecommerce', [])).deliveryMethod).toBeUndefined();
  });

  test('Self Delivery is sent on create for Shop All only', () => {
    const form = { ...emptyForm(), name: 'Lamp', categoryId: 'c1', deliveryMethod: 'self_delivery' };
    expect(fields(buildCreateFormData(form, 'ecommerce', [])).deliveryMethod).toEqual(['self_delivery']);
    expect(fields(buildCreateFormData(form, 'grocery', [])).deliveryMethod).toBeUndefined();
  });

  test('older products read as Easy Ship; an untouched edit sends nothing, a change sends the new value', () => {
    const legacy = formFromProduct(product());
    expect([legacy.deliveryMethod, legacy.savedDeliveryMethod]).toEqual(['easy_ship', 'easy_ship']);
    expect(fields(buildUpdateFormData(legacy, 'ecommerce', [])).deliveryMethod).toBeUndefined();
    expect(fields(buildUpdateFormData({ ...legacy, deliveryMethod: 'self_delivery' }, 'ecommerce', [])).deliveryMethod).toEqual(['self_delivery']);
    const self = formFromProduct(product({ deliveryMethod: 'self_delivery' }));
    expect(fields(buildUpdateFormData(self, 'ecommerce', [])).deliveryMethod).toBeUndefined();
    expect(fields(buildUpdateFormData({ ...self, deliveryMethod: 'easy_ship' }, 'ecommerce', [])).deliveryMethod).toEqual(['easy_ship']);
  });
});

describe('Fulfilled by Bulkimart on the product form', () => {
  test('a new FBB listing sends the accepted charge version; other methods never do', () => {
    const form = { ...emptyForm(), name: 'Lamp', categoryId: 'c1', deliveryMethod: 'fbb', fbbChargeVersion: 3 };
    expect(fields(buildCreateFormData(form, 'ecommerce', []))).toMatchObject({ deliveryMethod: ['fbb'], fbbChargeVersion: ['3'] });
    expect(fields(buildCreateFormData({ ...form, deliveryMethod: 'easy_ship' }, 'ecommerce', [])).fbbChargeVersion).toBeUndefined();
    expect(fields(buildCreateFormData(form, 'grocery', [])).fbbChargeVersion).toBeUndefined();
  });

  test('an FBB product edit sends no delivery method change', () => {
    const fbb = formFromProduct(product({ deliveryMethod: 'fbb' }));
    expect(fields(buildUpdateFormData(fbb, 'ecommerce', [])).deliveryMethod).toBeUndefined();
  });

  test('the charges shown before choosing FBB name each rate and its basis', () => {
    const text = describeFbbRates({ current: { version: 1, storage: { amount: 1, basis: 'per_unit' }, packaging: { amount: 4, basis: 'per_order' }, fulfillment: { amount: 2.5, basis: 'per_unit' } }, taxNote: 'Tax not yet decided.' });
    expect(text).toContain('Storage: ₹1.00 per unit');
    expect(text).toContain('Packaging: ₹4.00 per order');
    expect(text).toContain('Fulfilment: ₹2.50 per unit');
    expect(describeFbbRates(null)).toMatch(/No FBB charges/);
  });
});
