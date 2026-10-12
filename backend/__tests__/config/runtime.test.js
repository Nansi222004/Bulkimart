import {
  getMockIntegrations,
  isMockIntegrationEnabled,
  validateRuntimeConfig,
} from '../../config/runtime.js';

const liveModes = {
  OTP_MODE: 'live',
  RAZORPAY_MODE: 'live',
  SHIPROCKET_MODE: 'live',
  FCM_MODE: 'live',
  MAPS_MODE: 'live',
  PAYMENT_GATEWAY: 'phonepe',
};

const authorizedStaging = {
  NODE_ENV: 'production',
  ...liveModes,
  OTP_MODE: 'mock',
  SHIPROCKET_MODE: 'mock',
  MAPS_MODE: 'mock',
  RAZORPAY_MODE: 'test',
  PAYMENT_GATEWAY: 'razorpay',
  RAZORPAY_KEY_ID: 'rzp_test_public_key',
  RAZORPAY_KEY_SECRET: 'test-secret',
  RAZORPAY_WEBHOOK_SECRET: 'test-webhook-secret',
  DEPLOYMENT_ENV: 'staging',
  ALLOW_MOCK_SERVICES: 'true',
  STAGING_DATA_ISOLATED: 'true',
  PUBLIC_API_URL: 'https://api-staging.bulkimart.in',
  CORS_ORIGINS: 'https://staging.bulkimart.in',
};

describe('runtime integration safety', () => {
  test('rejects production when mock modes are enabled without staging authorization', () => {
    expect(() => validateRuntimeConfig({
      NODE_ENV: 'production',
      ...liveModes,
      OTP_MODE: 'mock',
      SHIPROCKET_MODE: 'mock',
      MAPS_MODE: 'mock',
    })).toThrow(/Refusing to boot .* OTP_MODE, SHIPROCKET_MODE, MAPS_MODE/);
  });

  test('accepts production when every integration mode is explicitly live', () => {
    expect(validateRuntimeConfig({ NODE_ENV: 'production', ...liveModes }))
      .toEqual({ mockIntegrations: [], paymentGateway: 'phonepe' });
  });

  test('accepts explicitly authorized, isolated production-runtime staging mocks', () => {
    expect(validateRuntimeConfig(authorizedStaging)).toEqual({
      mockIntegrations: ['OTP_MODE', 'SHIPROCKET_MODE', 'MAPS_MODE'],
      paymentGateway: 'razorpay',
    });
    expect(isMockIntegrationEnabled('OTP_MODE', authorizedStaging)).toBe(true);
  });

  test.each([
    ['live API hostname', { PUBLIC_API_URL: 'https://api.bulkimart.in' }],
    ['live frontend origin', { CORS_ORIGINS: 'https://bulkimart.in' }],
  ])('cannot authorize mocks on the %s', (_label, override) => {
    expect(() => validateRuntimeConfig({ ...authorizedStaging, ...override }))
      .toThrow(/live Bulkimart/);
  });

  test('requires every production integration mode to be explicit', () => {
    const { MAPS_MODE: _omitted, ...incomplete } = liveModes;
    expect(() => validateRuntimeConfig({ NODE_ENV: 'production', ...incomplete }))
      .toThrow(/requires explicit integration modes: MAPS_MODE/);
  });

  test('rejects mode typos instead of silently selecting a behavior', () => {
    expect(() => validateRuntimeConfig({
      NODE_ENV: 'production',
      ...liveModes,
      OTP_MODE: 'real',
    })).toThrow(/unsupported values: OTP_MODE/);
  });

  test('rejects Razorpay test mode on the live production API', () => {
    expect(() => validateRuntimeConfig({
      ...authorizedStaging,
      PUBLIC_API_URL: 'https://api.bulkimart.in',
    })).toThrow(/live Bulkimart/);
  });

  test('rejects missing or mismatched Razorpay test credentials', () => {
    expect(() => validateRuntimeConfig({ ...authorizedStaging, RAZORPAY_KEY_SECRET: '' }))
      .toThrow(/RAZORPAY_KEY_SECRET/);
    expect(() => validateRuntimeConfig({ ...authorizedStaging, RAZORPAY_KEY_ID: 'rzp_live_wrong' }))
      .toThrow(/does not match RAZORPAY_MODE=test/);
  });

  test('reports the exact enabled mock integrations', () => {
    expect(getMockIntegrations(authorizedStaging))
      .toEqual(['OTP_MODE', 'SHIPROCKET_MODE', 'MAPS_MODE']);
  });
});

