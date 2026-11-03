import { describeOtpError, getAppHash, isDeadOtpError, pickPhoneNumber, toIndianMobile } from '../src/utils/otpAutofill';
import { sanitizeOtp } from '../src/components/OtpCodeInput';

describe('toIndianMobile (Phone Number Hint results)', () => {
  test.each([
    ['+919876543210', '9876543210'],
    ['+91 98765 43210', '9876543210'],
    ['919876543210', '9876543210'],
    ['09876543210', '9876543210'],
    ['9876543210', '9876543210'],
  ])('%s → %s', (input, expected) => expect(toIndianMobile(input)).toBe(expected));

  test.each(['+14155552671', '+915876543210', '12345', '', null])('rejects %s', (input) => {
    expect(toIndianMobile(input)).toBeNull();
  });
});

describe('sanitizeOtp (typing, paste, autofill)', () => {
  test('keeps digits only and caps the length', () => {
    expect(sanitizeOtp('48 29 13', 6)).toBe('482913');
    expect(sanitizeOtp('4829137', 6)).toBe('482913');
  });
  test('picks the code out of a pasted SMS', () => {
    expect(sanitizeOtp('<#> Your Bulkimart verification code is 482913. Do not share this OTP. FA+9qCX9VSu', 6)).toBe('482913');
  });
});

describe('OTP error copy', () => {
  test('maps server and network codes', () => {
    expect(describeOtpError({ code: 'OTP_EXPIRED' })).toMatch(/expired/i);
    expect(describeOtpError({ code: 'OTP_INVALID' })).toMatch(/incorrect/i);
    expect(describeOtpError({ code: 'NETWORK', message: 'Network Error' })).toMatch(/network error/i);
    expect(describeOtpError({ code: 'OTP_COOLDOWN', message: 'Please wait 20s' })).toBe('Please wait 20s');
  });
  test('only dead codes clear the input', () => {
    expect(isDeadOtpError({ code: 'OTP_EXPIRED' })).toBe(true);
    expect(isDeadOtpError({ code: 'OTP_INVALID' })).toBe(false);
  });
});

describe('without the native module (iOS / tests)', () => {
  test('falls back to manual entry', async () => {
    await expect(getAppHash()).resolves.toBeNull();
    await expect(pickPhoneNumber()).resolves.toEqual({ error: expect.stringMatching(/type your number/i) });
  });
});
