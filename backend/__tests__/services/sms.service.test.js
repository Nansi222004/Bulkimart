import { jest } from '@jest/globals';
import { sendOTP, verifyOTP, buildOtpSms, resolveAppHash, setSmsTransport, __resetOtpStore } from '../../services/sms.service.js';

const originalEnv = { ...process.env };

const liveModes = {
  OTP_MODE: 'live',
  RAZORPAY_MODE: 'live',
  SHIPROCKET_MODE: 'live',
  FCM_MODE: 'live',
  MAPS_MODE: 'live',
  PAYMENT_GATEWAY: 'razorpay',
  RAZORPAY_KEY_ID: 'rzp_live_public_key',
  RAZORPAY_KEY_SECRET: 'live-secret',
  RAZORPAY_WEBHOOK_SECRET: 'live-webhook-secret',
  // Live Shiprocket mode refuses to start without credentials (config/shiprocketEnvironment.js).
  SHIPROCKET_EMAIL: 'live-fixture@example.test',
  SHIPROCKET_PASSWORD: 'live-fixture-password',
  SHIPROCKET_WEBHOOK_SECRET: 'live-fixture-webhook-secret',
};

const useLive = (extra = {}) => Object.assign(process.env, { NODE_ENV: 'production', ...liveModes, ...extra });

/** Captures what would be handed to the SMS gateway. */
const captureSms = () => {
  const sent = [];
  setSmsTransport(async (payload) => { sent.push(payload); return { delivered: true }; });
  return sent;
};

beforeEach(() => __resetOtpStore());
afterEach(() => {
  process.env = { ...originalEnv };
  setSmsTransport(null);
});

describe('OTP mode isolation', () => {
  test('fixed mock OTPs do not verify in real production mode', () => {
    useLive();
    expect(verifyOTP('919999999999', '1234')).toMatchObject({ valid: false, code: 'OTP_NOT_FOUND' });
    expect(verifyOTP('919999999999', '123456')).toMatchObject({ valid: false, code: 'OTP_NOT_FOUND' });
  });

  test('real mode does not return the generated OTP to its caller', async () => {
    useLive();
    captureSms();
    const result = await sendOTP('918888888888');
    expect(result).toEqual({ success: true, otpLength: 6, expiresIn: 300, resendAfter: 30 });
    expect(result.otp).toBeUndefined();
  });

  test('authorized staging mock mode supports the fixed test OTP', async () => {
    useLive({
      OTP_MODE: 'mock',
      DEPLOYMENT_ENV: 'staging',
      ALLOW_MOCK_SERVICES: 'true',
      STAGING_DATA_ISOLATED: 'true',
      PUBLIC_API_URL: 'https://api-staging.bulkimart.in',
      CORS_ORIGINS: 'https://staging.bulkimart.in',
    });
    const sent = captureSms();

    await expect(sendOTP('917777777777')).resolves.toMatchObject({ success: true, otp: '123456', otpLength: 6 });
    expect(sent).toHaveLength(0); // mock mode never hits the SMS gateway
    expect(verifyOTP('917777777777', '1234')).toEqual({ valid: true });
  });
});

