import { sendOTP, verifyOTP } from '../../services/sms.service.js';

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

afterEach(() => {
  process.env = { ...originalEnv };
});

describe('OTP mode isolation', () => {
  test('fixed mock OTPs do not verify in real production mode', () => {
    Object.assign(process.env, { NODE_ENV: 'production', ...liveModes });
    expect(verifyOTP('919999999999', '1234')).toEqual({
      valid: false,
      message: 'OTP not found. Please request again.',
    });
    expect(verifyOTP('919999999999', '123456')).toEqual({
      valid: false,
      message: 'OTP not found. Please request again.',
    });
  });

  test('real mode does not return the generated OTP to its caller', async () => {
    Object.assign(process.env, { NODE_ENV: 'production', ...liveModes });
    await expect(sendOTP('918888888888')).resolves.toEqual({ success: true });
  });

  test('authorized staging mock mode supports the fixed test OTP', async () => {
    Object.assign(process.env, {
      NODE_ENV: 'production',
      ...liveModes,
      OTP_MODE: 'mock',
      DEPLOYMENT_ENV: 'staging',
      ALLOW_MOCK_SERVICES: 'true',
      STAGING_DATA_ISOLATED: 'true',
      PUBLIC_API_URL: 'https://api-staging.bulkimart.in',
      CORS_ORIGINS: 'https://staging.bulkimart.in',
    });

    await expect(sendOTP('917777777777')).resolves.toEqual({ success: true, otp: '1234' });
    expect(verifyOTP('917777777777', '1234')).toEqual({ valid: true });
  });
});

