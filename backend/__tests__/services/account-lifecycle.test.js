import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import Admin from '../../models/Admin.js';
import User from '../../models/User.js';
import Seller from '../../models/Seller.js';
import DeliveryPartner from '../../models/DeliveryPartner.js';
import Order from '../../models/Order.js';
import Product from '../../models/Product.js';
import SellerPromotion from '../../models/SellerPromotion.js';
import {
  assessCustomerAccount, assessSellerAccount, assessDeliveryAccount, executeAccountAction,
} from '../../services/accountLifecycle.service.js';

let mongo;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri(), { autoIndex: true, retryWrites: false });
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

beforeEach(async () => {
  await mongoose.connection.db.dropDatabase();
  await Promise.all(Object.values(mongoose.models).map((model) => model.syncIndexes()));
});

const user = (suffix, extra = {}) => User.create({ phone: `90000000${suffix}`, roles: ['buyer'], ...extra });

test('permanently deletes only a standalone customer', async () => {
  const target = await user('01');
  expect((await assessCustomerAccount(target)).action).toBe('delete');

  const result = await executeAccountAction({ category: 'customer', targetId: target._id, source: 'admin' });

  expect(result.outcome).toBe('deleted');
  expect(await User.exists({ _id: target._id })).toBeNull();
});

test('deactivates a customer with history and preserves the historical order', async () => {
  const target = await user('02');
  await Order.collection.insertOne({ userId: target._id, status: 'delivered', orderNo: 'HIST-1' });
  expect((await assessCustomerAccount(target)).action).toBe('deactivate');

  const result = await executeAccountAction({ category: 'customer', targetId: target._id, source: 'admin' });

  expect(result.outcome).toBe('deactivated');
  expect((await User.findById(target._id)).isActive).toBe(false);
  expect(await Order.countDocuments({ userId: target._id })).toBe(1);
});

test('blocks active fulfillment and protects administrator-linked identities', async () => {
  const active = await user('03');
  await Order.collection.insertOne({ userId: active._id, status: 'preparing', orderNo: 'ACTIVE-1' });
  expect((await assessCustomerAccount(active)).action).toBe('skip');

  await Admin.create({ name: 'Protected', email: 'protected@example.test', password: 'long-test-password', role: 'superAdmin' });
  const protectedUser = await user('04', { email: 'protected@example.test' });
  const protectedAssessment = await assessCustomerAccount(protectedUser);
  expect(protectedAssessment.action).toBe('skip');
  expect(protectedAssessment.reasonCodes).toContain('PROTECTED_ADMIN_IDENTITY');
});

test('archives a seller with catalog history without deleting products or the shared buyer identity', async () => {
  const identity = await user('05', { roles: ['buyer', 'seller'] });
  const seller = await Seller.create({ userId: identity._id, status: 'approved', onboardingStep: 5 });
  await Product.collection.insertOne({ sellerId: seller._id, name: 'Historical catalog item' });
  expect((await assessSellerAccount(seller)).action).toBe('deactivate');

  const result = await executeAccountAction({ category: 'seller', targetId: seller._id, source: 'admin' });

  expect(result.outcome).toBe('deactivated');
  expect((await Seller.findById(seller._id)).status).toBe('suspended');
  expect(await Product.countDocuments({ sellerId: seller._id })).toBe(1);
  expect((await User.findById(identity._id)).isActive).toBe(true);
});

test('blocks a delivery partner with unsettled earnings', async () => {
  const identity = await user('06', { roles: ['buyer', 'delivery'] });
  const partner = await DeliveryPartner.create({ userId: identity._id, earnings: { pending: 50 } });
  const assessment = await assessDeliveryAccount(partner);
  expect(assessment.action).toBe('skip');
  expect(assessment.reasonCodes).toContain('PENDING_EARNINGS');
});

test('retired active advertisements retain history but no longer block seller deactivation', async () => {
  const identity = await user('07', { roles: ['buyer', 'seller'] });
  const seller = await Seller.create({ userId: identity._id, status:'approved', onboardingStep:5 });
  await SellerPromotion.create({ sellerId:seller._id, module:'ECOMMERCE', title:'Historical ad', status:'ACTIVE' });
  const assessment = await assessSellerAccount(seller);
  expect(assessment.action).toBe('deactivate');
  expect(assessment.reasonCodes).not.toContain('ACTIVE_PROMOTIONS');
  expect(await SellerPromotion.countDocuments({ sellerId:seller._id })).toBe(1);
});
