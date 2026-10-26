import { jest } from '@jest/globals';
import axios from 'axios';
jest.unstable_mockModule('../../config/shiprocket.js', () => ({ getShiprocketToken: async () => 'isolated-fixture-token' }));
const { verifyPickupLocation, checkServiceability } = await import('../../services/shiprocket.service.js');
let get;
const before = { mode: process.env.SHIPROCKET_MODE, base: process.env.SHIPROCKET_BASE_URL };
beforeEach(() => { process.env.SHIPROCKET_MODE = 'sandbox'; Object.assign(process.env,{SHIPROCKET_SANDBOX_BASE_URL:'https://provider.invalid',SHIPROCKET_SANDBOX_EMAIL:'fixture@example.invalid',SHIPROCKET_SANDBOX_PASSWORD:'fixture-secret',SHIPROCKET_SANDBOX_WEBHOOK_SECRET:'fixture-webhook',SHIPROCKET_SANDBOX_CONFIRMED:'true'}); get = jest.spyOn(axios, 'get'); });
afterEach(() => { get.mockRestore(); process.env.SHIPROCKET_MODE = before.mode; if (before.base === undefined) delete process.env.SHIPROCKET_BASE_URL; else process.env.SHIPROCKET_BASE_URL = before.base; });
test('pickup verification matches only the configured store location and postcode using the documented API path', async () => {
  get.mockResolvedValue({ data: { data: { shipping_address: [{ pickup_location: 'owned-store', pin_code: '400001', address: 'Store pickup', is_verified: 1 }, { pickup_location: 'other-store', pin_code: '400001', address: 'Private other store' }] } } });
  const result = await verifyPickupLocation('owned-store', { pincode: '400001' });
  expect(result.address).toBe('Store pickup'); expect(JSON.stringify(result)).not.toContain('Private other store');
  expect(get.mock.calls[0][0]).toBe('https://provider.invalid/v1/external/settings/company/pickup');
});
test.each([{ pickup_location: 'wrong-store', pin_code: '400001' }, { pickup_location: 'owned-store', pin_code: '999999' }, { pickup_location: 'owned-store', pin_code: '400001', is_verified: 0 }])('unmatched or unverified pickup fails closed: %j', async row => {
  get.mockResolvedValue({ data: { data: { shipping_address: [row] } } });
  expect(await verifyPickupLocation('owned-store', { pincode: '400001' })).toBeNull();
});
test('malformed provider response is unavailable, never silently eligible', async () => {
  get.mockResolvedValue({ data: {} }); await expect(verifyPickupLocation('owned-store', {})).rejects.toThrow('Pickup verification unavailable');
});
test('serviceability uses the documented external API path', async () => {
  get.mockResolvedValue({ data: { data: { available_courier_companies: [] } } });
  await checkServiceability({ pickupPostcode: '400001', deliveryPostcode: '400002', weight: 1, cod: true });
  expect(get.mock.calls[0][0]).toBe('https://provider.invalid/v1/external/courier/serviceability/');
});

test.each(['valid', 'wrong-id', 'wrong-phone'])('managed pickup booking rechecks the exact provider identity and contact: %s', async scenario => {
  const payload = { name: 'Fixture Store', email: 'pickup@example.invalid', phone: '9876500001', address: 'Fixture pickup street 123', city: 'Mumbai', state: 'Maharashtra', country: 'India', pin_code: '400001' };
  const row = { ...payload, pickup_location: 'owned-store', id: scenario === 'wrong-id' ? 'different-provider-id' : 'known-provider-id', status: 2, phone_verified: 1, ...(scenario === 'wrong-phone' ? { phone: '9876500002' } : {}) };
  get.mockResolvedValue({ data: { data: { shipping_address: [row] } } });
  const result = await verifyPickupLocation('owned-store', { address: payload.address, pincode: payload.pin_code }, { payload, providerId: 'known-provider-id' });
  if (scenario === 'valid') expect(result.address).toBe(payload.address); else expect(result).toBeNull();
});
