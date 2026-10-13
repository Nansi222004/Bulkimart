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

const [{ submitStep1, submitStep3 }, { errorHandler }] = await Promise.all([
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
app.put('/step-3', (req, _res, next) => {
  req.user = { _id: '507f1f77bcf86cd799439012' };
  if (req.get('x-test-file') === 'yes') req.file = { buffer: Buffer.from('mock-passbook') };
  next();
}, submitStep3);
app.use(errorHandler);

const makePartner = () => ({
  status: 'incomplete',
  onboardingStep: 1,
  drivingLicense: undefined,
  bankDetails: undefined,
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

test('valid bank details and passbook upload advance the payout step', async () => {
  const partner = { ...makePartner(), onboardingStep: 3 };
  findPartner.mockResolvedValue(partner);
  uploadDocument.mockResolvedValue('https://cdn.example.test/passbook.pdf');

  const response = await request(app).put('/step-3').set('x-test-file', 'yes').send({
    zones: '440010,440012', lat: 21.1458, lng: 79.0882, source: 'gps',
    accountNo: '1234567890', ifsc: 'SBIN0001234', holderName: 'Test Rider', bankName: 'Test Bank', upiId: 'rider@upi',
  });

  expect(response.status).toBe(200);
  expect(uploadDocument).toHaveBeenCalledWith(expect.any(Buffer), 'delivery-bank/507f1f77bcf86cd799439012');
  expect(partner.bankDetails.passbookUrl).toBe('https://cdn.example.test/passbook.pdf');
  expect(partner.onboardingStep).toBe(4);
  expect(partner.save).toHaveBeenCalledTimes(1);
});

test.each([
  [{ accountNo: '', ifsc: 'SBIN0001234' }, 'Bank account details'],
  [{ accountNo: '1234567890', ifsc: 'INVALID' }, 'valid 11-character IFSC'],
])('invalid payout fields remain on step 3', async (override, expectedMessage) => {
  const partner = { ...makePartner(), onboardingStep: 3 };
  findPartner.mockResolvedValue(partner);

  const response = await request(app).put('/step-3').set('x-test-file', 'yes').send({
    zones: '440010', lat: 21.1458, lng: 79.0882, source: 'gps',
    accountNo: '1234567890', ifsc: 'SBIN0001234', holderName: 'Test Rider', bankName: 'Test Bank',
    ...override,
  });

  expect(response.status).toBe(400);
  expect(response.body.message).toContain(expectedMessage);
  expect(partner.onboardingStep).toBe(3);
  expect(partner.save).not.toHaveBeenCalled();
});

test('first payout setup requires a passbook or cancelled cheque', async () => {
  const partner = { ...makePartner(), onboardingStep: 3 };
  findPartner.mockResolvedValue(partner);

  const response = await request(app).put('/step-3').send({
    zones: '440010', lat: 21.1458, lng: 79.0882, source: 'gps',
    accountNo: '1234567890', ifsc: 'SBIN0001234', holderName: 'Test Rider', bankName: 'Test Bank',
  });

  expect(response.status).toBe(400);
  expect(response.body.message).toContain('passbook');
  expect(partner.save).not.toHaveBeenCalled();
});

test('bank document upload failure does not advance and can be retried', async () => {
  const partner = { ...makePartner(), onboardingStep: 3 };
  findPartner.mockResolvedValue(partner);
  uploadDocument
    .mockRejectedValueOnce(Object.assign(new Error('Document upload failed. Please try again.'), { status: 502 }))
    .mockResolvedValueOnce('https://cdn.example.test/passbook-retry.pdf');
  const payload = {
    zones: '440010', lat: 21.1458, lng: 79.0882, source: 'gps',
    accountNo: '1234567890', ifsc: 'SBIN0001234', holderName: 'Test Rider', bankName: 'Test Bank',
  };

  await request(app).put('/step-3').set('x-test-file', 'yes').send(payload).expect(502);
  expect(partner.onboardingStep).toBe(3);
  expect(partner.save).not.toHaveBeenCalled();

  await request(app).put('/step-3').set('x-test-file', 'yes').send(payload).expect(200);
  expect(partner.onboardingStep).toBe(4);
  expect(partner.save).toHaveBeenCalledTimes(1);
});
