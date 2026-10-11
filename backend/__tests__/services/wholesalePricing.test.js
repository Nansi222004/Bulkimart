import mongoose from 'mongoose';
import Product from '../../models/Product.js';
import Seller from '../../models/Seller.js';
import { CHANNEL, CHANNELS, ORDER_TYPES, WHOLESALE_CHANNEL } from '../../constants/enums.js';
import { normalizeWholesalePricing, priceWholesaleQuantity } from '../../services/wholesalePricing.service.js';

const validPricing = {
  enabled: true,
  minimumQuantity: 5,
  quantityIncrement: 5,
  priceTiers: [
    { minimumQuantity: 5, unitPrice: 18.5 },
    { minimumQuantity: 10, unitPrice: 16 },
  ],
};

describe('Wholesale seller and per-variant pricing foundation', () => {
  test('Wholesale seller channel is supported without expanding cart/order channels', async () => {
    const seller = new Seller({ userId: new mongoose.Types.ObjectId(), salesChannels: [CHANNEL.ECOM, CHANNEL.GROCERY, WHOLESALE_CHANNEL] });
    await expect(seller.validate()).resolves.toBeUndefined();
    expect(CHANNELS).not.toContain(WHOLESALE_CHANNEL);
    expect(ORDER_TYPES).not.toContain(WHOLESALE_CHANNEL);
  });

  test('existing seller defaults remain E-Commerce with no wholesale request state', () => {
    const seller = new Seller({ userId: new mongoose.Types.ObjectId() });
    expect(seller.salesChannels).toEqual([CHANNEL.ECOM]);
    expect(seller.wholesaleChannel).toBeUndefined();
  });

  test('MOQ and increment validation is whole-number based and tier prices are normalized', () => {
    expect(normalizeWholesalePricing(validPricing)).toEqual({
      enabled: true,
      minimumQuantity: 5,
      quantityIncrement: 5,
      priceTiers: [
        { minimumQuantity: 5, unitPrice: 18.5 },
        { minimumQuantity: 10, unitPrice: 16 },
      ],
    });
    expect(() => normalizeWholesalePricing({ ...validPricing, minimumQuantity: 0 })).toThrow(/minimum quantity/);
    expect(() => normalizeWholesalePricing({ ...validPricing, quantityIncrement: 0 })).toThrow(/increment/);
    expect(() => normalizeWholesalePricing({ ...validPricing, priceTiers: [{ minimumQuantity: 6, unitPrice: 18 }] })).toThrow(/allowed quantity/);
    expect(() => normalizeWholesalePricing({ ...validPricing, priceTiers: [{ minimumQuantity: 5, unitPrice: 20 }, { minimumQuantity: 10, unitPrice: 21 }] })).toThrow(/cannot increase/);
  });

  test('quantity pricing selects the highest eligible tier and rejects invalid quantities', () => {
    expect(priceWholesaleQuantity(validPricing, 5)).toEqual({ unitPrice: 18.5, quantity: 5, lineTotal: 92.5 });
    expect(priceWholesaleQuantity(validPricing, 15)).toEqual({ unitPrice: 16, quantity: 15, lineTotal: 240 });
    expect(() => priceWholesaleQuantity(validPricing, 4)).toThrow(/MOQ or increment/);
    expect(() => priceWholesaleQuantity(validPricing, 6)).toThrow(/MOQ or increment/);
  });

  test('variant wholesale price book validates without changing the retail price or shared stock fields', async () => {
    const product = new Product({
      type: CHANNEL.ECOM,
      name: 'Test Bulk Product',
      category: new mongoose.Types.ObjectId(),
      variants: [{ name: 'Case', price: 24, mrp: 30, stock: 25, unit: 'piece', wholesalePricing: validPricing }],
    });
    await expect(product.validate()).resolves.toBeUndefined();
    expect(product.price).toBe(24);
    expect(product.stock).toBe(25);
    expect(product.variants[0].wholesalePricing.priceTiers[0].unitPrice).toBe(18.5);
  });
});
