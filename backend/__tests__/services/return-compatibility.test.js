import { jest } from '@jest/globals';
import mongoose from 'mongoose';

const orders = new Map();
const Order = { findById: jest.fn(async (id) => orders.get(String(id)) || null) };
jest.unstable_mockModule('../../models/Order.js', () => ({ default: Order }));
jest.unstable_mockModule('../../models/Return.js', () => ({ default: {} }));
jest.unstable_mockModule('../../models/Payment.js', () => ({ default: {} }));
jest.unstable_mockModule('../../models/Product.js', () => ({ default: {} }));
jest.unstable_mockModule('../../services/notification.service.js', () => ({
  notifyUser: jest.fn(async () => {}),
  notifySeller: jest.fn(async () => {}),
  notifyAllAdmins: jest.fn(async () => {}),
  NOTIFICATION_EVENT: new Proxy({}, { get: (_target, key) => String(key) }),
}));

const [{ calculateReturnRefund, canTransitionReturnStatus, getReturnEligibility }, { RETURN_STATUS }] = await Promise.all([
  import('../../services/return.service.js'),
  import('../../constants/enums.js'),
]);

beforeEach(() => {
  orders.clear();
  jest.clearAllMocks();
});

test('customer return eligibility follows delivered state, ownership, and the frozen return snapshot', async () => {
  const customerId = new mongoose.Types.ObjectId();
  const orderId = new mongoose.Types.ObjectId();
  const itemId = new mongoose.Types.ObjectId();
  const item = {
    _id: itemId,
    qty: 3,
    returnedQty: 1,
    returnPolicy: { returnEligible: true, returnWindowDays: 7 },
    returnEligibleUntil: new Date(Date.now() + 60_000),
  };
  const order = {
    _id: orderId,
    userId: customerId,
    status: 'delivered',
    items: { id: (id) => String(id) === String(itemId) ? item : null },
  };
  orders.set(String(orderId), order);

  const result = await getReturnEligibility({ orderId, orderItemId: itemId, customerId, quantity: 2 });
  expect(result.remaining).toBe(2);
  await expect(getReturnEligibility({ orderId, orderItemId: itemId, customerId, quantity: 3 }))
    .rejects.toMatchObject({ status: 400, meta: { code: 'RETURN_QUANTITY_EXCEEDED' } });
  await expect(getReturnEligibility({ orderId, orderItemId: itemId, customerId: new mongoose.Types.ObjectId(), quantity: 1 }))
    .rejects.toMatchObject({ status: 404, meta: { code: 'RETURN_NOT_FOUND' } });
});

test('historical CDS discount remains in proportional refund calculations without affecting new pricing', () => {
  const refund = calculateReturnRefund(
    { unitPriceSnapshot: 50, quantity: 1 },
    {
      items: [{ price: 50, qty: 1 }, { price: 50, qty: 1 }],
      pricing: { couponDiscount: 5, cdsDiscount: 10, coinDiscount: 4, coinsUsed: 4, deliveryCharge: 40 },
    },
  );
  expect(refund).toMatchObject({
    itemGrossAmount: 50,
    allocatedCouponDiscount: 2.5,
    allocatedLegacyDiscount: 5,
    allocatedCoinDiscount: 2,
    allocatedCoinsCount: 2,
    refundAmount: 40.5,
  });
});

test('multiple partial return items each allocate historical discounts from the immutable order subtotal', () => {
  const order = {
    items: [{ price: 33.33, qty: 3 }, { price: 10, qty: 1 }],
    pricing: { couponDiscount: 1, cdsDiscount: 2, coinDiscount: 0.5, coinsUsed: 1 },
  };
  const firstPartial = calculateReturnRefund({ unitPriceSnapshot: 33.33, quantity: 1 }, order);
  const secondPartial = calculateReturnRefund({ unitPriceSnapshot: 10, quantity: 1 }, order);
  expect(firstPartial).toMatchObject({ itemGrossAmount: 33.33, allocatedCouponDiscount: 0.3, allocatedLegacyDiscount: 0.61, refundAmount: 32.27 });
  expect(secondPartial).toMatchObject({ itemGrossAmount: 10, allocatedCouponDiscount: 0.09, allocatedLegacyDiscount: 0.18, refundAmount: 9.68 });
});

test('return transitions allow the implemented review and refund progression only', () => {
  expect(canTransitionReturnStatus(RETURN_STATUS.RETURN_REQUESTED, RETURN_STATUS.UNDER_REVIEW)).toBe(true);
  expect(canTransitionReturnStatus(RETURN_STATUS.UNDER_REVIEW, RETURN_STATUS.APPROVED)).toBe(true);
  expect(canTransitionReturnStatus(RETURN_STATUS.REFUNDED, RETURN_STATUS.REFUND_PENDING)).toBe(false);
});
