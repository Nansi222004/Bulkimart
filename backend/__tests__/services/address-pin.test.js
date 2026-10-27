import { jest } from '@jest/globals';

const forwardGeocode = jest.fn();
jest.unstable_mockModule('../../services/geocode.service.js', () => ({ forwardGeocode }));
const { geocodeAddressPin, pinSavedAddresses } = await import('../../services/addressPin.service.js');

const typed = () => ({ line1: 'b block', line2: '', city: 'indore', state: 'Madhya Pradesh', pincode: '452001' });

beforeEach(() => forwardGeocode.mockReset());

test('locates an address with the same lookup the order resolver uses', async () => {
  forwardGeocode.mockResolvedValue({ ok: true, lat: 22.720136, lng: 75.871369, precision: 'ROOFTOP' });
  await expect(geocodeAddressPin(typed())).resolves.toEqual({ lat: 22.720136, lng: 75.871369, locationSource: 'geocoded' });
  expect(forwardGeocode).toHaveBeenCalledWith(['b block', '', 'indore', 'Madhya Pradesh', '452001', 'India']);
});

test('pins only unpinned addresses and saves once', async () => {
  forwardGeocode.mockResolvedValue({ ok: true, lat: 22.72, lng: 75.87 });
  const pinned = { ...typed(), lat: 22.71, lng: 75.86 };
  const user = { addresses: [pinned, typed()], save: jest.fn() };
  await expect(pinSavedAddresses(user)).resolves.toBe(true);
  expect(forwardGeocode).toHaveBeenCalledTimes(1);
  expect(user.addresses[0]).toMatchObject({ lat: 22.71, lng: 75.86 });
  expect(user.addresses[1]).toMatchObject({ lat: 22.72, lng: 75.87, locationSource: 'geocoded' });
  expect(user.save).toHaveBeenCalledTimes(1);
});

test('an address that cannot be located stays unpinned, so cart and order both use the flat fee', async () => {
  forwardGeocode.mockResolvedValue({ ok: false });
  const user = { addresses: [typed()], save: jest.fn() };
  await expect(pinSavedAddresses(user)).resolves.toBe(false);
  expect(user.addresses[0].lat).toBeUndefined();
  expect(user.save).not.toHaveBeenCalled();
});