describe('live OTP lifecycle', () => {
  test('issues a 6-digit code by default and accepts it exactly once', async () => {
    useLive();
    const sent = captureSms();
    await sendOTP('9876543210');
    const { otp } = sent[0];
    expect(otp).toMatch(/^\d{6}$/);
    expect(verifyOTP('9876543210', otp)).toEqual({ valid: true });
    expect(verifyOTP('9876543210', otp)).toMatchObject({ valid: false, code: 'OTP_NOT_FOUND' });
  });

  test('honours OTP_LENGTH', async () => {
    useLive({ OTP_LENGTH: '4' });
    const sent = captureSms();
    await expect(sendOTP('9876543210')).resolves.toMatchObject({ otpLength: 4 });
    expect(sent[0].otp).toMatch(/^\d{4}$/);
  });

  test('rejects expired codes with OTP_EXPIRED', async () => {
    useLive();
    const sent = captureSms();
    const now = Date.now();
    const spy = jest.spyOn(Date, 'now').mockReturnValue(now);
    await sendOTP('9876543210');
    spy.mockReturnValue(now + 5 * 60 * 1000 + 1);
    expect(verifyOTP('9876543210', sent[0].otp)).toMatchObject({ valid: false, code: 'OTP_EXPIRED' });
    spy.mockRestore();
  });

  test('burns the code after too many wrong attempts', async () => {
    useLive({ OTP_MAX_VERIFY_ATTEMPTS: '3' });
    const sent = captureSms();
    await sendOTP('9876543210');
    const wrong = sent[0].otp === '000000' ? '111111' : '000000';
    expect(verifyOTP('9876543210', wrong)).toMatchObject({ code: 'OTP_INVALID' });
    expect(verifyOTP('9876543210', wrong)).toMatchObject({ code: 'OTP_INVALID' });
    expect(verifyOTP('9876543210', wrong)).toMatchObject({ code: 'OTP_ATTEMPTS_EXCEEDED' });
    // Even the right code no longer works.
    expect(verifyOTP('9876543210', sent[0].otp)).toMatchObject({ valid: false, code: 'OTP_NOT_FOUND' });
  });

  test('enforces a per-number resend cooldown and hourly cap', async () => {
    useLive({ OTP_RESEND_COOLDOWN_SECONDS: '30', OTP_MAX_SENDS_PER_HOUR: '2' });
    captureSms();
    const now = Date.now();
    const spy = jest.spyOn(Date, 'now').mockReturnValue(now);
    await sendOTP('9876543210');
    await expect(sendOTP('9876543210')).rejects.toMatchObject({ status: 429, meta: { code: 'OTP_COOLDOWN' } });
    spy.mockReturnValue(now + 31_000);
    await sendOTP('9876543210');
    spy.mockReturnValue(now + 62_000);
    await expect(sendOTP('9876543210')).rejects.toMatchObject({ status: 429, meta: { code: 'OTP_SEND_LIMIT' } });
    spy.mockReturnValue(now + 60 * 60 * 1000 + 1);
    await expect(sendOTP('9876543210')).resolves.toMatchObject({ success: true });
    spy.mockRestore();
  });
});

describe('SMS Retriever message', () => {
  test('builds the DLT-compatible body with the app hash on the last line', () => {
    expect(buildOtpSms('482913', 'FA+9qCX9VSu')).toBe(
      '<#> Your Bulkimart verification code is 482913.\nDo not share this OTP.\nFA+9qCX9VSu',
    );
    expect(buildOtpSms('482913', '')).toBe('<#> Your Bulkimart verification code is 482913.\nDo not share this OTP.');
  });

  test('uses a well-formed client hash and refuses arbitrary text', () => {
    expect(resolveAppHash('FA+9qCX9VSu', 'user')).toBe('FA+9qCX9VSu');
    expect(resolveAppHash('click http://evil', 'user')).toBe('');
    expect(resolveAppHash(undefined, 'user')).toBe('');
  });

  test('falls back to the configured per-app hash and applies the allowlist', () => {
    process.env.SMS_RETRIEVER_HASH_SELLER = 'SeLLeRHash1';
    process.env.SMS_RETRIEVER_ALLOWED_HASHES = 'SeLLeRHash1,UsErHash123';
    expect(resolveAppHash('NotAllowed1', 'seller')).toBe('SeLLeRHash1');
    expect(resolveAppHash('UsErHash123', 'user')).toBe('UsErHash123');
  });

  test('passes the hash-bearing message to the transport', async () => {
    useLive();
    const sent = captureSms();
    await sendOTP('9876543210', { appHash: 'FA+9qCX9VSu', app: 'user' });
    expect(sent[0].message).toBe(`<#> Your Bulkimart verification code is ${sent[0].otp}.\nDo not share this OTP.\nFA+9qCX9VSu`);
    expect(sent[0].appHash).toBe('FA+9qCX9VSu');
  });
});
