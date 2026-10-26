/**
 * Indian vehicle registration and driving-licence formats, shared by the rider
 * registration form and the API so both reject the same input.
 *
 * Spaces and hyphens are accepted while typing and removed before checking,
 * so "MH 31 AB 1234" and "MH-31-AB-1234" are both stored as MH31AB1234.
 */
export const normalizeRiderDocument = (value) => String(value ?? '').toUpperCase().replace(/[\s-]+/g, '');

// State code, RTO number, optional series letters, four-digit number (MH31AB1234, DL3C1234),
// or the national BH series (22BH1234AB).
const STATE_REGISTRATION = /^[A-Z]{2}\d{1,2}[A-Z]{0,3}\d{4}$/;
const BH_REGISTRATION = /^\d{2}BH\d{4}[A-Z]{1,2}$/;
// State code, RTO number, year of issue, seven-digit serial: MH3120230001234.
const DRIVING_LICENCE = /^[A-Z]{2}\d{2}(19|20)\d{2}\d{7}$/;

export const VEHICLE_NUMBER_EXAMPLE = 'MH31AB1234';
export const DRIVING_LICENCE_EXAMPLE = 'MH3120230001234';

/** Error message for a vehicle number, or '' when it is valid. Bicycles carry no registration plate. */
export const vehicleNumberError = (value, vehicleType) => {
  const number = normalizeRiderDocument(value);
  if (!number) return 'Vehicle number is required';
  if (vehicleType === 'bicycle') return number.length <= 20 ? '' : 'Bicycle identifier can be at most 20 characters';
  if (STATE_REGISTRATION.test(number) || BH_REGISTRATION.test(number)) return '';
  return `Enter the vehicle number as on the registration plate, e.g. ${VEHICLE_NUMBER_EXAMPLE}`;
};

/** Error message for a driving licence number, or '' when it is valid. */
export const drivingLicenceError = (value) => {
  const number = normalizeRiderDocument(value);
  if (!number) return 'Licence number is required for a motor vehicle';
  if (DRIVING_LICENCE.test(number)) return '';
  return `Enter the 15-character licence number, e.g. ${DRIVING_LICENCE_EXAMPLE}`;
};
