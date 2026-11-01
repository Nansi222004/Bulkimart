import { dialablePhone, directionsWebUrl, routePreviewUrl, toCoord } from '../src/utils/location';
import { routeForNotification, isDeliveryNotification } from '../src/utils/notificationRouting';
import { drivingLicenceError, isLicenseExpired, isValidPincodeList, parsePincodes, vehicleNumberError } from '../src/utils/riderDocuments';
import { isValidDeliveryLogin } from '../src/utils/session';
import { stageLabel, historyLabel, returnStatus } from '../src/utils/status';

describe('coordinates', () => {
  test('valid point', () => expect(toCoord({ lat: '22.7196', lng: 75.8577 })).toEqual({ lat: 22.7196, lng: 75.8577 }));
  test.each([[null], [{}], [{ lat: '', lng: 1 }], [{ lat: 91, lng: 0 }], [{ lat: 0, lng: 181 }], [{ lat: 0, lng: 0 }], [{ lat: 'x', lng: 1 }]])('invalid %p', (p) => expect(toCoord(p)).toBeNull());
  test('directions fall back to the address when there are no coordinates', () => {
    expect(directionsWebUrl({ coord: null, address: 'MG Road, Indore' })).toContain('destination=MG%20Road%2C%20Indore');
    expect(directionsWebUrl({ coord: null, address: '' })).toBeNull();
  });
  test('route preview needs at least the pickup', () => {
    expect(routePreviewUrl(null, { lat: 1, lng: 1 })).toBeNull();
    expect(routePreviewUrl({ lat: 1, lng: 2 }, { lat: 3, lng: 4 })).toContain('origin=1,2&destination=3,4');
  });
  test('phone numbers', () => {
    expect(dialablePhone('+91 98765-43210')).toBe('+919876543210');
    expect(dialablePhone('call me')).toBeNull();
  });
});

describe('notification routing only opens /delivery routes', () => {
  test.each([
    ['/delivery/earnings', { name: 'Main', params: { screen: 'Earnings' } }],
    ['/delivery', { name: 'Main', params: { screen: 'Duty' } }],
    ['/delivery/profile', { name: 'Main', params: { screen: 'Profile' } }],
    ['/delivery/parcels?parcel=0123456789abcdef01234567', { name: 'ParcelDetail', params: { id: '0123456789abcdef01234567' } }],
    ['/delivery/returns/0123456789abcdef01234567', { name: 'ReturnDetail', params: { id: '0123456789abcdef01234567' } }],
    ['/admin/finance', { name: 'Notifications' }],
    ['https://evil.example/delivery/earnings', { name: 'Notifications' }],
    [undefined, { name: 'Notifications' }],
  ])('%s', (route, target) => expect(routeForNotification(route)).toEqual(target));
  test('inbox filter', () => {
    expect(isDeliveryNotification({ route: '/delivery/earnings' })).toBe(true);
    expect(isDeliveryNotification({ route: '/orders' })).toBe(false);
  });
});

describe('rider documents (copy of backend/shared/riderDocuments.mjs)', () => {
  test('vehicle numbers', () => {
    expect(vehicleNumberError('MH 31 AB 1234', 'bike')).toBe('');
    expect(vehicleNumberError('22BH1234AB', 'car')).toBe('');
    expect(vehicleNumberError('ABC', 'bike')).not.toBe('');
    expect(vehicleNumberError('any-cycle-id', 'bicycle')).toBe('');
  });
  test('licence numbers', () => {
    expect(drivingLicenceError('MH31-2023-0001234')).toBe('');
    expect(drivingLicenceError('MH3118990001234')).not.toBe('');
  });
  test('pincodes', () => {
    expect(parsePincodes(' 452001, 452006 ,452001,')).toEqual(['452001', '452006']);
    expect(isValidPincodeList(['452001'])).toBe(true);
    expect(isValidPincodeList(['45200'])).toBe(false);
    expect(isValidPincodeList([])).toBe(false);
  });
  test('licence expiry follows the server flag when present', () => {
    expect(isLicenseExpired({ vehicleType: 'bike', isLicenseExpired: true })).toBe(true);
    expect(isLicenseExpired({ vehicleType: 'bicycle', isLicenseExpired: true })).toBe(false);
    expect(isLicenseExpired({ vehicleType: 'bike', drivingLicense: { expiryDate: '2000-01-01' } })).toBe(true);
    expect(isLicenseExpired({ vehicleType: 'bike', drivingLicense: { expiryDate: '2999-01-01' } })).toBe(false);
  });
});

describe('delivery login validation (mirrors web saveDeliverySession)', () => {
  const ok = { success: true, token: 't', sessionRole: 'delivery', user: { _id: 'u', roles: ['buyer', 'delivery'] } };
  test('approved rider', () => expect(isValidDeliveryLogin(ok, 'approved')).toBe(true));
  test('applicant without delivery role', () => expect(isValidDeliveryLogin({ ...ok, user: { _id: 'u', roles: ['buyer'] } }, 'pending')).toBe(true));
  test('approved status but no delivery role is refused', () => expect(isValidDeliveryLogin({ ...ok, user: { _id: 'u', roles: ['buyer'] } }, 'approved')).toBe(false));
  test('wrong session role', () => expect(isValidDeliveryLogin({ ...ok, sessionRole: 'buyer' }, 'approved')).toBe(false));
  test('unknown role', () => expect(isValidDeliveryLogin({ ...ok, user: { _id: 'u', roles: ['admin'] } }, 'approved')).toBe(false));
  test('missing token', () => expect(isValidDeliveryLogin({ ...ok, token: '' }, 'approved')).toBe(false));
});

describe('labels never invent states', () => {
  test('known and unknown stages', () => { expect(stageLabel('picked_up')).toMatch(/Picked up/); expect(stageLabel('weird_state')).toBe('weird state'); });
  test('history', () => expect(historyLabel('OFFER_EXPIRED')).toBe('Missed'));
  test('return status fallback', () => expect(returnStatus('SOMETHING_NEW').label).toBe('something new'));
});
