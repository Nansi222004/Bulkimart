import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';

const findNotifications = jest.fn();
const countNotifications = jest.fn();

jest.unstable_mockModule('../../models/Notification.js', () => ({
  default: {
    find: findNotifications,
    countDocuments: countNotifications,
  },
}));
jest.unstable_mockModule('../../services/notification.service.js', () => ({
  registerPushToken: jest.fn(),
  removePushToken: jest.fn(),
}));

const [{ getMyNotifications, getUnreadCount }, { errorHandler }] = await Promise.all([
  import('../../controllers/notification.controller.js'),
  import('../../middlewares/error.middleware.js'),
]);

const app = express();
app.use((req, _res, next) => { req.user = { _id: '507f1f77bcf86cd799439015' }; next(); });
app.get('/notifications', getMyNotifications);
app.get('/notifications/unread-count', getUnreadCount);
app.use(errorHandler);

beforeEach(() => {
  jest.clearAllMocks();
  findNotifications.mockReturnValue({
    sort() { return this; },
    skip() { return this; },
    limit() { return this; },
    lean: jest.fn(async () => []),
  });
  countNotifications.mockResolvedValue(0);
});

test('retired reward notifications are excluded from history', async () => {
  await request(app).get('/notifications').expect(200);
  expect(findNotifications).toHaveBeenCalledWith(expect.objectContaining({
    event: { $nin: ['REFERRAL_SIGNUP', 'REFERRAL_REWARD_CREDITED', 'REFERRAL_MILESTONE_REACHED'] },
  }));
});

test('retired reward notifications do not inflate the unread badge', async () => {
  await request(app).get('/notifications/unread-count').expect(200);
  expect(countNotifications).toHaveBeenCalledWith(expect.objectContaining({
    isRead: false,
    event: { $nin: ['REFERRAL_SIGNUP', 'REFERRAL_REWARD_CREDITED', 'REFERRAL_MILESTONE_REACHED'] },
  }));
});
