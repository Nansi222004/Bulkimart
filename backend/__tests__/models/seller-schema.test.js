import mongoose from 'mongoose';
import Seller from '../../models/Seller.js';

describe('Seller schema compatibility', () => {
  test('email remains optional and is normalized for future writes', async () => {
    const emailPath = Seller.schema.path('email');
    expect(emailPath).toBeDefined();
    expect(emailPath.isRequired).not.toBe(true);
    expect(emailPath.options.trim).toBe(true);
    expect(emailPath.options.lowercase).toBe(true);

    const seller = new Seller({ userId: new mongoose.Types.ObjectId() });
    expect(seller.email).toBeUndefined();
    await expect(seller.validate()).resolves.toBeUndefined();
  });

  test('email uniqueness applies only to non-empty string addresses', () => {
    const emailIndex = Seller.schema.indexes().find(([, options]) => options.name === 'email_1_optional_unique');
    expect(emailIndex).toBeDefined();
    expect(emailIndex[0]).toEqual({ email: 1 });
    expect(emailIndex[1]).toMatchObject({
      unique: true,
      partialFilterExpression: { email: { $type: 'string', $gt: '' } },
    });
  });
});
