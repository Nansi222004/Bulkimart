import { jest } from '@jest/globals';
import express from 'express';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import request from 'supertest';

const users = new Map();
let partner;
let order;
let delivery;
const User = { findById: jest.fn((id) => ({ select: async () => users.get(String(id)) || null })) };
const DeliveryPartner = {
  findOne: jest.fn(async () => partner),
  updateOne: jest.fn(async () => ({ modifiedCount: 1 })),
};
const Order = {
  findById: jest.fn(async (id) => String(order?._id) === String(id) ? order : null),
  updateOne: jest.fn(async () => ({ modifiedCount: 1 })),
};
const Delivery = {
  findById: jest.fn((id) => ({
    select: async () => delivery && String(delivery._id) === String(id) ? delivery : null,
    then: (resolve, reject) => Promise.resolve(delivery && String(delivery._id) === String(id) ? delivery : null).then(resolve, reject),
  })),
  updateOne: jest.fn(async () => ({ modifiedCount: 1 })),
};

jest.unstable_mockModule('../../models/User.js', () => ({ default: User }));
jest.unstable_mockModule('../../models/DeliveryPartner.js', () => ({ default: DeliveryPartner }));
jest.unstable_mockModule('../../models/Order.js', () => ({ default: Order }));
jest.unstable_mockModule('../../models/Delivery.js', () => ({ default: Delivery }));
jest.unstable_mockModule('../../services/notification.service.js', () => ({
  notifyUser: jest.fn(async () => {}),
  notifySeller: jest.fn(async () => {}),
  notifyRider: jest.fn(async () => {}),
  notifyAllAdmins: jest.fn(async () => {}),
  NOTIFICATION_EVENT: new Proxy({}, { get: (_target, key) => String(key) }),
}));
jest.unstable_mockModule('../../socket/rooms.js', () => ({
  emitToUser: jest.fn(),
  emitToSeller: jest.fn(),
  emitToRider: jest.fn(),
}));

const [{ default: deliveryRoutes }, { errorHandler }, { JWT_SECRET }, { notifyUser, notifySeller }] = await Promise.all([
  import('../../routes/delivery.routes.js'),
  import('../../middlewares/error.middleware.js'),
  import('../../config/jwt.js'),
  import('../../services/notification.service.js'),
]);
const app = express();
app.use(express.json());
app.use('/api/delivery', deliveryRoutes);
app.use(errorHandler);

let riderUser;
let token;
const auth = () => ({ Authorization: `Bearer ${token}` });

beforeEach(() => {
  users.clear();
  riderUser = { _id: new mongoose.Types.ObjectId(), phone: '9500000001', isActive: true, roles: ['delivery'] };
  users.set(String(riderUser._id), riderUser);
  partner = { _id: new mongoose.Types.ObjectId(), userId: riderUser._id, status: 'approved', isAvailable: false };
  order = {
    _id: new mongoose.Types.ObjectId(),
    userId: new mongoose.Types.ObjectId(),
    orderNo: 'TEST-DELIVERY-1',
    deliveryPartnerId: partner._id,
    deliveryId: new mongoose.Types.ObjectId(),
    type: 'grocery',
    status: 'out_for_delivery',
    pricing: { tipAmount: 5 },
    items: [{ sellerId: new mongoose.Types.ObjectId(), returnPolicy: { returnEligible: true, returnWindowDays: 7 } }],
  };
  delivery = {
    _id: order.deliveryId,
    otp: '2468',
    otpAttempts: 0,
    status: 'out_for_delivery',
    route: { distanceKm: 2 },
    ratesUsed: { mode: 'quick', base: 20, perKm: 10, minPayout: 0 },
    async save() { return this; },
  };
  token = jwt.sign({ id: String(riderUser._id), type: 'user' }, JWT_SECRET);
  jest.clearAllMocks();
  jest.spyOn(mongoose, 'startSession').mockResolvedValue({
    withTransaction: async (callback) => callback(),
    endSession: async () => {},
  });
});

afterEach(() => mongoose.startSession.mockRestore());

test('delivery OTP endpoint enforces login and approved-rider authorization', async () => {
  await request(app).post(`/api/delivery/orders/${order._id}/verify-otp`).send({ otp: '2468' }).expect(401);
  partner.status = 'pending';
  await request(app).post(`/api/delivery/orders/${order._id}/verify-otp`).set(auth()).send({ otp: '2468' }).expect(403);
  expect(Delivery.updateOne).not.toHaveBeenCalled();
});

test('invalid and missing delivery OTPs are rejected and failed attempts are counted', async () => {
  await request(app).post(`/api/delivery/orders/${order._id}/verify-otp`).set(auth()).send({}).expect(400);
  await request(app).post(`/api/delivery/orders/${order._id}/verify-otp`).set(auth()).send({ otp: '0000' }).expect(400);
  expect(delivery.otpAttempts).toBe(1);
  expect(Delivery.updateOne).not.toHaveBeenCalled();
});

test('valid OTP completes the order once and dispatches customer and seller delivery notifications', async () => {
  const response = await request(app).post(`/api/delivery/orders/${order._id}/verify-otp`).set(auth()).send({ otp: '2468' }).expect(200);
  expect(response.body.data.earnings).toBeGreaterThanOrEqual(0);
  expect(Delivery.updateOne).toHaveBeenCalledWith(
    expect.objectContaining({ _id: delivery._id, status: { $nin: ['delivered', 'rejected', 'failed'] } }),
    expect.objectContaining({ $set: expect.objectContaining({ otpVerified: true, status: 'delivered' }) }),
    expect.any(Object),
  );
  expect(Order.updateOne).toHaveBeenCalledWith(
    expect.objectContaining({ _id: order._id, deliveryPartnerId: partner._id }),
    expect.objectContaining({ $set: expect.objectContaining({ status: 'delivered' }) }),
    expect.any(Object),
  );
  expect(DeliveryPartner.updateOne).toHaveBeenCalledTimes(1);
  expect(notifyUser).toHaveBeenCalledWith(order.userId, expect.objectContaining({ event: 'ORDER_DELIVERED' }));
  expect(notifySeller).toHaveBeenCalledWith(order.items[0].sellerId, expect.objectContaining({ event: 'ORDER_DELIVERED' }));
});
