import { jest } from '@jest/globals';
import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';

process.env.JWT_SECRET = 'admin-product-delete-test-secret';

const findAdminById = jest.fn();
const findUserById = jest.fn();
const findProductById = jest.fn();

jest.unstable_mockModule('../../models/Admin.js', () => ({
  default: { findById: findAdminById },
}));

jest.unstable_mockModule('../../models/User.js', () => ({
  default: { findById: findUserById },
}));

jest.unstable_mockModule('../../models/Product.js', () => ({
  default: { findById: findProductById },
}));

const [{ deleteProductAdmin }, { protect, requireAdmin }, { errorHandler }, { JWT_SECRET }] = await Promise.all([
  import('../../controllers/admin.controller.js'),
  import('../../middlewares/auth.middleware.js'),
  import('../../middlewares/error.middleware.js'),
  import('../../config/jwt.js'),
]);

const app = express();
app.use(express.json());
app.delete('/products/:id', protect, requireAdmin, deleteProductAdmin);
app.use(errorHandler);

const admin = {
  _id: '507f1f77bcf86cd799439011',
  role: 'superAdmin',
  isActive: true,
};
const token = jwt.sign({ id: admin._id, type: 'admin' }, JWT_SECRET, { expiresIn: '5m' });

beforeEach(() => {
  jest.clearAllMocks();
  findAdminById.mockReturnValue({ select: jest.fn(async () => admin) });
});

test('product deletion requires an authenticated administrator', async () => {
  await request(app).delete('/products/507f1f77bcf86cd799439099').expect(401);
  expect(findProductById).not.toHaveBeenCalled();
});

test('administrator removes product from catalogue and clears promotion flags', async () => {
  const product = {
    _id: '507f1f77bcf86cd799439099',
    isDeleted: false,
    isActive: true,
    isFeatured: true,
    isSponsored: true,
    sponsoredRank: 3,
    save: jest.fn(async function save() { return this; }),
  };
  findProductById.mockResolvedValue(product);

  const response = await request(app)
    .delete(`/products/${product._id}`)
    .set('Authorization', `Bearer ${token}`);

  expect(response.status).toBe(200);
  expect(response.body.data).toMatchObject({ _id: product._id, action: 'deleted' });
  expect(product).toMatchObject({
    isDeleted: true,
    isActive: false,
    isFeatured: false,
    isSponsored: false,
    sponsoredRank: 0,
  });
  expect(product.save).toHaveBeenCalledTimes(1);
});

test('missing or previously deleted product returns not found', async () => {
  findProductById.mockResolvedValue(null);
  await request(app)
    .delete('/products/507f1f77bcf86cd799439099')
    .set('Authorization', `Bearer ${token}`)
    .expect(404);
});
