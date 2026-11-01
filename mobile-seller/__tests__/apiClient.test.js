// No network: every request here either fails closed in the interceptor or hits a stub adapter.

describe('environment selection', () => {
  afterEach(() => { jest.resetModules(); global.__DEV__ = true; });

  test('debug without a staging URL uses the live server, like the Customer app', () => {
    global.__DEV__ = true;
    const env = require('../src/config/env');
    expect(env.APP_ENV.name).toBe('production');
    expect(env.API_BASE_URL).toBe('https://api.bulkimart.in');
  });

  test('release → production over https', () => {
    global.__DEV__ = false;
    const env = require('../src/config/env');
    expect(env.APP_ENV.name).toBe('production');
    expect(env.API_BASE_URL).toMatch(/^https:\/\//);
    expect(env.API_CONFIGURED).toBe(true);
  });
});

describe('api client', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.doMock('../src/config/env', () => ({
      APP_ENV: { name: 'test' }, API_BASE_URL: 'http://insecure.invalid', API_CONFIGURED: false,
      REQUEST_TIMEOUT_MS: 1000, UPLOAD_TIMEOUT_MS: 1000, SESSION_SERVICE: 'test',
    }));
  });
  afterEach(() => jest.dontMock('../src/config/env'));

  test('a non-HTTPS / missing address rejects every call without sending it', async () => {
    const { api } = require('../src/services/apiClient');
    const adapter = jest.fn();
    await expect(api.get('/api/auth/me', { adapter })).rejects.toMatchObject({ name: 'ApiError', code: 'API_NOT_CONFIGURED' });
    await expect(api.post('/api/sellers/payouts', {}, { adapter })).rejects.toMatchObject({ code: 'API_NOT_CONFIGURED' });
    expect(adapter).not.toHaveBeenCalled();
  });
});

describe('api client (configured, stub adapter)', () => {
  let client;
  beforeEach(() => {
    jest.resetModules();
    jest.doMock('../src/config/env', () => ({
      APP_ENV: { name: 'test' }, API_BASE_URL: 'https://example.invalid', API_CONFIGURED: true,
      REQUEST_TIMEOUT_MS: 1000, UPLOAD_TIMEOUT_MS: 1000, SESSION_SERVICE: 'test',
    }));
    client = require('../src/services/apiClient');
  });
  afterEach(() => jest.dontMock('../src/config/env'));

  const reply = (status, data) => jest.fn(async (config) => {
    if (status >= 400) {
      const error = new Error(`Request failed with status code ${status}`);
      error.response = { status, data, config, headers: {} };
      error.config = config;
      throw error;
    }
    return { status, data, config, headers: {}, statusText: 'OK' };
  });

  test('adds the bearer token, and skipAuth removes it', async () => {
    client.setApiToken('t1');
    const adapter = reply(200, { success: true });
    await client.api.get('/x', { adapter });
    expect(adapter.mock.calls[0][0].headers.Authorization).toBe('Bearer t1');
    await client.api.get('/x', { adapter, skipAuth: true });
    expect(adapter.mock.calls[1][0].headers.Authorization).toBeUndefined();
  });

  test('401 for the current token ends the session', async () => {
    const handler = jest.fn();
    client.setUnauthorizedHandler(handler);
    client.setApiToken('t1');
    await expect(client.api.get('/x', { adapter: reply(401, { success: false, message: 'expired' }) })).rejects.toMatchObject({ status: 401 });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  test('server errors become ApiError with the server message and code', async () => {
    client.setApiToken('t1');
    await expect(client.api.get('/x', { adapter: reply(409, { success: false, message: 'Product changed', meta: { code: 'CONFLICT' } }) }))
      .rejects.toMatchObject({ name: 'ApiError', status: 409, message: 'Product changed' });
  });

  test('network failure is reported as such', async () => {
    const adapter = jest.fn(async () => { const e = new Error('Network Error'); e.code = 'ERR_NETWORK'; throw e; });
    await expect(client.api.get('/x', { adapter })).rejects.toMatchObject({ code: 'NETWORK', status: 0 });
  });
});
