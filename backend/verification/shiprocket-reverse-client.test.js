import { jest } from '@jest/globals';
const http = { post: jest.fn(), get: jest.fn() };
jest.unstable_mockModule('axios', () => ({ default: http }));
const provider = await import('../services/shiprocket.service.js');
const origin = 'https://provider-fixture.example.test';
beforeEach(() => {
  jest.resetAllMocks();
  Object.assign(process.env, { SHIPROCKET_MODE: 'sandbox', SHIPROCKET_SANDBOX_CONFIRMED: 'true', SHIPROCKET_SANDBOX_BASE_URL: origin, SHIPROCKET_SANDBOX_EMAIL: 'fixture@example.test', SHIPROCKET_SANDBOX_PASSWORD: `fixture-${Math.random()}`, SHIPROCKET_SANDBOX_WEBHOOK_SECRET: 'fixture' });
  http.post.mockImplementation(async url => ({ data: url.endsWith('/auth/login') ? { token: 'test-token' } : { order_id: 301, shipment_id: 401 } }));
});
test('reverse create authenticates, caches token, and sends the documented payload with bounded requests', async () => {
  const payload = { order_id: 'RET-fixture', payment_method: 'PREPAID' };
  expect(await provider.createReverseOrder(payload)).toEqual({ order_id: 301, shipment_id: 401 });
  expect(http.post).toHaveBeenCalledWith(origin + '/v1/external/orders/create/return', payload, { headers: { Authorization: 'Bearer test-token' }, timeout: 15000, maxRedirects: 0 });
  expect(http.post.mock.calls.filter(([url]) => url.endsWith('/auth/login'))).toHaveLength(1);
});
test('reverse AWB, schedule and cancellation retain original provider identifiers', async () => {
  http.post.mockImplementation(async url => ({ data: url.endsWith('/auth/login') ? { token: 'test-token' } : url.endsWith('/awb') ? { response: { data: { awb_code: 'ACTUAL401' } } } : { pickup_status: 1 } }));
  expect((await provider.assignCourier(401, undefined, { isReturn: true })).awb).toBe('ACTUAL401');
  await provider.schedulePickup(401); await provider.cancelReverseOrder(301);
  expect(http.post).toHaveBeenCalledWith(origin + '/v1/external/courier/assign/awb', { shipment_id: 401, is_return: 1 }, expect.any(Object));
  expect(http.post).toHaveBeenCalledWith(origin + '/v1/external/courier/generate/pickup', { shipment_id: [401] }, expect.any(Object));
  expect(http.post).toHaveBeenCalledWith(origin + '/v1/external/orders/cancel', { ids: [301] }, expect.any(Object));
});
test('lookup requires the exact merchant reference; tracking uses shipment identity', async () => {
  http.get.mockResolvedValueOnce({ data: { data: [{ id: 301, channel_order_id: 'RET-fixture' }, { id: 302, channel_order_id: 'OTHER' }] } });
  expect(await provider.findReverseOrders('RET-fixture')).toEqual([{ id: 301, channel_order_id: 'RET-fixture' }]);
  http.get.mockResolvedValueOnce({ data: { tracking_data: {} } }); await provider.trackReverseShipment(401);
  expect(http.get).toHaveBeenLastCalledWith(origin + '/v1/external/courier/track/shipment/401', expect.objectContaining({ timeout: 15000 }));
});
test.each(['mock', 'live', 'missing'])('%s cannot create a local reverse shipment', async mode => {
  process.env.SHIPROCKET_MODE = mode;
  await expect(provider.createReverseOrder({})).rejects.toThrow();
  expect(http.post).not.toHaveBeenCalled();
});
test('authentication failure never submits a reverse order', async () => {
  http.post.mockRejectedValueOnce(new Error('timeout'));
  await expect(provider.createReverseOrder({})).rejects.toThrow('Shiprocket Auth Failed');
  expect(http.post).toHaveBeenCalledTimes(1);
});
