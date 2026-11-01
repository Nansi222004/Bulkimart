/**
 * Copy of backend/shared/riderDocuments.mjs (the web registration form imports the same file).
 * Metro only bundles this app's folder, so the rules are copied, not imported.
 * Keep both files identical; the server re-checks every value anyway.
 */
export const normalizeRiderDocument = (value) => String(value ?? '').toUpperCase().replace(/[\s-]+/g, '');

const STATE_REGISTRATION = /^[A-Z]{2}\d{1,2}[A-Z]{0,3}\d{4}$/;
const BH_REGISTRATION = /^\d{2}BH\d{4}[A-Z]{1,2}$/;
const DRIVING_LICENCE = /^[A-Z]{2}\d{2}(19|20)\d{2}\d{7}$/;

export const VEHICLE_NUMBER_EXAMPLE = 'MH31AB1234';
export const DRIVING_LICENCE_EXAMPLE = 'MH3120230001234';

export const vehicleNumberError = (value, vehicleType) => {
  const number = normalizeRiderDocument(value);
  if (!number) return 'Vehicle number is required';
  if (vehicleType === 'bicycle') return number.length <= 20 ? '' : 'Bicycle identifier can be at most 20 characters';
  if (STATE_REGISTRATION.test(number) || BH_REGISTRATION.test(number)) return '';
  return `Enter the vehicle number as on the registration plate, e.g. ${VEHICLE_NUMBER_EXAMPLE}`;
};

export const drivingLicenceError = (value) => {
  const number = normalizeRiderDocument(value);
  if (!number) return 'Licence number is required for a motor vehicle';
  if (DRIVING_LICENCE.test(number)) return '';
  return `Enter the 15-character licence number, e.g. ${DRIVING_LICENCE_EXAMPLE}`;
};

// Values allowed by the DeliveryPartner.vehicleType enum.
export const VEHICLE_TYPES = [
  { key: 'bicycle', label: 'Bicycle' },
  { key: 'bike', label: 'Bike' },
  { key: 'auto', label: 'Auto' },
  { key: 'car', label: 'Car' },
];

export const isValidPhone = (phone) => /^\d{10}$/.test(phone || '');
export const isValidPincodeList = (entries) => entries.length > 0 && entries.length <= 50 && entries.every((v) => /^\d{6}$/.test(v));
export const parsePincodes = (text) => [...new Set(String(text || '').split(',').map((v) => v.trim()).filter(Boolean))];

/** Licence expiry check exactly as the server and web portal do it (bicycles carry no licence). */
export function isLicenseExpired(profile, now = new Date()) {
  if (!profile || profile.vehicleType === 'bicycle') return false;
  if (typeof profile.isLicenseExpired === 'boolean') return profile.isLicenseExpired; // server decides when it says
  const expiry = profile.drivingLicense?.expiryDate ? new Date(profile.drivingLicense.expiryDate) : null;
  return Boolean(expiry && !Number.isNaN(expiry.getTime()) && expiry < now);
}
