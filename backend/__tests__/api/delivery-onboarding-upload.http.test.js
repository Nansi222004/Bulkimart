import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';

const findPartner = jest.fn();
const uploadDocument = jest.fn();

jest.unstable_mockModule('../../models/DeliveryPartner.js', () => ({
  default: {
    findOne: findPartner,
  },
}));

jest.unstable_mockModule('../../services/cloudinary.service.js', () => ({
  uploadToCloudinary: uploadDocument,
}));

const [{ submitStep1 }, { errorHandler }] = await Promise.all([
  import('../../controllers/deliveryPartner.controller.js'),
  import('../../middlewares/error.middleware.js'),
]);

const app = express();
app.use(express.json());
app.put('/step-1', (req, _res, next) => {
  req.user = { _id: '507f1f77bcf86cd799439012' };
  req.file = { buffer: Buffer.from('mock-driving-licence') };
  next();
}, submitStep1);
app.use(errorHandler);

const makePartner = () => ({
  status: 'incomplete',
  onboardingStep: 1,
  drivingLicense: undefined,
  save: jest.fn(async function save() { return this; }),
});

beforeEach(() => {
  jest.clearAllMocks();
});

test('successful server upload stores the returned URL and advances onboarding', async () => {
  const partner = makePartner();
  findPartner.mockResolvedValue(partner);
  uploadDocument.mockResolvedValue('https://cdn.example.test/licence.jpg');

  const response = await request(app).put('/step-1').send({
    vehicleType: 'bike',
    vehicleNo: 'up 32 ab 1234',
    licenseNo: 'DL-TEST-1',
    licenseExpiry: '2099-01-01',
  });

  expect(response.status).toBe(200);
  expect(uploadDocument).toHaveBeenCalledWith(
    expect.any(Buffer),
    'delivery-kyc/507f1f77bcf86cd799439012',
  );
  expect(partner.drivingLicense.url).toBe('https://cdn.example.test/licence.jpg');
  expect(partner.vehicleNo).toBe('UP32AB1234');
  expect(partner.onboardingStep).toBe(2);
  expect(partner.save).toHaveBeenCalledTimes(1);
});

test('provider failure does not save or advance, and a retry can succeed', async () => {
  const partner = makePartner();
  findPartner.mockResolvedValue(partner);
  uploadDocument
    .mockRejectedValueOnce(Object.assign(new Error('Document upload failed. Please try again.'), { status: 502 }))
    .mockResolvedValueOnce('https://cdn.example.test/licence-retry.jpg');
  const payload = { vehicleType: 'bike', vehicleNo: 'UP32AB1234', licenseNo: 'DL-TEST-2' };

  const failed = await request(app).put('/step-1').send(payload);
  expect(failed.status).toBe(502);
  expect(partner.onboardingStep).toBe(1);
  expect(partner.save).not.toHaveBeenCalled();

  const retried = await request(app).put('/step-1').send(payload);
  expect(retried.status).toBe(200);
  expect(partner.drivingLicense.url).toBe('https://cdn.example.test/licence-retry.jpg');
  expect(partner.onboardingStep).toBe(2);
  expect(partner.save).toHaveBeenCalledTimes(1);
});
