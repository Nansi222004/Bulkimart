import { jest } from '@jest/globals';
import mongoose from 'mongoose';

let payment;
let packagingOrder;
let seller;
const Payment = {
  findById: jest.fn(() => ({ session: async () => payment })),
};
const PackagingOrder = {
  findById: jest.fn(() => ({ session: async () => packagingOrder })),
};
const Seller = {
  findById: jest.fn(() => ({ select() { return this; }, lean: async () => seller })),
};
const notifySeller = jest.fn(async () => {});

jest.unstable_mockModule('../../models/Payment.js', () => ({ default: Payment }));
jest.unstable_mockModule('../../models/PackagingOrder.js', () => ({ default: PackagingOrder }));
jest.unstable_mockModule('../../models/PackagingMaterial.js', () => ({ default: {} }));
jest.unstable_mockModule('../../models/PackagingPackage.js', () => ({ default: {} }));
jest.unstable_mockModule('../../models/Seller.js', () => ({ default: Seller }));
jest.unstable_mockModule('../../services/cloudinary.service.js', () => ({ uploadToCloudinary: jest.fn() }));
jest.unstable_mockModule('../../services/packaging.service.js', () => ({
  resolvePackagingItems: jest.fn(),
  pricePackage: jest.fn(),
  BULK_ORDER_MIN_TOTAL_ITEMS: 1,
}));
jest.unstable_mockModule('../../services/notification.service.js', () => ({
  notifySeller,
  notifyAllAdmins: jest.fn(async () => {}),
  NOTIFICATION_EVENT: new Proxy({}, { get: (_target, key) => String(key) }),
}));

const { settlePackagingOrderPayment } = await import('../../controllers/packaging.controller.js');

beforeEach(() => {
  payment = {
    _id: new mongoose.Types.ObjectId(),
    packagingOrderId: new mongoose.Types.ObjectId(),
    status: 'pending',
    gateway: { merchantOrderId: 'LEGACY-PACKAGE-PENDING' },
    async save() { this.saveCount = (this.saveCount || 0) + 1; return this; },
  };
  packagingOrder = {
    _id: payment.packagingOrderId,
    sellerId: new mongoose.Types.ObjectId(),
    paymentStatus: 'pending',
    orderStatus: 'PAYMENT_PENDING',
    orderNumber: 'LEGACY-PKG-1',
    async save() { this.saveCount = (this.saveCount || 0) + 1; return this; },
  };
  seller = { _id: packagingOrder.sellerId, userId: new mongoose.Types.ObjectId() };
  jest.clearAllMocks();
});

test('a historical pending packaging payment can settle once and a duplicate completion is inert', async () => {
  const transaction = { withTransaction: async (callback) => callback(), endSession: jest.fn(async () => {}) };
  const startSession = jest.spyOn(mongoose, 'startSession').mockResolvedValue(transaction);
  try {
    const args = { payment, state: 'COMPLETED', gatewayOrderId: 'GATEWAY-LEGACY', paymentDetails: [{ state: 'COMPLETED' }] };
    await expect(settlePackagingOrderPayment(args)).resolves.toMatchObject({ changed: true, status: 'paid' });
    await expect(settlePackagingOrderPayment(args)).resolves.toMatchObject({ changed: false, status: 'paid' });
    expect(payment.status).toBe('paid');
    expect(packagingOrder).toMatchObject({ paymentStatus: 'paid', orderStatus: 'CONFIRMED' });
    expect(payment.saveCount).toBe(1);
    expect(packagingOrder.saveCount).toBe(1);
    expect(notifySeller).toHaveBeenCalledTimes(1);
  } finally {
    startSession.mockRestore();
  }
});
