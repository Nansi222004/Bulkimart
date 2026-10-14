import { jest } from '@jest/globals';
import { sellerOtpPayload } from '../../../forntend/src/modules/Seller/utils/sellerAuth.js';
import {
  submitDeliveryPayoutStep,
  validateDeliveryPayoutStep,
} from '../../../forntend/src/modules/Delivery/utils/onboarding.js';

const validForm = () => ({
  location: { lat: 21.1458, lng: 79.0882, source: 'gps' },
  zones: '440010, 440012',
  deliveryRadius: 10,
  bankHolder: 'Test Rider',
  bankName: 'Test Bank',
  bankAccount: '1234567890',
  bankIfsc: 'SBIN0001234',
  upiId: 'rider@upi',
});

test('seller OTP payload ignores a circular React-style click event', () => {
  const button = {};
  const event = { currentTarget: button };
  button.reactFiber = { stateNode: button, event };

  const payload = sellerOtpPayload('+91 98765-43210', event);

  expect(payload).toEqual({ phone: '9876543210', intent: 'login' });
  expect(() => JSON.stringify(payload)).not.toThrow();
});

test('delivery payout validation reports every required field inline', () => {
  const { errors } = validateDeliveryPayoutStep({ form: {}, passbookFile: null, existingPassbookUrl: '' });
  expect(errors).toMatchObject({
    location: expect.any(String), zones: expect.any(String), bankHolder: expect.any(String),
    bankName: expect.any(String), bankAccount: expect.any(String), bankIfsc: expect.any(String),
    passbook: expect.any(String),
  });
});

test('valid payout details and selected document are submitted once', async () => {
  const file = { name: 'cheque.pdf', type: 'application/pdf', size: 1024 };
  const submit = jest.fn(async () => ({ ok: true, data: { onboardingStep: 4 } }));
  const result = await submitDeliveryPayoutStep({
    form: validForm(), passbookFile: file, existingPassbookUrl: '', submit, lock: { current: false },
  });
  expect(result.ok).toBe(true);
  expect(submit).toHaveBeenCalledWith(expect.objectContaining({ passbookFile: file, zones: '440010,440012' }));
});

test('upload or API failure is actionable and retains the selected file for retry', async () => {
  const file = { name: 'cheque.pdf', type: 'application/pdf', size: 1024 };
  const submit = jest.fn(async () => ({ ok: false, message: 'Document upload failed. Please try again.' }));
  const result = await submitDeliveryPayoutStep({
    form: validForm(), passbookFile: file, existingPassbookUrl: '', submit, lock: { current: false },
  });
  expect(result).toMatchObject({ ok: false, code: 'SUBMISSION_FAILED', message: 'Document upload failed. Please try again.' });
  expect(submit.mock.calls[0][0].passbookFile).toBe(file);
});

test('duplicate clicks are rejected while the first submission is pending', async () => {
  let resolveSubmit;
  const submit = jest.fn(() => new Promise((resolve) => { resolveSubmit = resolve; }));
  const lock = { current: false };
  const args = { form: validForm(), passbookFile: { name: 'cheque.pdf' }, existingPassbookUrl: '', submit, lock };

  const first = submitDeliveryPayoutStep(args);
  const duplicate = await submitDeliveryPayoutStep(args);
  expect(duplicate.code).toBe('IN_PROGRESS');
  expect(submit).toHaveBeenCalledTimes(1);

  resolveSubmit({ ok: true, data: { onboardingStep: 4 } });
  await expect(first).resolves.toMatchObject({ ok: true });
});
